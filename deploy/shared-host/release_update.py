"""Transactional browser-release updates on the existing MelodiaJest VPS.

The CLI is Linux-only and fixed to /opt/melodiajest. Configuration migrations,
Caddy changes, image pulls, cleanup and other portal services are out of scope.
"""
import argparse
from contextlib import ExitStack, contextmanager
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid

import release_artifact as artifact

require = artifact.require
PRODUCTION = Path('/opt/melodiajest')
SERVICE = 'melodiajest-static'
CONTAINER = 'melodiajest-web-1'
TERMINAL = {'committed', 'rolled-back'}


class UpdateFailed(RuntimeError):
    pass


def layout(base):
    base = Path(base).absolute()
    require(base.is_dir() and base.resolve() == base, 'Release root must be a real directory')
    for name in ['releases', 'deploy', 'ops']:
        require((base / name).is_dir() and not (base / name).is_symlink(), 'Unsafe release layout: ' + name)
    return base


def ref(base, name, optional=False):
    link = base / name
    if optional and not link.exists() and not link.is_symlink():
        return None
    require(link.is_symlink(), name + ' must be a release symlink')
    target = os.readlink(link)
    require(re.fullmatch(r'releases/[A-Za-z0-9][A-Za-z0-9._-]*', target), 'Unsafe ' + name + ' target')
    path = base / target
    require(path.is_dir() and not path.is_symlink() and path.resolve().parent == base / 'releases', 'Invalid release target')
    return target


def current_sha(base):
    return artifact.sha256(artifact.regular_bytes(base / ref(base, 'current'), 'web-release.json'))


def expect_current(base, expected):
    require(re.fullmatch(r'[0-9a-f]{64}', expected or ''), 'Expected current SHA256 required')
    require(current_sha(base) == expected, 'Current release changed; inspect before retrying')


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def save_json(path, value):
    require(not path.is_symlink(), 'Linked journal')
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_directory(path.parent)


def switch(base, name, target):
    require(name in {'current', 'previous'}, 'Unsupported pointer')
    existing = ref(base, name, optional=True)
    if target is None:
        if existing is not None:
            (base / name).unlink()
            sync_directory(base)
        return
    require(re.fullmatch(r'releases/[A-Za-z0-9][A-Za-z0-9._-]*', target), 'Unsafe release pointer')
    require((base / target).is_dir() and not (base / target).is_symlink(), 'Missing release')
    temporary = base / ('.' + name + '-' + uuid.uuid4().hex)
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, base / name)
    sync_directory(base)


def journal(base):
    path = base / 'ops/update-state.json'
    require(not path.is_symlink(), 'Linked update state')
    return json.loads(path.read_text()) if path.exists() else None


def ensure_idle(base):
    state = journal(base)
    require(state is None or state.get('phase') in TERMINAL, 'Unfinished update; explicit recover required')


@contextmanager
def operation_locks(base, shared=Path('/run/lock/libre-deploy.lock')):
    require(os.name == 'posix', 'Updates require Linux/POSIX')
    import fcntl
    with ExitStack() as stack:
        for path in [Path(shared), base / 'ops/operation.lock']:
            require(not path.is_symlink(), 'Linked operation lock')
            lock = stack.enter_context(path.open('a'))
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise UpdateFailed('Another deployment/maintenance operation holds the lock') from error
        yield


def plan(base, archive, archive_sha, expected):
    base = layout(base)
    ensure_idle(base)
    expect_current(base, expected)
    files, meta = artifact.read_bundle(archive, archive_sha)
    for name in artifact.CONFIG:
        require(files['config/' + name] == artifact.regular_bytes(base / 'deploy', name), 'Configuration drift: ' + name)
    old = ref(base, 'current')
    previous = ref(base, 'previous', optional=True)
    changed = meta['webManifestSha256'] != expected
    if changed:
        require(meta['sourceSnapshotIncluded'], 'Changed release requires a source snapshot')
        old_version = json.loads((base / old / 'web-release.json').read_bytes())['version']
        require(tuple(map(int, meta['version'].split('.'))) > tuple(map(int, old_version.split('.'))), 'Update must increase version; use explicit rollback for older releases')
    target = 'releases/' + meta['version'] + '-' + meta['webManifestSha256'][:12] if changed else old
    return {'changed': changed, 'old': old, 'oldPrevious': previous, 'new': target,
            'oldSha256': expected, 'newSha256': meta['webManifestSha256'], 'version': meta['version'],
            'archiveSha256': archive_sha}, files


