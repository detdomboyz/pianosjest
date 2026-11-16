"""Exact, offline-backed retirement of this project's files; no Docker prune.

The production entry point is fixed to /opt/melodiajest. The caller archives to
the private D: store, verifies the full archive, and performs an isolated Linux
restoration before retirement. Database backup retention is outside this tool.
"""
from contextlib import ExitStack, contextmanager
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import time

BASE = Path('/opt/melodiajest')
MAX_FILES = 200000
MAX_UNIQUE_BYTES = 16 * 1024**3
MAX_FILE_BYTES = 512 * 1024**2
MAX_DEPTH = 32
DATA_TREES = ('postgres-data', 'account-data', 'account-backup-work',
              'account-restore-work', 'runtime', 'deploy', 'ops/secrets',
              'ops/account-backups', 'ops/account-postgres-backups',
              'ops/server-backups', 'ops/backups', 'ops/source-snapshots',
              'ops/docker-client')
CONTROL_FILES = ('ops/account-profile.json', 'ops/updater-tooling.json',
                 'ops/backup-tooling.json', 'ops/s3-tooling.json',
                 'ops/s3-schedule.json', 'ops/backup-policy.json',
                 'ops/update-state.json', 'deploy/compose.yaml',
                 'deploy/nginx.conf')
STAGE = re.compile(r'ops/(?:course|release|development-source|account-stage|game-fixture|game-stage|game-worker|game-public|archive-stage|archive-readers|update-check|backup-check|backup-install|external-check|s3-stage|s3-install|s3-pin|start-budget|account-health|base-health|candidate|attempt|worker-update|worker-install|retention-check|quarantine-check|interruption|runtime-retire)-[A-Za-z0-9._-]+(?:/.*)?')
VERSIONS = re.compile(r'(?:releases|account-service/releases)/[0-9]+\.[0-9]+\.[0-9]+(?:-[a-f0-9]{12,16})?(?:/.*)?')
PACKAGES = re.compile(r'ops/(?:external-work/(?:payload-[a-f0-9]{16}|archive-readers[0-9]+-[a-f0-9]{12}|worker-update-[0-9]+-[a-f0-9]{12})|external-kits/[a-f0-9]{64}|tooling/[a-z0-9-]+-[a-f0-9]{16})(?:/.*)?|ops/artifacts/[a-f0-9]{64}\.tar\.gz')


def require(ok, message):
    if not ok:
        raise ValueError('MelodiaJest storage: ' + message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def file_sha(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024**2), b''):
            value.update(block)
    return value.hexdigest()


def relative(value):
    require(isinstance(value, str) and '\\' not in value and '\0' not in value, 'invalid relative path')
    p = PurePosixPath(value)
    require(not p.is_absolute() and p.parts and not any(x in ('..', '.') for x in p.parts), 'unsafe path')
    require(str(p) == value and len(p.parts) <= MAX_DEPTH, 'noncanonical/deep path')
    return value


def inside(root, value, *, leaf_link=False):
    value = relative(value)
    root = Path(root)
    require(root.is_absolute() and root.resolve() == root and not root.is_symlink(), 'linked root')
    p = root
    parts = PurePosixPath(value).parts
    for i, part in enumerate(parts):
        p /= part
        if os.path.lexists(p):
            require(not p.is_symlink() or (leaf_link and i == len(parts)-1), 'linked ancestor')
    return p


def overlaps(a, b):
    return a == b or a.startswith(b+'/') or b.startswith(a+'/')


def eligible(value):
    relative(value)
    return bool(STAGE.fullmatch(value) or VERSIONS.fullmatch(value) or PACKAGES.fullmatch(value) or value=='account-postgres-staging' or value.startswith('account-postgres-staging/'))


def references(value):
    out = []
    if isinstance(value, dict):
        for v in value.values():
            out.extend(references(v))
    elif isinstance(value, list):
        for v in value:
            out.extend(references(v))
    elif isinstance(value, str) and value.startswith(str(BASE)+'/'):
        out.append(value[len(str(BASE))+1:])
    return out


