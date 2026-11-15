"""Executed PostgreSQL worker: refusal receipts must not clobber active work."""
from contextlib import contextmanager, ExitStack
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, Mock

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'service'))
import postgres_backup as backup


@contextmanager
def free_lock(*args,**kwargs):yield


class PostgresBackupAttempts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=ROOT/'tmp');self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);self.home=self.base/'receipts';self.home.mkdir();self.work=self.base/'work';self.work.mkdir()
        self.old={'kind':'melodiajest-postgres-protection','version':2,'status':'verified','checkedAt':'2026-11-09T05:00:00+00:00','restoredAt':'2026-11-09T04:00:00+00:00','snapshot':'a'*64,'localPayload':str(self.base/'old-payload')}
        self.old_bytes=(json.dumps(self.old,indent=2)+'\n').encode()
        for name in ['latest-attempt.json','latest-success.json']:(self.home/name).write_bytes(self.old_bytes)
        self.profile={'standby':False,'dependenciesDirectory':'fixture-deps','nodeDirectory':str(self.base/'node'),'archiveSha256':'1'*64,'nodeArchiveSha256':'2'*64,'dependenciesArchiveSha256':'3'*64,'imageArchiveSha256':'4'*64}
        self.stack=ExitStack();self.addCleanup(self.stack.close)
        for target,value in [('BASE',self.base),('HOME',self.home)]:self.stack.enter_context(patch.object(backup,target,value))
        self.stack.enter_context(patch.object(backup,'profile',return_value=(self.profile,SimpleNamespace(pw_uid=1,pw_gid=1),{'sourceSha256':'5'*64})))
        self.stack.enter_context(patch.object(backup.legacy,'private',side_effect=lambda p:p))
        self.work_mock=self.stack.enter_context(patch.object(backup.legacy,'owned_work',return_value=self.work))
        self.cleanup=self.stack.enter_context(patch.object(backup.legacy,'cleanup_work'))
        self.stack.enter_context(patch.object(backup.os,'chown',create=True))
        self.locks=self.stack.enter_context(patch.object(backup.base_backup,'worker_lock',side_effect=free_lock))
        self.operations=self.stack.enter_context(patch.object(backup.update,'operation_locks',side_effect=free_lock))
        self.idle=self.stack.enter_context(patch.object(backup.update,'ensure_idle'))
        self.neighbors=self.stack.enter_context(patch.object(backup,'neighbors'))
        self.child=self.stack.enter_context(patch.object(backup.subprocess,'run',side_effect=AssertionError('Unexpected subprocess')))
    def receipt(self,name='latest-attempt.json'):return json.loads((self.home/name).read_text())
    def failed(self,error_type,stage):
        r=self.receipt();self.assertEqual(r['status'],'failed');self.assertEqual(r['errorType'],error_type);self.assertEqual(r['failureStage'],stage)
        self.assertGreaterEqual(datetime.datetime.fromisoformat(r['failedAt']),datetime.datetime.fromisoformat(r['startedAt']))
        self.assertEqual((self.home/'latest-success.json').read_bytes(),self.old_bytes)
        self.assertNotIn('snapshot',r);self.assertNotIn('restoredAt',r)
    def test_shared_worker_refusal_replaces_old_attempt_but_preserves_success(self):
        @contextmanager
        def locks(home):
            if home!=self.home:raise BlockingIOError('private lock details must not enter receipt')
            yield
        self.locks.side_effect=locks
        with self.assertRaises(BlockingIOError):backup.run()
        self.failed('BlockingIOError','shared-s3-worker-lock');self.child.assert_not_called();self.work_mock.assert_not_called();self.neighbors.assert_not_called()
        self.assertEqual([call.args[0] for call in self.locks.call_args_list],[self.home,self.base/'ops/external-s3/scheduled'])
    def test_deploy_lock_refusal_is_recorded_before_snapshot_work(self):
        self.operations.side_effect=backup.update.UpdateFailed('busy')
        with self.assertRaises(backup.update.UpdateFailed):backup.run()
        self.failed('UpdateFailed','deployment-locks');self.child.assert_not_called();self.work_mock.assert_not_called()
    def test_nonterminal_deployment_is_recorded(self):
        self.idle.side_effect=ValueError('unfinished transaction')
        with self.assertRaises(ValueError):backup.run()
        self.failed('ValueError','deployment-idle');self.work_mock.assert_not_called()
    def test_neighbor_failure_is_recorded_before_snapshot(self):
        self.neighbors.side_effect=RuntimeError('neighbor failure')
        with self.assertRaises(RuntimeError):backup.run()
        self.failed('RuntimeError','neighbors-before-backup');self.work_mock.assert_not_called()
    def test_dump_failure_remains_failed_without_secret_or_fake_restore(self):
        self.stack.enter_context(patch.object(backup,'node_environment',return_value={}))
        self.stack.enter_context(patch.object(backup,'source_paths',return_value=self.base/'source'))
        self.child.side_effect=None;self.child.return_value=subprocess.CompletedProcess([],1,'','sensitive fixture diagnostics')
        with self.assertRaises(ValueError):backup.run()
        self.failed('ArtifactError','snapshot-and-protection');self.cleanup.assert_called_once_with(self.work)
        self.assertNotIn('sensitive',json.dumps(self.receipt()))
    def test_competing_pg_worker_preserves_active_attempt_and_success(self):
        active={'status':'started','startedAt':'2026-11-09T05:00:00+00:00','activeFixture':True};active_bytes=json.dumps(active).encode();(self.home/'latest-attempt.json').write_bytes(active_bytes)
        self.locks.side_effect=BlockingIOError('worker active')
        with self.assertRaises(BlockingIOError):backup.run()
        self.assertEqual((self.home/'latest-attempt.json').read_bytes(),active_bytes);self.assertEqual((self.home/'latest-success.json').read_bytes(),self.old_bytes)
        refusal=self.receipt('latest-refusal.json');self.assertEqual(refusal['status'],'refused');self.assertEqual(refusal['reason'],'postgres-worker-active');self.assertEqual(refusal['errorType'],'BlockingIOError')
        self.operations.assert_not_called();self.neighbors.assert_not_called();self.child.assert_not_called()
    def test_unchanged_snapshot_reuse_keeps_real_restore_time(self):
        desc={'bytes':1,'sha256':'b'*64};snapshot={'digest':'c'*64}
        fingerprint=hashlib.sha256(json.dumps({'data':snapshot['digest'],'source':'5'*64,'archives':{n:self.profile[n+'Sha256'] for n in ['archive','nodeArchive','dependenciesArchive','imageArchive']},'previous':None,'controls':{},'private':{n:desc for n in ['session-secret','postgres-password']},'standby':False},sort_keys=True,separators=(',',':')).encode()).hexdigest()
        previous={**self.old,'fingerprint':fingerprint};backup.deployment.save(self.home/'latest-success.json',previous)
        self.stack.enter_context(patch.object(backup,'node_environment',return_value={}));self.stack.enter_context(patch.object(backup,'source_paths',return_value=self.base/'source'));self.stack.enter_context(patch.object(backup,'control_sources',return_value={}));self.stack.enter_context(patch.object(backup.images,'descriptor',return_value=desc));self.stack.enter_context(patch.object(backup,'age',return_value=1));verify=self.stack.enter_context(patch.object(backup,'verify_payload'));transport=self.stack.enter_context(patch.object(backup.transport,'run'))
        self.child.side_effect=None;self.child.return_value=subprocess.CompletedProcess([],0,json.dumps(snapshot),'')
        result=backup.run();self.assertFalse(result['newSnapshotCreated']);self.assertEqual(result['restoredAt'],previous['restoredAt']);self.assertEqual(result['snapshot'],previous['snapshot']);self.assertEqual(self.receipt(),self.receipt('latest-success.json'));self.assertEqual(self.receipt()['status'],'verified');verify.assert_called_once();transport.assert_not_called();self.cleanup.assert_called_once_with(self.work)
    @unittest.skipUnless(os.name=='posix','Actual flock requires POSIX; exercised in isolated Linux')
    def test_real_shared_flock_refusal_and_pg_lock_release(self):
        self.stack.close();self.stack=ExitStack();self.addCleanup(self.stack.close)
        # Keep actual flock, atomic writes and real local files; replace only
        # production identity, paths and work which must never be reached.
        self.stack.enter_context(patch.object(backup,'BASE',self.base));self.stack.enter_context(patch.object(backup,'HOME',self.home));self.stack.enter_context(patch.object(backup,'profile',return_value=(self.profile,SimpleNamespace(pw_uid=1,pw_gid=1),{'sourceSha256':'5'*64})));self.stack.enter_context(patch.object(backup.legacy,'private',side_effect=lambda p:p))
        shared=self.base/'ops/external-s3/scheduled';shared.mkdir(parents=True)
        with backup.base_backup.worker_lock(shared):
            with self.assertRaises(BlockingIOError):backup.run()
        self.failed('BlockingIOError','shared-s3-worker-lock')
        with backup.base_backup.worker_lock(self.home):pass
    @unittest.skipUnless(os.name=='posix','Actual flock requires POSIX; exercised in isolated Linux')
    def test_real_pg_flock_refusal_keeps_existing_attempt(self):
        self.stack.close();self.stack=ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(backup,'BASE',self.base));self.stack.enter_context(patch.object(backup,'HOME',self.home));self.stack.enter_context(patch.object(backup,'profile',return_value=(self.profile,SimpleNamespace(pw_uid=1,pw_gid=1),{'sourceSha256':'5'*64})));self.stack.enter_context(patch.object(backup.legacy,'private',side_effect=lambda p:p))
        with backup.base_backup.worker_lock(self.home):
            with self.assertRaises(BlockingIOError):backup.run()
        self.assertEqual((self.home/'latest-attempt.json').read_bytes(),self.old_bytes);self.assertEqual((self.home/'latest-success.json').read_bytes(),self.old_bytes);self.assertEqual(self.receipt('latest-refusal.json')['reason'],'postgres-worker-active')


if __name__=='__main__':unittest.main(verbosity=2)
