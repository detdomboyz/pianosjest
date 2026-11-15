"""Own daily file backups, isolated restores and freshness. No S3 or deletion.

The CLI is fixed to /opt/melodiajest. General functions accept a private fixture
for tests; they never switch release pointers, restart production or pull images.
"""
import argparse
import base64
from contextlib import contextmanager
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

import backup_units
import release_artifact as artifact
import release_update as update

require = artifact.require
TOOLS = {'release_backup.py', 'backup_units.py', 'release_artifact.py', 'release_update.py', 'public-assets.json'}
UNITS = {f'melodiajest-{name}.{suffix}' for name in backup_units.JOBS for suffix in ['service', 'timer']}
CONTROL_NAMES = {'policy.json'} | {'tooling/' + name for name in TOOLS} | {'systemd/' + name for name in UNITS}
SHA = re.compile(r'[0-9a-f]{64}')


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode('utf-8')


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def directory(path):
    require(not path.is_symlink(), 'Linked backup directory')
    path.mkdir(mode=0o700, exist_ok=True)
    require(path.is_dir() and path.resolve() == path.absolute(), 'Unsafe backup directory')
    return path


def layout(base):
    base = update.layout(base)
    home = directory(base / 'ops/server-backups')
    for name in ['blobs', 'controls', 'snapshots', 'work']:
        directory(home / name)
    return home


def json_file(path):
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= 2 * 1024 * 1024, 'Invalid backup receipt')
    return json.loads(path.read_bytes())


def policy(base):
    value = json_file(base / 'ops/backup-policy.json')
    require(value.get('version') == 1 and value.get('scope') == 'melodiajest-only', 'Wrong backup policy')
    require(SHA.fullmatch(value.get('image', '').removeprefix('sha256:')) is not None and value['image'].startswith('sha256:'), 'Pinned runtime image required')
    require(isinstance(value.get('sourceSeeds'), dict) and len(value['sourceSeeds']) <= 16, 'Invalid source index')
    return value


def owned_archive(base, relative):
    artifact.safe_name(relative)
    path = base / relative
    require(relative.startswith(('ops/artifacts/', 'ops/backups/', 'ops/source-snapshots/')), 'Source archive outside own archive namespaces')
    require(path.resolve().is_relative_to(base / 'ops') and path.resolve() == path.absolute() and path.is_file(), 'Linked or missing source archive')
    return path


