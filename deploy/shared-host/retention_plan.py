"""Read-only plan for old, independently restored local S3 payload duplicates.

No removal, quarantine, restic, Docker or timer commands. Production CLI is fixed
to /opt/melodiajest; fixtures use collect/plan directly. Bytes are measured, not
promised savings. A plan never authorizes deletion without a separate executor.
"""
import argparse
from contextlib import contextmanager, ExitStack
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import stat

import release_artifact as artifact
import backup_s3_job as job

PRODUCTION = Path('/opt/melodiajest')
SHA = re.compile(r'[a-f0-9]{64}')
TOKEN = re.compile(r'payload-[a-f0-9]{16}')
MAX_WORKS = 256
MAX_ENTRIES = 20000
MAX_JSON = 256 * 1024
KEEP_NEWEST = 3
MIN_AGE_SECONDS = 6 * 3600
MAX_CANDIDATES = 2
MAX_CANDIDATE_BYTES = 64 * 1024 * 1024
CONTROL_NAMES = ['s3-schedule.json', 'update-state.json',
                 'external-s3/last-backup-success.json',
                 'external-s3/last-restore-success.json',
                 'external-s3/last-attempt.json',
                 'external-s3/scheduled/pending.json',
                 'external-s3/scheduled/last-success.json',
                 'external-s3/scheduled/last-restore-success.json',
                 'external-s3/scheduled/last-attempt.json']


def require(ok, message):
    if not ok:
        raise ValueError('MelodiaJest retention plan: ' + message)


def stamp(value):
    require(isinstance(value, str), 'timestamp required')
    value = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(value.tzinfo is not None, 'timezone required')
    return value.astimezone(dt.timezone.utc)


def real(path, directory=False):
    require(path.is_absolute() and path.resolve(strict=True) == path, 'non-canonical or linked path')
    info = path.lstat()
    require(not path.is_symlink() and not getattr(path, 'is_junction', lambda: False)(), 'linked path')
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode), 'wrong file type')
    if not directory:
        require(info.st_nlink == 1, 'hard-linked file')
    return info


def read_json(path):
    info = real(path)
    require(info.st_size <= MAX_JSON, 'oversized metadata')
    raw = path.read_bytes()
    require(len(raw) == info.st_size and path.lstat().st_mtime_ns == info.st_mtime_ns, 'metadata changed during read')
    value = json.loads(raw)
    require(type(value) is dict, 'metadata object required')
    return value, artifact.descriptor(raw)


def tree_usage(root):
    device = real(root, True).st_dev
    pending = [(root, 0)]
    count = logical = allocated = 0
    newest = 0
    blocks_available = True
    while pending:
        path, depth = pending.pop()
        require(depth <= 12, 'tree too deep')
        info = real(path, True)
        require(info.st_dev == device, 'different filesystem')
        newest = max(newest, info.st_mtime)
        allocated += getattr(info, 'st_blocks', 0) * 512
        blocks_available = blocks_available and hasattr(info, 'st_blocks')
        with os.scandir(path) as entries:
            for entry in entries:
                count += 1
                require(count <= MAX_ENTRIES, 'tree entry limit exceeded')
                item = Path(entry.path)
                info = item.lstat()
                require(info.st_dev == device and not item.is_symlink() and not getattr(item, 'is_junction', lambda: False)(), 'linked or mounted entry')
                newest = max(newest, info.st_mtime)
                if stat.S_ISDIR(info.st_mode):
                    pending.append((item, depth + 1))
                else:
                    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'special or hard-linked entry')
                    logical += info.st_size
                    allocated += getattr(info, 'st_blocks', 0) * 512
                    blocks_available = blocks_available and hasattr(info, 'st_blocks')
    return dict(entries=count, logicalBytes=logical, allocatedBytes=allocated if blocks_available else None,
                newestMtime=newest, allocationMeasured=blocks_available)


def references(value):
    """Only documented work/prepared paths; arbitrary receipt strings are ignored."""
    result = set()
    backup = value.get('backup', {})
    require(type(backup) is dict, 'invalid backup reference object')
    for item in [value, value.get('prepared', {}), backup, backup.get('prepared', {})]:
        require(type(item) is dict, 'invalid work reference object')
        if 'work' in item:
            require(TOKEN.fullmatch(item['work'] or ''), 'invalid active work reference')
            result.add(item['work'])
    return result


