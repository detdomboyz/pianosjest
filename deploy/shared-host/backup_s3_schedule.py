"""External steps for the three existing MelodiaJest services; no new timers.

Each changed payload is backed up and cold-restored. An unchanged payload only
refreshes local coverage; the existing weekly service rechecks S3 availability.
No bucket scan, initialization, retention, production restore or policy changes.
"""
import argparse,base64,datetime,hashlib,json,os,re,shutil,sys
from pathlib import Path
import backup_s3_job as job
import backup_s3_runtime as runtime
import release_artifact as artifact
import release_backup as backup
import release_update as update

BASE=Path('/opt/melodiajest');OPS=BASE/'ops';STATE=OPS/'external-s3/scheduled'
TOOLING=Path(__file__).resolve().parents[2]
JOBS={'backup':'backup','restore-check':'restore-check','backup-health':'health'}
require=runtime.require

def render_dropins(tooling):
    require(re.fullmatch(r'/opt/melodiajest/ops/tooling/s3-[a-f0-9]{16}',str(tooling)),'immutable own S3 tooling required')
    return {'melodiajest-'+name+'.service.d/20-external-s3.conf':'[Service]\nExecStartPost=/usr/bin/python3 -B '+str(tooling)+'/deploy/shared-host/backup_s3_schedule.py '+command+'\n' for name,command in JOBS.items()}

def validate_configuration(value):
    keys={'format','enabled','tooling','files','developmentArchiveSha256','developmentWebManifestSha256','passwordCopySha256'}
    require(type(value) is dict and set(value)==keys and value['format']=='melodiajest-s3-schedule-v1' and value['enabled'] is True,'unexpected schedule configuration')
    render_dropins(value['tooling']);require(type(value['files']) is dict and set(value['files'])==job.SCHEDULE_TOOL_FILES,'unexpected schedule tooling files')
    require(all(runtime.SHA.fullmatch(x or '') for x in [value['developmentArchiveSha256'],value['developmentWebManifestSha256'],value['passwordCopySha256'],*value['files'].values()]),'schedule SHA required')
    return value

def configuration():
    p=OPS/'s3-schedule.json';require(p.resolve()==p and p.stat().st_uid==0 and p.stat().st_mode&0o077==0,'schedule config must be root-private')
    value=validate_configuration(job.read(p));require(value['tooling']==str(TOOLING),'schedule tooling pointer differs')
    for name,digest in value['files'].items():require(artifact.sha256(artifact.regular_bytes(TOOLING,name))==digest,'installed schedule tooling changed')
    require(job.read(OPS/'password-copy-receipt.json')['encryptedFileSha256']==value['passwordCopySha256'],'protected password copy changed')
    return value

def collect_controls(config,units=Path('/etc/systemd/system')):
    files={'config/s3-schedule.json':backup.encoded(config),'config/s3-backup.json':backup.encoded(runtime.configuration())}
    for name in ['restic-runtime','password-copy-receipt']:
        files['config/'+name+'.json']=artifact.regular_bytes(OPS,name+'.json')
    files['config/external-repository.json']=artifact.regular_bytes(OPS/'external-s3','repository.json')
    for name in job.SCHEDULE_TOOL_FILES:files['tooling/'+name]=artifact.regular_bytes(TOOLING,name)
    for name,expected in render_dropins(config['tooling']).items():
        raw=artifact.regular_bytes(units,name);require(raw==expected.encode(),'installed external drop-in differs');files['systemd/'+name]=raw
    raw=backup.encoded({'format':'melodiajest-s3-controls-v1','files':{name:{**artifact.descriptor(data),'data':base64.b64encode(data).decode()} for name,data in files.items()}})
    job.schedule_controls(raw);return raw

def source_choice(snapshot,config):
    current=snapshot['entries']['current'];manifest=current['manifestSha256']
    if manifest==config['developmentWebManifestSha256']:
        sha=config['developmentArchiveSha256'];return sha,OPS/('development-source-'+sha[:12])/'selected-checkout.tar.gz'
    sha=current['sources']['sha256'];require(runtime.SHA.fullmatch(sha or ''),'published source SHA missing')
    return sha,OPS/'server-backups/blobs'/(sha+'.tar.gz')

def coverage(snapshot,checkout_sha,controls_sha):
    entries={name:{k:value[k] for k in ['manifestSha256','web','sources']} for name,value in snapshot['entries'].items()}
    value={'entries':entries,'serverControls':snapshot['controls'],'checkoutArchiveSha256':checkout_sha,'scheduleControlsSha256':controls_sha,'resticBinarySha256':runtime.BINARY_SHA}
    return artifact.sha256(backup.encoded(value))