def stage_release(base, target, files):
    destination = base / target
    public = {name[4:]: data for name, data in files.items() if name.startswith('web/')}
    if destination.exists() or destination.is_symlink():
        require(not destination.is_symlink() and artifact.read_web(destination) == public, 'Existing immutable release differs')
        return
    temporary = base / 'releases' / ('.stage-' + uuid.uuid4().hex)
    temporary.mkdir(mode=0o700)
    for name, data in public.items():
        with (temporary / name).open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        (temporary / name).chmod(0o644)
    require(artifact.read_web(temporary) == public, 'Staged release mismatch')
    temporary.chmod(0o755)
    sync_directory(temporary)
    os.rename(temporary, destination)
    sync_directory(destination.parent)


def finish(base, state):
    save_json(base / 'ops/update-state.json', state)
    history = base / 'ops/updates'
    history.mkdir(mode=0o700, exist_ok=True)
    require(not history.is_symlink(), 'Linked update history')
    save_json(history / (state['id'] + '.json'), state)


def transaction(base, details, runtime, guard=None):
    """Caller holds operation_locks. Includes fresh recoverable pre-update copy."""
    ensure_idle(base)
    expect_current(base, details['oldSha256'])
    guard = runtime.preflight() if guard is None else guard
    require(shutil.disk_usage(base).free >= 512 * 1024 * 1024, 'Insufficient free disk')
    identifier = uuid.uuid4().hex
    backups = base / 'ops/backups'
    backups.mkdir(mode=0o700, exist_ok=True)
    require(not backups.is_symlink(), 'Linked backup directory')
    backup = artifact.pack(base / details['old'], base / 'deploy', backups / ('before-update-' + identifier + '.tar.gz'))
    with Path(backup['archive']).open('rb') as source:
        os.fsync(source.fileno())
    sync_directory(backups)
    with tempfile.TemporaryDirectory(prefix='verify-backup-', dir=base / 'ops') as temporary:
        verified = artifact.restore(backup['archive'], Path(temporary) / 'restored', backup['sha256'])
    state = {**details, 'id': identifier, 'phase': 'prepared', 'guard': guard,
             'backup': backup, 'backupFileRestoreVerified': verified['restoreVerified']}
    save_json(base / 'ops/update-state.json', state)
    try:
        switch(base, 'current', state['new'])
        state['phase'] = 'switched'
        save_json(base / 'ops/update-state.json', state)
        runtime.activate(base / state['new'])
        state['phase'] = 'verifying'
        save_json(base / 'ops/update-state.json', state)
        state['verification'] = runtime.verify(base / state['new'])
        require(isinstance(state['verification'], dict) and state['verification'].get('healthy') is True, 'Verification did not confirm health')
        switch(base, 'previous', state['old'])
        state['phase'] = 'committed'
        finish(base, state)
        return state
    except Exception as error:
        state['failureType'] = type(error).__name__
        try:
            switch(base, 'current', state['old'])
            runtime.activate(base / state['old'])
            state['rollbackVerification'] = runtime.verify(base / state['old'])
            require(isinstance(state['rollbackVerification'], dict) and state['rollbackVerification'].get('healthy') is True, 'Rollback health not confirmed')
            switch(base, 'previous', state['oldPrevious'])
            state['phase'] = 'rolled-back'
        except Exception as rollback_error:
            state['phase'] = 'rollback-failed'
            state['rollbackFailureType'] = type(rollback_error).__name__
        finish(base, state)
        raise UpdateFailed('Update failed; state=' + state['phase'] + '; inspect ops/update-state.json') from error


