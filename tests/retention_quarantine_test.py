"""Actual bounded rename/recovery on isolated files; no production input mounts."""
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
sys.path.insert(0, str(ROOT/'deploy/shared-host'))
import retention_plan as rp
import retention_quarantine as q
import backup_s3_runtime as runtime


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding='utf-8')
    return rp.artifact.sha256(path.read_bytes())


def minimal_plan(at):
    entry = dict(work='payload-'+'1'*16, path='ops/external-work/payload-'+'1'*16, payloadContentsVerified=True, metadataMatchedColdRestore=True, holdReasons=[])
    return dict(format='melodiajest-local-payload-retention-plan-v1', checkedAt=at.isoformat(), candidates=[entry], pinnedSourceSha256s=['a'*64], estimatedAllocatedBytes=4096)


class PortableContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='quarantine-contract-',dir=ROOT/'tmp');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.at=q.now();self.path=self.root/'plan.json';self.plan=minimal_plan(self.at);self.sha=save(self.path,self.plan)

    def test_bounded_plan_requires_exact_external_sha(self):
        self.assertEqual(q.read_plan(self.path,self.sha,at=self.at),self.plan)
        for sha in ['b'*64,'../escape','']:
            with self.assertRaises(ValueError):q.read_plan(self.path,sha,at=self.at)

    def test_expired_future_and_naive_plans_refused(self):
        for value in [self.at-dt.timedelta(seconds=901),self.at+dt.timedelta(seconds=1),self.at.replace(tzinfo=None)]:
            self.plan['checkedAt']=value.isoformat();sha=save(self.path,self.plan)
            with self.assertRaises(ValueError):q.read_plan(self.path,sha,at=self.at)

    def test_escape_duplicates_extra_candidates_hold_and_budget_refused(self):
        original=copy.deepcopy(self.plan)
        for change in ['escape','duplicate','three','unverified','held','budget','pin']:
            self.plan=copy.deepcopy(original)
            if change=='escape':self.plan['candidates'][0]['path']='ops/../libre'
            if change=='duplicate':self.plan['candidates']*=2
            if change=='three':self.plan['candidates']*=3
            if change=='unverified':self.plan['candidates'][0]['payloadContentsVerified']=1
            if change=='held':self.plan['candidates'][0]['holdReasons']=['keep-current']
            if change=='budget':self.plan['estimatedAllocatedBytes']=64*1024**2+1
            if change=='pin':self.plan['pinnedSourceSha256s']=['invalid']
            sha=save(self.path,self.plan)
            with self.assertRaises(ValueError):q.read_plan(self.path,sha,at=self.at)

    def test_linux_write_guard_does_not_create_anything(self):
        before=list(self.root.rglob('*'))
        with patch.object(q.sys,'platform','win32'):
            with self.assertRaisesRegex(ValueError,'Linux required'):
                with q.exclusive_locks(self.root,self.root/'not-a-lock'):self.fail('guard bypassed')
        self.assertEqual(list(self.root.rglob('*')),before)

    def test_mountinfo_escape_and_bind_volume_sources_are_distinct(self):
        mounts=q.mount_sources('1 0 0:1 / / rw - ext4 /dev/x rw\n2 1 0:1 / /a\\040b rw - ext4 /dev/x rw',[[dict(Type='bind',Source='/payload'),dict(Type='volume',Source='/volume'),dict(Type='tmpfs')]])
        self.assertIn(dict(kind='mountpoint',path='/a b'),mounts)
        q.no_mounts([Path('/unrelated/work')],[mounts[0]])
        for value in [dict(kind='docker-source',path='/'),dict(kind='docker-source',path='/unrelated'),dict(kind='mountpoint',path='/unrelated/work/inside'),dict(kind='docker-source',path='/unrelated/work')]:
            with self.assertRaises(ValueError):q.no_mounts([Path('/unrelated/work')],[value])
        with self.assertRaises(ValueError):q.mount_sources('broken',[])

    def test_cli_offers_neither_arbitrary_base_nor_purge_or_timer(self):
        tool=ROOT/'deploy/shared-host/retention_quarantine.py'
        for args in [['purge'],['delete'],['quarantine','--base','/opt/libre'],['recover','--batch','../../libre','--sha256','a'*64]]:
            p=subprocess.run([sys.executable,'-B',str(tool),*args],capture_output=True)
            self.assertNotEqual(p.returncode,0)
        text=tool.read_text(encoding='utf-8')
        for token in ['shutil.rmtree','.unlink(', 'docker prune', "['restic",'systemctl']:
            self.assertNotIn(token,text)

    def test_intent_external_sha_and_work_paths_cannot_be_substituted(self):
        batch=self.root/('quarantine-'+'a'*32);batch.mkdir()
        entry=dict(work='payload-'+'1'*16,tree={'.':{}},snapshotId='b'*64,payloadManifestSha256='c'*64)
        value=dict(format=q.FORMAT,batch=batch.name,planSha256='a'*64,entries=[entry]);sha=save(batch/'intent.json',value)
        self.assertEqual(q.load_intent(batch,sha),value)
        value['entries'][0]['work']='../../other';sha=save(batch/'intent.json',value)
        with self.assertRaises(ValueError):q.load_intent(batch,sha)
        with self.assertRaises(ValueError):q.load_intent(batch,'f'*64)