def context(config):
    snapshot=backup.load_snapshot(OPS/'server-backups');current=update.current_sha(BASE)
    require(snapshot['entries']['current']['manifestSha256']==current,'server backup does not cover current release')
    previous=update.ref(BASE,'previous',optional=True);previous_sha=artifact.sha256(artifact.regular_bytes(BASE/previous,'web-release.json')) if previous else None
    require(snapshot['entries'].get('previous',{}).get('manifestSha256')==previous_sha,'server backup does not cover previous release')
    controls=collect_controls(config);sha,source=source_choice(snapshot,config)
    return {'coverage':coverage(snapshot,sha,artifact.sha256(controls)),'checkoutSha256':sha,'source':source,'controls':controls,'currentManifestSha256':current,'previousManifestSha256':previous_sha}

def summary(ctx):return {k:ctx[k] for k in ['coverage','checkoutSha256','currentManifestSha256','previousManifestSha256']}

class Backend:
    def prepare(self,ctx):
        source=ctx['source'];sha=ctx['checkoutSha256'];_,meta=artifact.read_bundle(source,sha)
        require(meta['sourceSnapshotIncluded'] and meta['webManifestSha256']==ctx['currentManifestSha256'],'selected source does not cover current release')
        folder=job.private_directory(OPS/('development-source-'+sha[:12]));target=folder/'selected-checkout.tar.gz'
        if target.exists():require(artifact.sha256(artifact.regular_bytes(folder,target.name))==sha,'immutable selected checkout changed')
        else:
            with target.open('xb') as out:out.write(source.read_bytes())
            target.chmod(0o600);require(artifact.sha256(target.read_bytes())==sha,'selected source staging differs')
        return job.prepare(sha,ctx['controls'])

    def validate(self,prepared):
        work=job.work_directory(prepared['work']);job.verify_payload(work/'payload',prepared['payloadManifestSha256'])

    def backup(self,prepared):
        self.validate(prepared);saved=job.work_directory(prepared['work'])/'backup-success.json'
        if saved.exists():
            value=job.read(saved);require(value['success'] and value['prepared']['payloadManifestSha256']==prepared['payloadManifestSha256'],'saved backup differs');return value
        return job.backup_payload(prepared['work'],False)

    def restore(self,prepared):
        p=Path(runtime.PASSWORD_FILE);require(p.resolve()==p and p.stat().st_uid==0 and p.stat().st_mode&0o077==0,'own password must be root-private')
        password=runtime.password_value(artifact.regular_bytes(p.parent,p.name));receipt=job.read(OPS/'password-copy-receipt.json')
        return job.restore_payload(prepared['work'],{'password':password,'encryptedPasswordCopySha256':receipt['encryptedFileSha256']},password_source='server-file')

def optional(path):return job.read(path) if path.exists() else None

def finish_restore(state,ctx,pending,backend):
    job.save(state/'last-restore-attempt.json',{'checkedAt':job.now(),'status':'running'})
    try:
        proof=backend.restore(pending['prepared']);require(proof['success'] and proof['independentExternalCopyVerified'] and proof['snapshotId']==pending['backup']['snapshotId'] and proof.get('payloadManifestSha256')==pending['prepared']['payloadManifestSha256'],'external cold restore did not verify exact backup')
    except Exception as error:
        job.save(state/'last-restore-attempt.json',{'checkedAt':job.now(),'status':'failed','errorType':type(error).__name__});raise
    job.save(state/'last-restore-success.json',proof)
    job.save(state/'last-restore-attempt.json',{'checkedAt':job.now(),'status':'success','snapshotId':proof['snapshotId']})
    value={'checkedAt':job.now(),'success':True,**summary(ctx),'snapshotId':proof['snapshotId'],'prepared':pending['prepared'],'backupCreatedAt':pending['backup']['checkedAt'],'independentExternalCopyVerified':True,'passwordRecoverySource':'server-owned-file','browserDataBackedUp':False,'scheduledExternalBackup':True}
    job.save(state/'last-success.json',value);job.save(state/'last-check-success.json',value);job.save(state/'last-attempt.json',{'checkedAt':job.now(),'status':'success','coverage':ctx['coverage'],'snapshotId':proof['snapshotId']});return value

def backup_cycle(state,ctx,backend):
    last=optional(state/'last-success.json');pending=optional(state/'pending.json')
    if last and last['coverage']==ctx['coverage']:
        restore_attempt=optional(state/'last-restore-attempt.json')
        if not restore_attempt or restore_attempt.get('status')!='success':return restore_cycle(state,ctx,backend)
        backend.validate(last['prepared']);value={**last,'checkedAt':job.now(),'unchangedPayload':True,'s3RequestsThisCheck':0}
        job.save(state/'last-check-success.json',value);job.save(state/'last-backup-attempt.json',{'checkedAt':job.now(),'status':'success','unchangedPayload':True});job.save(state/'last-attempt.json',{'checkedAt':job.now(),'status':'success','coverage':ctx['coverage'],'snapshotId':last['snapshotId'],'unchangedPayload':True});return value
    job.save(state/'last-backup-attempt.json',{'checkedAt':job.now(),'status':'running'})
    try:
        if not pending or pending['coverage']!=ctx['coverage']:
            pending={**summary(ctx),'prepared':backend.prepare(ctx)};job.save(state/'pending.json',pending)
        if 'backup' not in pending:
            pending['backup']=backend.backup(pending['prepared']);require(pending['backup']['success'] and runtime.SHA.fullmatch(pending['backup']['snapshotId']),'external backup not confirmed')
            job.save(state/'pending.json',pending);job.save(state/'last-backup-success.json',pending['backup'])
    except Exception as error:
        job.save(state/'last-backup-attempt.json',{'checkedAt':job.now(),'status':'failed','errorType':type(error).__name__});raise
    job.save(state/'last-backup-attempt.json',{'checkedAt':job.now(),'status':'success','snapshotId':pending['backup']['snapshotId']})
    return finish_restore(state,ctx,pending,backend)

