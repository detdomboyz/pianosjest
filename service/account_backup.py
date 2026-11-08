"""Own daily account copies and cold restores. Never restores production data.

The restic transport is the existing pinned MelodiaJest runner. Every new
snapshot is read back with a fresh cache, decrypted, checked, and exercised with
a restored Node binary and a disposable database. Unchanged data reuses its
confirmed snapshot for at most seven days. No repository forget/prune occurs.
"""
from contextlib import ExitStack
import datetime as dt
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import uuid

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'deploy/shared-host'))
sys.path.insert(0,str(ROOT/'service'))
import release_artifact as artifact
import release_update as update
import release_backup as backup
import backup_s3_runtime as transport
import deployment

BASE=Path('/opt/melodiajest')
HOME=BASE/'ops/account-backups'
PROFILE=BASE/'ops/account-profile.json'
require=artifact.require


def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def age(instant):return (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(instant)).total_seconds()
def sha(data):return hashlib.sha256(data).hexdigest()


def private(path):
    path=deployment.directory(path,0o700)
    require(path.stat().st_uid==0,'Backup directory is not root-owned')
    path.chmod(0o700)
    return path


def profile():
    require(os.name=='posix' and os.geteuid()==0 and BASE.resolve()==BASE,'Production root context required')
    import pwd
    value=json.loads(artifact.regular_bytes(PROFILE.parent,PROFILE.name))
    require(value.get('kind')=='melodiajest-account-profile' and value.get('version')==1,'Unknown account profile')
    for name in ['archive','nodeArchive','tooling']:
        path=Path(value[name]);require(path.is_absolute() and path.resolve()==path and path.is_relative_to(BASE/'ops') and not path.is_symlink(),'Unsafe account profile path')
    require(sha(Path(value['archive']).read_bytes())==value['archiveSha256'],'Account release archive changed')
    require(sha(Path(value['nodeArchive']).read_bytes())==value['nodeArchiveSha256'],'Account Node archive changed')
    deployment.verify_node(value['nodeDirectory'])
    require(Path(value['nodeDirectory']).parent==BASE/'runtime','Wrong Node directory')
    require(Path(value['tooling'])==ROOT,'Wrong account worker version')
    source=deployment.verify_sources(BASE/'account-service'/deployment.pointer(BASE/'account-service'))
    require(source['sourceSha256']==value['sourceSha256'],'Account code changed without its protection profile')
    uid=pwd.getpwnam('melodiajest-account')
    require(uid.pw_uid>0 and uid.pw_gid>0 and uid.pw_dir==str(BASE/'account-data'),'Unexpected daemon identity')
    data=BASE/'account-data';require(data.resolve()==data and data.stat().st_uid==uid.pw_uid and data.stat().st_mode&0o777==0o700,'Unsafe account data directory')
    return value,uid,source


def child(uid,args,**kwargs):
    return subprocess.run(args,check=True,capture_output=True,text=True,encoding='utf-8',timeout=90,
        user=uid.pw_uid,group=uid.pw_gid,extra_groups=[],env={'PATH':'/usr/bin:/bin','HOME':uid.pw_dir,'NODE_NO_WARNINGS':'1'},**kwargs)


def owned_work(parent,uid):
    require(parent.resolve()==parent and parent.parent==BASE and parent.name in {'account-backup-work','account-restore-work'},'Unsafe work root')
    parent.mkdir(mode=0o711,exist_ok=True);require(not parent.is_symlink() and parent.stat().st_uid==0,'Unsafe work parent')
    parent.chmod(0o711)
    path=parent/uuid.uuid4().hex;path.mkdir(mode=0o755);os.chown(path,uid.pw_uid,uid.pw_gid)
    return path


def cleanup_work(path):
    path=Path(path)
    require(path.resolve()==path and path.parent in {BASE/'account-backup-work',BASE/'account-restore-work',BASE/'ops/external-work'},'Refuse cleanup outside own work roots')
    require(len(path.name)==32 and all(c in '0123456789abcdef' for c in path.name),'Refuse unexpected work name')
    shutil.rmtree(path)


def copy_regular(source,target,mode=0o600):
    source=Path(source);require(source.is_file() and not source.is_symlink(),'Expected regular backup input')
    target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with target.open('xb') as out:
        out.write(source.read_bytes());out.flush();os.fsync(out.fileno())
    target.chmod(mode)


def control_sources():
    return {name:Path('/etc/systemd/system')/name for name in ['melodiajest-account.service','melodiajest-account-backup.service','melodiajest-account-backup.timer']}|{
        'account.env':BASE/'deploy/account.env','nginx.conf':BASE/'deploy/nginx.conf','compose.yaml':BASE/'deploy/compose.yaml'}