def install(base, archive, archive_sha, expected, runtime, shared=Path('/run/lock/libre-deploy.lock')):
    base = layout(base)
    with operation_locks(base, shared):
        details, files = plan(base, archive, archive_sha, expected)
        if not details['changed']:
            runtime.preflight()
            return {**details, 'phase': 'unchanged', 'containerRecreated': False}
        guard = runtime.preflight()
        require(shutil.disk_usage(base).free >= 512 * 1024 * 1024, 'Insufficient free disk')
        stage_release(base, details['new'], files)
        snapshots = base / 'ops/artifacts'
        snapshots.mkdir(mode=0o700, exist_ok=True)
        require(not snapshots.is_symlink(), 'Linked artifact directory')
        saved = snapshots / (archive_sha + '.tar.gz')
        if not saved.exists():
            with saved.open('xb') as target:
                target.write(Path(archive).read_bytes())
                target.flush()
                os.fsync(target.fileno())
            saved.chmod(0o600)
        artifact.read_bundle(saved, archive_sha)
        details['retainedArchive'] = str(saved)
        sync_directory(snapshots)
        return transaction(base, details, runtime, guard)


def rollback(base, expected, runtime, shared=Path('/run/lock/libre-deploy.lock')):
    base = layout(base)
    with operation_locks(base, shared):
        ensure_idle(base)
        expect_current(base, expected)
        target = ref(base, 'previous')
        target_files = artifact.read_web(base / target)
        return transaction(base, {'changed': True, 'old': ref(base, 'current'), 'oldPrevious': target,
                                  'new': target, 'oldSha256': expected,
                                  'newSha256': artifact.sha256(target_files['web-release.json']), 'mode': 'explicit-rollback'}, runtime)


def recover(base, expected, runtime, shared=Path('/run/lock/libre-deploy.lock')):
    base = layout(base)
    with operation_locks(base, shared):
        state = journal(base)
        require(state and state.get('phase') not in TERMINAL, 'No unfinished operation')
        require(re.fullmatch(r'[0-9a-f]{32}', state.get('id', '')), 'Invalid transaction ID')
        expect_current(base, expected)
        require(ref(base, 'current') in {state['old'], state['new']}, 'Unknown current pointer; automatic recovery refused')
        require(expected in {state['oldSha256'], state['newSha256']}, 'Unknown current version')
        # Validate all journal references through the same pointer resolver before use.
        for name in ['old', 'new', 'oldPrevious']:
            value = state.get(name)
            if value is not None:
                require(re.fullmatch(r'releases/[A-Za-z0-9][A-Za-z0-9._-]*', value), 'Unsafe journal target')
                require((base / value).is_dir() and not (base / value).is_symlink(), 'Missing journal release')
        backup_path = Path(state['backup']['archive'])
        require(backup_path.parent == base / 'ops/backups', 'Backup outside own directory')
        _, backup = artifact.read_bundle(backup_path, state['backup']['sha256'])
        require(backup['webManifestSha256'] == state['oldSha256'], 'Wrong recovery backup')
        require(artifact.sha256(artifact.read_web(base / state['old'])['web-release.json']) == state['oldSha256'], 'Recovery release corrupted')
        runtime.preflight(saved_guard=state['guard'])
        switch(base, 'current', state['old'])
        runtime.activate(base / state['old'])
        state['rollbackVerification'] = runtime.verify(base / state['old'])
        require(isinstance(state['rollbackVerification'], dict) and state['rollbackVerification'].get('healthy') is True, 'Recovery health not confirmed')
        switch(base, 'previous', state['oldPrevious'])
        state['phase'] = 'rolled-back'
        state['recoveredAfterInterruption'] = True
        finish(base, state)
        return state