def controls(base):
    home = base / 'ops'
    real(base, True)
    real(home, True)
    values, fingerprints, protected = {}, {}, set()
    for name in CONTROL_NAMES:
        path = home / name
        require(path.exists() or not path.is_symlink(), 'dangling control link')
        if not path.exists():
            fingerprints[name] = None
            continue
        value, descriptor = read_json(path)
        fingerprints[name] = descriptor
        values[name] = value
        protected.update(references(value))
        require(value.get('status') not in ['running', 'backup-succeeded-restore-pending', 'failed', 'deferred'], 'backup or restore unfinished or unhealthy')
    require('s3-schedule.json' in values and 'update-state.json' in values, 'missing own control state')
    require(values['update-state.json'].get('phase') in ['committed', 'rolled-back'], 'release transaction unfinished')
    pins = values['s3-schedule.json']
    require(SHA.fullmatch(pins.get('developmentArchiveSha256', '') or ''), 'development source pin missing')
    manifests = {}
    release_paths = {}
    for name in ['current', 'previous']:
        path = base / name
        require(path.is_symlink(), 'missing current or previous release reference')
        relative = os.readlink(path)
        require(re.fullmatch(r'releases/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{12}', relative), 'unsafe release reference')
        target = base / relative
        real(target, True)
        raw = artifact.regular_bytes(target, 'web-release.json')
        manifests[name] = artifact.sha256(raw)
        release_paths[name] = relative
    return dict(fingerprints=fingerprints, protectedWorks=sorted(protected),
                developmentSourceSha256=pins['developmentArchiveSha256'],
                releaseManifests=manifests, releasePaths=release_paths)


def work_summary(folder):
    token = folder.name
    out = dict(work=token, path='ops/external-work/' + token, holdReasons=[],
               payloadContentsVerified=False, automaticDeletionReady=False)
    try:
        out.update(tree_usage(folder))
        require({p.name for p in folder.iterdir()}.issubset({'prepared.json', 'backup-success.json', 'restore-success.json', 'payload', 'cache-backup'}), 'unknown work contents')
        prepared, _ = read_json(folder / 'prepared.json')
        backup, _ = read_json(folder / 'backup-success.json')
        restored, _ = read_json(folder / 'restore-success.json')
        payload, payload_desc = read_json(folder / 'payload/payload.json')
        require(prepared.get('work') == backup.get('work') == token, 'work identity differs')
        for field in ['payloadManifestSha256', 'checkoutArchiveSha256', 'currentWebManifestSha256']:
            require(SHA.fullmatch(prepared.get(field, '') or ''), 'missing prepared digest')
            require(backup.get('prepared', {}).get(field) == prepared[field], 'backup prepared identity differs')
        require(payload_desc['sha256'] == prepared['payloadManifestSha256'] == restored.get('payloadManifestSha256'), 'payload manifest identity differs')
        require(payload.get('format') == 'melodiajest-external-payload-v1' and payload.get('checkoutArchiveSha256') == prepared['checkoutArchiveSha256'], 'payload source identity differs')
        require(backup.get('success') is True and restored.get('success') is True and restored.get('independentExternalCopyVerified') is True, 'external restore unconfirmed')
        require(SHA.fullmatch(backup.get('snapshotId', '') or '') and backup['snapshotId'] == restored.get('snapshotId'), 'restored snapshot differs')
        require(restored.get('productionInputsMounted') is False and restored.get('originalPayloadTemporarilyUnavailable') is True and restored.get('temporaryRestoreRemoved') is True, 'isolated cold restore unconfirmed')
        require(restored.get('checkoutRestore', {}).get('archiveSha256') == prepared['checkoutArchiveSha256'], 'restored source differs')
        require(stamp(prepared['checkedAt']) <= stamp(backup['checkedAt']) <= stamp(restored['checkedAt']), 'receipt chronology differs')
        require(type(prepared.get('bytes')) is int and 0 < prepared['bytes'] <= MAX_CANDIDATE_BYTES, 'invalid payload size')
        out.update(verifiedAt=restored['checkedAt'], preparedAt=prepared['checkedAt'],
                   snapshotId=backup['snapshotId'], checkoutSha256=prepared['checkoutArchiveSha256'],
                   releaseManifestSha256=prepared['currentWebManifestSha256'],
                   payloadManifestSha256=prepared['payloadManifestSha256'], payloadBytes=prepared['bytes'],
                   metadataMatchedColdRestore=True)
    except (ValueError, OSError, KeyError, TypeError) as error:
        out['holdReasons'].append(str(error) if str(error).startswith('MelodiaJest retention plan:') else type(error).__name__)
    return out


def collect(base, now=None):
    base = Path(base).absolute()
    captured = controls(base)
    home = base / 'ops/external-work'
    real(home, True)
    folders = sorted(home.iterdir())
    require(len(folders) <= MAX_WORKS, 'work directory limit exceeded')
    entries, unknown = [], []
    for folder in folders:
        if TOKEN.fullmatch(folder.name) and not folder.is_symlink() and folder.is_dir():
            entries.append(work_summary(folder))
        else:
            unknown.append(folder.name)
    require(captured == controls(base), 'control state changed during inventory')
    return dict(format='melodiajest-local-payload-inventory-v1', checkedAt=(now or dt.datetime.now(dt.timezone.utc)).isoformat(),
                controls=captured, entries=entries, unknownEntries=unknown, s3Requests=0, deletedFiles=0)


