"""Bounded, reversible Linux quarantine of verified local payload duplicates.

No purge, restic, timer or production release changes. The CLI fixes the base to
/opt/melodiajest; isolated tests call the same functions with their own fixture.
Both actual portal/own locks are held. Immutable intent plus file hashes allows
recovery after interruption between rename and journal update.
"""
import argparse
from contextlib import contextmanager, ExitStack
import ctypes
import datetime as dt
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import uuid

import retention_plan as rp

FORMAT = 'melodiajest-payload-quarantine-intent-v1'
BATCH = re.compile(r'quarantine-[a-f0-9]{32}')
MAX_PLAN_AGE = 15 * 60
MAX_INTENT = 8 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise ValueError('MelodiaJest quarantine: ' + message)


def now():
    return dt.datetime.now(dt.timezone.utc)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def read_plan(path, expected, at=None):
    require(rp.SHA.fullmatch(expected or ''), 'expected plan SHA256 required')
    value, digest = rp.read_json(Path(path).absolute())
    require(digest['sha256'] == expected, 'plan SHA256 differs')
    require(value.get('format') == 'melodiajest-local-payload-retention-plan-v1', 'wrong plan format')
    age = ((at or now()) - rp.stamp(value['checkedAt'])).total_seconds()
    require(0 <= age <= MAX_PLAN_AGE, 'plan expired or from future')
    candidates = value.get('candidates')
    require(type(candidates) is list and 0 < len(candidates) <= rp.MAX_CANDIDATES, 'one or two candidates required')
    require(len({x.get('work') for x in candidates}) == len(candidates), 'duplicate candidate')
    for row in candidates:
        require(rp.TOKEN.fullmatch(row.get('work', '') or '') and row.get('path') == 'ops/external-work/' + row['work'], 'unsafe candidate path')
        require(row.get('payloadContentsVerified') is True and row.get('metadataMatchedColdRestore') is True, 'candidate verification missing')
        require(not row.get('holdReasons'), 'candidate is held')
    pins = value.get('pinnedSourceSha256s')
    require(type(pins) is list and len(pins) <= 16 and all(rp.SHA.fullmatch(x or '') for x in pins), 'invalid source protections')
    require(type(value.get('estimatedAllocatedBytes')) is int and 0 < value['estimatedAllocatedBytes'] <= rp.MAX_CANDIDATE_BYTES, 'allocation budget exceeded')
    return value


@contextmanager
def exclusive_locks(base, shared):
    require(sys.platform.startswith('linux'), 'Linux required for writes and actual locks')
    import fcntl
    rp.real(base, True); rp.real(base / 'ops', True)
    with ExitStack() as stack:
        for path in [Path(shared), base / 'ops/operation.lock']:
            rp.real(path)
            fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
            stack.callback(os.close, fd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def mount_sources(mountinfo, docker_mounts):
    result = []
    for line in mountinfo.splitlines():
        columns = line.split()
        require(len(columns) >= 10 and '-' in columns, 'invalid mountinfo')
        result.append(dict(kind='mountpoint', path=re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), columns[4])))
    for group in docker_mounts:
        require(type(group) is list, 'invalid Docker mount metadata')
        for entry in group:
            require(type(entry) is dict, 'invalid Docker mount')
            if entry.get('Type') in ['bind', 'volume']:
                source = entry.get('Source')
                require(isinstance(source, str) and source.startswith('/'), 'invalid bind source')
                result.append(dict(kind='docker-source', path=source))
    require(all(isinstance(x['path'], str) and x['path'].startswith('/') and '\x00' not in x['path'] for x in result), 'invalid mount path')
    return result


def production_mounts():
    ids = subprocess.check_output(['docker', 'ps', '-q'], text=True, timeout=20).split()
    require(len(ids) <= 256 and all(re.fullmatch(r'[a-f0-9]{12,64}', x) for x in ids), 'invalid running container inventory')
    groups = []
    if ids:
        output = subprocess.check_output(['docker', 'inspect', '--format', '{{json .Mounts}}', *ids], text=True, timeout=30)
        groups = [json.loads(line) for line in output.splitlines()]
        require(len(groups) == len(ids), 'incomplete running mount inventory')
    return mount_sources(Path('/proc/self/mountinfo').read_text(encoding='utf-8'), groups)


def no_mounts(paths, mounts):
    for target in paths:
        target = PurePosixPath(target.as_posix())
        for value in mounts:
            require(type(value) is dict and value.get('kind') in ['mountpoint', 'docker-source'], 'typed mount source required')
            other = PurePosixPath(value['path'])
            require(other.is_absolute(), 'absolute mount path required')
            require(other != target and target not in other.parents, 'active nested mount')
            if other != PurePosixPath('/') or value['kind'] == 'docker-source':
                require(other not in target.parents, 'candidate is below an active mount or bind')