def validate_compose(config, base):
    require(config.get('name') == 'melodiajest' and set(config.get('services', {})) == {SERVICE}, 'Unexpected Compose project/services')
    service = config['services'][SERVICE]
    require(service.get('container_name') == CONTAINER and service.get('user') == '101:101' and service.get('read_only') is True, 'Unsafe container identity')
    require(not service.get('ports') and not service.get('build') and service.get('pull_policy') == 'never', 'Unexpected ports/build/pull')
    require(not any(service.get(key) for key in ['privileged', 'devices', 'pid', 'ipc', 'volumes_from', 'network_mode', 'post_start', 'pre_stop']), 'Unexpected privileged runtime configuration')
    require(set(service.get('cap_drop', [])) == {'ALL'} and any(value in {'no-new-privileges:true', 'no-new-privileges=true'} for value in service.get('security_opt', [])), 'Missing capability/privilege protection')
    require(0 < int(service.get('mem_limit', 0)) <= 64 * 1024 * 1024 and 0 < float(service.get('cpus', 0)) <= 0.25, 'Missing resource bounds')
    require(service.get('image') == 'nginx:stable-alpine' and service.get('entrypoint') == ['nginx'] and service.get('command') == ['-g', 'daemon off;'], 'Unexpected image/command')
    volumes = service.get('volumes', [])
    expected = {'/usr/share/nginx/html': (base / 'current').as_posix(), '/etc/nginx/nginx.conf': (base / 'deploy/nginx.conf').as_posix()}
    if any(v.get('target') == '/run/melodiajest-account' for v in volumes):
        expected['/run/melodiajest-account'] = '/run/melodiajest-account'
    require(len(volumes) == len(expected) and {v.get('target') for v in volumes} == set(expected), 'Unexpected mounts')
    require(all(v.get('type') == 'bind' and v.get('read_only') is True and v.get('source') == expected[v['target']] for v in volumes), 'Unsafe bind mount')
    require(set(service.get('networks', {})) == {'edge'} and service['networks']['edge'].get('aliases') == ['melodiajest-web'], 'Unsafe network aliases')
    require(set(config.get('networks', {})) == {'edge'} and config['networks']['edge'].get('external') is True and config['networks']['edge'].get('name') == 'libre_public', 'Wrong shared network')


