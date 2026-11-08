"""Real backup code; POSIX cases also run on Linux with an isolated fixture."""
import base64
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'deploy/shared-host'))
import backup_units
import release_artifact as artifact
import release_backup as backup
import release_update as update


class Contracts(unittest.TestCase):
    def test_only_six_own_units_and_pinned_tooling(self):
        units=backup_units.render('/opt/melodiajest/ops/tooling/backup-'+'a'*16)
        self.assertEqual(set(units),backup.UNITS)
        self.assertEqual(len(units),6)
        for name,body in units.items():
            self.assertTrue(name.startswith('melodiajest-'))
            if name.endswith('.timer'):
                self.assertIn('Persistent=true',body)
                self.assertIn('Unit='+name.removesuffix('.timer')+'.service',body)
            else:
                for contract in ['Type=oneshot','PrivateNetwork=yes','ProtectSystem=strict','UMask=0077','MemoryMax=256M','/run/lock/libre-deploy.lock']:
                    self.assertIn(contract,body)
                self.assertNotIn('RemainAfterExit=yes',body)
                self.assertNotIn('docker prune',body)

    def test_rejects_other_projects_mutable_paths_and_command_injection(self):
        for name in ['/opt/libre/ops/tooling/backup-'+'a'*16,'/opt/melodiajest/current','/opt/melodiajest/ops/tooling/backup-'+'a'*16+';touch /tmp/unexpected']:
            with self.assertRaises(ValueError):backup_units.render(name)

    def control(self):
        return backup.encoded({'version':1,'files':{name:{**artifact.descriptor(name.encode()),'data':base64.b64encode(name.encode()).decode()} for name in backup.CONTROL_NAMES}})

    def test_control_restoration_requires_exact_own_names_and_hashes(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'tmp') as temporary:
            destination=Path(temporary)/'restore'
            self.assertEqual(backup.restore_controls(self.control(),destination),12)
            self.assertEqual((destination/'policy.json').read_bytes(),b'policy.json')
            with self.assertRaises(artifact.ArtifactError):backup.restore_controls(self.control(),destination)
            for change in ['path','hash','extra']:
                value=json.loads(self.control())
                if change=='path':value['files']['../outside']=value['files'].pop('policy.json')
                elif change=='hash':value['files']['policy.json']['sha256']='0'*64
                else:value['files']['systemd/libre-backup.timer']=value['files']['policy.json']
                with self.assertRaises(artifact.ArtifactError):backup.restore_controls(backup.encoded(value),Path(temporary)/change)
            self.assertFalse((Path(temporary)/'outside').exists())

    def test_blob_reads_validate_size_hash_and_hash_path(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'tmp') as temporary:
            home=Path(temporary);(home/'blobs').mkdir();raw=b'known backup';desc=artifact.descriptor(raw)
            path=home/'blobs'/(desc['sha256']+'.tar.gz');path.write_bytes(raw)
            self.assertEqual(backup.read_blob(home,'blobs',desc,'.tar.gz')[1],raw)
            for bad in [desc|{'sha256':'../../outside'},desc|{'bytes':True},desc|{'bytes':0}]:
                with self.assertRaises(artifact.ArtifactError):backup.read_blob(home,'blobs',bad,'.tar.gz')
            path.write_bytes(b'wrong bytes!')
            with self.assertRaises(artifact.ArtifactError):backup.read_blob(home,'blobs',desc,'.tar.gz')

    def test_production_cli_has_no_other_base_or_destructive_command(self):
        body=(ROOT/'deploy/shared-host/release_backup.py').read_text()
        self.assertIn('base = update.PRODUCTION',body)
        for unwanted in ["add_argument('--base'",'extractall(',"'prune'",'systemctl restart','/opt/libre/deploy']:
            self.assertNotIn(unwanted,body)


class FakeNginx:
    def __init__(self):self.failure=False;self.checked=[]
    def verify(self,target,config):
        if self.failure:raise RuntimeError('isolated runtime failure')
        data=artifact.read_web(target)
        self.checked.append(str(target))
        return {'healthy':True,'manifestSha256':artifact.sha256(data['web-release.json']),'publicFilesVerified':len(data),'network':'none','publicPorts':False}