def execution_root(name):
    parts=PurePosixPath(relative(name)).parts
    if len(parts)>=3 and parts[:2] in (('ops','tooling'),('ops','external-work'),('ops','external-kits')):return '/'.join(parts[:3])
    if len(parts)>=2 and STAGE.fullmatch('/'.join(parts[:2])):return '/'.join(parts[:2])
    return name


def state(root, extra_protected=()):
    root = Path(root)
    require(root.resolve() == root and not root.is_symlink(), 'noncanonical base')
    keep = set(DATA_TREES)
    pointers, controls = {}, {}
    for name in ('current', 'previous', 'account-service/current', 'account-service/previous'):
        p = root/name
        require(p.is_symlink(), 'required release pointer absent: '+name)
        resolved = p.resolve(strict=True)
        require(resolved.is_relative_to(root), 'foreign pointer')
        target = resolved.relative_to(root).as_posix()
        require(VERSIONS.fullmatch(target), 'invalid release pointer')
        pointers[name] = dict(link=os.readlink(p), target=target)
        keep.add(target)
    for name in CONTROL_FILES:
        p = inside(root, name)
        require(p.is_file() and not p.is_symlink() and p.stat().st_size <= 2*1024**2, 'missing/oversized control: '+name)
        raw = p.read_bytes()
        controls[name] = digest(raw)
    profile = json.loads((root/'ops/account-profile.json').read_bytes())
    updater = json.loads((root/'ops/update-state.json').read_bytes())
    retained=updater.get('retainedArchive')
    if retained:
        require(retained.startswith(str(BASE)+'/ops/artifacts/'),'foreign retained archive')
        name=retained[len(str(BASE))+1:];p=inside(root,name)
        require(p.is_file() and not p.is_symlink(),'updater retained archive absent')
        require(file_sha(p)==updater.get('archiveSha256'),'updater retained archive changed')
        keep.add(name)
    for key in ('archiveSha256','previousArchiveSha256'):
        value=profile.get(key)
        if value:
            name='ops/artifacts/'+value+'.tar.gz'
            if (root/name).is_file():keep.add(name)
    for key in ('archive', 'nodeArchive', 'dependenciesArchive', 'imageArchive', 'previousArchive', 'sqliteBeforeMigrationCopy'):
        if not profile.get(key):
            continue
        name = profile[key]
        require(name.startswith(str(BASE)+'/'), 'foreign profile input')
        name = name[len(str(BASE))+1:]
        p = inside(root, name)
        require(p.is_file() and not p.is_symlink(), 'required profile input absent: '+key)
        keep.add(name)
    for name in ('account-profile.json', 'updater-tooling.json', 'backup-tooling.json', 's3-tooling.json', 's3-schedule.json'):
        obj = json.loads((root/'ops'/name).read_bytes())
        for key in ('tooling', 'toolDirectory', 'stage'):
            if isinstance(obj.get(key), str) and obj[key].startswith(str(BASE)+'/'):
                keep.add(obj[key][len(str(BASE))+1:])
    schedule = json.loads((root/'ops/s3-schedule.json').read_bytes())
    if schedule.get('developmentArchiveSha256'):
        keep.add('ops/development-source-'+schedule['developmentArchiveSha256'][:12])
    runtime_pin = root/'ops/restic-runtime.json'
    if runtime_pin.is_file():
        obj = json.loads(runtime_pin.read_bytes())
        for name in references(obj):
            keep.add(name)
        controls['ops/restic-runtime.json'] = file_sha(runtime_pin)
    for p in extra_protected:
        keep.add(relative(p))
    if root == BASE:
        units = subprocess.check_output(['systemctl','list-unit-files','--no-legend','--plain','melodiajest-*'],text=True)
        names = [x.split()[0] for x in units.splitlines() if x.strip()]
        definitions = subprocess.check_output(['systemctl','cat',*names])
        controls['systemdDefinitions'] = digest(definitions)
        executable_lines=b'\n'.join(x for x in definitions.splitlines() if x.startswith((b'ExecStart=',b'ExecStartPre=',b'ExecStartPost=',b'ExecStop=')))
        for name in re.findall(rb'/opt/melodiajest/[A-Za-z0-9/._-]+',executable_lines):
            name=name.decode()[len(str(BASE))+1:]
            if os.path.lexists(root/name):keep.add(execution_root(name))
        ids=subprocess.check_output(['docker','ps','-aq'],text=True).split()
        mounts=[]
        if ids:
            raw=subprocess.check_output(['docker','inspect','--format','{{json .Id}} {{json .Mounts}}',*ids],text=True)
            for line in raw.splitlines():
                identifier,mount_data=line.split(' ',1)
                for mount in json.loads(mount_data):
                    name=mount.get('Source','')
                    if name.startswith(str(BASE)+'/'):
                        name=name[len(str(BASE))+1:];keep.add(name)
                        mounts.append((json.loads(identifier),name,mount['Destination']))
        controls['activeOwnMounts']=digest(encoded(sorted(mounts)))
        for proc in Path('/proc').glob('[0-9]*/cmdline'):
            try:command=proc.read_bytes()
            except (OSError,PermissionError):continue
            for name in re.findall(rb'/opt/melodiajest/[A-Za-z0-9/._-]+',command):
                name=name.decode()[len(str(BASE))+1:]
                if os.path.lexists(root/name):keep.add(execution_root(name))
            try:cwd=(proc.parent/'cwd').resolve(strict=True)
            except OSError:continue
            if cwd.is_relative_to(root) and cwd not in (root,root/'ops'):
                keep.add(cwd.relative_to(root).as_posix())
    require(json.loads((root/'ops/update-state.json').read_bytes()).get('phase') in ('committed', 'rolled-back'), 'unfinished deployment')
    return dict(pointers=pointers, controls=controls, protected=sorted(keep))