@unittest.skipUnless(sys.platform.startswith('linux'),'Actual Linux flock, renameat2 and inode recovery run in isolated Linux')
class LinuxFilesystem(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='quarantine-native-',dir=ROOT/'tmp');self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.base=self.root/'app';self.home=self.base/'ops/external-work';self.home.mkdir(parents=True)
        self.shared=self.root/'shared.lock';self.shared.touch();(self.base/'ops/operation.lock').touch()
        self.at=q.now();self.work_names=[]
        for label,version in [('current','1.0.1'),('previous','1.0.0')]:
            rel='releases/'+version+'-'+'d'*12;folder=self.base/rel;folder.mkdir(parents=True);save(folder/'web-release.json',dict(version=version));(self.base/label).symlink_to(rel,target_is_directory=True)
        save(self.base/'ops/update-state.json',dict(phase='committed'))
        save(self.base/'ops/s3-schedule.json',dict(developmentArchiveSha256='a'*64))
        self.sentinel=self.root/'foreign';self.sentinel.write_bytes(b'foreign data must survive')
        for index in range(1,9):self.seed_work(index)
        self.plan=rp.plan(rp.collect(self.base,now=self.at),['d'*64])
        for row in self.plan['candidates']:
            rp.job.verify_payload(self.base/row['path']/'payload',row['payloadManifestSha256']);row['payloadContentsVerified']=True
        self.plan_file=self.root/'plan.json';self.plan_sha=save(self.plan_file,self.plan)
        self.before={n:self.bytes_of(self.home/n) for n in self.work_names};self.emitted=[]
        self.mount_patch=patch.object(q,'production_mounts',return_value=[]);self.mount_patch.start();self.addCleanup(self.mount_patch.stop)

    def bytes_of(self,folder):
        return {p.relative_to(folder).as_posix():p.read_bytes() for p in folder.rglob('*') if p.is_file()}

    def seed_work(self,index):
        token='payload-'+format(index,'016x');folder=self.home/token;payload=folder/'payload';payload.mkdir(parents=True);self.work_names.append(token)
        paths=['checkout.tar.gz','external-config.json','runtime-pin.json','runtime/restic_0.19.1_linux_amd64.bz2','runtime/SHA256SUMS','runtime/SHA256SUMS.asc','runtime/restic-signing-key.asc','published/kit.json']
        for name in paths:
            target=payload/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(('fixture-'+str(index)+'-'+name).encode())
        save(payload/'external-config.json',runtime.configuration())
        listing={p.relative_to(payload).as_posix():rp.artifact.descriptor(p.read_bytes()) for p in payload.rglob('*') if p.is_file()}
        manifest=dict(format='melodiajest-external-payload-v1',checkoutArchiveSha256=format(index+100,'064x'),files=listing)
        sha=save(payload/'payload.json',manifest);when=(self.at-dt.timedelta(hours=40-index)).isoformat()
        prepared=dict(work=token,checkedAt=when,payloadManifestSha256=sha,checkoutArchiveSha256=manifest['checkoutArchiveSha256'],currentWebManifestSha256=format(index+200,'064x'),bytes=sum(x['bytes'] for x in listing.values())+(payload/'payload.json').stat().st_size)
        save(folder/'prepared.json',prepared);save(folder/'backup-success.json',dict(work=token,success=True,checkedAt=when,prepared=prepared,snapshotId=format(index+300,'064x')))
        save(folder/'restore-success.json',dict(success=True,checkedAt=when,payloadManifestSha256=sha,snapshotId=format(index+300,'064x'),independentExternalCopyVerified=True,productionInputsMounted=False,originalPayloadTemporarilyUnavailable=True,temporaryRestoreRemoved=True,checkoutRestore=dict(archiveSha256=manifest['checkoutArchiveSha256'])))
        cache=folder/'cache-backup';cache.mkdir();(cache/'cache-data').write_bytes(b'local cache retained too')
        old=self.at.timestamp()-(40-index)*3600
        for path in [*folder.rglob('*'),folder]:os.utime(path,(old,old))

    def apply(self,fault=lambda stage,index:None):
        return q.quarantine(self.base,self.plan_file,self.plan_sha,shared=self.shared,emit=self.emitted.append,fault=fault)

    def recover(self,proof=None,fault=lambda stage,index:None):
        proof=proof or self.emitted[0]
        return q.recover(self.base,proof['batch'],proof['intentSha256'],shared=self.shared,fault=fault)

    def unchanged(self):
        self.assertEqual(self.sentinel.read_bytes(),b'foreign data must survive')
        for token,files in self.before.items():self.assertEqual(self.bytes_of(self.home/token),files)

    def test_real_two_directory_roundtrip_and_repeated_recovery_preserve_every_byte(self):
        self.assertEqual(len(self.plan['candidates']),2)
        first=self.home/self.plan['candidates'][0]['work'];inode=first.stat().st_ino
        proof=self.apply();self.assertEqual(proof['quarantinedWorks'],2);self.assertEqual(proof['actuallyFreedBytes'],0)
        self.assertFalse(first.exists());result=self.recover(proof);self.assertEqual(result['restoredWorks'],2);self.assertEqual(first.stat().st_ino,inode);self.unchanged()
        self.assertEqual(self.recover(proof)['alreadyAtSource'],2);self.unchanged()

    def test_crash_after_first_rename_is_reconciled_without_trusting_journal(self):
        def crash(stage,index):
            if stage=='after-move' and index==0:raise RuntimeError('power loss before journal update')
        with self.assertRaisesRegex(RuntimeError,'power loss'):self.apply(crash)
        batch=self.base/'ops/retention-quarantine'/self.emitted[0]['batch'];(batch/'journal.json').write_bytes(b'corrupt mutable journal')
        self.assertEqual(self.recover()['restoredWorks'],1);self.unchanged()

    def test_crash_before_first_rename_recovers_as_noop(self):
        def crash(stage,index):raise RuntimeError('interrupt before move')
        with self.assertRaises(RuntimeError):self.apply(crash)
        self.assertEqual(self.recover()['alreadyAtSource'],2);self.unchanged()

    def test_interrupted_recovery_resumes_exact_remaining_directory(self):
        proof=self.apply()
        def crash(stage,index):
            if stage=='after-return' and index==0:raise RuntimeError('recovery interrupted')
        with self.assertRaises(RuntimeError):self.recover(proof,crash)
        result=self.recover(proof);self.assertEqual((result['restoredWorks'],result['alreadyAtSource']),(1,1));self.unchanged()

    def test_changed_controls_before_second_move_stop_and_allow_return(self):
        def change(stage,index):
            if stage=='before-move' and index==1:save(self.base/'ops/update-state.json',dict(phase='committed',new='different current receipt'))
        with self.assertRaisesRegex(ValueError,'controls changed'):self.apply(change)
        self.recover();self.unchanged();self.assertIn('new',json.loads((self.base/'ops/update-state.json').read_text(encoding='utf-8')))

    def test_stale_plan_after_control_change_never_creates_quarantine(self):
        save(self.base/'ops/update-state.json',dict(phase='committed',other='changed'))
        with self.assertRaisesRegex(ValueError,'changed'):self.apply()
        self.assertFalse((self.base/'ops/retention-quarantine').exists());self.unchanged()

    def test_actual_mount_or_bind_blocks_move_before_intent(self):
        target=self.home/self.plan['candidates'][0]['work']
        for source in [target,target/'payload',self.home,Path('/')]:
            with patch.object(q,'production_mounts',return_value=[dict(kind='docker-source',path=str(source))]):
                with self.assertRaises(ValueError):self.apply()
        self.assertFalse((self.base/'ops/retention-quarantine').exists());self.unchanged()

    def test_changed_payload_bytes_refused_before_any_move(self):
        target=self.home/self.plan['candidates'][0]['work']/'payload/checkout.tar.gz';target.write_bytes(b'changed actual data')
        with self.assertRaises(ValueError):self.apply()
        self.assertFalse((self.base/'ops/retention-quarantine').exists());self.assertEqual(target.read_bytes(),b'changed actual data')

    def test_actual_shared_and_own_locks_are_not_bypassed_or_created(self):
        import fcntl
        for path in [self.shared,self.base/'ops/operation.lock']:
            with path.open('r+') as held:
                fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError):self.apply()
        self.assertFalse((self.base/'ops/retention-quarantine').exists());self.unchanged()

    def test_hardlink_and_symlink_in_cache_are_preserved_and_refused(self):
        target=self.home/self.plan['candidates'][0]['work']/'cache-backup/escape'
        for kind in ['symlink','hardlink']:
            if kind=='symlink':target.symlink_to(self.sentinel)
            else:os.link(self.sentinel,target)
            with self.assertRaises(ValueError):self.apply()
            target.unlink()
        self.assertEqual(self.sentinel.read_bytes(),b'foreign data must survive')

    def test_no_replace_rename_refuses_even_existing_empty_destination(self):
        source=self.root/'move-source';source.mkdir();target=self.root/'existing-empty';target.mkdir();ino=target.stat().st_ino
        with self.assertRaises(FileExistsError):q.rename_no_replace(source,target)
        self.assertTrue(source.is_dir());self.assertEqual(target.stat().st_ino,ino)

    def test_missing_renameat2_has_no_overwrite_fallback(self):
        source=self.root/'move-source';source.mkdir();target=self.root/'target'
        with patch.object(q.ctypes,'CDLL',return_value=object()):
            with self.assertRaisesRegex(ValueError,'no unsafe fallback'):q.rename_no_replace(source,target)
        self.assertTrue(source.is_dir());self.assertFalse(target.exists())

    def test_changed_quarantined_byte_blocks_all_recovery_moves(self):
        proof=self.apply();target=self.base/'ops/retention-quarantine'/proof['batch']/'works'/self.plan['candidates'][1]['work']/'payload/checkout.tar.gz';target.write_bytes(b'tampered')
        with self.assertRaisesRegex(ValueError,'tree changed'):self.recover(proof)
        self.assertTrue(target.exists());self.assertFalse((self.home/self.plan['candidates'][0]['work']).exists())

    def test_recovery_never_overwrites_recreated_source_or_foreign_link(self):
        proof=self.apply();target=self.home/self.plan['candidates'][0]['work'];target.mkdir();(target/'foreign').write_bytes(b'keep me')
        with self.assertRaisesRegex(ValueError,'ambiguous'):self.recover(proof)
        self.assertEqual((target/'foreign').read_bytes(),b'keep me')

    def test_quarantine_root_must_be_private_and_unlinked(self):
        target=self.base/'ops/retention-quarantine';target.mkdir(mode=0o755)
        with self.assertRaisesRegex(ValueError,'mode'):self.apply()
        self.unchanged()

    def test_recovery_intent_tamper_and_unknown_work_are_refused(self):
        proof=self.apply();batch=self.base/'ops/retention-quarantine'/proof['batch'];(batch/'works/unknown').mkdir()
        with self.assertRaisesRegex(ValueError,'unknown'):self.recover(proof)
        (batch/'works/unknown').rmdir();(batch/'intent.json').write_bytes(b'changed intent')
        with self.assertRaisesRegex(ValueError,'SHA256'):self.recover(proof)


if __name__=='__main__':unittest.main(verbosity=2)
