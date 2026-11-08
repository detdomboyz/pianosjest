"""The production recovery-kit code is exercised independently of source data."""
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'deploy/shared-host'))
import backup_replica as replica
import release_artifact as artifact
import release_backup as backup
import release_update as update
import web_backup_test as fixture


class InputContracts(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=ROOT/'tmp');self.addCleanup(self.temporary.cleanup);self.root=Path(self.temporary.name)

    def write_manifest(self,value):
        raw=backup.encoded(value);(self.root/'kit.json').write_bytes(raw);return artifact.sha256(raw)

    def test_expected_checksum_and_schema_are_required(self):
        digest=self.write_manifest({'version':7,'scope':'melodiajest-recovery-kit','files':{}})
        for expected in ['', 'x'*64, '0'*64, digest]:
            with self.assertRaises(artifact.ArtifactError):replica.load_kit(self.root,expected)

    def test_unknown_paths_sizes_and_file_counts_fail_before_reading_outside(self):
        good={f'blobs/{n:064x}.tar.gz':{'bytes':1,'sha256':'0'*64} for n in range(4)}
        for change in ['path','size','total','count']:
            files=json.loads(json.dumps(good))
            if change=='path':files['../outside']=files.pop(next(iter(files)))
            elif change=='size':files[next(iter(files))]['bytes']=True
            elif change=='total':
                for item in files.values():item['bytes']=replica.MAX_KIT
            else:files={}
            expected=self.write_manifest({'version':1,'scope':'melodiajest-recovery-kit','files':files})
            with self.assertRaises(artifact.ArtifactError):replica.load_kit(self.root,expected)

    def test_write_kit_never_replaces_an_existing_destination(self):
        destination=self.root/'existing';destination.mkdir();(destination/'saved').write_text('personal data')
        with self.assertRaises(artifact.ArtifactError):replica.write_kit({'kit.json':b'{}'},destination)
        self.assertEqual((destination/'saved').read_text(),'personal data')