def assert_selection(root, selected, observed):
    require(isinstance(selected, list) and 0 < len(selected) <= 2048, 'invalid root count')
    require(len(set(selected)) == len(selected), 'duplicate roots')
    for i, name in enumerate(selected):
        require(eligible(name), 'path outside retirement allowlist: '+name)
        require(not any(overlaps(name, p) for p in observed['protected']), 'protected input: '+name)
        require(not any(overlaps(name, p) for p in selected[:i]), 'overlapping selections')
        p = inside(root, name, leaf_link=True)
        require(os.path.lexists(p), 'missing selection')


def xattrs(path):
    if not hasattr(os, 'listxattr'):
        return {}
    return {n: base64.b64encode(os.getxattr(path, n, follow_symlinks=False)).decode() for n in sorted(os.listxattr(path, follow_symlinks=False))}


def describe(root, name, hashes, *, link_base=None):
    p = inside(root, name, leaf_link=True)
    info = p.lstat()
    require(info.st_dev == Path(root).stat().st_dev, 'foreign filesystem')
    out = dict(path=name, mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid,
               mtimeNs=info.st_mtime_ns, device=info.st_dev, inode=info.st_ino,
               allocatedBytes=getattr(info, 'st_blocks', 0)*512, xattrs=xattrs(p))
    if stat.S_ISREG(info.st_mode):
        require(info.st_size <= MAX_FILE_BYTES, 'oversized file')
        key = (info.st_dev, info.st_ino)
        if key not in hashes:
            hashes[key] = file_sha(p)
        out.update(type='file', bytes=info.st_size, sha256=hashes[key], nlink=info.st_nlink)
    elif stat.S_ISDIR(info.st_mode):
        out['type'] = 'directory'
    elif stat.S_ISLNK(info.st_mode):
        target = os.readlink(p)
        require('\0' not in target, 'invalid link')
        original_base = Path(link_base or root)
        original_parent = original_base/PurePosixPath(name).parent
        resolved = Path(os.path.normpath(str(original_parent/target)))
        require(resolved.is_relative_to(original_base), 'foreign symbolic link')
        out.update(type='symlink', target=target)
    else:
        raise ValueError('MelodiaJest storage: special file: '+name)
    after = p.lstat()
    require((info.st_ino, info.st_size, info.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns), 'file changed during hashing')
    return out