def tree_snapshot(root):
    usage = rp.tree_usage(root)
    require(usage['logicalBytes'] <= rp.MAX_CANDIDATE_BYTES, 'tree bytes exceeded')
    values = {}; total = 0
    for path in [root, *sorted(root.rglob('*'))]:
        relative = path.relative_to(root).as_posix()
        info = rp.real(path, path.is_dir())
        value = dict(device=info.st_dev, inode=info.st_ino, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid, kind='directory' if path.is_dir() else 'file')
        if value['kind'] == 'file':
            require(info.st_size <= rp.MAX_CANDIDATE_BYTES, 'file bytes exceeded')
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'rb') as stream:raw = stream.read(rp.MAX_CANDIDATE_BYTES+1)
            total += len(raw)
            after = path.lstat()
            require(len(raw) == info.st_size and total <= rp.MAX_CANDIDATE_BYTES and (after.st_ino, after.st_mtime_ns, after.st_size) == (info.st_ino, info.st_mtime_ns, info.st_size), 'tree changed while reading')
            value.update(rp.artifact.descriptor(raw))
        values[relative] = value
    require(total == usage['logicalBytes'], 'tree entry set changed')
    return values


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def private_directory(path, create=False):
    if create:
        path.mkdir(mode=0o700)
        sync_directory(path.parent)
    info = rp.real(path, True)
    require(stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == os.geteuid(), 'private directory ownership or mode differs')
    return path


def write_record(path, value, immutable=False):
    raw = canonical(value)
    require(len(raw) <= MAX_INTENT, 'journal too large')
    rp.real(path.parent, True)
    if os.path.lexists(path):
        rp.real(path)
        require(not immutable, 'immutable record already exists')
    target = path if immutable else path.with_name('.journal-' + uuid.uuid4().hex)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    if not immutable:
        os.replace(target, path)
    sync_directory(path.parent)
    return rp.artifact.sha256(raw)


def rename_no_replace(source, destination):
    """Linux RENAME_NOREPLACE, no fallback to overwrite-capable rename."""
    require(sys.platform.startswith('linux'), 'Linux no-replace rename required')
    require(rp.real(source, True).st_dev == rp.real(destination.parent, True).st_dev, 'cross-filesystem move refused')
    library = ctypes.CDLL(None, use_errno=True)
    function = getattr(library, 'renameat2', None)
    require(function is not None, 'renameat2 unavailable; no unsafe fallback')
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    with ExitStack() as stack:
        fds = []
        for folder in [source.parent, destination.parent]:
            rp.real(folder, True)
            fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            stack.callback(os.close, fd); fds.append(fd)
        if function(fds[0], os.fsencode(source.name), fds[1], os.fsencode(destination.name), 1):
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
        for fd in fds:
            os.fsync(fd)


def verify_current_plan(base, value):
    inventory = rp.collect(base, now=rp.stamp(value['checkedAt']))
    fresh = rp.plan(inventory, value['pinnedSourceSha256s'])
    for entry in fresh['candidates']:
        rp.job.verify_payload(base / entry['path'] / 'payload', entry['payloadManifestSha256'])
        entry['payloadContentsVerified'] = True
    require(fresh == value, 'plan or current controls/targets changed; replan')
    require(rp.controls(base) == value['controls'], 'controls changed during verification')


def checkpoint(batch, phase, intent_sha, moved, recovered=0):
    return write_record(batch / 'journal.json', dict(checkedAt=now().isoformat(), phase=phase, intentSha256=intent_sha, moved=moved, recovered=recovered, deletedFiles=0, actuallyFreedBytes=0))


def quarantine(base, plan_path, expected, shared=Path('/run/lock/libre-deploy.lock'), emit=lambda value: None, fault=lambda stage, index: None):
    base = Path(base).absolute()
    with exclusive_locks(base, shared):
        value = read_plan(plan_path, expected)
        verify_current_plan(base, value)
        targets = [base / row['path'] for row in value['candidates']]
        no_mounts(targets, production_mounts())
        trees = [tree_snapshot(path) for path in targets]
        require(rp.controls(base) == value['controls'], 'controls changed before intent')
        home = base / 'ops/retention-quarantine'
        if not os.path.lexists(home):private_directory(home, create=True)
        private_directory(home)
        require(home.stat().st_dev == (base/'ops/external-work').stat().st_dev, 'quarantine filesystem differs')
        batch = private_directory(home / ('quarantine-' + expected[:32]), create=True)
        destination = private_directory(batch / 'works', create=True)
        intent = dict(format=FORMAT, checkedAt=now().isoformat(), batch=batch.name, planSha256=expected, controls=value['controls'], entries=[dict(work=row['work'], payloadManifestSha256=row['payloadManifestSha256'], snapshotId=row['snapshotId'], tree=tree) for row,tree in zip(value['candidates'],trees)])
        intent_sha = write_record(batch/'intent.json', intent, immutable=True)
        checkpoint(batch, 'prepared', intent_sha, 0)
        emit(dict(batch=batch.name, intentSha256=intent_sha, planSha256=expected, recoveryCommand='recover --batch '+batch.name+' --sha256 '+intent_sha))
        for index, source in enumerate(targets):
            fault('before-move', index)
            require(rp.controls(base) == value['controls'], 'controls changed before move')
            no_mounts([source], production_mounts())
            require(tree_snapshot(source) == trees[index], 'target changed before move')
            rename_no_replace(source, destination / source.name)
            fault('after-move', index)
            require(tree_snapshot(destination/source.name) == trees[index], 'quarantined tree differs')
            checkpoint(batch, 'moving', intent_sha, index+1)
        journal_sha = checkpoint(batch, 'quarantined', intent_sha, len(targets))
        return dict(success=True, batch=batch.name, intentSha256=intent_sha, journalSha256=journal_sha, quarantinedWorks=len(targets), sourceFilesDeleted=0, deletedFiles=0, actuallyFreedBytes=0, s3Requests=0, releaseChanged=False, recoveryRequiredBeforeAnyFutureRemoval=True)


