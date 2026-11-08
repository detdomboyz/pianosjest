"""Self-contained, allowlisted recovery kits for a later encrypted external copy.

This module does not connect to S3, create keys, change timers, or delete backups.
The CLI only operates below /opt/melodiajest/ops. Encryption is delegated to a
separately verified restic runtime, never implemented here.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import uuid

import release_artifact as artifact
import release_backup as backup
import release_update as update

require = artifact.require
MAX_KIT = 128 * 1024 * 1024
MANIFEST = 'kit.json'


def expected_names(snapshot, receipt):
    names = {'last-backup-success.json', receipt['snapshot']}
    for entry in snapshot['entries'].values():
        for section in ['web', 'sources']:
            names.add('blobs/' + entry[section]['sha256'] + '.tar.gz')
    names.add('controls/' + snapshot['controls']['sha256'] + '.json')
    return names


def load_kit(path, expected):
    path = Path(path).absolute()
    require(path.resolve() == path and path.is_dir() and not path.is_symlink(), 'Kit must be a real directory')
    require(backup.SHA.fullmatch(expected or ''), 'Expected kit SHA256 required')
    raw = artifact.regular_bytes(path, MANIFEST)
    require(len(raw) <= 128 * 1024 and artifact.sha256(raw) == expected, 'Kit manifest checksum differs')
    manifest = json.loads(raw)
    require(manifest.get('version') == 1 and manifest.get('scope') == 'melodiajest-recovery-kit', 'Wrong recovery kit')
    listed = manifest.get('files')
    require(isinstance(listed, dict) and 4 <= len(listed) <= 8, 'Invalid kit file count')
    total = len(raw)
    for name, descriptor in listed.items():
        require(name == 'last-backup-success.json' or re.fullmatch(r'(?:snapshots/[0-9a-f]{32}\.json|blobs/[0-9a-f]{64}\.tar\.gz|controls/[0-9a-f]{64}\.json)', name), 'Unexpected kit path')
        require(isinstance(descriptor, dict) and type(descriptor.get('bytes')) is int and 0 < descriptor['bytes'] <= MAX_KIT, 'Invalid kit file size')
        total += descriptor['bytes']
    require(total <= MAX_KIT, 'Oversized recovery kit')
    actual = set()
    for item in path.rglob('*'):
        require(not item.is_symlink() and not getattr(item, 'is_junction', lambda: False)(), 'Link in recovery kit')
        if item.is_file():
            actual.add(item.relative_to(path).as_posix())
        else:
            require(item.is_dir() and item.relative_to(path).as_posix() in {'blobs', 'controls', 'snapshots'}, 'Unexpected kit directory')
    require(actual == set(listed) | {MANIFEST}, 'Unlisted or missing kit files')
    for name, descriptor in listed.items():
        require(artifact.descriptor(artifact.regular_bytes(path, name)) == descriptor, 'Kit file checksum differs')
    receipt = backup.json_file(path / 'last-backup-success.json')
    snapshot = backup.load_snapshot(path)
    require(set(listed) == expected_names(snapshot, receipt), 'Incomplete or extra recovery references')
    require(snapshot['id'] == manifest.get('snapshotId') and snapshot['entries']['current']['manifestSha256'] == manifest.get('currentManifestSha256'), 'Kit snapshot identity differs')
    for role, entry in snapshot['entries'].items():
        require(re.fullmatch(r'releases/[A-Za-z0-9][A-Za-z0-9._-]*', entry.get('release', '')), 'Invalid recovered release name')
        for section in ['web', 'sources']:
            archive, _ = backup.read_blob(path, 'blobs', entry[section], '.tar.gz')
            _, meta = artifact.read_bundle(archive, entry[section]['sha256'])
            require(meta['webManifestSha256'] == entry['manifestSha256'], 'Recovered archive belongs to another release')
            if section == 'sources':
                require(meta['sourceSnapshotIncluded'], 'Recovered source coverage missing')
    _, controls = backup.read_blob(path, 'controls', snapshot['controls'], '.json')
    with tempfile.TemporaryDirectory(prefix='verify-controls-') as temporary:
        backup.restore_controls(controls, Path(temporary) / 'controls')
    return manifest, snapshot


def collect(base):
    home = backup.layout(base)
    update.ensure_idle(base)
    attempt = backup.json_file(home / 'last-backup-attempt.json')
    require(attempt.get('status') == 'success', 'Last backup attempt did not succeed')
    snapshot = backup.load_snapshot(home)
    require(snapshot['entries']['current']['manifestSha256'] == update.current_sha(base), 'Current release not in source snapshot')
    previous = update.ref(base, 'previous', optional=True)
    previous_sha = artifact.sha256(artifact.regular_bytes(base / previous, 'web-release.json')) if previous else None
    require(snapshot['entries'].get('previous', {}).get('manifestSha256') == previous_sha, 'Previous release not in source snapshot')
    receipt = backup.json_file(home / 'last-backup-success.json')
    timestamp = dt.datetime.fromisoformat(receipt['checkedAt'])
    require(timestamp.tzinfo is not None and -300 <= (dt.datetime.now(dt.timezone.utc) - timestamp).total_seconds() <= 30 * 3600, 'Source backup is stale or has an invalid time')
    names = expected_names(snapshot, receipt)
    files = {name: artifact.regular_bytes(home, name) for name in names}
    require(sum(map(len, files.values())) <= MAX_KIT, 'Source kit exceeds size limit')
    manifest = {'version': 1, 'scope': 'melodiajest-recovery-kit', 'snapshotId': snapshot['id'],
                'currentManifestSha256': snapshot['entries']['current']['manifestSha256'],
                'files': {name: artifact.descriptor(data) for name, data in sorted(files.items())},
                'contents': 'current/previous web/config and retained sources plus own controls; no browser state or encryption password'}
    files[MANIFEST] = backup.encoded(manifest)
    return files


def write_kit(files, destination):
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'Recovery destination already exists')
    destination.mkdir(mode=0o700)
    for name, data in files.items():
        artifact.safe_name(name)
        path = destination / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        path.chmod(0o600)
    return destination


def prepare(base, shared=Path('/run/lock/libre-deploy.lock')):
    home = backup.layout(base)
    with backup.worker_lock(home), update.operation_locks(base, shared):
        require(shutil.disk_usage(base).free >= 512 * 1024 * 1024, 'Insufficient free disk')
        files = collect(base)
        digest = artifact.sha256(files[MANIFEST])
        parent = backup.directory(base / 'ops/external-kits')
        destination = parent / digest
        require(not destination.is_symlink(), 'Linked immutable kit destination')
        reused = destination.exists()
        if reused:
            manifest, snapshot = load_kit(destination, digest)
        else:
            temporary = parent / ('.stage-' + uuid.uuid4().hex)
            try:
                write_kit(files, temporary)
                manifest, snapshot = load_kit(temporary, digest)
                os.rename(temporary, destination)
                update.sync_directory(parent)
            finally:
                if temporary.exists():
                    require(temporary.parent == parent and not temporary.is_symlink(), 'Unsafe temporary cleanup')
                    shutil.rmtree(temporary)
        return {'checkedAt': backup.utcnow(), 'path': str(destination), 'manifestSha256': digest, 'snapshotId': snapshot['id'],
                'filesVerified': len(manifest['files']) + 1, 'bytes': sum(map(len, files.values())), 'reused': reused, 'encrypted': False, 'independentExternalCopyVerified': False}


def restore_check(kit, expected, destination, runtime_factory):
    """Cold restore from kit bytes only; destination must be new, never production."""
    manifest, snapshot = load_kit(kit, expected)
    destination = Path(destination).absolute()
    require(not destination.exists() and not destination.is_symlink(), 'Cold restore destination exists')
    require(destination.parent.is_dir() and destination.parent.resolve() == destination.parent, 'Unsafe cold restore parent')
    # Do not permit a caller to replace the installed service namespace.
    require(destination != update.PRODUCTION and not update.PRODUCTION.is_relative_to(destination), 'Refuse production/ancestor restore')
    destination.mkdir(mode=0o700)
    for name in ['releases', 'deploy', 'ops']:
        (destination / name).mkdir(mode=0o700)
    home = backup.layout(destination)
    for name in manifest['files']:
        path = home / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(artifact.regular_bytes(kit, name))
        path.chmod(0o600)
    controls = backup.read_blob(home, 'controls', snapshot['controls'], '.json')[1]
    backup.restore_controls(controls, destination / 'recovered-controls')
    config = backup.json_file(destination / 'recovered-controls/policy.json')
    result = backup.check_restore(destination, runtime_factory(destination, config['image']))
    result.update(kitManifestSha256=expected, coldRestore=True, productionInputsUsed=False, independentExternalCopyVerified=False)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'verify', 'restore-check'])
    parser.add_argument('--kit', help='Expected immutable kit SHA256; not a filesystem path')
    args = parser.parse_args()
    base = update.PRODUCTION
    if args.command == 'prepare':
        result = prepare(base)
    else:
        require(backup.SHA.fullmatch(args.kit or ''), 'Expected own kit identifier')
        kit = base / 'ops/external-kits' / args.kit
        if args.command == 'verify':
            manifest, _ = load_kit(kit, args.kit)
            result = {'filesVerified': len(manifest['files']) + 1, 'manifestSha256': args.kit}
        else:
            home = backup.layout(base)
            with backup.worker_lock(home), update.operation_locks(base):
                with tempfile.TemporaryDirectory(prefix='cold-', dir=home / 'work') as temporary:
                    result = restore_check(kit, args.kit, Path(temporary) / 'app', backup.IsolatedNginx)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