def describe_tree(root):
    result={}
    for path in root.rglob('*'):
        require(not path.is_symlink(),'Linked backup payload member')
        if path.is_file():result[path.relative_to(root).as_posix()]=artifact.descriptor(path.read_bytes())
    return result


def verify_payload(payload,retained=False):
    value=json.loads(artifact.regular_bytes(payload,'account-payload.json'))
    require(value.get('kind')=='melodiajest-account-payload' and value.get('version')==1,'Unknown account payload')
    actual=describe_tree(payload);actual.pop('account-payload.json')
    if retained:actual.pop('protection-receipt.json')
    require(actual==value['files'],'Account payload size/SHA256 mismatch')
    require(set(actual)=={'release.tar.gz','node.tar.xz','data/accounts.sqlite','data/session-secret','data/manifest.json','profile.json'}|{'controls/'+n for n in control_sources()},'Account payload allowlist mismatch')
    data=json.loads(artifact.regular_bytes(payload/'data','manifest.json'))
    require(data['dataDigest']==value['dataDigest'] and data['restoredUsersMustSignIn'] is True,'Account data identity mismatch')
    return value


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self,path):super().__init__('melodiajest.ru',timeout=10);self.path=str(path)
    def connect(self):self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(10);self.sock.connect(self.path)


def request(sock,route,method='GET',body=None,client=None):
    headers={'Host':'melodiajest.ru','X-Real-IP':'127.0.0.1'}
    if client:
        if client.get('cookie'):headers['Cookie']=client['cookie']
        if client.get('account'):headers['X-Melodiajest-Account']=client['account']
    raw=None
    if method!='GET':
        headers.update({'Origin':'https://melodiajest.ru','Content-Type':'application/json','X-Melodiajest-CSRF':(client or {}).get('csrf','')})
        raw=json.dumps(body).encode()
    connection=UnixHTTP(sock)
    try:
        connection.request(method,'/api/service/v1'+route,raw,headers);response=connection.getresponse();data=json.loads(response.read(6*1024*1024))
        if client is not None:
            if response.getheader('Set-Cookie'):client['cookie']=response.getheader('Set-Cookie').split(';')[0]
            if data.get('csrfToken'):client['csrf']=data['csrfToken']
            if 'user' in data:client['account']=(data['user'] or {}).get('id','')
        return response.status,data
    finally:connection.close()