def load_intent(batch, expected):
    require(rp.SHA.fullmatch(expected or ''), 'expected intent SHA256 required')
    path = batch / 'intent.json';info = rp.real(path)
    require(info.st_size <= MAX_INTENT, 'intent too large')
    raw = path.read_bytes();require(len(raw) == info.st_size and rp.artifact.sha256(raw) == expected, 'intent SHA256 differs')
    value = json.loads(raw)
    require(value.get('format') == FORMAT and value.get('batch') == batch.name and rp.SHA.fullmatch(value.get('planSha256', '') or ''), 'intent identity differs')
    entries = value.get('entries')
    require(type(entries) is list and 0 < len(entries) <= rp.MAX_CANDIDATES, 'invalid intent entries')
    require(len({x.get('work') for x in entries}) == len(entries), 'duplicate intent work')
    for entry in entries:
        require(rp.TOKEN.fullmatch(entry.get('work', '') or '') and type(entry.get('tree')) is dict and len(entry['tree']) <= rp.MAX_ENTRIES+1 and '.' in entry['tree'], 'unsafe intent entry')
        require(rp.SHA.fullmatch(entry.get('payloadManifestSha256', '') or '') and rp.SHA.fullmatch(entry.get('snapshotId', '') or ''), 'invalid intent digests')
    return value


def recover(base, token, expected, shared=Path('/run/lock/libre-deploy.lock'), fault=lambda stage, index: None):
    require(BATCH.fullmatch(token or ''), 'unsafe batch token')
    base = Path(base).absolute()
    with exclusive_locks(base, shared):
        home = private_directory(base/'ops/retention-quarantine')
        batch = private_directory(home/token);works = private_directory(batch/'works')
        intent = load_intent(batch, expected)
        parent = base/'ops/external-work';rp.real(parent, True)
        require({p.name for p in works.iterdir()} <= {x['work'] for x in intent['entries']}, 'unknown quarantined work')
        locations = []
        for entry in intent['entries']:
            source, destination = works/entry['work'], parent/entry['work']
            present = [os.path.lexists(x) for x in [source,destination]]
            require(present[0] != present[1], 'ambiguous missing or duplicate recovery target')
            actual = source if present[0] else destination
            no_mounts([actual, destination], production_mounts())
            require(tree_snapshot(actual) == entry['tree'], 'recovery tree changed')
            rp.job.verify_payload(actual/'payload', entry['payloadManifestSha256'])
            locations.append((source,destination,present[0],entry))
        recovered = 0
        for index,(source,destination,needs_move,entry) in enumerate(locations):
            if needs_move:
                fault('before-return', index)
                no_mounts([source,destination], production_mounts())
                require(tree_snapshot(source) == entry['tree'], 'return source changed')
                rename_no_replace(source,destination)
                fault('after-return', index)
                require(tree_snapshot(destination) == entry['tree'], 'returned tree differs')
                recovered += 1
                checkpoint(batch, 'recovering', expected, len(locations), recovered)
        journal_sha = checkpoint(batch, 'recovered', expected, len(locations), recovered)
        return dict(success=True, batch=token, intentSha256=expected, journalSha256=journal_sha, restoredWorks=recovered, alreadyAtSource=len(locations)-recovered, allWorksAtOriginalLocation=True, deletedFiles=0, actuallyFreedBytes=0, s3Requests=0, releaseChanged=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    q = commands.add_parser('quarantine');q.add_argument('--plan', type=Path, required=True);q.add_argument('--sha256', required=True)
    rec = commands.add_parser('recover');rec.add_argument('--batch', required=True);rec.add_argument('--sha256', required=True)
    args = parser.parse_args(argv)
    if args.command == 'quarantine':
        result = quarantine(rp.PRODUCTION, args.plan, args.sha256, emit=lambda value: print('RECOVERY_INTENT '+json.dumps(value), flush=True))
    else:
        result = recover(rp.PRODUCTION, args.batch, args.sha256)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
