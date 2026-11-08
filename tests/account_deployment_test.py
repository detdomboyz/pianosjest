"""Exercise the shipped API updater, archive staging and backup allowlist."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'service'))
import deployment as deploy
import account_backup as backup
import units


class AccountDeployment(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work=tempfile.TemporaryDirectory(dir=ROOT/'tmp',prefix='account-deployment-')
        cls.root=Path(cls.work.name);web=cls.root/'web'
        subprocess.run(['node','--preserve-symlinks','--preserve-symlinks-main','-e',"require('./tools/build-web.cjs').buildWeb({outDir:process.argv[1],service:true})",str(web)],cwd=ROOT,check=True,capture_output=True)
        cls.archive=cls.root/'release.tar.gz'
        cls.receipt=deploy.artifact.pack(web,ROOT/'deploy/shared-host',cls.archive,ROOT)
    @classmethod
    def tearDownClass(cls):cls.work.cleanup()
    def setUp(self):
        self.workcase=tempfile.TemporaryDirectory(dir=self.root);self.addCleanup(self.workcase.cleanup);self.base=Path(self.workcase.name)
    def stage(self):return deploy.stage_sources(self.base/'backend',self.archive,self.receipt['sha256'])
    def preparation(self):
        return {'kind':'melodiajest-schema-preparation','status':'verified','dataSchemaVersion':2,'schemaSha256':deploy.artifact.sha256((ROOT/'service/schema.pg.sql').read_bytes()),'sourceCopyVerified':True,'isolatedImportVerified':True,'isolatedRecoveryVerified':True}

    def test_exact_sources_and_running_implementation_identity(self):
        staged=self.stage();self.assertEqual(set(staged['manifest']['files']),deploy.FILES)
        self.assertEqual(staged['manifest']['dataSchemaVersion'],2)
        self.assertEqual(deploy.verify_sources(staged['directory']),staged['manifest'])
        self.assertTrue(self.stage()['reused'])
        selected,manifest=deploy.source_plan(self.archive,self.receipt['sha256'])
        self.assertEqual(set(selected),deploy.FILES)
        # JS computes this exact production identity, not a parallel hash model.
        script="const fs=require('fs'),p=require('path'),c=require('crypto');const dir=process.argv[1],m=JSON.parse(fs.readFileSync(p.join(dir,'backend.json')));const f=Object.fromEntries(Object.keys(m.files).sort().map(n=>{const b=fs.readFileSync(p.join(dir,n));return[n,{bytes:b.length,sha256:c.createHash('sha256').update(b).digest('hex')}]}));process.stdout.write(c.createHash('sha256').update(JSON.stringify(f)).digest('hex'));"
        observed=subprocess.check_output(['node','--preserve-symlinks','--preserve-symlinks-main','-e',script,staged['directory']],text=True,cwd=ROOT)
        self.assertEqual(observed,manifest['sourceSha256'])
    def test_changed_code_and_unexpected_files_rejected(self):
        staged=self.stage();target=Path(staged['directory']);(target/'service/server.cjs').write_bytes(b'changed')
        with self.assertRaises(ValueError):deploy.verify_sources(target)
        (target/'service/server.cjs').write_bytes((ROOT/'service/server.cjs').read_bytes());(target/'unexpected.key').write_bytes(b'never accepted')
        with self.assertRaises(ValueError):deploy.verify_sources(target)
    def test_same_api_with_changed_recovery_config_retains_both_artifacts(self):
        import shutil
        first=self.stage();config=self.base/'config';config.mkdir()
        for name in deploy.artifact.CONFIG:shutil.copyfile(ROOT/'deploy/shared-host'/name,config/name)
        with (config/'nginx.conf').open('a') as out:out.write('\n# isolated recovery configuration revision\n')
        other=self.base/'second.tar.gz';receipt=deploy.artifact.pack(self.root/'web',config,other,ROOT)
        second=deploy.stage_sources(self.base/'backend',other,receipt['sha256'])
        self.assertNotEqual(first['directory'],second['directory']);self.assertEqual(first['manifest']['sourceSha256'],second['manifest']['sourceSha256'])
        self.assertEqual(deploy.verify_sources(first['directory']),first['manifest']);self.assertEqual(deploy.verify_sources(second['directory']),second['manifest'])
    @unittest.skipUnless(os.name=='posix','Real POSIX backend pointer guard')
    def test_schema_two_requires_preparation_and_refuses_an_incompatible_database(self):
        staged=self.stage();base=self.base/'backend';target='releases/'+Path(staged['directory']).name
        class Runtime:
            def neighbors(self):raise AssertionError('Unprepared update must stop before runtime changes')
        with self.assertRaises(ValueError):deploy.apply_backend(base,target,None,Runtime(),self.base/'unprepared.json')
        broken={**self.preparation(),'isolatedRecoveryVerified':False}
        with self.assertRaises(ValueError):deploy.apply_backend(base,target,None,Runtime(),self.base/'unrestored.json',schema_preparation=broken)
        runtime=Runtime();runtime.minimum_schema=lambda:3
        with self.assertRaises(ValueError):deploy.apply_backend(base,target,None,runtime,self.base/'incompatible.json',schema_preparation=self.preparation())
        self.assertIsNone(deploy.pointer(base,optional=True))
    def test_pinned_runtime_and_nonsecret_environment(self):
        with self.assertRaises(ValueError):deploy.unpack_node(self.archive,self.base/'runtime')
        rendered=units.render('/opt/melodiajest/runtime/node-v24.22.2-48cc0e21e048/node','/opt/melodiajest/ops/tooling/account-'+'a'*16)
        self.assertEqual(len(rendered),3)
        self.assertIn('PrivateNetwork=yes',rendered['melodiajest-account.service'])
        self.assertIn('RestrictAddressFamilies=AF_UNIX',rendered['melodiajest-account.service'])
        self.assertIn('MELODIA_REGISTRATION_ENABLED=0',units.environment())
        self.assertNotIn('PASSWORD',units.environment())
        with self.assertRaises(ValueError):units.render('/usr/bin/node','/tmp/foreign')
    @unittest.skipUnless(os.name=='posix','POSIX directory permissions')
    def test_public_immutable_sources_remain_traversable_under_private_worker_umask(self):
        before=os.umask(0o077)
        try:staged=self.stage()
        finally:os.umask(before)
        target=Path(staged['directory'])
        for folder in [self.base/'backend',self.base/'backend/releases',target,target/'service']:
            self.assertEqual(folder.stat().st_mode&0o777,0o755)
    def test_private_payload_rejects_extra_missing_or_changed_files(self):
        payload=self.base/'payload';(payload/'data').mkdir(parents=True);(payload/'controls').mkdir()
        names=['release.tar.gz','node.tar.xz','profile.json','data/accounts.sqlite','data/session-secret']+['controls/'+n for n in backup.control_sources()]
        for name in names:(payload/name).write_bytes(b'fixture')
        digest='a'*64;(payload/'data/manifest.json').write_text(json.dumps({'dataDigest':digest,'restoredUsersMustSignIn':True}))
        manifest={'kind':'melodiajest-account-payload','version':1,'dataDigest':digest,'files':backup.describe_tree(payload)}
        (payload/'account-payload.json').write_text(json.dumps(manifest))
        self.assertEqual(backup.verify_payload(payload),manifest)
        (payload/'unexpected').write_bytes(b'private leak')
        with self.assertRaises(ValueError):backup.verify_payload(payload)
        (payload/'unexpected').unlink();(payload/'data/accounts.sqlite').write_bytes(b'damaged')
        with self.assertRaises(ValueError):backup.verify_payload(payload)
    @unittest.skipUnless(os.name=='posix','Real symlink transaction runs in isolated Linux')
    def test_first_failure_stops_only_new_api_and_keeps_data(self):
        staged=self.stage();base=self.base/'backend';target='releases/'+Path(staged['directory']).name
        marker=self.base/'accounts.sqlite';marker.write_bytes(b'keep all user data')
        class Runtime:
            stopped=False
            def neighbors(self):pass
            def activate(self,target):pass
            def verify(self,target,manifest):raise RuntimeError('injected health failure')
            def stop(self):self.stopped=True
        runtime=Runtime()
        with self.assertRaises(RuntimeError):deploy.apply_backend(base,target,None,runtime,self.base/'receipt.json',schema_preparation=self.preparation())
        self.assertTrue(runtime.stopped);self.assertIsNone(deploy.pointer(base,optional=True));self.assertEqual(marker.read_bytes(),b'keep all user data')
        self.assertEqual(json.loads((self.base/'receipt.json').read_text())['status'],'rolled-back')
    @unittest.skipUnless(os.name=='posix','Real symlink transaction runs in isolated Linux')
    def test_commit_stale_guard_and_verified_previous_rollback(self):
        staged=self.stage();base=self.base/'backend';old='releases/'+Path(staged['directory']).name
        manifest=staged['manifest']
        class Runtime:
            fail=False
            activations=[]
            def neighbors(self):pass
            def activate(self,target):self.activations.append(target.name)
            def verify(self,target,value):
                if self.fail and target.name.startswith('99.'):raise RuntimeError('injected new version failure')
                return {'implementationSha256':value['sourceSha256']}
            def stop(self):raise AssertionError('Existing API must be restored')
        runtime=Runtime();state=deploy.apply_backend(base,old,None,runtime,self.base/'first.json',schema_preparation=self.preparation());self.assertEqual(state['status'],'committed')
        new='releases/99.1.1-'+manifest['sourceSha256'][:16]
        import shutil
        shutil.copytree(base/old,base/new)
        with self.assertRaises(ValueError):deploy.apply_backend(base,new,None,runtime,self.base/'stale.json',schema_preparation=self.preparation())
        runtime.fail=True
        with self.assertRaises(RuntimeError):deploy.apply_backend(base,new,old,runtime,self.base/'failed.json',schema_preparation=self.preparation())
        self.assertEqual(deploy.pointer(base),old);self.assertEqual(runtime.activations[-1],Path(old).name)
        runtime.fail=False
        state=deploy.apply_backend(base,new,old,runtime,self.base/'success.json',schema_preparation=self.preparation());self.assertEqual(state['status'],'committed');self.assertEqual(deploy.pointer(base,'previous'),old)
    @unittest.skipUnless(os.name=='posix','Real symlink transaction runs in isolated Linux')
    def test_receipt_failure_after_switch_does_not_block_rollback(self):
        staged=self.stage();base=self.base/'backend';target='releases/'+Path(staged['directory']).name
        class Runtime:
            stopped=False
            def neighbors(self):pass
            def activate(self,target):raise AssertionError('Receipt failed before restart')
            def stop(self):self.stopped=True
        real=deploy.save;calls=0
        def fail_later(path,value):
            nonlocal calls
            calls+=1
            if calls>1:raise OSError('disk full')
            return real(path,value)
        runtime=Runtime()
        with patch.object(deploy,'save',fail_later),self.assertRaises(OSError):deploy.apply_backend(base,target,None,runtime,self.base/'receipt.json',schema_preparation=self.preparation())
        self.assertTrue(runtime.stopped);self.assertIsNone(deploy.pointer(base,optional=True))


if __name__=='__main__':unittest.main(verbosity=2)