@unittest.skipUnless(os.name=='posix','Real filesystem and lock cases run on Linux')
class RecoveryKits(unittest.TestCase):
    make_edition=fixture.Backups.make_edition
    write_policy=fixture.Backups.write_policy
    run_job=fixture.Backups.run_job
    complete=fixture.Backups.complete

    @classmethod
    def setUpClass(cls):fixture.Backups.setUpClass.__func__(cls)
    def setUp(self):fixture.Backups.setUp(self)
    def prepare(self):return replica.prepare(self.base,self.shared)

    def test_complete_kit_reuses_identical_bytes_without_extra_files(self):
        self.complete();first=self.prepare();kit=Path(first['path']);before={p.relative_to(kit).as_posix():(p.stat().st_mtime_ns,p.read_bytes()) for p in kit.rglob('*') if p.is_file()}
        second=self.prepare();self.assertTrue(second['reused']);self.assertEqual(second['manifestSha256'],first['manifestSha256']);self.assertEqual(first['filesVerified'],8)
        self.assertEqual(before,{p.relative_to(kit).as_posix():(p.stat().st_mtime_ns,p.read_bytes()) for p in kit.rglob('*') if p.is_file()})

    def test_cold_restore_uses_only_the_copy_after_original_paths_disappear(self):
        self.complete();prepared=self.prepare();copy=self.root/'independent-copy';shutil.copytree(prepared['path'],copy)
        self.base.rename(self.root/'source-unavailable')
        runtime=fixture.FakeNginx();result=replica.restore_check(copy,prepared['manifestSha256'],self.root/'cold',lambda base,image:runtime)
        self.assertTrue(result['success']);self.assertTrue(result['coldRestore']);self.assertFalse(result['productionInputsUsed']);self.assertEqual(result['controlsRestored'],12)
        self.assertEqual(len(runtime.checked),2);self.assertEqual(result['entries']['current']['manifestSha256'],self.shas['new'])
        self.assertTrue(all(str(self.root/'cold') in path for path in runtime.checked))

    def test_changed_archive_and_unlisted_secret_reject_the_kit(self):
        self.complete();prepared=self.prepare();kit=Path(prepared['path']);snapshot=backup.load_snapshot(kit)
        archive,_=backup.read_blob(kit,'blobs',snapshot['entries']['current']['web'],'.tar.gz');original=archive.read_bytes()
        archive.write_bytes(b'x'+original[1:])
        with self.assertRaises(artifact.ArtifactError):replica.load_kit(kit,prepared['manifestSha256'])
        archive.write_bytes(original);(kit/'password').write_text('must not be shipped')
        with self.assertRaises(artifact.ArtifactError):replica.load_kit(kit,prepared['manifestSha256'])

    def test_private_side_files_and_unreferenced_old_blobs_are_not_copied(self):
        self.complete();(self.home/'secrets.env').write_text('PRIVATE PASSWORD');(self.home/'blobs'/('0'*64+'.tar.gz')).write_text('unreferenced')
        prepared=self.prepare();kit=Path(prepared['path']);names={p.name for p in kit.rglob('*') if p.is_file()}
        self.assertNotIn('secrets.env',names);self.assertNotIn('0'*64+'.tar.gz',names)
        self.assertFalse(prepared['encrypted']);self.assertFalse(prepared['independentExternalCopyVerified'])

    def test_failed_or_stale_source_backup_cannot_produce_a_new_kit(self):
        self.complete();update.save_json(self.home/'last-backup-attempt.json',{'checkedAt':backup.utcnow(),'status':'failed'})
        with self.assertRaises(artifact.ArtifactError):self.prepare()
        self.run_job('snapshot');receipt=backup.json_file(self.home/'last-backup-success.json');receipt['checkedAt']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=31)).isoformat();update.save_json(self.home/'last-backup-success.json',receipt)
        with self.assertRaises(artifact.ArtifactError):self.prepare()

    def test_changed_current_or_previous_blocks_old_kit_reuse(self):
        self.complete();self.prepare();update.switch(self.base,'previous',None)
        with self.assertRaises(artifact.ArtifactError):self.prepare()

    def test_symlinked_archive_and_immutable_destination_are_rejected(self):
        self.complete();prepared=self.prepare();kit=Path(prepared['path']);archive=next((kit/'blobs').iterdir());outside=self.root/'outside';outside.write_bytes(archive.read_bytes());archive.unlink();archive.symlink_to(outside)
        with self.assertRaises(artifact.ArtifactError):replica.load_kit(kit,prepared['manifestSha256'])
        archive.unlink();archive.write_bytes(outside.read_bytes());moved=self.root/'moved-kit';kit.rename(moved);kit.symlink_to(moved,target_is_directory=True)
        with self.assertRaises(artifact.ArtifactError):self.prepare()

    def test_forged_success_markers_do_not_hide_a_source_from_another_release(self):
        self.complete();receipt=backup.json_file(self.home/'last-backup-success.json');snapshot=backup.load_snapshot(self.home)
        snapshot['entries']['current']['sources']=snapshot['entries']['previous']['sources'];path=self.home/receipt['snapshot'];update.save_json(path,snapshot);receipt['sha256']=artifact.sha256(path.read_bytes());update.save_json(self.home/'last-backup-success.json',receipt)
        with self.assertRaises(artifact.ArtifactError):self.prepare()
        self.assertEqual(list((self.base/'ops/external-kits').iterdir()),[])

    def test_cold_restore_failure_cannot_replace_the_original_service_or_receipts(self):
        self.complete();prepared=self.prepare();before=(self.home/'last-restore-success.json').read_bytes();runtime=fixture.FakeNginx();runtime.failure=True
        with self.assertRaises(RuntimeError):replica.restore_check(prepared['path'],prepared['manifestSha256'],self.root/'failed-cold',lambda base,image:runtime)
        self.assertEqual((self.home/'last-restore-success.json').read_bytes(),before);self.assertEqual(os.readlink(self.base/'current'),'releases/new')


if __name__=='__main__':unittest.main(verbosity=2)
