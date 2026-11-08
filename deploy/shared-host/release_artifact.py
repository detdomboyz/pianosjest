"""Verified MelodiaJest archives. Python stdlib only; never extracts tar paths.

This module does not change current, start containers, configure S3, or restore
over an existing directory. Source snapshots are separate from public web files.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile

ASSETS = frozenset(json.loads(Path(__file__).with_name('public-assets.json').read_text(encoding='utf-8')))
PUBLIC = ASSETS | {'web-runtime.js', 'web-release.json'}
# Published 23.5.61 and its predecessors remain valid rollback/restore inputs.
# Accept complete known profiles only; a subset or arbitrary new file is unsafe.
LEGACY_ASSETS = frozenset({
    'index.html', 'chopin-theme.js', 'audio-transcriber.js', 'fingering.js', 'beginner-fingering.js',
    'practice-assessment.js', 'piano-progress-store.js', 'piano-preparation.js', 'piano-preparation-store.js',
    'piano-preparation-fragment.js', 'piano-preparation-capture.js', 'piano-preparation-transfer.js',
    'piano-preparation-import.js', 'curriculum.js', 'curriculum-plan.js', 'catalog-sections.js',
    'lesson-review-baseline.js', 'lesson-quality.js', 'lesson-development.js', 'piano-lesson-development.js',
    'piano-learning-ui.js', 'catalog-transfer.js', 'music-document.js', 'piano-catalog-adapter.js',
    'catalog-sections.css', 'piano-learning-ui.css'})
ACCOUNT_ASSETS = LEGACY_ASSETS | {'service-client.js', 'catalog-personalization.js', 'account.html', 'account.js', 'account.css'}
ASSET_PROFILES = (LEGACY_ASSETS, ACCOUNT_ASSETS, ASSETS)
CONFIG = frozenset({'compose.yaml', 'nginx.conf', 'Caddyfile.fragment'})
MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 128 * 1024 * 1024
MAX_FILES = 4096
FORBIDDEN = frozenset({'trainer-content.json', 'midi-keyboard-settings.ini', '.env', '.git', '.aws'})


class ArtifactError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise ArtifactError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def descriptor(data):
    return {'bytes': len(data), 'sha256': sha256(data)}


def safe_name(name):
    require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9_./-]+', name), 'Unsafe archive name')
    parts = name.split('/')
    require(all(part and part not in {'.', '..'} and not part.startswith('.') for part in parts), 'Unsafe archive path')
    require(all(not part.endswith('.') and part.split('.')[0].upper() not in {'CON', 'PRN', 'AUX', 'NUL', *{'COM' + str(n) for n in range(1, 10)}, *{'LPT' + str(n) for n in range(1, 10)}} for part in parts), 'Non-portable archive path')
    require(not PurePosixPath(name).is_absolute(), 'Absolute archive path')
    require(not any(part.lower() in FORBIDDEN for part in parts), 'Private file in archive')
    return name


def source_allowed(name):
    safe_name(name)
    path = PurePosixPath(name)
    if len(path.parts) == 1:
        return path.suffix in {'.js', '.cjs', '.ts', '.css', '.html'} or name in {'AGENTS.md', 'README.md', 'package.json', 'package-lock.json'}
    if path.parts[0] == 'docs':
        return path.suffix in {'.md', '.json'}
    if path.parts[0] == 'tests':
        return path.suffix in {'.cjs', '.js', '.json', '.py'}
    if path.parts[0] == 'tools':
        return path.suffix in {'.cjs', '.js', '.py', '.json', '.md'}
    if path.parts[0] == 'service':
        return path.suffix in {'.cjs', '.js', '.ts', '.py', '.json', '.md', '.html', '.css', '.sql'} and not any(part in {'data', 'backups', 'node_modules'} for part in path.parts)
    return path.parts[:2] == ('deploy', 'shared-host') and path.suffix in {'.py', '.json', '.yaml', '.conf', '.fragment', '.md'}


def regular_bytes(base, name):
    safe_name(name)
    base = Path(base).resolve(strict=True)
    path = base / name
    for item in [path] + list(path.parents):
        if item == base:
            break
        require(not item.is_symlink() and not getattr(item, 'is_junction', lambda: False)(), 'Link in input: ' + name)
    require(path.is_file(), 'Missing regular file: ' + name)
    require(path.stat().st_size <= MAX_FILE, 'Oversized input: ' + name)
    data = path.read_bytes()
    require(len(data) <= MAX_FILE, 'Input changed size: ' + name)
    return data


def verify_web(files):
    require('web-release.json' in files, 'Missing web manifest')
    manifest = json.loads(files['web-release.json'])
    names = set(manifest.get('files', {}))
    profile = names - {'web-runtime.js'}
    require(profile in ASSET_PROFILES and names == profile | {'web-runtime.js'} and set(files) == names | {'web-release.json'}, 'Unexpected or missing public files')
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', str(manifest.get('version', ''))), 'Invalid version')
    require(manifest.get('targetDomain') == 'melodiajest.ru' and manifest.get('domainStatus') == 'registered', 'Wrong domain')
    require(manifest.get('mode') == 'web' and manifest.get('nativeCompanion') is False, 'Unsafe web mode')
    if manifest.get('storage') == 'account':
        require(manifest.get('serviceVersion') == 1, 'Unprepared account API profile')
        if manifest.get('gameVersion') == 1:
            require(profile == ASSETS and manifest.get('personalProgress') == 'database-and-versioned-browser-history' and manifest.get('sourceEntries') == {'index.html':'learn.html','trainer.html':'index.html'}, 'Unprepared game web profile')
            runtime = "window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'account',serviceVersion:1,gameVersion:1,version:" + json.dumps(manifest['version']) + "});\n"
        else:
            require(profile == ACCOUNT_ASSETS and manifest.get('gameVersion') is None and manifest.get('personalProgress') == 'account-scoped-browser', 'Unprepared account web profile')
            runtime = "window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'account',serviceVersion:1,version:" + json.dumps(manifest['version']) + "});\n"
    else:
        require(manifest.get('storage') == 'browser' and manifest.get('serviceVersion') is None, 'Unsafe web storage')
        runtime = "window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'browser'});\n"
    require(files['web-runtime.js'] == runtime.encode(), 'Runtime mode differs from verified manifest')
    for name, info in manifest['files'].items():
        require(type(info.get('bytes')) is int and info == descriptor(files[name]), 'Public checksum mismatch: ' + name)
    return manifest


def read_web(directory):
    directory = Path(directory)
    names = {item.name for item in directory.iterdir()}
    require(names <= PUBLIC, 'Unexpected files in web directory')
    files = {name: regular_bytes(directory, name) for name in names}
    verify_web(files)
    return files


def collect_sources(checkout):
    if checkout is None:
        return {}
    checkout = Path(checkout).resolve(strict=True)
    candidates = list(checkout.iterdir())
    for folder in ['tools', 'tests', 'docs', 'deploy/shared-host', 'service']:
        directory = checkout / folder
        require(not directory.is_symlink() and not getattr(directory, 'is_junction', lambda: False)(), 'Linked source directory')
        candidates.extend(directory.rglob('*'))
    result = {}
    for path in candidates:
        if path.is_dir():
            require(not path.is_symlink() and not getattr(path, 'is_junction', lambda: False)(), 'Linked source directory')
            continue
        name = path.relative_to(checkout).as_posix()
        # Unselected private files are never read; selected links are rejected.
        try:
            selected = source_allowed(name)
        except ArtifactError:
            selected = False
        if selected:
            result[name] = regular_bytes(checkout, name)
    return result


def pack(web, configs, output, checkout=None):
    public = read_web(web)
    entries = {'web/' + name: data for name, data in public.items()}
    entries.update({'config/' + name: regular_bytes(configs, name) for name in CONFIG})
    sources = collect_sources(checkout)
    entries.update({'source/' + name: data for name, data in sources.items()})
    require(len(entries) < MAX_FILES and sum(map(len, entries.values())) <= MAX_TOTAL, 'Bundle limit exceeded')
    meta = {'format': 'melodiajest-artifact-v1', 'version': verify_web(public)['version'],
            'webManifestSha256': sha256(public['web-release.json']), 'sourceSnapshotIncluded': bool(sources),
            'files': {name: descriptor(data) for name, data in sorted(entries.items())}}
    entries['bundle.json'] = (json.dumps(meta, sort_keys=True, indent=2) + '\n').encode()
    output = Path(output)
    require(not output.exists() and not output.is_symlink(), 'Archive already exists')
    # Exclusive creation never replaces an earlier known-good copy.
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as destination:
        with gzip.GzipFile(fileobj=destination, mode='wb', mtime=0, filename='') as compressed:
            with tarfile.open(fileobj=compressed, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
                for name, data in sorted(entries.items()):
                    member = tarfile.TarInfo(name)
                    member.size, member.mode = len(data), 0o644
                    tar.addfile(member, io.BytesIO(data))
    digest = sha256(output.read_bytes())
    verified = read_bundle(output, digest)[1]
    return {'archive': str(output), **descriptor(output.read_bytes()), 'version': verified['version'],
            'webManifestSha256': verified['webManifestSha256'], 'sourceSnapshotIncluded': bool(sources),
            'sourceFiles': len(sources), 'publicFiles': len(public)}


def read_bundle(archive, expected_sha256):
    require(re.fullmatch(r'[0-9a-f]{64}', expected_sha256 or ''), 'Expected SHA256 required')
    archive = Path(archive)
    require(archive.is_file() and not archive.is_symlink() and archive.stat().st_size <= MAX_TOTAL, 'Invalid archive')
    raw = archive.read_bytes()
    require(len(raw) <= MAX_TOTAL, 'Oversized archive')
    require(sha256(raw) == expected_sha256, 'Archive SHA256 mismatch')
    # Bound decompression before tarfile parses potentially large PAX headers.
    with gzip.GzipFile(fileobj=io.BytesIO(raw), mode='rb') as compressed:
        unpacked = compressed.read(MAX_TOTAL + MAX_FILES * 1024 + 1)
    require(len(unpacked) <= MAX_TOTAL + MAX_FILES * 1024, 'Expanded archive limit exceeded')
    files, total, seen = {}, 0, set()
    with tarfile.open(fileobj=io.BytesIO(unpacked), mode='r:') as tar:
        for member in tar:
            name = safe_name(member.name)
            require(member.isfile() and not member.issparse(), 'Non-regular archive member')
            require(name.lower() not in seen, 'Duplicate archive member')
            seen.add(name.lower())
            require(0 <= member.size <= MAX_FILE, 'Oversized archive member')
            total += member.size
            require(total <= MAX_TOTAL and len(seen) <= MAX_FILES, 'Archive limits exceeded')
            with tar.extractfile(member) as source:
                data = source.read(member.size + 1)
            require(len(data) == member.size, 'Truncated archive member')
            files[name] = data
    require('bundle.json' in files, 'Missing bundle manifest')
    meta = json.loads(files['bundle.json'])
    require(meta.get('format') == 'melodiajest-artifact-v1', 'Unsupported bundle format')
    require(set(meta.get('files', {})) == set(files) - {'bundle.json'}, 'Bundle file set mismatch')
    for name, info in meta['files'].items():
        require(type(info.get('bytes')) is int and info == descriptor(files[name]), 'Bundle checksum mismatch: ' + name)
        category, separator, relative = name.partition('/')
        require(separator and (category == 'web' and relative in PUBLIC or category == 'config' and relative in CONFIG or category == 'source' and source_allowed(relative)), 'Unlisted bundle file')
    public = {name[4:]: data for name, data in files.items() if name.startswith('web/')}
    manifest = verify_web(public)
    require({name[7:] for name in files if name.startswith('config/')} == CONFIG, 'Missing configuration')
    require(meta.get('version') == manifest['version'] and meta.get('webManifestSha256') == sha256(public['web-release.json']), 'Bundle identity mismatch')
    has_sources = any(name.startswith('source/') for name in files)
    require(meta.get('sourceSnapshotIncluded') is has_sources, 'Source coverage mismatch')
    return files, meta


def restore(archive, destination, expected_sha256):
    files, meta = read_bundle(archive, expected_sha256)
    destination = Path(destination)
    require(not destination.exists() and not destination.is_symlink(), 'Restore destination must be new')
    destination.mkdir(mode=0o700)
    for name, data in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open('xb') as stream:
            stream.write(data)
        target.chmod(0o600)
    for name, data in files.items():
        require((destination / name).read_bytes() == data, 'Restored data mismatch: ' + name)
    verify_web({name[4:]: (destination / name).read_bytes() for name in files if name.startswith('web/')})
    return {'destination': str(destination), 'archiveSha256': expected_sha256, 'version': meta['version'],
            'webManifestSha256': meta['webManifestSha256'], 'filesVerified': len(files),
            'sourceSnapshotIncluded': meta['sourceSnapshotIncluded'], 'restoreVerified': True,
            'scope': 'isolated file restoration; not S3, browser data, or container runtime'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    create = commands.add_parser('pack')
    for flag in ['web', 'configs', 'output']:
        create.add_argument('--' + flag, required=True)
    create.add_argument('--checkout')
    for name in ['verify', 'restore', 'restore-check']:
        action = commands.add_parser(name)
        action.add_argument('archive')
        action.add_argument('--sha256', required=True)
        if name == 'restore':
            action.add_argument('--destination', required=True)
        if name == 'restore-check':
            action.add_argument('--work-dir', required=True)
    args = parser.parse_args()
    if args.command == 'pack':
        result = pack(args.web, args.configs, args.output, args.checkout)
    elif args.command == 'verify':
        _, meta = read_bundle(args.archive, args.sha256)
        result = {'archiveVerified': True, 'version': meta['version'], 'webManifestSha256': meta['webManifestSha256'], 'sourceSnapshotIncluded': meta['sourceSnapshotIncluded']}
    elif args.command == 'restore':
        result = restore(args.archive, args.destination, args.sha256)
    else:
        with tempfile.TemporaryDirectory(prefix='melodiajest-restore-', dir=args.work_dir) as work:
            result = restore(args.archive, Path(work) / 'restored', args.sha256)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    main()