def blob(home, category, data, suffix):
    digest = artifact.sha256(data)
    target = home / category / (digest + suffix)
    if target.exists() or target.is_symlink():
        require(not target.is_symlink() and target.read_bytes() == data, 'Immutable backup blob differs')
    else:
        temporary = target.with_name(target.name + '.' + uuid.uuid4().hex + '.tmp')
        with temporary.open('xb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(0o600)
        os.rename(temporary, target)
        update.sync_directory(target.parent)
    return {'sha256': digest, 'bytes': len(data)}


def read_blob(home, category, descriptor, suffix):
    require(isinstance(descriptor, dict) and SHA.fullmatch(descriptor.get('sha256', '') or ''), 'Invalid blob hash')
    require(type(descriptor.get('bytes')) is int and 0 < descriptor['bytes'] <= artifact.MAX_TOTAL, 'Invalid blob size')
    path = home / category / (descriptor['sha256'] + suffix)
    require(not path.is_symlink() and path.is_file() and path.stat().st_size == descriptor['bytes'], 'Backup blob missing or changed size')
    data = path.read_bytes()
    require(artifact.sha256(data) == descriptor['sha256'], 'Backup blob checksum differs')
    return path, data


def controls(base, tooling, units):
    files = {'policy.json': (base / 'ops/backup-policy.json').read_bytes()}
    files.update({'tooling/' + name: artifact.regular_bytes(tooling, name) for name in TOOLS})
    files.update({'systemd/' + name: artifact.regular_bytes(units, name) for name in UNITS})
    require(set(files) == CONTROL_NAMES, 'Missing own controls')
    return encoded({'version': 1, 'files': {name: {**artifact.descriptor(data), 'data': base64.b64encode(data).decode('ascii')} for name, data in files.items()}})


def restore_controls(data, destination):
    require(len(data) <= 2 * 1024 * 1024, 'Oversized control snapshot')
    value = json.loads(data)
    require(value.get('version') == 1 and set(value.get('files', {})) == CONTROL_NAMES, 'Unexpected control names')
    require(not destination.exists() and not destination.is_symlink(), 'Control restore destination exists')
    destination.mkdir(mode=0o700)
    for name, entry in value['files'].items():
        raw = base64.b64decode(entry['data'], validate=True)
        require(entry['bytes'] == len(raw) and entry['sha256'] == artifact.sha256(raw), 'Control checksum differs')
        path = destination / name
        path.parent.mkdir(mode=0o700, exist_ok=True)
        with path.open('xb') as stream:
            stream.write(raw)
        path.chmod(0o600)
        require(path.read_bytes() == raw, 'Control restore differs')
    return len(value['files'])


def source_candidates(base, home, config):
    path = home / 'source-index.json'
    value = json_file(path) if path.exists() else {}
    require(isinstance(value, dict) and len(value) <= 4096, 'Invalid stored source index')
    value.update(config['sourceSeeds'])
    latest = update.journal(base)
    if latest and latest.get('phase') == 'committed' and latest.get('retainedArchive'):
        key = latest['newSha256']
        # A fresh desktop source seed for the same music release takes priority.
        if key not in config['sourceSeeds']:
            value[key] = {'path': Path(latest['retainedArchive']).relative_to(base).as_posix(), 'sha256': latest['archiveSha256']}
    return value


def save_snapshot(base, tooling, units):
    home = layout(base)
    update.ensure_idle(base)
    require(shutil.disk_usage(base).free >= 512 * 1024 * 1024, 'Insufficient free disk for backup')
    config = policy(base)
    index = source_candidates(base, home, config)
    control = blob(home, 'controls', controls(base, tooling, units), '.json')
    entries = {}
    with tempfile.TemporaryDirectory(prefix='snapshot-', dir=home / 'work') as temporary:
        work = Path(temporary)
        restore_controls(read_blob(home, 'controls', control, '.json')[1], work / 'controls')
        for role in ['current', 'previous']:
            target = update.ref(base, role, optional=role == 'previous')
            if target is None:
                continue
            public = artifact.read_web(base / target)
            manifest = artifact.sha256(public['web-release.json'])
            source = index.get(manifest)
            require(isinstance(source, dict) and SHA.fullmatch(source.get('sha256', '') or ''), 'Missing selected source snapshot for ' + role)
            source_path = owned_archive(base, source['path'])
            _, source_meta = artifact.read_bundle(source_path, source['sha256'])
            require(source_meta['webManifestSha256'] == manifest and source_meta['sourceSnapshotIncluded'], 'Source snapshot does not cover ' + role)
            source_blob = blob(home, 'blobs', source_path.read_bytes(), '.tar.gz')
            packed = artifact.pack(base / target, base / 'deploy', work / (role + '.tar.gz'))
            web_blob = blob(home, 'blobs', Path(packed['archive']).read_bytes(), '.tar.gz')
            for label, item in [('web', web_blob), ('sources', source_blob)]:
                stored, _ = read_blob(home, 'blobs', item, '.tar.gz')
                artifact.restore(stored, work / (role + '-' + label), item['sha256'])
            entries[role] = {'release': target, 'version': packed['version'], 'manifestSha256': manifest, 'web': web_blob, 'sources': source_blob}
    stamp = utcnow()
    snapshot = {'version': 1, 'id': uuid.uuid4().hex, 'checkedAt': stamp, 'success': True, 'fileRestoreVerified': True, 'entries': entries, 'controls': control,
                'scope': 'published current/previous, own controls and retained selected source snapshots; no private browser data, S3, encryption or cleanup'}
    path = home / 'snapshots' / (snapshot['id'] + '.json')
    update.save_json(path, snapshot)
    receipt = {'checkedAt': stamp, 'success': True, 'snapshot': 'snapshots/' + path.name, 'sha256': artifact.sha256(path.read_bytes()), 'currentManifestSha256': entries['current']['manifestSha256']}
    update.save_json(home / 'source-index.json', index)
    update.save_json(home / 'last-backup-success.json', receipt)
    return receipt


def load_snapshot(home):
    receipt = json_file(home / 'last-backup-success.json')
    require(receipt.get('success') is True and re.fullmatch(r'snapshots/[0-9a-f]{32}\.json', receipt.get('snapshot', '')), 'Invalid snapshot reference')
    snapshot_path = home / receipt['snapshot']
    require(not snapshot_path.is_symlink(), 'Linked snapshot')
    require(artifact.sha256(snapshot_path.read_bytes()) == receipt['sha256'], 'Snapshot receipt differs')
    snapshot = json_file(snapshot_path)
    require(snapshot.get('version') == 1 and snapshot.get('success') is True and snapshot.get('fileRestoreVerified') is True, 'Unverified snapshot')
    require('current' in snapshot.get('entries', {}) and set(snapshot['entries']) <= {'current', 'previous'}, 'Invalid snapshot roles')
    return snapshot


def check_restore(base, runtime):
    home = layout(base)
    update.ensure_idle(base)
    require(shutil.disk_usage(base).free >= 512 * 1024 * 1024, 'Insufficient free disk for restore check')
    snapshot = load_snapshot(home)
    checks = {}
    with tempfile.TemporaryDirectory(prefix='restore-', dir=home / 'work') as temporary:
        work = Path(temporary)
        control_files = restore_controls(read_blob(home, 'controls', snapshot['controls'], '.json')[1], work / 'controls')
        for role, entry in snapshot['entries'].items():
            require(SHA.fullmatch(entry.get('manifestSha256', '') or ''), 'Invalid restore manifest')
            restored = {}
            for label in ['web', 'sources']:
                descriptor = entry[label]
                path, _ = read_blob(home, 'blobs', descriptor, '.tar.gz')
                destination = work / (role + '-' + label)
                restored[label] = artifact.restore(path, destination, descriptor['sha256'])
                require(restored[label]['webManifestSha256'] == entry['manifestSha256'], 'Restore version differs')
            require(restored['sources']['sourceSnapshotIncluded'], 'Missing restored source coverage')
            served = runtime.verify(work / (role + '-web/web'), work / (role + '-web/config/nginx.conf'))
            require(served.get('healthy') is True and served.get('manifestSha256') == entry['manifestSha256'], 'Isolated Nginx did not verify restore')
            checks[role] = {'manifestSha256': entry['manifestSha256'], 'files': restored, 'runtime': served}
    receipt = {'checkedAt': utcnow(), 'success': True, 'snapshotId': snapshot['id'], 'controlsRestored': control_files, 'entries': checks, 'isolated': True, 's3Verified': False}
    update.save_json(home / 'last-restore-success.json', receipt)
    return receipt


def assess_account_health(profile,attempt,last,backend,payload,now):
    """Read existing PostgreSQL proof; never refresh its restore timestamp."""
    problems=[];ages={}
    values=[profile,attempt,last,backend,payload]
    if not all(isinstance(value,dict) for value in values):
        return {'required':True,'success':False,'problems':['receipt-missing-or-invalid'],'s3RequestsThisCheck':0,'restorePerformedThisCheck':False}
    sha=lambda value:isinstance(value,str) and SHA.fullmatch(value) is not None
    if profile.get('kind')!='melodiajest-account-profile' or profile.get('version')!=2 or profile.get('engine')!='postgres' or profile.get('standby') is not False:problems.append('profile-not-active-postgres')
    for name,value in [('last-attempt',attempt),('last-success',last)]:
        if value.get('kind')!='melodiajest-postgres-protection' or value.get('version')!=2 or value.get('status')!='verified' or value.get('standby') is not False:problems.append(name+'-not-verified')
    if backend.get('kind')!='melodiajest-account-source' or backend.get('dataSchemaVersion')!=2:problems.append('active-reader-not-compatible')
    source=profile.get('sourceSha256')
    if not sha(source) or any(value.get('sourceSha256')!=source for value in [attempt,last,backend,payload]):problems.append('source-does-not-match-current')
    for field in ['snapshot','fingerprint','dataDigest']:
        if not sha(last.get(field)) or attempt.get(field)!=last.get(field):problems.append('latest-'+field+'-differs')
    if payload.get('kind')!='melodiajest-postgres-payload' or payload.get('version')!=2 or payload.get('standby') is not False:problems.append('payload-not-active-postgres')
    if payload.get('fingerprint')!=last.get('fingerprint') or payload.get('dataDigest')!=last.get('dataDigest'):problems.append('payload-receipt-differs')
    if not sha(profile.get('archiveSha256')) or payload.get('archiveSha256')!=profile.get('archiveSha256') or payload.get('previousArchiveSha256')!=profile.get('previousArchiveSha256'):problems.append('archive-coverage-differs')
    files=payload.get('files',{});needed={'release.tar.gz','node.tar.xz','pg-dependencies.tar.gz','postgres-image.tar.gz','data/postgres.dump','data/snapshot.json','profile.json'}
    if not isinstance(files,dict) or not needed.issubset(files) or not isinstance(files.get('release.tar.gz'),dict) or files['release.tar.gz'].get('sha256')!=profile.get('archiveSha256'):problems.append('runtime-or-dump-proof-missing')
    proof=last.get('restore',{});flags=['postgresImageImported','nodeFromRestoredArchive','pgDependenciesFromRestoredArchive','dataDigestMatched','ddlDenied','wrongPasswordDenied','restoredSessionsRevoked','twoUsersRegistered','privateWriteReadback','forgedOwnerDenied']
    if not isinstance(proof,dict) or any(proof.get(key) is not True for key in flags) or proof.get('productionVolumesMounted') is not False or proof.get('productionDataUsed') is not False or proof.get('network')!='none' or proof.get('apiHealth')!='ok' or proof.get('sourceSha256')!=source:problems.append('independent-recovery-proof-incomplete')
    for name,value,key,limit in [('lastAttempt',attempt,'checkedAt',30*3600),('dataCompared',last,'dataComparedAt',30*3600),('independentRestore',last,'restoredAt',7*86400)]:
        try:
            stamp=dt.datetime.fromisoformat(value[key]);require(stamp.tzinfo is not None,'ambiguous account timestamp');age=(now-stamp).total_seconds();ages[name]=round(age)
            if age < -300 or age>limit:problems.append(name+'-invalid-or-stale')
        except (TypeError,KeyError,ValueError):problems.append(name+'-missing-or-invalid')
    return {'required':True,'success':not problems,'engine':'postgres','problems':problems,'agesSeconds':ages,'snapshotId':last.get('snapshot'),'sourceSha256':source,'restoreVerifiedAt':last.get('restoredAt'),'dataComparedAt':last.get('dataComparedAt'),'s3RequestsThisCheck':0,'restorePerformedThisCheck':False,'browserDataBackedUp':False}


def postgres_account_health(base,now,profile):
    try:
        home=base/'ops/account-postgres-backups';last=read_account_receipt(home/'latest-success.json');attempt=read_account_receipt(home/'latest-attempt.json')
        link=base/'account-service/current';require(link.is_symlink(),'account reader pointer missing');target=link.readlink();require(re.fullmatch(r'releases/[0-9]+\.[0-9]+\.[0-9]+-[a-f0-9]{16}',target.as_posix()),'invalid account reader pointer')
        backend=base/'account-service'/target;require(backend.resolve()==backend,'linked account reader directory');backend=read_account_receipt(backend/'backend.json')
        retained=Path(last['localPayload']);require(retained.is_absolute() and retained.parent==home and re.fullmatch(r'verified-[a-f0-9]{32}',retained.name) and retained.resolve()==retained,'invalid retained account proof')
        payload=read_account_receipt(retained/'account-payload.json');return assess_account_health(profile,attempt,last,backend,payload,now)
    except (OSError,ValueError,TypeError,KeyError):
        return {'required':True,'success':False,'problems':['receipt-missing-or-invalid'],'s3RequestsThisCheck':0,'restorePerformedThisCheck':False}


def read_account_receipt(path):
    require(path.parent.resolve()==path.parent and not path.is_symlink() and path.is_file() and path.stat().st_size<=256*1024, 'invalid bounded account receipt')
    value=json_file(path)
    require(isinstance(value,dict), 'invalid account receipt object')
    return value


def sqlite_account_health(base,now):
    """Retain the legacy SQLite deadlines; never consult it for PostgreSQL."""
    problems=[];account={'required':True,'engine':'sqlite','s3RequestsThisCheck':0,'restorePerformedThisCheck':False,'browserDataBackedUp':False}
    for name in ['latest-attempt.json','latest-success.json']:
        receipt=read_account_receipt(base/'ops/account-backups'/name)
        if receipt.get('status') not in {'verified','unchanged-confirmed'}:problems.append(name+'-not-verified')
        stamp=dt.datetime.fromisoformat(receipt.get('checkedAt',receipt.get('startedAt')))
        require(stamp.tzinfo is not None,'ambiguous account timestamp')
        checked=(now-stamp).total_seconds()
        if checked < -300 or checked > 30*3600:problems.append(name+'-stale')
        if name=='latest-success.json':
            stamp=dt.datetime.fromisoformat(receipt['restore']['verifiedAt'])
            require(stamp.tzinfo is not None,'ambiguous account restore timestamp')
            restored=(now-stamp).total_seconds()
            if restored < -300 or restored > 8*86400:problems.append('runtime-restore-stale')
            account.update(checkedAgeSeconds=round(checked),restoreAgeSeconds=round(restored),dataDigest=receipt['dataDigest'],sourceSha256=receipt['sourceSha256'],independentReadAndRestore=receipt['restore'].get('restoredRuntimeExecuted') is True)
    return {**account,'success':not problems,'problems':problems}


def account_health(base,now=None):
    """Select one backend from the installed profile; missing proof fails closed.

    This bounded local read performs no database, S3 or restore operation.
    """
    base=Path(base);now=now or dt.datetime.now(dt.timezone.utc)
    installed=any(path.exists() or path.is_symlink() for path in [base/'ops/account-profile.json',base/'account-service/current',base/'account-data/postgres.json'])
    if not installed:return {'required':False,'success':True,'status':'not-configured','problems':[],'s3RequestsThisCheck':0,'restorePerformedThisCheck':False}
    try:
        profile=read_account_receipt(base/'ops/account-profile.json')
        require(profile.get('kind')=='melodiajest-account-profile' and type(profile.get('version')) is int,'unknown account profile')
        if profile['version']==2:
            require(profile.get('engine')=='postgres','unknown account backend')
            return postgres_account_health(base,now,profile)
        marker=base/'account-data/postgres.json'
        require(profile['version']==1 and profile.get('engine','sqlite')=='sqlite' and not (marker.exists() or marker.is_symlink()),'unknown account backend or PostgreSQL downgrade')
        return sqlite_account_health(base,now)
    except (OSError,ValueError,TypeError,KeyError):
        return {'required':True,'success':False,'problems':['receipt-missing-or-invalid'],'s3RequestsThisCheck':0,'restorePerformedThisCheck':False}


def freshness(base, now=None):
    home = layout(base)
    now = dt.datetime.now(dt.timezone.utc) if now is None else now
    problems, ages = [], {}
    for job, limit in [('backup', 30 * 3600), ('restore', 8 * 24 * 3600)]:
        attempt_path = home / ('last-' + job + '-attempt.json')
        if attempt_path.exists():
            attempt = json_file(attempt_path)
            if attempt.get('status') != 'success':
                problems.append(job + '-last-attempt-' + str(attempt.get('status', 'unknown')))
        path = home / ('last-' + job + '-success.json')
        if not path.exists():
            problems.append(job + '-success-missing')
            continue
        receipt = json_file(path)
        stamp = dt.datetime.fromisoformat(receipt['checkedAt'])
        require(stamp.tzinfo is not None, 'Ambiguous receipt time')
        age = (now - stamp).total_seconds()
        ages[job] = round(age)
        if receipt.get('success') is not True or age < -300 or age > limit:
            problems.append(job + '-receipt-invalid-or-stale')
        if job == 'backup':
            if receipt.get('currentManifestSha256') != update.current_sha(base):
                problems.append('current-release-not-backed-up')
        elif receipt.get('entries', {}).get('current', {}).get('manifestSha256') != update.current_sha(base):
            problems.append('current-release-not-runtime-restored')
    if (home / 'last-backup-success.json').exists():
        saved = load_snapshot(home)
        previous = update.ref(base, 'previous', optional=True)
        previous_sha = artifact.sha256(artifact.regular_bytes(base / previous, 'web-release.json')) if previous else None
        if saved['entries'].get('previous', {}).get('manifestSha256') != previous_sha:
            problems.append('previous-release-not-backed-up')
    checked_account = account_health(base,now)
    account = {'configured':checked_account['required'],'browserProgressCovered':False,**checked_account}
    if not checked_account['success']:
        problems.extend('account-'+name for name in checked_account['problems'])
    result = {'checkedAt': now.isoformat(), 'success': not problems, 'problems': problems, 'agesSeconds': ages, 'independentExternalCopyVerified': False, 'browserDataBackedUp': False, 'accounts': account}
    update.save_json(home / 'health.json', result)
    return result


class IsolatedNginx:
    def __init__(self, base, image):
        self.work_root = layout(base) / 'work'
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', image), 'Pinned image required')
        self.image = image

    def command(self, args, timeout=60):
        return subprocess.check_output(['docker', *args], timeout=timeout, stderr=subprocess.PIPE)

    def verify(self, target, config):
        require(target.resolve().is_relative_to(self.work_root) and config.resolve().is_relative_to(self.work_root), 'Restore mount outside isolated work')
        public = artifact.read_web(target)
        target.chmod(0o755)
        for name in public:
            (target / name).chmod(0o644)
        config.chmod(0o644)
        token = uuid.uuid4().hex
        name = 'melodiajest-restore-' + token[:12]
        container = None
        try:
            container = self.command(['run', '-d', '--name', name, '--label', 'com.melodiajest.role=backup-restore-check', '--label', 'com.melodiajest.restore-id=' + token,
                '--network', 'none', '--pull', 'never', '--read-only', '--user', '101:101', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
                '--memory', '64m', '--cpus', '0.25', '--pids-limit', '64', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777',
                '--mount', 'type=bind,src=' + str(target) + ',dst=/usr/share/nginx/html,readonly', '--mount', 'type=bind,src=' + str(config) + ',dst=/etc/nginx/nginx.conf,readonly',
                '--entrypoint', 'nginx', self.image, '-g', 'daemon off;']).decode().strip()
            info = json.loads(self.command(['inspect', name]))[0]
            require(info['Id'] == container and info['Image'] == self.image and info['Config']['Labels'].get('com.melodiajest.restore-id') == token, 'Wrong restore container')
            require(info['HostConfig']['NetworkMode'] == 'none' and not info['HostConfig']['PortBindings'], 'Restore network/port isolation differs')
            for attempt in range(20):
                ready = subprocess.run(['docker', 'exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1:8080/healthz'], capture_output=True, timeout=5)
                if ready.returncode == 0 and ready.stdout == b'ok\n':
                    break
                time.sleep(0.2)
            require(ready.returncode == 0 and ready.stdout == b'ok\n', 'Restored Nginx not ready')
            for asset, data in public.items():
                require(self.command(['exec', name, 'wget', '-q', '-O', '-', 'http://127.0.0.1:8080/' + asset]) == data, 'Restored public bytes differ')
            return {'healthy': True, 'publicFilesVerified': len(public), 'manifestSha256': artifact.sha256(public['web-release.json']), 'network': 'none', 'publicPorts': False}
        finally:
            # docker run can create a stopped container and then fail to start it.
            # Inspect only this unique name, including that failure case.
            inspected = subprocess.run(['docker', 'inspect', name], capture_output=True, timeout=30)
            if inspected.returncode == 0:
                actual = json.loads(inspected.stdout)[0]
                require((container is None or actual['Id'] == container) and actual['Config']['Labels'].get('com.melodiajest.role') == 'backup-restore-check' and actual['Config']['Labels'].get('com.melodiajest.restore-id') == token, 'Refuse cleanup of unrelated container')
                self.command(['rm', '-f', name], timeout=30)
            else:
                require(container is None, 'Unable to inspect/remove owned restore container')


@contextmanager
def worker_lock(home):
    require(os.name == 'posix', 'Backup jobs require Linux/POSIX')
    import fcntl
    path = home / 'worker.lock'
    require(not path.is_symlink(), 'Linked worker lock')
    with path.open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def run_job(base, command, tooling, units, runtime=None, shared=Path('/run/lock/libre-deploy.lock')):
    home = layout(base)
    job = 'backup' if command == 'snapshot' else 'restore'
    with worker_lock(home):
        if command == 'health':
            try:
                return freshness(base)
            except Exception as error:
                result = {'checkedAt': utcnow(), 'success': False, 'problems': ['backup-receipt-invalid'], 'errorType': type(error).__name__}
                update.save_json(home / 'health.json', result)
                return result
        try:
            with update.operation_locks(base, shared):
                update.save_json(home / ('last-' + job + '-attempt.json'), {'checkedAt': utcnow(), 'status': 'running'})
                result = save_snapshot(base, tooling, units) if command == 'snapshot' else check_restore(base, runtime)
            update.save_json(home / ('last-' + job + '-attempt.json'), {'checkedAt': utcnow(), 'status': 'success'})
            return result
        except update.UpdateFailed:
            update.save_json(home / ('last-' + job + '-attempt.json'), {'checkedAt': utcnow(), 'status': 'deferred', 'reason': 'shared-or-own-deploy-lock-busy'})
            raise
        except Exception as error:
            update.save_json(home / ('last-' + job + '-attempt.json'), {'checkedAt': utcnow(), 'status': 'failed', 'errorType': type(error).__name__})
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['snapshot', 'restore-check', 'health'])
    args = parser.parse_args()
    base = update.PRODUCTION
    try:
        runtime = IsolatedNginx(base, policy(base)['image']) if args.command == 'restore-check' else None
        result = run_job(base, args.command, Path(__file__).resolve().parent, Path('/etc/systemd/system'), runtime)
        print(json.dumps(result, sort_keys=True))
        return 0 if result['success'] else 1
    except (BlockingIOError, update.UpdateFailed):
        print(json.dumps({'success': False, 'status': 'deferred', 'reason': 'operation-lock-busy'}))
        return 75
    except Exception as error:
        print(json.dumps({'success': False, 'errorType': type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
