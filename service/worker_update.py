"""Own PG backup-worker control update. No API/data/timer changes or starts.

The production runtime uses the already shared S3/deploy locks. Plans are
recomputed under those locks. Rollback restores exact original control bytes.
An independent kit-recovery receipt is required before installation.
"""
import base64
from contextlib import contextmanager, ExitStack
import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import uuid

FILES=frozenset('''music-document.js catalog-personalization.js portal-experience.js practice-assessment.js piano-catalog-adapter.js lesson-rating.js catalog-transfer.js
tests/backup_s3_runtime_test.py tests/backup_s3_schedule_test.py tools/melodiajest_secret.py tools/package-service-dependencies.py
service/implementation-files.json service/db-config.cjs service/postgres-runtime.json service/game-schema.sql service/migration.cjs service/security.cjs service/pg-snapshot.cjs service/store.cjs service/game-grade.cjs service/repository.cjs service/deployment.py service/operate.py service/data-model.cjs service/account_backup.py service/canonical.cjs service/server.cjs service/postgres.py service/units.py service/game.cjs service/backup.cjs service/postgres_image.py service/validation.cjs service/course.cjs service/socket-clean.cjs service/package.json service/postgres_backup.py service/schema.pg.sql service/database.cjs service/runtime.json service/course-registry.json service/package-lock.json
deploy/shared-host/release_update.py deploy/shared-host/backup_replica.py deploy/shared-host/backup_s3_runtime.py deploy/shared-host/public-assets.json deploy/shared-host/backup_units.py deploy/shared-host/backup_s3_schedule.py deploy/shared-host/release_artifact.py deploy/shared-host/backup_s3_job.py deploy/shared-host/release_backup.py'''.split())
UNIT='melodiajest-account-backup.service';CHANGED='service/postgres_backup.py'
PREFIX='/opt/melodiajest/ops/tooling/'
sha=lambda raw:hashlib.sha256(raw).hexdigest()
stamp=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def require(ok,message):
    if not ok:raise ValueError(message)
def regular(path):
    path=Path(path);require(path.parent.resolve()==path.parent and not path.is_symlink() and path.is_file(),'Unsafe regular input')
    require(path.stat().st_size<=8*1024*1024,'Input too large');return path.read_bytes()
