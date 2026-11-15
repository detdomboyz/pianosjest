# Read-only наблюдатель phase51

SHA256 `d7f406c2893619abd66fca1e3870d68443e1751401850f3b011ce90640f07f73`. Однократно выполнен по SSH через stdin,не установлен как worker. Данные/payload/архивы не открывает;bounded FD walk без следования symlink/mount. В первом наблюдении web current/previous проверены;API-указатели отдельно проверены известными точными путями account-service/current/previous в retention/du.

```python
"""Bounded Linux metadata observation of this service; never removes or opens payloads."""
import datetime
import json
import os
import shutil
import stat
import time
from collections import defaultdict
from pathlib import Path

BASE = Path('/opt/melodiajest')
MAX_ENTRIES = 150000
MAX_SECONDS = 40


def bucket(relative):
    parts = relative.split('/') if relative else []
    depth = 2 if parts and parts[0] in ('ops', 'runtime', 'releases') else 1
    if parts[:2] == ['account-api', 'releases']:
        depth = 3
    return '/'.join(parts[:depth]) or '.'


def aggregate(records):
    groups = defaultdict(lambda: {'fileNames': 0, 'logicalNameBytes': 0,
                                  'uniqueAllocatedBytes': 0, 'exclusiveObservedAllocatedBytes': 0,
                                  'sharedOrUnobservedLinkAllocatedBytes': 0})
    for record in records.values():
        owners = record['owners']
        for owner, count in owners.items():
            group = groups[owner]
            group['fileNames'] += count
            group['logicalNameBytes'] += record['size'] * count
            group['uniqueAllocatedBytes'] += record['allocated']
            if len(owners) == 1 and sum(owners.values()) == record['nlink'] and not record['changed']:
                group['exclusiveObservedAllocatedBytes'] += record['allocated']
            else:
                group['sharedOrUnobservedLinkAllocatedBytes'] += record['allocated']
    return dict(sorted(groups.items(), key=lambda pair: (-pair[1]['uniqueAllocatedBytes'], pair[0])))


def observe(root=BASE, max_entries=MAX_ENTRIES, max_seconds=MAX_SECONDS):
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    clock = time.monotonic()
    before_free = shutil.disk_usage(root).free
    pointers = ['current', 'previous', 'account-api/current', 'account-api/previous']

    def read_pointers():
        return {name: os.readlink(root / name) if (root / name).is_symlink() else None for name in pointers}

    before = read_pointers()
    mounts = set()
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        value = line.split()[4]
        for escape, decoded in [('\\040', ' '), ('\\011', '\t'), ('\\012', '\n'), ('\\134', '\\')]:
            value = value.replace(escape, decoded)
        if value.startswith(str(root) + '/'):
            mounts.add(value)
    files = {}
    details = {}
    directories = set()
    counters = {'entries': 0, 'directories': 0, 'symlinksNotFollowed': 0,
                'mountsNotEntered': 0, 'specialFilesNotOpened': 0, 'directoryAllocatedBytes': 0}
    errors = []
    stopped = None
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root_fd = os.open(root, flags)
    device = os.fstat(root_fd).st_dev

    def add(table, info, owner):
        key = (info.st_dev, info.st_ino)
        allocated = info.st_blocks * 512
        signature = (info.st_size, allocated, info.st_nlink, info.st_mtime_ns, info.st_ctime_ns)
        record = table.setdefault(key, {'size': info.st_size, 'allocated': allocated,
                                      'nlink': info.st_nlink, 'signature': signature,
                                      'owners': defaultdict(int), 'changed': False})
        if signature != record['signature']:
            record['changed'] = True
        record['owners'][owner] += 1

    def walk(fd, relative):
        nonlocal stopped
        info = os.fstat(fd)
        identity = (info.st_dev, info.st_ino)
        if identity in directories:
            errors.append({'path': relative, 'type': 'directory-seen-twice'})
            return
        directories.add(identity)
        counters['directories'] += 1
        counters['directoryAllocatedBytes'] += info.st_blocks * 512
        with os.scandir(fd) as iterator:
            for entry in iterator:
                if counters['entries'] >= max_entries or time.monotonic() - clock > max_seconds:
                    stopped = 'entry-limit' if counters['entries'] >= max_entries else 'time-limit'
                    return
                counters['entries'] += 1
                name = entry.name
                child = relative + '/' + name if relative else name
                try:
                    item = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISLNK(item.st_mode):
                        counters['symlinksNotFollowed'] += 1
                    elif item.st_dev != device or str(root / child) in mounts:
                        counters['mountsNotEntered'] += 1
                    elif stat.S_ISDIR(item.st_mode):
                        child_fd = os.open(name, flags, dir_fd=fd)
                        try:
                            opened = os.fstat(child_fd)
                            if (opened.st_dev, opened.st_ino) != (item.st_dev, item.st_ino):
                                raise RuntimeError('directory-identity-changed')
                            walk(child_fd, child)
                        finally:
                            os.close(child_fd)
                        if stopped:
                            return
                    elif stat.S_ISREG(item.st_mode):
                        owner = bucket(child)
                        add(files, item, owner)
                        parts = child.split('/')
                        deeper = '/'.join(parts[:min(len(parts), len(owner.split('/')) + 1)])
                        # Do not enumerate private data names in the output.
                        add(details, item, owner if parts[0] == 'account-data' else deeper)
                    else:
                        counters['specialFilesNotOpened'] += 1
                except (OSError, RuntimeError) as error:
                    if len(errors) < 30:
                        errors.append({'path': bucket(child), 'type': type(error).__name__})

    try:
        walk(root_fd, '')
    finally:
        os.close(root_fd)
    after = read_pointers()
    groups = aggregate(files)
    nested = aggregate(details)
    changed = sum(record['changed'] for record in files.values())
    unseen = sum(record['allocated'] for record in files.values()
                 if sum(record['owners'].values()) < record['nlink'])
    return {'kind': 'melodiajest-read-only-storage-inventory', 'version': 1,
            'startedAt': started, 'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'elapsedSeconds': round(time.monotonic() - clock, 3), 'root': str(root),
            'limits': {'entries': max_entries, 'seconds': max_seconds},
            'completeWithinScope': stopped is None and not errors and not changed,
            'stoppedBecause': stopped, 'errors': errors, 'counters': counters,
            'uniqueRegularFileInodes': len(files),
            'uniqueRegularFileAllocatedBytes': sum(record['allocated'] for record in files.values()),
            'logicalFileNameBytes': sum(record['size'] * sum(record['owners'].values()) for record in files.values()),
            'changedRegularInodes': changed, 'allocatedBytesWithUnobservedHardlinks': unseen,
            'pointersBefore': before, 'pointersAfter': after, 'pointersUnchanged': before == after,
            'freeBytesBefore': before_free, 'freeBytesAfter': shutil.disk_usage(root).free,
            'prepareMinimumFreeBytes': 1000 * 1024 * 1024,
            'postgresRecoveryMinimumFreeBytes': 800 * 1024 * 1024,
            'groups': groups, 'nestedGroups': nested,
            'readOnly': True, 'payloadContentsOpened': False, 'archivesRead': False,
            's3Requests': 0, 'locksAcquired': False, 'deletionPlan': False,
            'limitations': ['non-atomic observation; active writers can change file metadata',
                            'inode allocation does not measure shared extents, open deleted files or billing',
                            'group unique allocations overlap for cross-group hardlinks; do not add them',
                            'exclusive observed allocation is attribution, not authorized or guaranteed reclaim']}


if __name__ == '__main__':
    print(json.dumps(observe(), sort_keys=True))
```