class ProductionRuntime:
    def __init__(self, base=PRODUCTION):
        require(Path(base) == PRODUCTION and os.name == 'posix', 'Production runtime is fixed to the existing Linux service')
        self.base, self.guard = Path(base), None

    def command(self, args):
        return subprocess.check_output(args, timeout=90)

    def compose(self, *args):
        return self.command(['docker', 'compose', '-f', str(self.base / 'deploy/compose.yaml'), *args])

    def inspect(self):
        info = json.loads(self.command(['docker', 'inspect', CONTAINER]))[0]
        require(info['Config']['Labels']['com.docker.compose.service'] == SERVICE, 'Wrong running service')
        require(info['Config']['User'] == '101:101' and info['HostConfig']['ReadonlyRootfs'] and not info['HostConfig']['PortBindings'], 'Unsafe running container')
        require(set(info['NetworkSettings']['Networks']) == {'libre_public'}, 'Unexpected container networks')
        require(all(alias.startswith('melodiajest-') for alias in info['NetworkSettings']['Networks']['libre_public']['Aliases']), 'Shared DNS alias collision')
        return info

    def get(self, path):
        request = urllib.request.Request('https://melodiajest.ru' + path, headers={'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=15) as response:
            require(response.status == 200, 'HTTP check failed')
            data = response.read(artifact.MAX_FILE + 1)
            require(len(data) <= artifact.MAX_FILE, 'Oversized HTTP response')
            return data

    def neighbors(self):
        statuses = {}
        for host in ['libreta.ru', 'praicer.ru', 'grigorova.libreta.ru']:
            with urllib.request.urlopen('https://' + host + '/', timeout=15) as response:
                require(response.status == 200, 'Neighbor unavailable: ' + host)
                statuses[host] = response.status
        return statuses

    def preflight(self, saved_guard=None):
        validate_compose(json.loads(self.compose('config', '--format', 'json')), self.base)
        try:
            info = self.inspect()
        except subprocess.CalledProcessError:
            require(saved_guard is not None, 'Container missing; inspect before updating')
            info = None
        require(saved_guard is not None or info['State']['Running'], 'Container not running')
        image = json.loads(self.command(['docker', 'image', 'inspect', 'nginx:stable-alpine']))[0]['Id']
        require(info is None or image == info['Image'], 'Image tag changed; image updates are separate')
        caddy = Path('/opt/libre/deploy/vps/Caddyfile')
        guard = {'image': image, 'caddySha256': artifact.sha256(caddy.read_bytes()), 'caddyInode': caddy.stat().st_ino,
                 'configs': {name: artifact.sha256(artifact.regular_bytes(self.base / 'deploy', name)) for name in artifact.CONFIG}}
        if saved_guard is not None:
            require(guard == saved_guard, 'Infrastructure/configuration changed; automatic recovery refused')
        self.neighbors()
        self.guard = guard
        return guard

    def activate(self, target):
        require((self.base / 'current').resolve() == target, 'Pointer not switched to target')
        image = json.loads(self.command(['docker', 'image', 'inspect', 'nginx:stable-alpine']))[0]['Id']
        require(self.guard and image == self.guard['image'], 'Image drift before activation')
        self.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait', '--wait-timeout', '40', SERVICE)

    def verify(self, target):
        expected = artifact.read_web(target)
        for name, data in expected.items():
            require(self.get('/' + name) == data, 'Public bytes differ: ' + name)
        require(self.get('/') == expected['index.html'], 'Main route differs')
        manifest = json.loads(expected['web-release.json'])
        if manifest.get('storage') == 'account':
            health = json.loads(self.get('/api/service/v1/health'))
            require(health.get('status') == 'ok' and health.get('serviceVersion') == 1 and health.get('schemaVersion') == 1, 'Account API is unavailable after release')
            contracts = {'catalog-transfer.js', 'catalog-personalization.js', 'music-document.js', 'piano-catalog-adapter.js', 'practice-assessment.js'}
            require(set(health.get('contracts', {})) == contracts and all(health['contracts'][name] == manifest['files'][name]['sha256'] for name in contracts), 'Account API and public musical contracts differ')
        for path in ['/server.cjs', '/trainer-content.json', '/.env', '/api/content', '/api/midi-keyboard/launch', '/api/midi-bridge/events']:
            try:
                self.get(path)
                raise artifact.ArtifactError('Private route exposed')
            except urllib.error.HTTPError as error:
                require(error.code == 404, 'Unexpected private-route status')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None
        opener = urllib.request.build_opener(NoRedirect())
        for start, code in [('http://melodiajest.ru', 308), ('https://www.melodiajest.ru', 301)]:
            suffix = '/web-release.json?melodiajest-release-check=1'
            try:
                opener.open(start + suffix, timeout=15)
                raise artifact.ArtifactError('Missing canonical redirect')
            except urllib.error.HTTPError as error:
                require(error.code == code and error.headers.get('Location') == 'https://melodiajest.ru' + suffix, 'Redirect lost scheme/host/path/query')
        try:
            urllib.request.urlopen(urllib.request.Request('https://melodiajest.ru/', data=b'{}', method='POST'), timeout=15)
            raise artifact.ArtifactError('Static root accepted a mutation')
        except urllib.error.HTTPError as error:
            require(error.code == 405, 'Unexpected POST status')
        info = self.inspect()
        require(info['State']['Health']['Status'] == 'healthy' and info['Image'] == self.guard['image'], 'Container unhealthy or wrong image')
        caddy = Path('/opt/libre/deploy/vps/Caddyfile')
        require(artifact.sha256(caddy.read_bytes()) == self.guard['caddySha256'] and caddy.stat().st_ino == self.guard['caddyInode'], 'Shared Caddy changed')
        require(all(artifact.sha256(artifact.regular_bytes(self.base / 'deploy', name)) == digest for name, digest in self.guard['configs'].items()), 'Own configuration changed')
        return {'publicFilesVerified': len(expected), 'neighbors': self.neighbors(), 'healthy': True, 'caddyUnchanged': True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for command in ['plan', 'install', 'rollback', 'recover']:
        action = commands.add_parser(command)
        action.add_argument('--expected-current', required=True)
        if command in {'plan', 'install'}:
            action.add_argument('archive')
            action.add_argument('--sha256', required=True)
    args = parser.parse_args()
    runtime = ProductionRuntime()
    if args.command == 'plan':
        with operation_locks(PRODUCTION):
            result, _ = plan(PRODUCTION, args.archive, args.sha256, args.expected_current)
            result['infrastructure'] = runtime.preflight()
    elif args.command == 'install':
        result = install(PRODUCTION, args.archive, args.sha256, args.expected_current, runtime)
    elif args.command == 'rollback':
        result = rollback(PRODUCTION, args.expected_current, runtime)
    else:
        result = recover(PRODUCTION, args.expected_current, runtime)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
