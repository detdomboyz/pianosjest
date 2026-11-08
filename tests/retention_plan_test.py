"""No deletion mocks: real read-only planner and real isolated filesystem guards."""
import copy
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'deploy/shared-host'))
import retention_plan as rp

NOW = dt.datetime(2026, 11, 8, 12, tzinfo=dt.timezone.utc)


def row(index, hours=24, size=1024):
    token = 'payload-' + format(index, '016x')
    when = NOW - dt.timedelta(hours=hours)
    return dict(work=token, path='ops/external-work/' + token, holdReasons=[],
                metadataMatchedColdRestore=True, payloadContentsVerified=False,
                allocatedBytes=size, logicalBytes=size, newestMtime=when.timestamp(),
                verifiedAt=when.isoformat(), preparedAt=when.isoformat(),
                checkoutSha256=format(index + 100, '064x'),
                releaseManifestSha256=format(index + 200, '064x'),
                snapshotId=format(index + 300, '064x'),
                payloadManifestSha256=format(index + 400, '064x'))


def inventory():
    return dict(format='melodiajest-local-payload-inventory-v1', checkedAt=NOW.isoformat(),
                controls=dict(developmentSourceSha256='a' * 64,
                              releaseManifests=dict(current='b' * 64, previous='c' * 64),
                              protectedWorks=[], fingerprints={}),
                entries=[row(i, hours=30 - i) for i in range(1, 9)], unknownEntries=['keep-unrecognized'])


class Selection(unittest.TestCase):
    def test_oldest_two_bounded_deterministic_and_read_only(self):
        value = inventory(); before = copy.deepcopy(value)
        result = rp.plan(value)
        self.assertEqual([x['work'] for x in result['candidates']], [row(1)['work'], row(2)['work']])
        self.assertEqual(result['estimatedAllocatedBytes'], 2048)
        self.assertFalse(result['deletionImplemented']); self.assertFalse(result['automaticDeletionReady'])
        self.assertEqual((result['deletedFiles'], result['s3Requests']), (0, 0))
        self.assertEqual(value, before)
        self.assertEqual(rp.plan(value), result)

    def test_all_current_and_previous_payload_editions_are_protected(self):
        value = inventory()
        for i in [0, 1]:value['entries'][i]['releaseManifestSha256'] = value['controls']['releaseManifests'][['current', 'previous'][i]]
        result = rp.plan(value)
        self.assertEqual([x['work'] for x in result['candidates']], [row(3)['work'], row(4)['work']])
        self.assertTrue(all('current-or-previous-release' in x['reasons'] for x in result['held'][:2]))

    def test_development_and_explicit_historical_pins_are_protected(self):
        value = inventory(); value['entries'][0]['checkoutSha256'] = 'a' * 64
        result = rp.plan(value, [value['entries'][1]['checkoutSha256']])
        self.assertEqual([x['work'] for x in result['candidates']], [row(3)['work'], row(4)['work']])

    def test_pending_and_receipt_references_are_protected(self):
        value = inventory(); value['controls']['protectedWorks'] = [row(1)['work']]
        result = rp.plan(value)
        self.assertEqual(result['candidates'][0]['work'], row(2)['work'])
        self.assertIn('active-receipt-reference', result['held'][0]['reasons'])

    def test_three_newest_and_unknown_entries_are_preserved(self):
        result = rp.plan(inventory())
        kept = [x['work'] for x in result['held'] if 'keep-newest-three' in x['reasons']]
        self.assertEqual(kept, [row(6)['work'], row(7)['work'], row(8)['work']])
        self.assertEqual(result['unknownEntriesPreserved'], ['keep-unrecognized'])

    def test_six_hour_window_and_future_receipt_are_held(self):
        value = inventory()
        for x in value['entries']:x['verifiedAt'] = (NOW - dt.timedelta(hours=5)).isoformat()
        value['entries'][0]['verifiedAt'] = (NOW + dt.timedelta(hours=1)).isoformat()
        self.assertEqual(rp.plan(value)['candidates'], [])

    def test_allocated_limit_is_not_logical_size_or_freed_space(self):
        value = inventory(); value['entries'][0].update(allocatedBytes=48 * 1024**2, logicalBytes=1)
        value['entries'][1]['allocatedBytes'] = 32 * 1024**2
        result = rp.plan(value)
        self.assertEqual(result['candidates'][0]['work'], row(1)['work'])
        self.assertNotIn(row(2)['work'], [x['work'] for x in result['candidates']])
        self.assertLessEqual(result['estimatedAllocatedBytes'], 64 * 1024**2)
        self.assertNotIn('freedBytes', result)

    def test_missing_size_bool_and_nonfinite_time_never_qualify(self):
        for change in [{'allocatedBytes': None}, {'allocatedBytes': True}, {'newestMtime': float('nan')}, {'newestMtime': True}, {'metadataMatchedColdRestore': 1}]:
            value = inventory(); value['entries'][0].update(change)
            self.assertNotIn(row(1)['work'], [x['work'] for x in rp.plan(value)['candidates']])

    def test_unknown_failed_and_partial_restore_hold(self):
        value = inventory(); value['entries'][0]['holdReasons'] = ['external restore unconfirmed']
        value['entries'][1]['metadataMatchedColdRestore'] = False
        self.assertEqual(rp.plan(value)['candidates'][0]['work'], row(3)['work'])

    def test_duplicate_escape_wrong_pin_and_naive_timestamp_refused(self):
        for mutation in ['duplicate', 'escape', 'pin', 'time']:
            value = inventory()
            if mutation == 'duplicate':value['entries'].append(copy.deepcopy(value['entries'][0]))
            elif mutation == 'escape':value['entries'][0]['path'] = 'ops/../libre'
            elif mutation == 'pin':value['controls']['developmentSourceSha256'] = '../outside'
            else:value['checkedAt'] = '2026-11-08T12:00:00'
            with self.assertRaises(ValueError):rp.plan(value)
        with self.assertRaises(ValueError):rp.plan(inventory(), ['x'])

    def test_work_references_include_nested_pending_backup(self):
        a, b = row(1)['work'], row(2)['work']
        self.assertEqual(rp.references(dict(prepared=dict(work=a), backup=dict(prepared=dict(work=b)))), {a, b})
        with self.assertRaises(ValueError):rp.references(dict(work='../../libre'))
        with self.assertRaises(ValueError):rp.references(dict(backup=None))

    def test_cli_has_no_apply_delete_base_or_restic_operation(self):
        for args in [['apply'], ['plan', '--base', '/opt/libre'], ['plan', '--delete']]:
            completed = subprocess.run([sys.executable, '-B', str(ROOT/'deploy/shared-host/retention_plan.py'), *args], capture_output=True)
            self.assertEqual(completed.returncode, 2)
        text=(ROOT/'deploy/shared-host/retention_plan.py').read_text()
        for token in ['shutil.rmtree', 'os.remove(', '.unlink(', '.rename(', 'docker', 'restic']:
            self.assertNotIn(token, '\n'.join(x for x in text.splitlines() if not x.lstrip().startswith(('"""', 'No removal'))))