def collect(root, selected, extra_protected=(), *, archive_only=False):
    before = state(root, extra_protected)
    if archive_only:
        require(isinstance(selected,list) and 0<len(selected)<=2048,'invalid snapshot selection')
        for i,name in enumerate(selected):
            relative(name);inside(root,name)
            require(not any(overlaps(name,x) for x in ('postgres-data','account-data')), 'live database/data is not a file snapshot')
            require(not any(overlaps(name,x) for x in selected[:i]),'overlapping snapshot roots')
    else:assert_selection(root, selected, before)
    paths = set()
    for name in selected:
        home = inside(root, name, leaf_link=True)
        paths.add(name)
        if home.is_dir() and not home.is_symlink():
            for folder, dirs, files in os.walk(home, followlinks=False):
                for child in dirs+files:
                    path = (Path(folder)/child).relative_to(root).as_posix()
                    relative(path)
                    paths.add(path)
                    require(len(paths) <= MAX_FILES, 'too many entries')
    hashes = {}
    rows = [describe(root, name, hashes) for name in sorted(paths)]
    links = [x['path'] for x in rows if x['type']=='symlink']
    for item in rows:
        require(not any(item['path'].startswith(x+'/') for x in links), 'entry below symlink')
    unique = {}
    for item in rows:
        if item['type']=='file':
            unique[(item['device'], item['inode'])] = item['bytes']
    require(sum(unique.values()) <= MAX_UNIQUE_BYTES, 'archive input budget exceeded')
    require(state(root, extra_protected) == before, 'controls changed during capture')
    return dict(format='melodiajest-offline-retirement-v1', base=str(root), selected=selected,
                extraProtected=list(extra_protected), state=before, entries=rows,
                uniqueFileBytes=sum(unique.values()), files=len(rows), archiveOnly=archive_only, automaticDeletionReady=False)


def verify_tree(root, manifest, *, relocated=False):
    hashes = {}
    actual = set()
    for name in manifest['selected']:
        p = inside(root, name, leaf_link=True)
        require(os.path.lexists(p), 'missing restored member')
        actual.add(name)
        if p.is_dir() and not p.is_symlink():
            for home, dirs, files in os.walk(p, followlinks=False):
                actual.update((Path(home)/x).relative_to(root).as_posix() for x in dirs+files)
    require(actual == {x['path'] for x in manifest['entries']}, 'tree member set differs')
    group, reverse_group = {}, {}
    for expected in manifest['entries']:
        observed = describe(root, expected['path'], hashes, link_base=Path(manifest['base']) if relocated or Path(root)!=BASE else root)
        for key in ('type', 'mode', 'uid', 'gid', 'mtimeNs', 'xattrs'):
            require(observed[key] == expected[key], 'metadata differs: '+expected['path']+':'+key)
        if expected['type']=='file':
            require(observed['bytes']==expected['bytes'] and observed['sha256']==expected['sha256'], 'file content differs')
            old = (expected['device'], expected['inode'])
            new = (observed['device'], observed['inode'])
            require(old not in group or group[old]==new, 'hardlink relationship differs')
            require(new not in reverse_group or reverse_group[new]==old, 'distinct files became hardlinks')
            group[old] = new
            reverse_group[new] = old
            if not relocated:
                require(old == new, 'source inode changed')
        elif expected['type']=='symlink':
            # Restored absolute links retain their original /opt/melodiajest
            # target; no operation follows them during verification.
            require(os.readlink(Path(root)/expected['path'])==expected['target'], 'symbolic link differs')
    return dict(filesVerified=len(actual), contentsAndMetadataVerified=True, internalHardlinksVerified=True)