def exercise_restore(payload,uid):
    """Uses only the externally restored bytes, never live source/data/runtime."""
    info=verify_payload(payload);work=owned_work(BASE/'account-restore-work',uid)
    try:
        # The daemon can traverse this disposable directory, but not the root-only
        # transport payload or production ops directory.
        work.chmod(0o755)
        copy_regular(payload/'node.tar.xz',work/'node.tar.xz',0o644)
        deployment.unpack_node(work/'node.tar.xz',work/'runtime')
        copy_regular(payload/'release.tar.gz',work/'release.tar.gz',0o644)
        staged=deployment.stage_sources(work/'sources',work/'release.tar.gz',info['archiveSha256'])
        node=work/'runtime/node';source=Path(staged['directory']);bundle=work/'bundle';bundle.mkdir(mode=0o700);os.chown(bundle,uid.pw_uid,uid.pw_gid)
        for name in ['accounts.sqlite','session-secret','manifest.json']:
            copy_regular(payload/'data'/name,bundle/name);os.chown(bundle/name,uid.pw_uid,uid.pw_gid)
        child(uid,[str(node),str(source/'service/backup.cjs'),'check',str(bundle)])
        isolate=work/'data';isolate.mkdir(mode=0o700);os.chown(isolate,uid.pw_uid,uid.pw_gid)
        result=child(uid,[str(node),str(source/'service/backup.cjs'),'restore-isolated',str(bundle),str(isolate),str(BASE/'account-data')])
        data=Path(json.loads(result.stdout)['directory']);sock=work/'api.sock'
        env={'PATH':'/usr/bin:/bin','HOME':uid.pw_dir,'NODE_NO_WARNINGS':'1','UV_THREADPOOL_SIZE':'2','NODE_ENV':'production','MELODIA_SERVICE_DATA_DIR':str(data),'MELODIA_SERVICE_ORIGIN':'https://melodiajest.ru','MELODIA_SERVICE_SOCKET':str(sock),'MELODIA_REGISTRATION_ENABLED':'1'}
        process=subprocess.Popen([str(node),str(source/'service/server.cjs')],user=uid.pw_uid,group=uid.pw_gid,extra_groups=[],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        try:
            for attempt in range(100):
                if sock.exists():break
                if process.poll() is not None:
                    error=process.stderr.read(4096).decode('utf-8',errors='replace')
                    code=re.search(r'Account API (?:startup|listener) failed: ([A-Za-z0-9_]+)',error)
                    raise RuntimeError('Restored API exited: '+(code.group(1) if code else str(process.returncode)))
                time.sleep(0.05)
            status,health=request(sock,'/health');require(status==200 and health['implementationSha256']==staged['manifest']['sourceSha256'],'Restored code/runtime health mismatch')
            one={};two={}
            for client in [one,two]:
                require(request(sock,'/session',client=client)[0]==200,'Restored session failed')
                status,registered=request(sock,'/auth/register','POST',{'username':'restore_'+uuid.uuid4().hex[:16],'displayName':'Isolated recovery check','password':secrets.token_urlsafe(32)},client)
                require(status==200 and len(registered.get('recoveryCode',''))==43,'Restored registration failed')
            status,prefs=request(sock,'/preferences','PUT',{'expectedRevision':0,'raw':'{"materialMode":"expanded"}'},one)
            require(status==200,'Restored personal write failed')
            status,other=request(sock,'/preferences',client=two);require(status==200 and other.get('raw') is None,'Cross-user private data leaked')
            forged=dict(two);forged['account']=one['account']
            require(request(sock,'/preferences',client=forged)[0]==409,'Forged restored owner accepted')
            return {'verifiedAt':now(),'sha256AndSizesVerified':True,'sqliteIntegrityAndDataDigest':True,'restoredRuntimeExecuted':True,'separateUsers':2,'forgedOwnerRejected':True,'sourceSha256':staged['manifest']['sourceSha256'],'productionDataUsed':False,'productionVolumesMounted':False,'sessionsRestored':False}
        finally:
            process.terminate()
            try:process.wait(timeout=15)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
    finally:cleanup_work(work)


def run(force_restore=False):
    if json.loads(PROFILE.read_text()).get('version')==2:
        import postgres_backup
        return postgres_backup.run(force_restore)
    value,uid,source=profile();home=private(HOME);transport.validate_configuration(transport.configuration())
    # Same ordering as the existing S3 scheduler. All own and shared mutations
    # still acquire the established Libreta + MelodiaJest locks.
    with backup.worker_lock(BASE/'ops/external-s3/scheduled'),update.operation_locks(BASE):
        update.ensure_idle(BASE)
        state={'kind':'melodiajest-account-protection','version':1,'startedAt':now(),'status':'started'}
        deployment.save(home/'latest-attempt.json',state)
        work=None;transport_work=None
        try:
            work=owned_work(BASE/'account-backup-work',uid)
            result=child(uid,[str(Path(value['nodeDirectory'])/'node'),str(BASE/'account-service/current/service/backup.cjs'),'backup',str(BASE/'account-data'),str(work)])
            bundle=Path(json.loads(result.stdout)['directory']);manifest=json.loads((bundle/'manifest.json').read_text())
            controls={name:artifact.descriptor(artifact.regular_bytes(path.parent,path.name)) for name,path in control_sources().items()}
            fingerprint=sha(json.dumps({'data':manifest['dataDigest'],'secret':manifest['files']['session-secret']['sha256'],'source':source['sourceSha256'],'archive':value['archiveSha256'],'node':value['nodeArchiveSha256'],'controls':controls},sort_keys=True,separators=(',',':')).encode())
            old=json.loads((home/'latest-success.json').read_text()) if (home/'latest-success.json').exists() else None
            if old and old['fingerprint']==fingerprint and not force_restore and age(old['restore']['verifiedAt'])<7*86400:
                state={**old,'checkedAt':now(),'status':'unchanged-confirmed','newSnapshotCreated':False,'unchangedDataConfirmedByOnlineCopy':True}
                deployment.save(home/'latest-attempt.json',state);deployment.save(home/'latest-success.json',state)
                return state
            root=private(BASE/'ops/external-work');transport_work=private(root/uuid.uuid4().hex)
            payload=private(transport_work/'payload');data=private(payload/'data')
            for name in ['accounts.sqlite','session-secret','manifest.json']:copy_regular(bundle/name,data/name)
            copy_regular(value['archive'],payload/'release.tar.gz');copy_regular(value['nodeArchive'],payload/'node.tar.xz');copy_regular(PROFILE,payload/'profile.json')
            for name,path in control_sources().items():copy_regular(path,payload/'controls'/name)
            info={'kind':'melodiajest-account-payload','version':1,'createdAt':now(),'dataDigest':manifest['dataDigest'],'fingerprint':fingerprint,'archiveSha256':value['archiveSha256'],'sourceSha256':source['sourceSha256'],'files':describe_tree(payload)}
            deployment.save(payload/'account-payload.json',info);verify_payload(payload)
            cache=private(transport_work/'backup-cache');credentials=transport.resolve_credentials();password=Path(transport.PASSWORD_FILE).read_bytes();transport.password_value(password)
            copied=transport.run(transport.configuration(),'backup',credentials,password,cache=str(cache),source=str(payload),kit_sha=sha((payload/'account-payload.json').read_bytes()),checkout_sha=value['archiveSha256'])
            require(copied['exitCode']==0,'External account copy failed')
            summaries=[r for r in copied['result'] if r.get('message_type')=='summary' and r.get('snapshot_id')]
            require(len(summaries)==1,'Missing account copy summary')
            snapshot=summaries[0]['snapshot_id'];require(len(snapshot)==64,'Missing account snapshot ID')
            state.update(status='external-copy-created-restore-pending',snapshot=snapshot,copyCreatedAt=now(),fingerprint=fingerprint,copyMetrics=copied)
            deployment.save(home/'latest-attempt.json',state)
            # Fresh cache and no original payload under its previous name.
            parked=transport_work/'parked';os.rename(payload,parked)
            destination=private(transport_work/'restored');coldcache=private(transport_work/'restore-cache')
            restored=transport.run(transport.configuration(),'restore',credentials,password,cache=str(coldcache),destination=str(destination),snapshot=snapshot)
            require(restored['exitCode']==0,'External account read/decryption failed')
            observed=verify_payload(destination/'payload');require(observed==info,'Restored account manifest differs')
            proof=exercise_restore(destination/'payload',uid)
            retained=home/('verified-'+uuid.uuid4().hex);os.rename(parked,retained)
            state={'kind':'melodiajest-account-protection','version':1,'status':'verified','createdAt':now(),'checkedAt':now(),'fingerprint':fingerprint,'sourceSha256':source['sourceSha256'],'dataDigest':manifest['dataDigest'],'snapshot':snapshot,'localPayload':str(retained),'newSnapshotCreated':True,'filesVerified':len(info['files']),'payloadBytes':sum(f['bytes'] for f in info['files'].values()),'copyMetrics':copied,'restoreMetrics':restored,'restore':proof,'billingMeasured':False,'retention':'latest three verified local payloads; no external deletion'}
            deployment.save(retained/'protection-receipt.json',state)
            deployment.save(home/'latest-success.json',state);deployment.save(home/'latest-attempt.json',state)
            # Bounded local rotation, only allowlisted, previously verified own
            # payloads. Do not touch snapshots, releases, foreign paths or data.
            candidates=sorted([p for p in home.glob('verified-*') if p.is_dir() and not p.is_symlink()],key=lambda p:p.stat().st_mtime,reverse=True)
            for obsolete in candidates[3:]:
                require(obsolete.resolve().parent==home and len(obsolete.name)==41,'Unsafe rotation path')
                receipt=json.loads(artifact.regular_bytes(obsolete,'protection-receipt.json'));require(receipt['status']=='verified' and receipt['restore']['productionDataUsed'] is False,'Unverified rotation candidate')
                verify_payload(obsolete,retained=True)
                for item in sorted(obsolete.rglob('*'),key=lambda p:len(p.parts),reverse=True):
                    require(not item.is_symlink(),'Linked rotation member')
                    item.unlink() if item.is_file() else item.rmdir()
                obsolete.rmdir()
            return state
        except Exception as error:
            state.update(status='failed',failedAt=now(),errorType=type(error).__name__)
            deployment.save(home/'latest-attempt.json',state)
            raise
        finally:
            if work is not None:cleanup_work(work)
            if transport_work is not None:cleanup_work(transport_work)


if __name__=='__main__':
    try:
        require(sys.argv[1:] in [['run'],['run','--force-restore']],'Usage: account_backup.py run [--force-restore]')
        result=run('--force-restore' in sys.argv)
        print(json.dumps({k:result[k] for k in ['status','checkedAt','newSnapshotCreated','snapshot','filesVerified','payloadBytes','restore','billingMeasured']},sort_keys=True))
    except Exception as error:
        print(json.dumps({'status':'failed','errorType':type(error).__name__,'message':str(error)[:500]}),file=sys.stderr);sys.exit(1)