def atomic(path,raw,mode=0o600):
    path=Path(path);require(path.parent.resolve()==path.parent and not path.is_symlink(),'Unsafe control path')
    temporary=path.with_name('.'+path.name+'-'+uuid.uuid4().hex)
    with temporary.open('xb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
    temporary.chmod(mode);os.replace(temporary,path)
    if os.name=='posix':
        fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
def save(path,value):atomic(path,(json.dumps(value,sort_keys=True,indent=2)+'\n').encode())
def control_paths(base,units):return {'profile':Path(base)/'ops/account-profile.json','unit':Path(units)/UNIT}
def decode(value):return base64.b64decode(value,validate=True)

def bundle(archive,expected_sha):
    raw=regular(archive);require(sha(raw)==expected_sha,'Worker archive checksum differs')
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as tar:
        members=tar.getmembers();names=[m.name for m in members]
        require(len(members)==52 and len(set(names))==52 and set(names)=={'toolkit-manifest.json'}|{'source/'+n for n in FILES},'Worker archive allowlist differs')
        require(all(m.isfile() and not m.issym() and not m.islnk() and 0<=m.size<=4*1024*1024 for m in members),'Unsafe archive entry')
        require(sum(m.size for m in members)<=8*1024*1024,'Expanded worker archive too large')
        manifest=json.load(tar.extractfile('toolkit-manifest.json'));files={n:tar.extractfile('source/'+n).read() for n in FILES}
    require(manifest.get('kind')=='melodiajest-account-worker-candidate' and manifest.get('version')==1 and set(manifest.get('files',{}))==FILES,'Unknown worker manifest')
    for name,raw in files.items():require(manifest['files'][name]=={'sha256':sha(raw),'bytes':len(raw)},'Worker file checksum differs')
    identity=sha(json.dumps({n:sha(v) for n,v in files.items()},sort_keys=True,separators=(',',':')).encode())
    require(manifest.get('identity')==identity and manifest.get('plannedTooling')==PREFIX+'account-'+identity[:16],'Worker identity differs')
    require(manifest.get('changedFiles')==[CHANGED] and manifest.get('productionFiles')==51 and manifest.get('unchangedFiles')==50,'Unexpected worker change scope')
    return files,manifest

def plan(base,units,archive,archive_sha,expected):
    base=Path(base).resolve();units=Path(units).resolve();paths=control_paths(base,units);old={n:regular(p) for n,p in paths.items()}
    require(sha(old['profile'])==expected['profileSha256'] and sha(old['unit'])==expected['unitSha256'],'Controls changed since preflight')
    profile=json.loads(old['profile']);tool=profile.get('tooling','');require(re.fullmatch(re.escape(PREFIX)+r'account-[a-f0-9]{16}',tool) is not None,'Unexpected old worker path')
    require(profile.get('kind')=='melodiajest-account-profile' and profile.get('version')==2 and not profile.get('standby'),'Expected active own PostgreSQL profile')
    files,manifest=bundle(archive,archive_sha);require(manifest.get('previousTooling')==tool and manifest['plannedTooling']!=tool,'Worker predecessor differs')
    old_root=base/'ops/tooling'/Path(tool).name;require(old_root.resolve()==old_root and not old_root.is_symlink(),'Unsafe old toolkit')
    require(all(not p.is_symlink() for p in old_root.rglob('*')),'Linked old toolkit member')
    observed={p.relative_to(old_root).as_posix() for p in old_root.rglob('*') if p.is_file()};require(observed==FILES,'Old toolkit allowlist differs')
    for name in FILES:
        old_file=regular(old_root/name)
        require(sha(old_file)==expected['oldWorkerSha256'] if name==CHANGED else old_file==files[name],'Unreviewed old toolkit change')
    line=('ExecStart=/usr/bin/python3 -B '+tool+'/service/account_backup.py run').encode()
    require(old['unit'].splitlines().count(line)==1 and len([x for x in old['unit'].splitlines() if x.startswith(b'ExecStart=')])==1,'Backup ExecStart differs')
    new_unit=old['unit'].replace(line,line.replace(tool.encode(),manifest['plannedTooling'].encode()),1);new_profile={**profile,'tooling':manifest['plannedTooling']}
    new={'profile':(json.dumps(new_profile,sort_keys=True,indent=2)+'\n').encode(),'unit':new_unit}
    result={'kind':'melodiajest-account-worker-update','version':1,'archive':str(Path(archive).resolve()),'archiveSha256':archive_sha,'manifest':manifest,'oldProfile':profile,'oldTooling':tool,'newTooling':manifest['plannedTooling'],'before':{n:base64.b64encode(v).decode() for n,v in old.items()},'after':{n:base64.b64encode(v).decode() for n,v in new.items()},'beforeSha256':{n:sha(v) for n,v in old.items()},'afterSha256':{n:sha(v) for n,v in new.items()},'controlModes':{n:p.stat().st_mode&0o777 for n,p in paths.items()},'expected':expected,'dataMigrationPerformed':False,'apiRestarted':False,'newTimersCreated':0}
    return result,files

def proof_ok(proof,archive_sha):
    require(proof.get('kind')=='melodiajest-independent-worker-kit-recovery' and proof.get('independentExternalCopyVerified') is True and proof.get('archiveSha256')==archive_sha and proof.get('restoredArchiveSha256')==archive_sha and proof.get('filesVerified')==51 and proof.get('productionVolumesMounted') is False and re.fullmatch('[a-f0-9]{64}',proof.get('snapshotId','')) is not None,'Independent worker recovery proof required')

def stage(base,record,files):
    target=Path(base)/'ops/tooling'/Path(record['newTooling']).name
    require(target.parent.resolve()==target.parent and not target.is_symlink(),'Unsafe candidate worker path');target.mkdir(mode=0o700,exist_ok=True)
    for name,raw in files.items():
        path=target/name;path.parent.mkdir(mode=0o700,parents=True,exist_ok=True);require(path.parent.resolve()==path.parent and not path.is_symlink(),'Linked candidate member')
        if path.exists():require(regular(path)==raw,'Immutable candidate file changed')
        else:atomic(path,raw)
    require(all(not p.is_symlink() for p in target.rglob('*')) and {p.relative_to(target).as_posix() for p in target.rglob('*') if p.is_file()}==FILES,'Unexpected candidate files')
    return target

def restore_controls(base,units,record,runtime):
    paths=control_paths(base,units)
    for name,path in paths.items():require(sha(regular(path)) in [record['beforeSha256'][name],record['afterSha256'][name]],'Control drift blocks rollback')
    for name,path in paths.items():atomic(path,decode(record['before'][name]),record['controlModes'][name])
    runtime.reload_and_verify(record,old=True)

def install(base,units,archive,archive_sha,expected,proof,runtime):
    journal=Path(base)/'ops/account-worker-update.json';proof_ok(proof,archive_sha)
    with runtime.guard('install'):
        if journal.exists():require(json.loads(regular(journal))['phase'] in ['committed','rolled-back'],'Unfinished worker update requires recovery')
        record,files=plan(base,units,archive,archive_sha,expected);runtime.preinstall(record,proof);stage(base,record,files)
        record.update(id=uuid.uuid4().hex,checkedAt=stamp(),phase='prepared',independentKitRecovery=proof);save(journal,record)
        try:
            for name,path in control_paths(base,units).items():atomic(path,decode(record['after'][name]),record['controlModes'][name]);record['phase']=name+'-written';save(journal,record)
            runtime.reload_and_verify(record,old=False);record.update(phase='committed',committedAt=stamp());save(journal,record);return record
        except Exception:
            try:restore_controls(base,units,record,runtime);record.update(phase='rolled-back',rolledBackAt=stamp());save(journal,record)
            except Exception:record.update(phase='recovery-required');save(journal,record);raise
            raise

def rollback(base,units,runtime):
    journal=Path(base)/'ops/account-worker-update.json'
    with runtime.guard('rollback'):
        record=json.loads(regular(journal));require(record['kind']=='melodiajest-account-worker-update' and record['phase'] in ['committed','prepared','profile-written','unit-written','recovery-required'],'Worker rollback state differs')
        restore_controls(base,units,record,runtime);record.update(phase='rolled-back',rolledBackAt=stamp());save(journal,record);return record


class ProductionRuntime:
    def __init__(self,base):
        require(os.name=='posix' and os.geteuid()==0 and Path(base)==Path('/opt/melodiajest'),'Own production root context required');self.base=Path(base)
        sys.path.insert(0,'/opt/melodiajest/ops/tooling/updater-a3fe61ded8b1e6b8')
        import release_update
        self.update=release_update
        sys.path.insert(0,'/opt/melodiajest/ops/tooling/backup-3d670cf8764788cb')
        import release_backup
        self.backup=release_backup
    def inactive(self,allow_failed=False):
        status=dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show',UNIT,'-p','ActiveState','-p','Result'],text=True).splitlines())
        require(status['ActiveState']=='inactive' and (allow_failed or status['Result']=='success'),'Backup unit active,failed or retrying;defer')
        # Known timer must be safely outside the bounded two-file transaction.
        raw=subprocess.check_output(['systemctl','show','melodiajest-account-backup.timer','-p','NextElapseUSecRealtime','--value'],text=True).strip()
        due=datetime.datetime.strptime(raw,'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=datetime.timezone.utc)
        require((due-datetime.datetime.now(datetime.timezone.utc)).total_seconds()>300,'Daily timer too close to control transaction')
    def controls(self):
        paths=list(Path('/etc/systemd/system').glob('melodiajest-*.timer'))+[Path('/opt/libre/deploy/vps/Caddyfile'),self.base/'ops/s3-schedule.json',self.base/'ops/backup-tooling.json']
        return {str(p):(sha(regular(p)),p.stat().st_ino if p.name=='Caddyfile' else None) for p in paths}|{'webPointer':str((self.base/'current').readlink()),'apiPointer':str((self.base/'account-service/current').readlink())}
    @contextmanager
    def guard(self,mode):
        with self.backup.worker_lock(self.base/'ops/external-s3/scheduled'),self.update.operation_locks(self.base):
            self.update.ensure_idle(self.base);self.inactive(allow_failed=mode=='rollback');baseline=self.controls();self.update.ProductionRuntime(self.base).neighbors()
            try:yield
            finally:require(self.controls()==baseline,'Unrelated production controls changed');self.update.ProductionRuntime(self.base).neighbors()
    def preinstall(self,record,proof):
        self.inactive()
        import importlib.util
        path=self.base/'ops/course-27-202d50f7ff6d/restored/source/deploy/shared-host/release_start_budget.py'
        require(sha(regular(path))=='aba34fb8bbfc0c5d7fd7e254afdd13d5a0161ac57708298af03e9f2170f9317a','Budget helper changed')
        spec=importlib.util.spec_from_file_location('worker_update_budget',path);budget=importlib.util.module_from_spec(spec);spec.loader.exec_module(budget)
        require(budget.observe_start_budget(planned_starts=1)['allowed'],'Post-install backup start not allowed;defer')
        home=self.base/'ops/account-postgres-backups';last=json.loads(regular(home/'latest-success.json'));attempt=json.loads(regular(home/'latest-attempt.json'))
        require(last==attempt and last['status']=='verified' and last['sourceSha256']==record['oldProfile']['sourceSha256'],'Current data protection differs')
        age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(last['dataComparedAt'])).total_seconds();require(0<=age<1800,'Fresh current-data comparison required')
    def reload_and_verify(self,record,old=False):
        for name,path in control_paths(self.base,Path('/etc/systemd/system')).items():require(sha(regular(path))==record['beforeSha256' if old else 'afterSha256'][name],'Written control differs')
        subprocess.run(['systemd-analyze','verify','/etc/systemd/system/'+UNIT],check=True,capture_output=True,timeout=20)
        subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True,timeout=20)
        observed=subprocess.check_output(['systemctl','show',UNIT,'-p','ExecStart','--value'],text=True)
        require((record['oldTooling'] if old else record['newTooling'])+'/service/account_backup.py run' in observed,'Loaded backup command differs');self.inactive(allow_failed=old)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=['plan','install','rollback']);parser.add_argument('--archive');parser.add_argument('--sha256');parser.add_argument('--expected');parser.add_argument('--proof');args=parser.parse_args();base=Path('/opt/melodiajest');units=Path('/etc/systemd/system')
    try:
        if args.command=='rollback':result=rollback(base,units,ProductionRuntime(base))
        else:
            expected=json.loads(regular(args.expected));result=plan(base,units,Path(args.archive),args.sha256,expected)[0] if args.command=='plan' else install(base,units,Path(args.archive),args.sha256,expected,json.loads(regular(args.proof)),ProductionRuntime(base))
        print(json.dumps(result,sort_keys=True))
    except Exception as error:print(json.dumps({'status':'failed','errorType':type(error).__name__,'message':str(error)[:160]}),file=sys.stderr);sys.exit(1)