class Filesystem(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='retention-test-', dir=ROOT/'tmp'); self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve(); self.work = self.root/row(1)['work']; self.work.mkdir()

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(value), encoding='utf-8')

    def sample(self):
        x = row(1); prepared = dict(work=x['work'], checkedAt=(NOW-dt.timedelta(days=2)).isoformat(), payloadManifestSha256=x['payloadManifestSha256'], checkoutArchiveSha256=x['checkoutSha256'], currentWebManifestSha256=x['releaseManifestSha256'], bytes=100)
        payload = dict(format='melodiajest-external-payload-v1', checkoutArchiveSha256=x['checkoutSha256'])
        self.write(self.work/'payload/payload.json', payload)
        prepared['payloadManifestSha256'] = rp.artifact.sha256((self.work/'payload/payload.json').read_bytes())
        backup = dict(work=x['work'], success=True, checkedAt=(NOW-dt.timedelta(hours=30)).isoformat(), prepared=prepared, snapshotId=x['snapshotId'])
        restored = dict(success=True, checkedAt=(NOW-dt.timedelta(days=1)).isoformat(), snapshotId=x['snapshotId'], payloadManifestSha256=prepared['payloadManifestSha256'], independentExternalCopyVerified=True, productionInputsMounted=False, originalPayloadTemporarilyUnavailable=True, temporaryRestoreRemoved=True, checkoutRestore=dict(archiveSha256=x['checkoutSha256']))
        for name,value in [('prepared', prepared), ('backup-success', backup), ('restore-success', restored)]:self.write(self.work/(name+'.json'), value)
        return restored

    def test_real_receipt_and_manifest_bytes_match_without_mutation(self):
        self.sample(); before={p.relative_to(self.work).as_posix():p.read_bytes() for p in self.work.rglob('*') if p.is_file()}
        result=rp.work_summary(self.work)
        self.assertTrue(result['metadataMatchedColdRestore']); self.assertEqual(result['holdReasons'], [])
        self.assertFalse(result['payloadContentsVerified'])
        self.assertEqual(before, {p.relative_to(self.work).as_posix():p.read_bytes() for p in self.work.rglob('*') if p.is_file()})

    def test_bad_snapshot_payload_source_and_truthy_restore_are_held(self):
        for field, value in [('snapshotId','0'*64), ('payloadManifestSha256','0'*64), ('independentExternalCopyVerified',1), ('productionInputsMounted',True)]:
            restored=self.sample(); restored[field]=value; self.write(self.work/'restore-success.json',restored)
            self.assertTrue(rp.work_summary(self.work)['holdReasons'])

    def test_unknown_extra_file_and_incomplete_restore_are_preserved(self):
        self.sample();(self.work/'unrecognized').write_text('keep')
        self.assertTrue(rp.work_summary(self.work)['holdReasons']);self.assertTrue((self.work/'unrecognized').exists())
        with tempfile.TemporaryDirectory(dir=self.root) as name:self.assertTrue(rp.work_summary(Path(name))['holdReasons'])

    def test_metadata_limit_refuses_large_data_and_leaves_it_intact(self):
        target=self.root/'large.json';target.write_bytes(b'x'*(rp.MAX_JSON+1))
        with self.assertRaises(ValueError):rp.read_json(target)
        self.assertEqual(target.stat().st_size,rp.MAX_JSON+1)

    @unittest.skipUnless(os.name=='posix','Native links and device accounting also run in isolated Linux')
    def test_symlink_and_hardlink_are_rejected_without_following(self):
        self.sample(); outside=self.root/'outside';outside.write_text('private sentinel')
        (self.work/'escape').symlink_to(outside)
        self.assertTrue(rp.work_summary(self.work)['holdReasons']);(self.work/'escape').unlink()
        os.link(outside,self.work/'hardlink')
        self.assertTrue(rp.work_summary(self.work)['holdReasons']);self.assertEqual(outside.read_text(),'private sentinel')

    @unittest.skipUnless(os.name=='posix','Actual POSIX read-lock coordination is tested on Linux')
    def test_read_locks_refuse_busy_shared_and_own_without_creating_files(self):
        import fcntl
        base=self.root/'app';(base/'ops').mkdir(parents=True);shared=self.root/'shared.lock';own=base/'ops/operation.lock'
        for target in [shared,own]:target.touch()
        before={p.relative_to(self.root).as_posix() for p in self.root.rglob('*')}
        for target in [shared,own]:
            with target.open('r') as held:
                fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError):
                    with rp.read_locks(base,shared):self.fail('Busy lock was bypassed')
        with rp.read_locks(base,shared):pass
        self.assertEqual(before,{p.relative_to(self.root).as_posix() for p in self.root.rglob('*')})

    def control_fixture(self):
        base=self.root/'app';(base/'ops/external-work').mkdir(parents=True)
        for name,content in [('current',{'version':'1.0.1'}),('previous',{'version':'1.0.0'})]:
            rel='releases/'+content['version']+'-'+'d'*12;target=base/rel;target.mkdir(parents=True)
            self.write(target/'web-release.json',content);(base/name).symlink_to(rel,target_is_directory=True)
        self.write(base/'ops/update-state.json',dict(phase='committed'))
        self.write(base/'ops/s3-schedule.json',dict(developmentArchiveSha256='a'*64))
        self.write(base/'ops/external-s3/scheduled/pending.json',dict(prepared=dict(work=row(1)['work'])))
        return base

    @unittest.skipUnless(os.name=='posix','Actual release symlinks are also checked in isolated Linux')
    def test_actual_collection_protects_release_and_pending_and_changes_nothing(self):
        base=self.control_fixture();self.work.rename(base/'ops/external-work'/self.work.name)
        before={p.relative_to(base).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file() and not p.is_symlink()}
        result=rp.collect(base,now=NOW)
        self.assertEqual(result['controls']['protectedWorks'],[row(1)['work']])
        self.assertEqual(result['controls']['releaseManifests']['current'],rp.artifact.sha256((base/'current/web-release.json').read_bytes()))
        self.assertEqual(len(result['entries']),1)
        self.assertEqual(before,{p.relative_to(base).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file() and not p.is_symlink()})

    @unittest.skipUnless(os.name=='posix','Actual release and control CAS are also checked in isolated Linux')
    def test_control_change_during_scan_is_refused_and_failed_attempt_holds(self):
        base=self.control_fixture();self.work.rename(base/'ops/external-work'/self.work.name)
        original=rp.work_summary
        def changed(folder):
            result=original(folder);self.write(base/'ops/update-state.json',dict(phase='committed',different='receipt changed'));return result
        with patch.object(rp,'work_summary',changed):
            with self.assertRaisesRegex(ValueError,'control state changed'):rp.collect(base,now=NOW)
        self.write(base/'ops/external-s3/last-attempt.json',dict(status='failed'))
        with self.assertRaisesRegex(ValueError,'unhealthy'):rp.collect(base,now=NOW)


if __name__=='__main__':unittest.main(verbosity=2)