@contextmanager
def locks(root, production=True):
    if not production:
        yield
        return
    require(Path(root)==BASE and os.name=='posix', 'production root is fixed')
    import fcntl
    with ExitStack() as stack:
        names = ['ops/account-postgres-backups/worker.lock', 'ops/external-s3/scheduled/worker.lock', 'ops/server-backups/worker.lock']
        paths = [BASE/n for n in names]+[Path('/run/lock/libre-deploy.lock'), BASE/'ops/operation.lock']
        for p in paths:
            require(p.is_file() and not p.is_symlink(), 'required existing lock absent')
            fd=os.open(p, os.O_RDONLY|os.O_NOFOLLOW)
            stack.callback(os.close, fd)
            fcntl.flock(fd, fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield


def work_dir(root, token):
    require(re.fullmatch(r'[a-f0-9]{32}', token or ''), 'invalid retirement token')
    return inside(root, 'ops/storage-maintenance-'+token)


def require_receipt(manifest, receipt):
    require(receipt.get('manifestSha256')==digest(encoded(manifest)), 'wrong external manifest')
    require(re.fullmatch(r'[a-f0-9]{64}', receipt.get('archiveSha256','')), 'archive SHA required')
    require(receipt.get('archiveBytes',0)>0, 'archive size required')
    require(receipt.get('fullArchiveReadbackVerified') is True and receipt.get('allMembersVerified') is True, 'PC archive not fully read')
    require(receipt.get('linuxRestoreVerified') is True, 'isolated Linux restore unverified')
    require(str(receipt.get('privateArchive','')).startswith('D:\\MelodiaJest-private\\host-maintenance\\'), 'wrong private destination')


def save_json(path, value):
    temporary = path.with_suffix('.pending')
    with temporary.open('wb') as stream:
        stream.write(encoded(value));stream.flush();os.fsync(stream.fileno())
    os.replace(temporary, path)
    if os.name == 'posix':
        fd=os.open(path.parent, os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)


def assert_closed(root, selected):
    """Refuse live open inputs, including ones absent from command lines."""
    if os.name!='posix':raise ValueError('Linux open-file check required')
    root=str(root)+'/'
    names=set(selected)
    for proc in Path('/proc').glob('[0-9]*/fd'):
        try:fds=list(proc.iterdir())
        except OSError:continue
        for fd in fds:
            try:value=os.readlink(fd)
            except OSError:continue
            if not value.startswith(root):continue
            parts=PurePosixPath(value[len(root):]).parts
            require(not any('/'.join(parts[:i]) in names for i in range(1,len(parts)+1)), 'selected file is open in a live process')


def quarantine(root, manifest, receipt, token, *, production=True):
    require(not manifest.get('archiveOnly'), 'protection snapshot is not a retirement plan')
    require_receipt(manifest, receipt)
    with locks(root, production):
        require(state(root, manifest['extraProtected'])==manifest['state'], 'critical state changed')
        assert_selection(root, manifest['selected'], manifest['state'])
        verify_tree(root, manifest)
        assert_closed(root,manifest['selected'])
        work=work_dir(root, token)
        require(not work.exists(), 'transaction already exists')
        work.mkdir(mode=0o700)
        destination=work/'quarantine';destination.mkdir(mode=0o700)
        journal=dict(format='melodiajest-storage-transaction-v1', token=token, phase='moving',
                     manifestSha256=digest(encoded(manifest)), archiveSha256=receipt['archiveSha256'],
                     moved=[], receipt=receipt)
        save_json(work/'manifest.json', manifest)
        journal['selected']=manifest['selected']
        save_json(work/'transaction.json', journal)
        try:
            for name in manifest['selected']:
                source=inside(root, name, leaf_link=True)
                target=destination/name;target.parent.mkdir(parents=True, exist_ok=True)
                os.rename(source, target);journal['moved'].append(name)
                save_json(work/'transaction.json', journal)
            journal['phase']='quarantined'
            save_json(work/'transaction.json', journal)
        except Exception:
            for name in reversed(journal['moved']):
                target=inside(root, name, leaf_link=True)
                require(not os.path.lexists(target), 'rollback target occupied')
                target.parent.mkdir(parents=True, exist_ok=True)
                os.rename(destination/name, target)
            journal['phase']='rolled-back';save_json(work/'transaction.json', journal)
            raise
        return journal


def rollback(root, token, *, production=True):
    with locks(root, production):
        work=work_dir(root,token);journal=json.loads((work/'transaction.json').read_bytes())
        require(journal['phase'] in ('moving','quarantined'), 'transaction cannot roll back')
        for name in reversed(journal['selected']):
            target=inside(root,name,leaf_link=True)
            source=work/'quarantine'/name
            if not os.path.lexists(source):
                require(os.path.lexists(target), 'both rollback copies absent')
                continue
            require(not os.path.lexists(target), 'occupied rollback path')
            target.parent.mkdir(parents=True, exist_ok=True)
            os.rename(source,target)
        journal['phase']='rolled-back';save_json(work/'transaction.json', journal)
        return journal


def commit(root, token, receipt, *, production=True):
    with locks(root, production):
        work=work_dir(root,token);journal=json.loads((work/'transaction.json').read_bytes())
        manifest=json.loads((work/'manifest.json').read_bytes());require_receipt(manifest, receipt)
        require(journal['phase']=='quarantined' and journal['archiveSha256']==receipt['archiveSha256'], 'wrong retirement transaction')
        require(state(root, manifest['extraProtected'])==manifest['state'], 'critical state changed')
        for name in manifest['selected']:
            require(not os.path.lexists(Path(root)/name), 'retired source reappeared')
        quarantine_root=work/'quarantine'
        verify_tree(quarantine_root,manifest)
        assert_closed(quarantine_root,manifest['selected'])
        # Only enumerated members. No recursive delete, force flag or Docker API.
        for item in sorted(manifest['entries'],key=lambda x:len(PurePosixPath(x['path']).parts),reverse=True):
            p=inside(quarantine_root,item['path'],leaf_link=True)
            if item['type']=='directory':p.rmdir()
            else:p.unlink()
        journal['phase']='committed';journal['deletedEntries']=len(manifest['entries'])
        save_json(work/'transaction.json', journal)
        return journal


def cleanup_restored(root, manifest, scratch):
    p=Path(scratch)
    require(p.parent==Path(root)/'ops' and p.name.startswith('storage-restore-') and p.resolve()==p, 'wrong restore scratch')
    verify_tree(p,manifest,relocated=True)
    for item in sorted(manifest['entries'],key=lambda x:len(PurePosixPath(x['path']).parts),reverse=True):
        member=inside(p,item['path'],leaf_link=True)
        if item['type']=='directory':member.rmdir()
        else:member.unlink()
    # Only empty scaffolding created by this restoration is removed.
    for home,dirs,files in os.walk(p,topdown=False,followlinks=False):
        require(not files,'unexpected restore residue')
        Path(home).rmdir()
    return dict(isolatedScratchRemoved=True)


def cleanup_transaction(root, token, expected_manifest, expected_journal, *, production=True):
    with locks(root,production):
        work=work_dir(root,token)
        for name in ('manifest.json','transaction.json'):
            p=inside(work,name);require(p.is_file() and not p.is_symlink(),'invalid transaction control')
        require((work/'quarantine').is_dir() and not (work/'quarantine').is_symlink(),'invalid quarantine root')
        require(file_sha(work/'manifest.json')==expected_manifest and file_sha(work/'transaction.json')==expected_journal,'offline transaction copy differs')
        journal=json.loads((work/'transaction.json').read_bytes())
        require(journal['phase']=='committed','only completed retirement metadata can be removed')
        require({x.name for x in work.iterdir()}=={'manifest.json','transaction.json','quarantine'},'unexpected transaction residue')
        dirs=list((work/'quarantine').rglob('*'))
        require(all(p.is_dir() and not p.is_symlink() for p in dirs),'nonempty quarantine')
        assert_closed(work,['manifest.json','transaction.json'])
        proof=dict(format='melodiajest-storage-retirement-receipt-v1',phase='committed',token=token,
                   manifestSha256=expected_manifest,journalSha256=expected_journal,
                   archiveSha256=journal['archiveSha256'],privateArchive=journal['receipt']['privateArchive'],
                   deletedEntries=journal['deletedEntries'],offlineMetadataVerified=True)
        save_json(Path(root)/'ops'/('storage-maintenance-receipt-'+token+'.json'),proof)
        for p in sorted(dirs,key=lambda x:len(x.parts),reverse=True):p.rmdir()
        (work/'quarantine').rmdir();(work/'manifest.json').unlink();(work/'transaction.json').unlink();work.rmdir()
        return dict(**proof,temporaryTransactionRemoved=True)


def restore_content(root, manifest, stream):
    """Restore a lossless content transport without merging distinct inodes.

    The original private GNU-tar archive and its complete manifest remain the
    recovery authority. Transport member names are only SHA-256 identifiers.
    Every original member is independently verified by verify_tree afterwards.
    """
    import shutil
    root=Path(root)
    require(root.is_dir() and root.resolve()==root and not list(root.iterdir()),'empty isolated root required')
    rows=manifest['entries'];require(len(rows)<=MAX_FILES,'too many restoration entries')
    expected={};paths=set()
    for row in rows:
        name=relative(row['path']);require(name not in paths,'duplicate restoration path');paths.add(name)
        if row['type']=='file':expected.setdefault(row['sha256'],[]).append(row)
        else:require(row['type'] in ('directory','symlink'),'special restoration member')
    links={x['path'] for x in rows if x['type']=='symlink'}
    require(not any('/'.join(PurePosixPath(x).parts[:i]) in links for x in paths for i in range(1,len(PurePosixPath(x).parts))),'entry beneath link')
    for row in sorted(rows,key=lambda x:len(PurePosixPath(x['path']).parts)):
        p=inside(root,row['path']);p.parent.mkdir(parents=True,exist_ok=True)
        if row['type']=='directory':p.mkdir(mode=0o700,exist_ok=True)
    seen=set();groups={};restored_bytes=0
    with tarfile.open(fileobj=stream,mode='r|gz') as archive:
        for member in archive:
            require(member.isfile() and not member.issparse() and re.fullmatch(r'blobs/[a-f0-9]{64}',member.name),'invalid content transport member')
            key=member.name[6:];require(key in expected and key not in seen,'unknown/duplicate content')
            targets=expected[key];require(member.size==targets[0]['bytes'] and member.size<=MAX_FILE_BYTES,'wrong content size')
            first=inside(root,targets[0]['path']);h=hashlib.sha256();read=0
            require(shutil.disk_usage(root).free>=member.size+2*1024**3,'restore disk reserve reached')
            with archive.extractfile(member) as source,first.open('xb') as output:
                for block in iter(lambda:source.read(1024**2),b''):read+=len(block);h.update(block);output.write(block)
            require(read==member.size and h.hexdigest()==key,'transport content differs')
            for i,row in enumerate(targets):
                p=inside(root,row['path']);identity=(row['device'],row['inode'])
                if identity in groups:
                    require(i!=0,'inode unexpectedly spans content hashes');os.link(groups[identity],p)
                else:
                    if i:
                        require(shutil.disk_usage(root).free>=row['bytes']+2*1024**3,'restore disk reserve reached')
                        with first.open('rb') as source,p.open('xb') as output:shutil.copyfileobj(source,output,1024**2)
                    groups[identity]=p
                restored_bytes+=row['bytes']
            seen.add(key)
            require(shutil.disk_usage(root).free>=2*1024**3,'restore disk reserve reached')
    require(seen==set(expected),'missing content')
    for row in rows:
        if row['type']=='symlink':
            original=Path(manifest['base'])/PurePosixPath(row['path']).parent
            target=Path(os.path.normpath(str(original/row['target'])))
            require(target.is_relative_to(Path(manifest['base'])),'foreign restored link')
            os.symlink(row['target'],inside(root,row['path']))
    for row in sorted(rows,key=lambda x:len(PurePosixPath(x['path']).parts),reverse=True):
        p=inside(root,row['path'],leaf_link=True);os.chown(p,row['uid'],row['gid'],follow_symlinks=False)
        if row['type']!='symlink':p.chmod(row['mode'])
        for name in os.listxattr(p,follow_symlinks=False):
            if name not in row['xattrs']:os.removexattr(p,name,follow_symlinks=False)
        for name,value in row['xattrs'].items():os.setxattr(p,name,base64.b64decode(value),follow_symlinks=False)
        os.utime(p,ns=(row['mtimeNs'],row['mtimeNs']),follow_symlinks=False)
    result=verify_tree(root,manifest,relocated=True)
    return dict(**result,transportUniqueContents=len(seen),restoredLogicalBytes=restored_bytes,distinctOriginalInodesPreserved=True)


def export_tar(root, manifest, output):
    require(os.name=='posix', 'GNU tar export requires Linux')
    require(state(root, manifest['extraProtected'])==manifest['state'], 'critical state changed')
    names=b''.join(x['path'].encode()+b'\0' for x in manifest['entries'])
    command=['nice','-n','15','ionice','-c','3','tar','--create','--gzip','--format=pax','--numeric-owner','--acls','--xattrs','--one-file-system','--no-recursion','--directory',str(root),'--null','--files-from=-']
    result=subprocess.run(command,input=names,stdout=output,stderr=subprocess.PIPE)
    require(result.returncode==0,'archive export failed: '+result.stderr[-500:].decode(errors='replace'))


def execute(request):
    require(os.name=='posix' and os.geteuid()==0 and BASE.resolve()==BASE, 'own Linux root context required')
    action=request['action']
    if action=='manifest':
        print(json.dumps(collect(BASE,request['selected'],request.get('extraProtected',[]),archive_only=request.get('archiveOnly',False))))
    elif action=='export':
        export_tar(BASE,request['manifest'],sys.stdout.buffer)
    elif action=='verify-restored':
        scratch=Path(request['scratch'])
        require(scratch.is_relative_to(BASE/'ops') and scratch.resolve()==scratch and scratch.name.startswith('storage-restore-'),'wrong isolated restoration root')
        print(json.dumps(verify_tree(scratch,request['manifest'],relocated=True)))
    elif action=='cleanup-restored':
        print(json.dumps(cleanup_restored(BASE,request['manifest'],request['scratch'])))
    elif action=='cleanup-transaction':
        print(json.dumps(cleanup_transaction(BASE,request['token'],request['manifestSha256'],request['journalSha256'])))
    elif action=='quarantine':
        print(json.dumps(quarantine(BASE,request['manifest'],request['receipt'],request['token'])))
    elif action=='rollback':
        print(json.dumps(rollback(BASE,request['token'])))
    elif action=='commit':
        print(json.dumps(commit(BASE,request['token'],request['receipt'])))
    else:
        raise ValueError('Unknown storage action')


def main():
    execute(json.load(sys.stdin))


if __name__=='__main__':
    main()
