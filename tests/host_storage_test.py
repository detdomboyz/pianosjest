"""Real filesystem and GNU-tar regression checks for manual retirement."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('host_storage',ROOT/'deploy/shared-host/host_storage.py')
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)


@unittest.skipUnless(os.name=='posix','Linux metadata, symlinks and GNU tar are required')
class Retirement(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        for name in s.CONTROL_FILES:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('{}')
        (self.root/'ops/update-state.json').write_text('{"phase":"committed"}')
        for head in ('','account-service/'):
            for name,version in (('current','1.0.2'),('previous','1.0.1')):
                target=self.root/(head+'releases/'+version+'-123456789abc')
                target.mkdir(parents=True);(self.root/(head+name)).symlink_to(target)
        self.name='ops/course-test-123';p=self.root/self.name;p.mkdir()
        (p/'one').write_bytes(b'private fixture\0\xff');(p/'one').chmod(0o640)
        os.link(p/'one',p/'hardlink');(p/'link').symlink_to(p/'one')
        self.manifest=s.collect(self.root,[self.name])
        self.receipt=dict(manifestSha256=s.digest(s.encoded(self.manifest)),archiveSha256='a'*64,archiveBytes=42,
                          fullArchiveReadbackVerified=True,allMembersVerified=True,linuxRestoreVerified=True,
                          privateArchive=r'D:\MelodiaJest-private\host-maintenance\test\archive.tar.gz')
        self.token='b'*32
    def tearDown(self):self.temp.cleanup()
    def move(self):return s.quarantine(self.root,self.manifest,self.receipt,self.token,production=False)
    def test_roundtrip_rollback_and_commit(self):
        self.assertEqual(self.move()['phase'],'quarantined')
        s.rollback(self.root,self.token,production=False)
        s.verify_tree(self.root,self.manifest)
        self.token='c'*32;self.move();result=s.commit(self.root,self.token,self.receipt,production=False)
        self.assertEqual(result['deletedEntries'],4)
        self.assertTrue((self.root/'current').exists())
    def test_completed_metadata_only_removed_after_offline_hash_check(self):
        self.move();s.commit(self.root,self.token,self.receipt,production=False)
        work=s.work_dir(self.root,self.token);m=s.file_sha(work/'manifest.json');j=s.file_sha(work/'transaction.json')
        with self.assertRaises(ValueError):s.cleanup_transaction(self.root,self.token,m,'0'*64,production=False)
        self.assertTrue(work.exists())
        result=s.cleanup_transaction(self.root,self.token,m,j,production=False)
        self.assertTrue(result['temporaryTransactionRemoved']);self.assertFalse(work.exists())
    def test_protected_current_and_data(self):
        for name in ('releases/1.0.2-123456789abc','ops/course-test-123'):
            with self.assertRaises(ValueError):s.collect(self.root,[name],[self.name])
        with self.assertRaises(ValueError):s.collect(self.root,['postgres-data'])
    def test_retained_updater_archive_is_a_required_input(self):
        name='ops/artifacts/'+'a'*64+'.tar.gz';p=self.root/name;p.parent.mkdir();p.write_bytes(b'kept archive')
        (self.root/'ops/update-state.json').write_text(json.dumps(dict(phase='committed',retainedArchive=str(s.BASE/name),archiveSha256=s.file_sha(p))))
        with self.assertRaises(ValueError):s.collect(self.root,[name])
        p.unlink()
        with self.assertRaises(ValueError):s.state(self.root)
    def test_entrypoint_protects_whole_toolkit_dependency_tree(self):
        name='ops/tooling/account-0123456789abcdef/service/postgres-runtime.json';p=self.root/name;p.parent.mkdir(parents=True);p.write_text('{"required":true}')
        protected=s.execution_root('ops/tooling/account-0123456789abcdef/service/postgres.py')
        with self.assertRaises(ValueError):s.collect(self.root,[name],[protected])
        self.assertTrue(p.exists())
    def test_numeric_toolkit_name_is_collected_when_unreferenced(self):
        name='ops/tooling/s3-0123456789abcdef';p=self.root/name;p.mkdir(parents=True);(p/'runtime.py').write_text('original fixture')
        manifest=s.collect(self.root,[name]);self.assertEqual(manifest['files'],2)
    def test_completed_external_work_requires_no_active_consumer(self):
        name='ops/external-work/archive-readers222-0123456789ab';p=self.root/name;p.mkdir(parents=True);(p/'fixture').write_text('temporary source')
        self.assertEqual(s.collect(self.root,[name])['files'],2)
        protected=s.execution_root(name+'/fixture')
        with self.assertRaises(ValueError):s.collect(self.root,[name],[protected])
    def test_no_unverified_or_wrong_receipt(self):
        for key,value in [('linuxRestoreVerified',False),('manifestSha256','0'*64),('privateArchive',r'C:\temp\archive')]:
            bad=dict(self.receipt);bad[key]=value
            with self.assertRaises(ValueError):s.quarantine(self.root,self.manifest,bad,self.token,production=False)
        self.assertTrue((self.root/self.name).is_dir())
    def test_changed_file_rejected(self):
        (self.root/self.name/'one').write_bytes(b'changed')
        with self.assertRaises(ValueError):self.move()
    def test_changed_control_rejected(self):
        (self.root/'ops/account-profile.json').write_text('{"changed":true}')
        with self.assertRaises(ValueError):self.move()
    def test_live_open_input_is_preserved(self):
        with (self.root/self.name/'one').open('rb'):
            with self.assertRaises(ValueError):self.move()
        self.assertTrue((self.root/self.name/'one').exists())
    def test_paths_and_foreign_symlink_rejected(self):
        for name in ('../bad','/etc/passwd','ops//course-x','ops/course-x/../data'):
            with self.assertRaises(ValueError):s.relative(name)
        (self.root/self.name/'bad').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError):s.collect(self.root,[self.name])
    def test_unexpected_quarantine_file_blocks_deletion(self):
        self.move();p=s.work_dir(self.root,self.token)/'quarantine'/self.name/'extra';p.write_text('keep')
        with self.assertRaises(ValueError):s.commit(self.root,self.token,self.receipt,production=False)
        self.assertTrue(p.exists())
    def test_interrupt_after_rename_recovered_from_intent(self):
        actual=s.save_json
        def stop(path,value):
            if value.get('moved'):raise KeyboardInterrupt('power loss boundary')
            return actual(path,value)
        with patch.object(s,'save_json',stop):
            with self.assertRaises(KeyboardInterrupt):self.move()
        self.assertEqual(s.rollback(self.root,self.token,production=False)['phase'],'rolled-back')
        s.verify_tree(self.root,self.manifest)
    def test_hardlink_break_detected(self):
        p=self.root/self.name/'hardlink';p.unlink();p.write_bytes((self.root/self.name/'one').read_bytes());p.chmod(0o640)
        with self.assertRaises(ValueError):s.verify_tree(self.root,self.manifest,relocated=True)
    def test_gnu_tar_metadata_restore(self):
        if hasattr(os,'setxattr'):os.setxattr(self.root/self.name/'one','user.melodiajest-test',b'fixture')
        self.manifest=s.collect(self.root,[self.name])
        archive=self.root/'private.tar.gz'
        with archive.open('wb') as output:s.export_tar(self.root,self.manifest,output)
        scratch=self.root/'ops/storage-restore-test';scratch.mkdir()
        subprocess.run(['tar','-xzf',str(archive),'--numeric-owner','--same-permissions','--acls','--xattrs','-C',str(scratch)],check=True)
        result=s.verify_tree(scratch,self.manifest,relocated=True)
        self.assertTrue(result['internalHardlinksVerified'])
        self.assertTrue(s.cleanup_restored(self.root,self.manifest,str(scratch))['isolatedScratchRemoved'])
    def test_archive_only_never_authorizes_retirement(self):
        m=s.collect(self.root,[self.name],archive_only=True)
        r=dict(self.receipt,manifestSha256=s.digest(s.encoded(m)))
        with self.assertRaises(ValueError):s.quarantine(self.root,m,r,self.token,production=False)
    def test_pc_reads_every_gnu_tar_member_and_compressed_byte(self):
        spec=importlib.util.spec_from_file_location('storage_pc',ROOT/'tools/host-storage-maintenance.py')
        pc=importlib.util.module_from_spec(spec);spec.loader.exec_module(pc)
        archive=self.root/'private.tar.gz'
        with archive.open('wb') as output:s.export_tar(self.root,self.manifest,output)
        proof=pc.readback(archive,self.manifest)
        self.assertTrue(proof['allMembersVerified']);self.assertFalse(proof['linuxRestoreVerified'])
        self.assertEqual(proof['archiveSha256'],s.file_sha(archive))
        self.assertEqual(proof['members'],len(self.manifest['entries']))
        damaged=dict(self.manifest,entries=[dict(x,sha256='0'*64) if x['type']=='file' else x for x in self.manifest['entries']])
        with self.assertRaises(ValueError):pc.readback(archive,damaged)
    def test_content_transport_preserves_distinct_files_links_and_metadata(self):
        spec=importlib.util.spec_from_file_location('storage_pc',ROOT/'tools/host-storage-maintenance.py')
        pc=importlib.util.module_from_spec(spec);spec.loader.exec_module(pc)
        p=self.root/self.name;(p/'separate').write_bytes((p/'one').read_bytes());(p/'separate').chmod(0o600)
        (p/'relative-link').symlink_to('one');os.setxattr(p/'one','user.melodiajest-test',b'kept')
        m=s.collect(self.root,[self.name]);archive=self.root/'original.tar.gz';transport=self.root/'content.tar.gz'
        with archive.open('wb') as output:s.export_tar(self.root,m,output)
        packed=pc.content_pack(archive,m,transport);self.assertEqual(packed['uniqueContents'],1)
        scratch=self.root/'ops/storage-restore-content';scratch.mkdir()
        with transport.open('rb') as stream:proof=s.restore_content(scratch,m,stream)
        self.assertTrue(proof['distinctOriginalInodesPreserved'])
        self.assertEqual((scratch/self.name/'one').stat().st_ino,(scratch/self.name/'hardlink').stat().st_ino)
        self.assertNotEqual((scratch/self.name/'one').stat().st_ino,(scratch/self.name/'separate').stat().st_ino)
        s.cleanup_restored(self.root,m,str(scratch))
    def test_unknown_transport_content_refused(self):
        import io,tarfile
        archive=self.root/'bad.tar.gz'
        with tarfile.open(archive,'w:gz') as output:
            info=tarfile.TarInfo('blobs/'+'0'*64);info.size=3;output.addfile(info,io.BytesIO(b'bad'))
        scratch=self.root/'ops/storage-restore-bad';scratch.mkdir()
        with archive.open('rb') as stream:
            with self.assertRaises(ValueError):s.restore_content(scratch,self.manifest,stream)
        self.assertEqual((self.root/self.name/'one').read_bytes(),b'private fixture\0\xff')


if __name__=='__main__':unittest.main()