def restore_cycle(state,ctx,backend):
    pending=optional(state/'pending.json');require(pending and pending['coverage']==ctx['coverage'] and 'backup' in pending,'no exact current external backup to restore')
    return finish_restore(state,ctx,pending,backend)

def assess_health(ctx,attempt,last,check,restored,now,backup_attempt,restore_attempt):
    problems=[];ages={}
    if not attempt or attempt.get('status')!='success':problems.append('last-attempt-not-success')
    for name,value in [('backup',backup_attempt),('restore',restore_attempt)]:
        if not value or value.get('status')!='success':problems.append(name+'-last-attempt-not-success')
    for name,value,limit in [('coverageCheck',check,30*3600),('externalRestore',restored,8*24*3600)]:
        try:
            stamp=datetime.datetime.fromisoformat(value['checkedAt']);require(stamp.tzinfo is not None,'ambiguous receipt timestamp');age=(now-stamp).total_seconds();ages[name]=round(age)
            if not value.get('success') or age < -300 or age>limit:problems.append(name+'-invalid-or-stale')
        except (TypeError,KeyError,ValueError):problems.append(name+'-missing-or-invalid')
    if not last or last.get('success') is not True or last.get('independentExternalCopyVerified') is not True or last.get('coverage')!=ctx['coverage']:problems.append('current-payload-not-externally-verified')
    if not check or check.get('coverage')!=ctx['coverage']:problems.append('coverage-check-does-not-match-current')
    if not last or not restored or last.get('snapshotId')!=restored.get('snapshotId') or not restored.get('independentExternalCopyVerified'):problems.append('exact-snapshot-not-restored')
    if last and restored and restored.get('payloadManifestSha256')!=last.get('prepared',{}).get('payloadManifestSha256'):problems.append('restored-payload-manifest-differs')
    if check and last and check.get('snapshotId')!=last.get('snapshotId'):problems.append('coverage-snapshot-differs')
    return {'checkedAt':now.isoformat(),'success':not problems,'problems':problems,'agesSeconds':ages,'backupCreatedAt':last.get('backupCreatedAt') if last else None,'independentExternalCopyVerified':bool(last and last.get('independentExternalCopyVerified') and not problems),'browserDataBackedUp':False,'scheduledExternalBackup':True,'s3RequestsThisCheck':0}

def execute(command):
    require(command in ['backup','restore-check','health'],'unknown scheduled operation');config=configuration();job.private_directory(STATE)
    with backup.worker_lock(STATE):
        if command!='health':job.save(STATE/'last-attempt.json',{'checkedAt':job.now(),'status':'running','step':command})
        ctx=context(config)
        if command=='backup':return backup_cycle(STATE,ctx,Backend())
        if command=='restore-check':return restore_cycle(STATE,ctx,Backend())
        value=assess_health(ctx,optional(STATE/'last-attempt.json'),optional(STATE/'last-success.json'),optional(STATE/'last-check-success.json'),optional(STATE/'last-restore-success.json'),datetime.datetime.now(datetime.timezone.utc),optional(STATE/'last-backup-attempt.json'),optional(STATE/'last-restore-attempt.json'));job.save(STATE/'health.json',value);return value

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['backup','restore-check','health']);args=parser.parse_args()
    try:
        value=execute(args.command);print(json.dumps(value));return 0 if value['success'] else 1
    except BlockingIOError:
        print(json.dumps({'success':False,'status':'deferred','reason':'operation-lock-busy'}));return 75
    except update.UpdateFailed:
        value={'checkedAt':job.now(),'success':False,'status':'deferred','step':args.command,'reason':'shared-or-own-operation-lock-busy'}
        if STATE.exists() and args.command!='health':job.save(STATE/'last-attempt.json',value)
        print(json.dumps(value));return 75
    except Exception as error:
        value={'checkedAt':job.now(),'success':False,'status':'failed','step':args.command,'errorType':type(error).__name__}
        if STATE.exists():job.save(STATE/('health.json' if args.command=='health' else 'last-attempt.json'),value)
        print(json.dumps(value),file=sys.stderr);return 1

if __name__=='__main__':sys.exit(main())
