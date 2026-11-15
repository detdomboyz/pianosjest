"""Interruption gates in the shipped workers; no production service is run.

--portable runs12 cases on Windows. The full Linux suite adds two actual flock
cases. Fixtures describe proof contracts; they do not perform a PG/S3 restore.
"""
import contextlib
import copy
import datetime as dt
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(os.environ.get('MELODIAJEST_INTERRUPTION_SOURCE', Path(__file__).resolve().parents[1])).resolve()
sys.path.insert(0, str(ROOT / 'deploy/shared-host'))
sys.path.insert(0, str(ROOT / 'tests'))
import backup_s3_schedule as schedule
import release_start_budget as budget
import release_update as update
from backup_s3_schedule_test import AccountHealthTests, ScheduleTests
ORIGINAL_WORKER_LOCK = schedule.backup.worker_lock


class InterruptionFixture(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory(prefix='melodiajest-interruption-')
        self.root = Path(work.name).resolve()
        self.assertEqual(self.root.parent, Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith('melodiajest-interruption-'))
        self.addCleanup(work.cleanup)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.argv = ['backup_s3_schedule.py', 'health']
        self.account = AccountHealthTests().data()
        health = ScheduleTests().health()
        for name, value in [
            ('last-attempt.json', health[1]), ('last-success.json', health[2]),
            ('last-check-success.json', health[3]), ('last-restore-success.json', health[4]),
            ('last-backup-attempt.json', health[6]), ('last-restore-attempt.json', health[7]),
        ]:
            schedule.job.save(self.state / name, value)
        schedule.job.save(self.state / 'health.json', {'success': True, 'oldReceiptSentinel': True})
        self.account_result = schedule.assess_account_health(*self.account)
        self.assertTrue(self.account_result['success'])
        self.stack = self.enterContext(contextlib.ExitStack())
        self.stack.enter_context(patch.object(schedule, 'STATE', self.state))
        self.stack.enter_context(patch.object(schedule, 'BASE', self.root / 'app'))
        self.stack.enter_context(patch.object(schedule, 'configuration', return_value={}))
        self.stack.enter_context(patch.object(schedule.job, 'private_directory', return_value=self.state))
        self.lock = self.stack.enter_context(patch.object(schedule.backup, 'worker_lock', return_value=contextlib.nullcontext()))
        self.context = self.stack.enter_context(patch.object(schedule, 'context', return_value=health[0]))
        self.account_read = self.stack.enter_context(patch.object(schedule, 'account_health', return_value=self.account_result))
        self.backend = self.stack.enter_context(patch.object(schedule, 'Backend', side_effect=AssertionError('Unexpected external backup/restore')))
        for method in ['run', 'Popen', 'check_call', 'check_output']:
            self.stack.enter_context(patch.object(subprocess, method, side_effect=AssertionError('No real subprocess or native unit allowed')))
        self.stack.enter_context(patch.object(sys, 'argv', self.argv))

    def invoke(self, command='health'):
        self.argv[:] = ['backup_s3_schedule.py', command]
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = schedule.main()
        lines = (out.getvalue() or err.getvalue()).splitlines()
        self.assertEqual(len(lines), 1)
        return status, json.loads(lines[0])

    def native(self, success=True):
        return ('StartLimitBurst=4\nStartLimitIntervalUSec=2h\nMainPID=0\n'
                'Result=' + ('success' if success else 'exit-code') + '\n'
                'ExecMainStartTimestamp=Wed 2026-11-11 22:13:00 UTC\n')

    def native_ready(self):
        now = dt.datetime(2026, 11, 11, 22, 14, tzinfo=dt.timezone.utc)
        starts = [dt.datetime(2026, 11, 11, h, m, s, tzinfo=dt.timezone.utc)
                  for h, m, s in [(21, 56, 58), (21, 57, 55), (22, 13, 0)]]
        rows = [{'MESSAGE': 'Starting ' + budget.UNIT + ' - fixture',
                 '__REALTIME_TIMESTAMP': str(int(stamp.timestamp() * 1_000_000))}
                for stamp in starts]
        calls = [self.native(), '\n'.join(json.dumps(row) for row in rows)]
        with patch.object(budget.subprocess, 'check_output', side_effect=calls) as reader:
            result = budget.observe_start_budget(planned_starts=1, now=now)
        self.assertTrue(result['allowed'])
        self.assertFalse(result['reservation'])
        self.assertFalse(result['mutationsPerformed'])
        self.assertEqual(reader.call_count, 2)
        return result


class RecoveryContracts(InterruptionFixture):
    def test_health_worker_busy_is75_not_stale_green_and_preserves_receipt(self):
        path = self.state / 'health.json'
        before = (path.read_bytes(), path.stat().st_mtime_ns)
        self.lock.side_effect = BlockingIOError('occupied fixture worker')
        status, value = self.invoke()
        self.assertEqual((status, value), (75, {'success': False, 'status': 'deferred', 'reason': 'operation-lock-busy'}))
        self.assertEqual(before, (path.read_bytes(), path.stat().st_mtime_ns))
        self.context.assert_not_called()
        self.account_read.assert_not_called()
        self.backend.assert_not_called()

    def test_busy_backup_or_restore_cannot_overwrite_another_owners_pending(self):
        pending = self.state / 'pending.json'
        schedule.job.save(pending, {'coverage': 'fixture-owner', 'snapshotId': 'f' * 64})
        before = {p.name: p.read_bytes() for p in self.state.iterdir()}
        self.lock.side_effect = BlockingIOError('occupied fixture worker')
        for command in ['backup', 'restore-check']:
            with self.subTest(command=command):
                status, value = self.invoke(command)
                self.assertEqual(status, 75)
                self.assertFalse(value['success'])
                self.assertEqual(before, {p.name: p.read_bytes() for p in self.state.iterdir()})

    def test_shared_lock_refusal_records_backup_deferred_without_new_success(self):
        success = (self.state / 'last-success.json').read_bytes()
        self.context.side_effect = update.UpdateFailed('fixture shared lock')
        status, value = self.invoke('backup')
        self.assertEqual(status, 75)
        self.assertEqual(value['status'], 'deferred')
        self.assertEqual(value['reason'], 'shared-or-own-operation-lock-busy')
        self.assertEqual(schedule.job.read(self.state / 'last-attempt.json'), value)
        self.assertEqual((self.state / 'last-success.json').read_bytes(), success)
        self.backend.assert_not_called()

    def test_shared_lock_refusal_health_is_deferred_without_forging_fresh_health(self):
        previous = (self.state / 'health.json').read_bytes()
        self.context.side_effect = update.UpdateFailed('fixture shared lock')
        status, value = self.invoke()
        self.assertEqual(status, 75)
        self.assertEqual(value['step'], 'health')
        self.assertEqual(value['status'], 'deferred')
        self.assertEqual((self.state / 'health.json').read_bytes(), previous)

    def test_invalid_receipt_replaces_old_green_with_explicit_failure(self):
        self.context.side_effect = ValueError('invalid fixture receipt')
        status, value = self.invoke()
        self.assertEqual(status, 1)
        self.assertFalse(value['success'])
        self.assertEqual(value['errorType'], 'ValueError')
        self.assertEqual(schedule.job.read(self.state / 'health.json'), value)

    def test_after_worker_release_health_reads_exact_proof_without_new_copy(self):
        prior_restore = (self.state / 'last-restore-success.json').read_bytes()
        self.lock.side_effect = BlockingIOError('occupied fixture worker')
        self.assertEqual(self.invoke()[0], 75)
        self.lock.side_effect = None
        status, value = self.invoke()
        self.assertEqual(status, 0)
        self.assertTrue(value['success'])
        self.assertEqual(value['s3RequestsThisCheck'], 0)
        self.assertEqual(value['accountBackup'], self.account_result)
        self.assertFalse(value['accountBackup']['restorePerformedThisCheck'])
        self.assertEqual((self.state / 'last-restore-success.json').read_bytes(), prior_restore)
        self.backend.assert_not_called()

    def test_failed_pg_in_native_backoff_rejects_gate_before_journal_or_start(self):
        with patch.object(budget.subprocess, 'check_output', return_value=self.native(False)) as reader:
            with self.assertRaisesRegex(ValueError, 'active or unsuccessful'):
                budget.observe_start_budget(1, dt.datetime(2026, 11, 11, 22, 1, tzinfo=dt.timezone.utc))
        self.assertEqual(reader.call_count, 1)
        self.assertEqual(reader.call_args.args[0][:3], ['systemctl', 'show', budget.UNIT])

    def test_natural_retry_success_still_requires_proof_for_current_reader(self):
        self.native_ready()
        self.account[1]['status'] = 'failed'
        self.assertFalse(schedule.assess_account_health(*self.account)['success'])
        self.account[1] = copy.deepcopy(self.account[2])
        before = copy.deepcopy(self.account)
        value = schedule.assess_account_health(*self.account)
        self.assertTrue(value['success'])
        self.assertFalse(value['restorePerformedThisCheck'])
        self.assertEqual(before, self.account)

    def test_successful_unit_with_old_reader_snapshot_does_not_authorize_resume(self):
        self.native_ready()
        self.account[0]['sourceSha256'] = self.account[3]['sourceSha256'] = '9' * 64
        value = schedule.assess_account_health(*self.account)
        self.assertFalse(value['success'])
        self.assertIn('source-does-not-match-current', value['problems'])

    def test_partial_new_copy_does_not_inherit_old_verified_restore(self):
        self.native_ready()
        self.account[1].update(status='external-copy-created-restore-pending', snapshot='9' * 64)
        value = schedule.assess_account_health(*self.account)
        self.assertFalse(value['success'])
        self.assertIn('last-attempt-not-verified', value['problems'])
        self.assertIn('latest-snapshot-differs', value['problems'])

    def test_static_transaction_must_be_terminal_even_with_healthy_account_proof(self):
        base = self.root / 'static'
        (base / 'ops').mkdir(parents=True)
        path = base / 'ops/update-state.json'
        for phase in ['planned', 'switched', 'rolling-back', 'rollback-failed']:
            schedule.job.save(path, {'phase': phase})
            with self.subTest(phase=phase), self.assertRaisesRegex(update.artifact.ArtifactError, 'explicit recover'):
                update.ensure_idle(base)
        schedule.job.save(path, {'phase': 'committed'})
        self.assertIsNone(update.ensure_idle(base))

    def test_archive_change_during_wait_cannot_reuse_the_previous_payload_proof(self):
        self.native_ready()
        self.account[0]['archiveSha256'] = '9' * 64
        value = schedule.assess_account_health(*self.account)
        self.assertFalse(value['success'])
        self.assertIn('archive-coverage-differs', value['problems'])


@unittest.skipUnless(os.name == 'posix', 'Real flock cases require POSIX;--portable excludes them explicitly')
class PosixLockContracts(InterruptionFixture):
    def test_actual_worker_contention_then_release_obeys_same_health_cli(self):
        self.stack.enter_context(patch.object(schedule.backup, 'worker_lock', ORIGINAL_WORKER_LOCK))
        with schedule.backup.worker_lock(self.state):
            self.assertEqual(self.invoke()[0], 75)
            self.context.assert_not_called()
        status, value = self.invoke()
        self.assertEqual(status, 0)
        self.assertTrue(value['success'])
        self.backend.assert_not_called()

    def test_actual_shared_lock_refusal_leaves_reader_and_then_releases_own_lock(self):
        import fcntl
        base = self.root / 'static'
        (base / 'ops').mkdir(parents=True)
        marker = base / 'reader-sentinel'
        marker.write_bytes(b'unchanged selected reader')
        shared = self.root / 'isolated-shared.lock'
        with shared.open('a') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(update.UpdateFailed, 'holds the lock'):
                with update.operation_locks(base, shared):
                    self.fail('Contended operation must not enter the critical section')
            self.assertEqual(marker.read_bytes(), b'unchanged selected reader')
        with update.operation_locks(base, shared):
            self.assertEqual(marker.read_bytes(), b'unchanged selected reader')


if __name__ == '__main__':
    portable = '--portable' in sys.argv
    suite = unittest.TestSuite()
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(RecoveryContracts))
    if not portable:
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(PosixLockContracts))
    assert suite.countTestCases() == (12 if portable else 14), 'Unexpected interruption test coverage'
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() and not result.skipped else 1)
