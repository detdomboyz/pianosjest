"""The same two-control transaction used in production, with disposable files."""
from contextlib import contextmanager
import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT/'service'))
import worker_update as update


class Runtime:
    def __init__(self):self.locked=False;self.events=[];self.fail_new=False;self.guard_failure=False
    @contextmanager
    def guard(self,mode):
        if self.guard_failure:raise BlockingIOError('another worker owns maintenance')
        self.locked=True;self.events.append('guard:'+mode)
        try:yield
        finally:self.locked=False
    def preinstall(self,record,proof):
        if not self.locked:raise AssertionError('unlocked preinstall')
        self.events.append('preinstall')
    def reload_and_verify(self,record,old=False):
        if not self.locked:raise AssertionError('unlocked verify')
        self.events.append('reload-old' if old else 'reload-new')
        if self.fail_new and not old:raise RuntimeError('fixture rejects changed unit')


class WorkerUpdate(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'tmp');self.addCleanup(self.temp.cleanup);self.base=Path(self.temp.name).resolve();self.units=self.base/'units';self.units.mkdir();(self.base/'ops').mkdir()
        self.old_tool=update.PREFIX+'account-'+'a'*16;self.old_root=self.base/'ops/tooling'/Path(self.old_tool).name
        self.files={n:('fixture:'+n).encode() for n in update.FILES}
        for n,raw in self.files.items():p=self.old_root/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
        self.profile={'kind':'melodiajest-account-profile','version':2,'standby':False,'tooling':self.old_tool,'sourceSha256':'d'*64,'unchangedFixture':['keep','all','fields']};self.raw_profile=(json.dumps(self.profile,indent=1)+'\n').encode();self.raw_unit=('[Unit]\nStartLimitIntervalSec=2h\nStartLimitBurst=4\n[Service]\nExecStart=/usr/bin/python3 -B '+self.old_tool+'/service/account_backup.py run\nRestart=on-failure\nRestartSec=15min\n').encode()
        self.paths=update.control_paths(self.base,self.units)
        self.paths['profile'].write_bytes(self.raw_profile);self.paths['profile'].chmod(0o600);self.paths['unit'].write_bytes(self.raw_unit);self.paths['unit'].chmod(0o644)
        self.original_modes={n:p.stat().st_mode&0o777 for n,p in self.paths.items()}
        self.expected={'profileSha256':update.sha(self.raw_profile),'unitSha256':update.sha(self.raw_unit),'oldWorkerSha256':update.sha(self.files[update.CHANGED])}
        self.files[update.CHANGED]=b'accepted new worker fixture';self.archive=self.base/'worker.tar.gz';self.make_archive()
        self.proof={'kind':'melodiajest-independent-worker-kit-recovery','independentExternalCopyVerified':True,'archiveSha256':self.archive_sha,'restoredArchiveSha256':self.archive_sha,'filesVerified':51,'productionVolumesMounted':False,'snapshotId':'b'*64};self.runtime=Runtime()
    def make_archive(self,extra=None,symlink=False):
        identity=update.sha(json.dumps({n:update.sha(raw) for n,raw in self.files.items()},sort_keys=True,separators=(',',':')).encode());self.new_tool=update.PREFIX+'account-'+identity[:16]
        manifest={'kind':'melodiajest-account-worker-candidate','version':1,'identity':identity,'plannedTooling':self.new_tool,'previousTooling':self.old_tool,'files':{n:{'sha256':update.sha(raw),'bytes':len(raw)} for n,raw in self.files.items()},'productionFiles':51,'changedFiles':[update.CHANGED],'unchangedFiles':50}
        entries={'toolkit-manifest.json':json.dumps(manifest).encode(),**{'source/'+n:raw for n,raw in self.files.items()}}
        if extra:entries[extra]=b'unsafe extra'
        with tarfile.open(self.archive,'w:gz') as tar:
            for n,raw in entries.items():
                member=tarfile.TarInfo(n);member.size=len(raw)
                if symlink and n=='source/'+update.CHANGED:member.type=tarfile.SYMTYPE;member.linkname='/etc/shadow';member.size=0;tar.addfile(member)
                else:tar.addfile(member,io.BytesIO(raw))
        self.archive_sha=update.sha(self.archive.read_bytes())
    def install(self):return update.install(self.base,self.units,self.archive,self.archive_sha,self.expected,self.proof,self.runtime)
    def original(self):
        self.assertEqual(self.paths['profile'].read_bytes(),self.raw_profile);self.assertEqual(self.paths['unit'].read_bytes(),self.raw_unit)
        self.assertEqual({n:p.stat().st_mode&0o777 for n,p in self.paths.items()},self.original_modes)
    def test_plan_changes_only_tooling_and_execstart_without_mutation(self):
        r,files=update.plan(self.base,self.units,self.archive,self.archive_sha,self.expected);self.original();self.assertEqual(set(files),update.FILES)
        after=json.loads(update.decode(r['after']['profile']));self.assertEqual(after,{**self.profile,'tooling':self.new_tool});self.assertEqual(update.decode(r['after']['unit']),self.raw_unit.replace(self.old_tool.encode(),self.new_tool.encode()))
        self.assertFalse((self.base/'ops/account-worker-update.json').exists())
    def test_real_file_install_and_explicit_byte_exact_rollback(self):
        (self.base/'sentinel').write_bytes(b'untouched private fixture');r=self.install();self.assertEqual(r['phase'],'committed');self.assertIn(self.new_tool.encode(),self.paths['unit'].read_bytes());self.assertEqual(self.runtime.events,['guard:install','preinstall','reload-new'])
        update.rollback(self.base,self.units,self.runtime);self.original();self.assertEqual((self.base/'sentinel').read_bytes(),b'untouched private fixture');self.assertEqual(self.runtime.events[-2:],['guard:rollback','reload-old'])
        self.assertTrue((self.base/'ops/tooling'/Path(self.new_tool).name/update.CHANGED).is_file());self.assertTrue(self.old_root.is_dir())
    def test_reload_failure_restores_both_controls_and_records_rollback(self):
        self.runtime.fail_new=True
        with self.assertRaises(RuntimeError):self.install()
        self.original();r=json.loads((self.base/'ops/account-worker-update.json').read_text());self.assertEqual(r['phase'],'rolled-back');self.assertEqual(self.runtime.events[-2:],['reload-new','reload-old'])
    def test_missing_independent_recovery_cannot_install(self):
        self.proof['independentExternalCopyVerified']=False
        with self.assertRaises(ValueError):self.install()
        self.original();self.assertEqual(self.runtime.events,[])
    def test_busy_existing_guard_never_changes_controls_or_stages(self):
        self.runtime.guard_failure=True
        with self.assertRaises(BlockingIOError):self.install()
        self.original();self.assertEqual(list((self.base/'ops/tooling').iterdir()),[self.old_root])
    def test_stale_control_preflight_cannot_overwrite(self):
        self.paths['unit'].write_bytes(self.raw_unit+b'# another change\n')
        with self.assertRaises(ValueError):self.install()
        self.assertTrue(self.paths['unit'].read_bytes().endswith(b'# another change\n'));self.assertEqual(self.paths['profile'].read_bytes(),self.raw_profile)
    def test_unreviewed_old_toolkit_drift_is_rejected(self):
        (self.old_root/update.CHANGED).write_bytes(b'changed after preflight')
        with self.assertRaises(ValueError):self.install()
        self.original()
    def test_archive_digest_and_escaping_extra_paths_are_rejected(self):
        with self.assertRaises(ValueError):update.bundle(self.archive,'0'*64)
        self.make_archive(extra='../outside')
        with self.assertRaises(ValueError):update.bundle(self.archive,self.archive_sha)
        self.assertFalse((self.base.parent/'outside').exists());self.original()
    def test_linked_archive_member_is_rejected(self):
        self.make_archive(symlink=True)
        with self.assertRaises(ValueError):update.bundle(self.archive,self.archive_sha)
        self.original()
    def test_changed_nonbackup_source_is_rejected_even_with_valid_manifest(self):
        self.files['service/server.cjs']=b'unrequested API change';self.make_archive()
        with self.assertRaises(ValueError):update.plan(self.base,self.units,self.archive,self.archive_sha,self.expected)
        self.original()
    def test_rollback_refuses_newer_unrecognized_control_bytes(self):
        self.install();self.paths['unit'].write_bytes(b'newer administrator bytes')
        with self.assertRaises(ValueError):update.rollback(self.base,self.units,self.runtime)
        self.assertEqual(self.paths['unit'].read_bytes(),b'newer administrator bytes')
    def test_nonterminal_transaction_blocks_second_install(self):
        update.save(self.base/'ops/account-worker-update.json',{'phase':'profile-written'})
        with self.assertRaises(ValueError):self.install()
        self.original()


if __name__=='__main__':unittest.main(verbosity=2)