def plan(inventory, pinned_sources=()):
    require(inventory.get('format') == 'melodiajest-local-payload-inventory-v1', 'wrong inventory format')
    now = stamp(inventory['checkedAt'])
    require(len(pinned_sources) <= 16 and all(SHA.fullmatch(x or '') for x in pinned_sources), 'invalid source protections')
    state = inventory['controls']
    require(SHA.fullmatch(state.get('developmentSourceSha256', '') or '') and set(state.get('releaseManifests', {})) == {'current', 'previous'} and all(SHA.fullmatch(x or '') for x in state['releaseManifests'].values()), 'invalid protected source or releases')
    require(type(state.get('protectedWorks')) is list and all(TOKEN.fullmatch(x or '') for x in state['protectedWorks']), 'invalid protected work references')
    protected_sources = {state['developmentSourceSha256'], *pinned_sources}
    protected_manifests = set(state['releaseManifests'].values())
    rows = inventory['entries']
    require(type(rows) is list and len(rows) <= MAX_WORKS, 'inventory rows exceeded')
    require(len({x['work'] for x in rows}) == len(rows) and all(TOKEN.fullmatch(x['work']) and x['path'] == 'ops/external-work/' + x['work'] for x in rows), 'duplicate or unsafe work identity')
    latest = {x['work'] for x in sorted(rows, key=lambda x: x.get('newestMtime', float('inf')), reverse=True)[:KEEP_NEWEST]}
    candidates, held, total = [], [], 0
    for item in sorted(rows, key=lambda x: x.get('newestMtime', float('inf'))):
        reasons = list(item['holdReasons'])
        newest = item.get('newestMtime')
        if type(newest) not in [int, float] or not math.isfinite(newest):
            reasons.append('newest-time-not-measured')
            newest = now.timestamp()
        if item['work'] in state['protectedWorks']:reasons.append('active-receipt-reference')
        if item.get('checkoutSha256') in protected_sources:reasons.append('pinned-development-source')
        if item.get('releaseManifestSha256') in protected_manifests:reasons.append('current-or-previous-release')
        if item['work'] in latest:reasons.append('keep-newest-three')
        age = now.timestamp() - max(newest, stamp(item.get('verifiedAt', inventory['checkedAt'])).timestamp())
        if age < MIN_AGE_SECONDS:reasons.append('younger-than-six-hours-or-future')
        size = item.get('allocatedBytes')
        if type(size) is not int or size <= 0:reasons.append('allocated-size-not-measured')
        if item.get('metadataMatchedColdRestore') is not True:reasons.append('matching-cold-restore-not-confirmed')
        if not reasons and (len(candidates) >= MAX_CANDIDATES or total + size > MAX_CANDIDATE_BYTES):reasons.append('bounded-plan-budget')
        if reasons:
            held.append(dict(work=item['work'], path=item['path'], reasons=reasons))
        else:
            total += size
            candidates.append(dict(item, ageSeconds=round(age), status='candidate-requires-separate-executor'))
    return dict(format='melodiajest-local-payload-retention-plan-v1', checkedAt=inventory['checkedAt'],
                policy=dict(keepNewest=KEEP_NEWEST, minAgeSeconds=MIN_AGE_SECONDS, maxCandidates=MAX_CANDIDATES, maxAllocatedBytes=MAX_CANDIDATE_BYTES),
                controls=state, pinnedSourceSha256s=sorted(protected_sources), candidates=candidates, held=held,
                unknownEntriesPreserved=inventory['unknownEntries'], estimatedAllocatedBytes=total,
                deletionImplemented=False, automaticDeletionReady=False, deletedFiles=0, s3Requests=0,
                requiredBeforeDeletion=['fresh exact independent restore or preserved verified independent replica',
                                        'revalidate pinned controls and every candidate under actual shared and own exclusive locks',
                                        'verify all payload hashes and sizes; no links, special files or active mounts',
                                        'bounded reversible quarantine and recovery verification before any final removal'])


@contextmanager
def read_locks(base=PRODUCTION, shared=Path('/run/lock/libre-deploy.lock')):
    require(os.name == 'posix', 'production inspection requires POSIX locks')
    import fcntl
    real(base, True)
    real(base / 'ops', True)
    with ExitStack() as stack:
        for path in [shared, base / 'ops/operation.lock']:
            real(path)
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            stack.callback(os.close, fd)
            fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        yield


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['inspect', 'plan'])
    parser.add_argument('--pin-source', action='append', default=[])
    args = parser.parse_args(argv)
    with read_locks():
        observed = collect(PRODUCTION)
        result = observed if args.command == 'inspect' else plan(observed, args.pin_source)
        if args.command == 'plan':
            for candidate in result['candidates']:
                job.verify_payload(PRODUCTION / candidate['path'] / 'payload', candidate['payloadManifestSha256'])
                candidate['payloadContentsVerified'] = True
            require(observed['controls'] == controls(PRODUCTION), 'control state changed during plan')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
