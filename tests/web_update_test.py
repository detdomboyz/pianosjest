"""The complete POSIX transaction suite also runs on the VPS in a private fixture."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'deploy/shared-host'))
import release_artifact as artifact
import release_update as update


def compose_fixture():
    return {'name': 'melodiajest', 'services': {update.SERVICE: {
        'container_name': update.CONTAINER, 'user': '101:101', 'read_only': True,
        'image': 'nginx:stable-alpine', 'entrypoint': ['nginx'], 'command': ['-g', 'daemon off;'],
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges:true'], 'mem_limit': 67108864, 'cpus': 0.25,
        'pull_policy': 'never', 'networks': {'edge': {'aliases': ['melodiajest-web']}},
        'volumes': [{'type': 'bind', 'read_only': True, 'target': target, 'source': source} for target, source in {
            '/usr/share/nginx/html': '/opt/melodiajest/current', '/etc/nginx/nginx.conf': '/opt/melodiajest/deploy/nginx.conf'}.items()]}},
        'networks': {'edge': {'external': True, 'name': 'libre_public'}}}


class ConfigurationTests(unittest.TestCase):
    def rejects(self, change):
        config = compose_fixture()
        change(config)
        with self.assertRaises(artifact.ArtifactError):
            update.validate_compose(config, update.PRODUCTION)

    def test_valid_namespaced_configuration(self):
        update.validate_compose(compose_fixture(), update.PRODUCTION)

    def test_generic_service_key(self):
        self.rejects(lambda c: c['services'].update(web=c['services'][update.SERVICE]))

    def test_generic_network_alias(self):
        self.rejects(lambda c: c['services'][update.SERVICE]['networks']['edge'].update(aliases=['web']))

    def test_wrong_mount_or_published_port(self):
        self.rejects(lambda c: c['services'][update.SERVICE]['volumes'][0].update(source='/opt/libre'))
        self.rejects(lambda c: c['services'][update.SERVICE].update(ports=[{'published': '8080'}]))

    def test_pull_build_privilege_and_resource_changes(self):
        for key, value in [('pull_policy', 'always'), ('build', '.'), ('privileged', True), ('cap_drop', []), ('mem_limit', 0), ('cpus', 1)]:
            with self.subTest(key=key):
                self.rejects(lambda c: c['services'][update.SERVICE].update({key: value}))

    def test_production_cli_cannot_target_another_project(self):
        with self.assertRaises(artifact.ArtifactError):
            update.ProductionRuntime(Path('/opt/libre'))

    def test_activation_command_only_recreates_own_service(self):
        runtime = update.ProductionRuntime.__new__(update.ProductionRuntime)
        runtime.base, runtime.guard = update.PRODUCTION, {'image': 'sha256:test'}
        runtime.command = lambda args: b'[{"Id":"sha256:test"}]'
        calls = []
        runtime.compose = lambda *args: calls.append(args)
        target = runtime.base / 'releases/test'
        with patch.object(Path, 'resolve', return_value=target):
            runtime.activate(target)
        self.assertEqual(calls, [('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait', '--wait-timeout', '40', update.SERVICE)])


class FakeRuntime:
    def __init__(self, served):
        self.served, self.calls, self.guard = served, [], {'configuration': 'unchanged'}
        self.fail_activate = self.fail_verify = self.fail_all = self.crash = False

    def preflight(self, saved_guard=None):
        if saved_guard is not None:
            artifact.require(saved_guard == self.guard, 'Guard changed')
        self.calls.append('preflight')
        return dict(self.guard)

    def activate(self, target):
        self.calls.append(('activate', target.name))
        if self.fail_activate:
            self.fail_activate = False
            raise RuntimeError('activation failed')
        self.served = target
        if self.crash:
            self.crash = False
            raise KeyboardInterrupt('simulated interrupted process')

    def verify(self, target):
        self.calls.append(('verify', target.name))
        if self.fail_all or self.fail_verify:
            self.fail_verify = False
            raise RuntimeError('health check failed')
        artifact.require(self.served == target, 'Old bind mount still served')
        artifact.read_web(target)
        return {'healthy': True, 'served': target.name}


@unittest.skipUnless(os.name == 'posix', 'Actual symlinks/flock/fsync are verified by the full Linux suite')
class TransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = tempfile.TemporaryDirectory(prefix='update-tests-', dir=ROOT / 'tmp')
        cls.addClassCleanup(cls.work.cleanup)
        cls.folder = Path(cls.work.name)
        if os.environ.get('UPDATER_WEB_FIXTURE'):
            cls.fixture = Path(os.environ['UPDATER_WEB_FIXTURE'])
        else:
            cls.fixture = cls.folder / 'web'
            subprocess.run(['node', '--preserve-symlinks', '--preserve-symlinks-main', '-e', "require('./tools/build-web.cjs').buildWeb({outDir:process.argv[1]})", str(cls.fixture)], check=True, cwd=ROOT, capture_output=True)
        cls.config = Path(os.environ.get('UPDATER_CONFIG_FIXTURE', ROOT / 'deploy/shared-host'))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=self.folder)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name) / 'app'
        self.base.mkdir()
        for name in ['releases', 'deploy', 'ops']:
            (self.base / name).mkdir()
        self.old = self.base / 'releases/original'
        shutil.copytree(self.fixture, self.old)
        for name in artifact.CONFIG:
            shutil.copyfile(self.config / name, self.base / 'deploy' / name)
        (self.base / 'current').symlink_to('releases/original', target_is_directory=True)
        self.expected = update.current_sha(self.base)
        self.runtime = FakeRuntime(self.old)
        self.shared = self.base.parent / 'shared.lock'
        self.archive, self.receipt = self.make_archive()

    def make_archive(self, version=None, checkout=True, configs=None):
        web = self.base.parent / ('web-' + str(len(list(self.base.parent.glob('web-*')))))
        shutil.copytree(self.fixture, web)
        manifest = json.loads((web / 'web-release.json').read_bytes())
        index = (web / 'index.html').read_bytes() + b'\n<!-- isolated update fixture -->\n'
        (web / 'index.html').write_bytes(index)
        manifest['files']['index.html'] = artifact.descriptor(index)
        numbers = list(map(int, manifest['version'].split('.')))
        numbers[-1] += 1
        manifest['version'] = version or '.'.join(map(str, numbers))
        (web / 'web-release.json').write_text(json.dumps(manifest, indent=2) + '\n')
        sources = self.base.parent / 'checkout'
        sources.mkdir(exist_ok=True)
        (sources / 'piano-lesson-development.js').write_text('selected current revision')
        archive = self.base.parent / (web.name + '.tar.gz')
        return archive, artifact.pack(web, configs or self.base / 'deploy', archive, sources if checkout else None)

    def install(self, expected=None):
        return update.install(self.base, self.archive, self.receipt['sha256'], expected or self.expected, self.runtime, self.shared)

    def assert_old(self):
        self.assertEqual(update.ref(self.base, 'current'), 'releases/original')
        self.assertEqual(self.runtime.served, self.old)

    def test_success_preserves_previous_and_verified_backup(self):
        result = self.install()
        self.assertEqual(result['phase'], 'committed')
        self.assertEqual(update.ref(self.base, 'previous'), 'releases/original')
        self.assertTrue(result['backupFileRestoreVerified'])
        self.assertTrue(Path(result['retainedArchive']).is_file())
        self.assertEqual(artifact.read_web(self.old), artifact.read_web(self.fixture))

    def test_same_artifact_does_not_restart_or_create_another_backup(self):
        first = self.install()
        before = len(list((self.base / 'ops/backups').iterdir()))
        self.runtime.calls.clear()
        second = self.install(first['newSha256'])
        self.assertEqual(second['phase'], 'unchanged')
        self.assertEqual(self.runtime.calls, ['preflight'])
        self.assertEqual(len(list((self.base / 'ops/backups').iterdir())), before)

    def test_expected_current_conflict(self):
        with self.assertRaises(artifact.ArtifactError):
            self.install('0' * 64)
        self.assert_old()
        self.assertFalse((self.base / 'ops/backups').exists())

    def test_configuration_drift(self):
        with (self.base / 'deploy/nginx.conf').open('a') as stream:
            stream.write('\n# independently modified')
        with self.assertRaises(artifact.ArtifactError):
            self.install()
        self.assert_old()

    def test_changed_release_without_sources(self):
        self.archive, self.receipt = self.make_archive(checkout=False)
        with self.assertRaises(artifact.ArtifactError):
            self.install()
        self.assert_old()

    def test_version_cannot_decrease_or_stay_same_with_new_manifest(self):
        original = json.loads((self.fixture / 'web-release.json').read_bytes())['version']
        for version in [original, '0.0.0']:
            self.archive, self.receipt = self.make_archive(version=version)
            with self.assertRaises(artifact.ArtifactError):
                self.install()
        self.assert_old()

    def test_activation_failure_restores_old_runtime(self):
        self.runtime.fail_activate = True
        with self.assertRaises(update.UpdateFailed):
            self.install()
        self.assert_old()
        self.assertEqual(update.journal(self.base)['phase'], 'rolled-back')

    def test_verification_failure_restores_old_runtime(self):
        self.runtime.fail_verify = True
        with self.assertRaises(update.UpdateFailed):
            self.install()
        self.assert_old()
        self.assertIsNone(update.ref(self.base, 'previous', optional=True))

    def test_false_verification_is_not_success(self):
        original = self.runtime.verify
        self.runtime.verify = lambda target: False if target != self.old else original(target)
        with self.assertRaises(update.UpdateFailed):
            self.install()
        self.assert_old()

    def test_rollback_failure_blocks_further_updates(self):
        self.runtime.fail_all = True
        with self.assertRaises(update.UpdateFailed):
            self.install()
        self.assertEqual(update.journal(self.base)['phase'], 'rollback-failed')
        with self.assertRaises(artifact.ArtifactError):
            self.install()
        self.runtime.fail_all = False
        result = update.recover(self.base, update.current_sha(self.base), self.runtime, self.shared)
        self.assertEqual(result['phase'], 'rolled-back')

    def interrupt(self):
        self.runtime.crash = True
        with self.assertRaises(KeyboardInterrupt):
            self.install()
        self.assertEqual(update.journal(self.base)['phase'], 'switched')

    def test_interrupted_update_blocks_new_work_and_recovers(self):
        self.interrupt()
        with self.assertRaises(artifact.ArtifactError):
            self.install(update.current_sha(self.base))
        result = update.recover(self.base, update.current_sha(self.base), self.runtime, self.shared)
        self.assertTrue(result['recoveredAfterInterruption'])
        self.assert_old()

    def test_recovery_of_corrupted_candidate_uses_known_manifest_and_valid_old_copy(self):
        self.interrupt()
        (self.base / update.ref(self.base, 'current') / 'index.html').write_text('corrupted candidate')
        update.recover(self.base, update.current_sha(self.base), self.runtime, self.shared)
        self.assert_old()

    def test_recovery_refuses_configuration_drift(self):
        self.interrupt()
        current = update.ref(self.base, 'current')
        self.runtime.guard = {'configuration': 'changed'}
        with self.assertRaises(artifact.ArtifactError):
            update.recover(self.base, update.current_sha(self.base), self.runtime, self.shared)
        self.assertEqual(update.ref(self.base, 'current'), current)

    def test_explicit_rollback_then_roll_forward(self):
        installed = self.install()
        result = update.rollback(self.base, installed['newSha256'], self.runtime, self.shared)
        self.assert_old()
        self.assertEqual(update.ref(self.base, 'previous'), installed['new'])
        result = update.rollback(self.base, result['newSha256'], self.runtime, self.shared)
        self.assertEqual(update.ref(self.base, 'current'), installed['new'])

    def test_shared_lock_is_respected(self):
        import fcntl
        with self.shared.open('a') as other:
            fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(update.UpdateFailed):
                self.install()
        self.assert_old()

    def test_escaping_current_symlink_is_rejected(self):
        (self.base / 'current').unlink()
        (self.base / 'current').symlink_to('../outside')
        with self.assertRaises(artifact.ArtifactError):
            self.install()

    def test_immutable_release_conflict(self):
        details, _ = update.plan(self.base, self.archive, self.receipt['sha256'], self.expected)
        shutil.copytree(self.fixture, self.base / details['new'])
        with self.assertRaises(artifact.ArtifactError):
            self.install()
        self.assert_old()

    def test_commit_receipt_error_rolls_back_and_restores_previous_pointer(self):
        real_finish = update.finish
        def fail_once(base, state):
            if state['phase'] == 'committed':
                raise OSError('receipt write failed')
            return real_finish(base, state)
        with patch.object(update, 'finish', side_effect=fail_once):
            with self.assertRaises(update.UpdateFailed):
                self.install()
        self.assert_old()
        self.assertIsNone(update.ref(self.base, 'previous', optional=True))


if __name__ == '__main__':
    unittest.main(verbosity=2)