@unittest.skipUnless(os.name=='posix','Full filesystem/flock suite is run on Linux')
class Backups(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.suite=tempfile.TemporaryDirectory(prefix='backup-tests-',dir=ROOT/'tmp');cls.addClassCleanup(cls.suite.cleanup)
        cls.suite_root=Path(cls.suite.name)
        if os.environ.get('BACKUP_WEB_FIXTURE'):cls.fixture=Path(os.environ['BACKUP_WEB_FIXTURE'])
        else:
            cls.fixture=cls.suite_root/'web'
            subprocess.run(['node','--preserve-symlinks','--preserve-symlinks-main','-e',"require('./tools/build-web.cjs').buildWeb({outDir:process.argv[1]})",str(cls.fixture)],cwd=ROOT,check=True,capture_output=True)
        cls.config=Path(os.environ.get('BACKUP_CONFIG_FIXTURE',ROOT/'deploy/shared-host'))

    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(dir=self.suite_root);self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);self.base=self.root/'app';self.base.mkdir()
        for name in ['releases','deploy','ops']:(self.base/name).mkdir()
        for name in artifact.CONFIG:shutil.copyfile(self.config/name,self.base/'deploy'/name)
        self.source=self.root/'checkout';self.source.mkdir();(self.source/'piano-lesson-development.js').write_text('CURRENT UNCOMMITTED LESSON SOURCE')
        (self.source/'trainer-content.json').write_text('PRIVATE NOTES');(self.source/'.env').write_text('PRIVATE KEY')
        (self.base/'ops/artifacts').mkdir()
        self.policy={'version':1,'scope':'melodiajest-only','image':'sha256:'+'a'*64,'sourceSeeds':{}}
        self.shas={}
        for name,version in [('old','1.0.0'),('new','1.0.1')]:self.make_edition(name,version)
        (self.base/'current').symlink_to('releases/new',target_is_directory=True)
        (self.base/'previous').symlink_to('releases/old',target_is_directory=True)
        self.write_policy()
        self.units=self.root/'units';self.units.mkdir()
        for name,body in backup_units.render('/opt/melodiajest/ops/tooling/backup-'+'a'*16).items():(self.units/name).write_text(body)
        self.tooling=ROOT/'deploy/shared-host';self.shared=self.root/'shared.lock';self.runtime=FakeNginx()
        self.home=backup.layout(self.base)

    def make_edition(self,name,version):
        web=self.base/'releases'/name;shutil.copytree(self.fixture,web)
        manifest=json.loads((web/'web-release.json').read_bytes());manifest['version']=version
        (web/'web-release.json').write_bytes(backup.encoded(manifest))
        archive=self.base/'ops/artifacts'/(name+'.tar.gz')
        result=artifact.pack(web,self.base/'deploy',archive,self.source)
        self.shas[name]=result['webManifestSha256']
        self.policy['sourceSeeds'][self.shas[name]]={'path':archive.relative_to(self.base).as_posix(),'sha256':result['sha256']}
        return result

    def write_policy(self):update.save_json(self.base/'ops/backup-policy.json',self.policy)
    def run_job(self,command):return backup.run_job(self.base,command,self.tooling,self.units,self.runtime,self.shared)
    def complete(self):self.run_job('snapshot');self.run_job('restore-check');self.assertTrue(self.run_job('health')['success'])

    def test_daily_backup_and_restore_cover_current_previous_sources_and_controls(self):
        self.complete();saved=backup.load_snapshot(self.home)
        self.assertEqual(set(saved['entries']),{'current','previous'})
        result=backup.json_file(self.home/'last-restore-success.json')
        self.assertEqual(result['controlsRestored'],12);self.assertEqual(len(self.runtime.checked),2)
        for role in ['current','previous']:
            self.assertEqual(result['entries'][role]['runtime']['publicFilesVerified'],28)
            self.assertTrue(result['entries'][role]['files']['sources']['sourceSnapshotIncluded'])
            archive,_=backup.read_blob(self.home,'blobs',saved['entries'][role]['sources'],'.tar.gz')
            files,_=artifact.read_bundle(archive,saved['entries'][role]['sources']['sha256'])
            self.assertEqual(files['source/piano-lesson-development.js'],b'CURRENT UNCOMMITTED LESSON SOURCE')
            self.assertNotIn('source/trainer-content.json',files);self.assertNotIn('source/.env',files)
        self.assertEqual(os.readlink(self.base/'current'),'releases/new')

    def test_identical_daily_payload_reuses_blobs_without_rewriting_them(self):
        self.run_job('snapshot');before={p.name:(p.stat().st_mtime_ns,p.read_bytes()) for p in (self.home/'blobs').iterdir()}
        first=backup.load_snapshot(self.home)['id'];self.run_job('snapshot')
        self.assertNotEqual(backup.load_snapshot(self.home)['id'],first)
        self.assertEqual({p.name:(p.stat().st_mtime_ns,p.read_bytes()) for p in (self.home/'blobs').iterdir()},before)
        self.assertEqual(len(before),4)

    def test_missing_or_wrong_source_edition_cannot_replace_good_backup(self):
        self.complete();old=(self.home/'last-backup-success.json').read_bytes()
        self.policy['sourceSeeds'][self.shas['new']]=self.policy['sourceSeeds'][self.shas['old']];self.write_policy()
        with self.assertRaises(artifact.ArtifactError):self.run_job('snapshot')
        self.assertEqual((self.home/'last-backup-success.json').read_bytes(),old)
        self.assertIn('backup-last-attempt-failed',self.run_job('health')['problems'])

    def test_corrupt_backup_rejects_restore_and_retains_prior_restore_receipt(self):
        self.complete();old=(self.home/'last-restore-success.json').read_bytes();saved=backup.load_snapshot(self.home)
        path,_=backup.read_blob(self.home,'blobs',saved['entries']['current']['web'],'.tar.gz');path.write_bytes(b'corruption')
        with self.assertRaises(artifact.ArtifactError):self.run_job('restore-check')
        self.assertEqual((self.home/'last-restore-success.json').read_bytes(),old)
        self.assertIn('restore-last-attempt-failed',self.run_job('health')['problems'])

    def test_runtime_failure_is_not_hidden_by_recent_last_success(self):
        self.complete();old=(self.home/'last-restore-success.json').read_bytes();self.runtime.failure=True
        with self.assertRaises(RuntimeError):self.run_job('restore-check')
        self.assertEqual((self.home/'last-restore-success.json').read_bytes(),old)
        self.assertFalse(self.run_job('health')['success'])

    def test_malformed_receipt_replaces_stale_green_health_with_failure(self):
        self.complete();(self.home/'last-backup-success.json').write_text('{broken')
        result=self.run_job('health');self.assertFalse(result['success']);self.assertEqual(result['problems'],['backup-receipt-invalid'])
        self.assertFalse(backup.json_file(self.home/'health.json')['success'])

    def test_shared_lock_contention_defers_without_changing_old_success(self):
        import fcntl
        self.complete();old=(self.home/'last-backup-success.json').read_bytes()
        with self.shared.open('a') as stream:
            fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(update.UpdateFailed):self.run_job('snapshot')
        self.assertEqual((self.home/'last-backup-success.json').read_bytes(),old)
        self.assertEqual(backup.json_file(self.home/'last-backup-attempt.json')['status'],'deferred')
        self.run_job('snapshot');self.assertTrue(self.run_job('health')['success'])

    def test_worker_lock_prevents_parallel_jobs_and_attempt_overwrite(self):
        self.complete();before=(self.home/'last-backup-attempt.json').read_bytes()
        with backup.worker_lock(self.home):
            with self.assertRaises(BlockingIOError):self.run_job('snapshot')
        self.assertEqual((self.home/'last-backup-attempt.json').read_bytes(),before)

    def test_unfinished_update_blocks_backups_and_restore_without_switching(self):
        self.complete();update.save_json(self.base/'ops/update-state.json',{'phase':'verifying'})
        for command in ['snapshot','restore-check']:
            with self.assertRaises(artifact.ArtifactError):self.run_job(command)
        self.assertEqual(os.readlink(self.base/'current'),'releases/new')

    def test_new_release_source_is_discovered_from_committed_updater(self):
        self.complete();created=self.make_edition('third','1.0.2');source=self.policy['sourceSeeds'].pop(self.shas['third'])
        update.switch(self.base,'previous','releases/new');update.switch(self.base,'current','releases/third')
        update.save_json(self.base/'ops/update-state.json',{'phase':'committed','newSha256':self.shas['third'],'retainedArchive':str(self.base/source['path']),'archiveSha256':source['sha256']})
        self.write_policy();self.assertFalse(self.run_job('health')['success']);self.run_job('snapshot');self.run_job('restore-check')
        self.assertTrue(self.run_job('health')['success'])
        self.assertIn(self.shas['third'],backup.json_file(self.home/'source-index.json'))

    def test_source_paths_and_directory_symlinks_cannot_reach_other_projects(self):
        self.policy['sourceSeeds'][self.shas['new']]['path']='../libre/archive.tar.gz';self.write_policy()
        with self.assertRaises(artifact.ArtifactError):self.run_job('snapshot')
        outside=self.root/'outside';outside.mkdir();shutil.rmtree(self.home);self.home.symlink_to(outside,target_is_directory=True)
        with self.assertRaises(artifact.ArtifactError):backup.layout(self.base)
        self.assertEqual(list(outside.iterdir()),[])

    def test_stale_future_and_missing_receipts_are_visible(self):
        self.assertFalse(self.run_job('health')['success']);self.complete()
        now=dt.datetime.now(dt.timezone.utc)
        for delta in [dt.timedelta(hours=31),dt.timedelta(minutes=-6)]:
            result=backup.freshness(self.base,now+delta);self.assertFalse(result['success'])
        result=backup.freshness(self.base,now+dt.timedelta(days=9));self.assertIn('restore-receipt-invalid-or-stale',result['problems'])

    def test_previous_pointer_change_is_not_hidden_by_same_current(self):
        self.complete();update.switch(self.base,'previous',None)
        self.assertIn('previous-release-not-backed-up',self.run_job('health')['problems'])

    def test_snapshot_metadata_and_control_links_are_rejected(self):
        self.complete();saved=backup.json_file(self.home/'last-backup-success.json')
        path=self.home/saved['snapshot'];path.write_text('{}')
        with self.assertRaises(artifact.ArtifactError):self.run_job('restore-check')
        control=self.units/'melodiajest-backup.timer';control.unlink();control.symlink_to(self.base/'deploy/nginx.conf')
        with self.assertRaises(artifact.ArtifactError):self.run_job('snapshot')


if __name__=='__main__':unittest.main(verbosity=2)
