"""Independent own PostgreSQL copies with a real isolated recovery exercise.

One exported MVCC snapshot binds pg_dump and the logical data digest. The image,
Node, pg dependency kit, exact API source and own configs travel with the dump.
No production restore, foreign mount, snapshot deletion or global prune exists.
"""
from contextlib import ExitStack
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import time
import uuid

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'service'));sys.path.insert(0,str(ROOT/'deploy/shared-host'))
import account_backup as legacy
import deployment
import postgres as pg
import postgres_image as images
import release_update as update
import release_artifact as artifact
import release_backup as base_backup
import backup_s3_runtime as transport

BASE=Path('/opt/melodiajest');HOME=BASE/'ops/account-postgres-backups';require=artifact.require
CONTROLS=['melodiajest-account.service','melodiajest-account-backup.service','melodiajest-account-backup.timer','melodiajest-postgres.service','account.env','nginx.conf','compose.yaml','postgres.compose.yaml','postgres-config/postgresql.conf','postgres-config/pg_hba.conf','postgres-config/pg_ident.conf']
DATA=['postgres.dump','snapshot.json','session-secret','postgres-password','postgres.json','postgres-bootstrap']
CORE={'release.tar.gz','node.tar.xz','pg-dependencies.tar.gz','postgres-image.tar.gz','profile.json'}|{'data/'+name for name in DATA}|{'controls/'+name for name in CONTROLS}


def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def age(value):return (dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(value)).total_seconds()


def copy(source,target,*,immutable=False):
    source=Path(source);target=Path(target);require(not source.is_symlink() and source.is_file() and not target.exists(),'Expected immutable regular copy input')
    target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if immutable:
        require(source.is_relative_to(BASE/'ops/postgres-runtime') and source.stat().st_uid==0,'Only own verified immutable image may be hard-linked locally')
        os.link(source,target)
    else:
        with source.open('rb') as inp,target.open('xb') as out:shutil.copyfileobj(inp,out,1024*1024);out.flush();os.fsync(out.fileno())
        target.chmod(0o600)


def tree(root):
    result={}
    for path in root.rglob('*'):
        require(not path.is_symlink(),'Linked private payload member')
        if path.is_file():result[path.relative_to(root).as_posix()]=images.descriptor(path)
    return result


def profile(path):
    require(os.name=='posix' and os.geteuid()==0 and BASE.resolve()==BASE,'Own production root context required')
    import pwd
    path=Path(path);require(path in {BASE/'ops/account-profile.json',BASE/'ops/postgres-preparation-profile.json'} and not path.is_symlink(),'Unknown own PostgreSQL profile')
    value=json.loads(path.read_text());require(value.get('kind')=='melodiajest-account-profile' and value.get('version')==2 and value.get('engine')=='postgres','Unknown PostgreSQL account profile')
    require(value.get('standby') is (path.name=='postgres-preparation-profile.json'),'Profile mode differs')
    for key in ['archive','nodeArchive','dependenciesArchive','imageArchive','tooling']+(['previousArchive'] if value.get('previousArchive') else []):
        item=Path(value[key]);require(item.is_absolute() and item.resolve()==item and item.is_relative_to(BASE/'ops') and not item.is_symlink(),'Unsafe PostgreSQL profile path')
    for key in ['archive','nodeArchive','dependenciesArchive','imageArchive']:require(images.descriptor(value[key])['sha256']==value[key+'Sha256'],'Profile archive changed: '+key)
    require(Path(value['tooling'])==ROOT,'Wrong PostgreSQL worker version');deployment.verify_node(value['nodeDirectory'])
    _,source=deployment.source_plan(value['archive'],value['archiveSha256']);require(source['dataSchemaVersion']==2 and source['sourceSha256']==value['sourceSha256'],'Wrong PostgreSQL source')
    pg.verify_container();require(value['postgresImageId']==pg.PIN['imageId'],'Wrong PostgreSQL image pin')
    if value['standby']:require(not (BASE/'account-data/postgres.json').exists(),'Standby preparation must precede active PostgreSQL config')
    else:
        active=deployment.verify_sources(BASE/'account-service'/deployment.pointer(BASE/'account-service'))
        require(active['sourceSha256']==source['sourceSha256'],'Account code changed without its PostgreSQL protection profile')
        require(json.loads((BASE/'account-data/postgres.json').read_text())==pg.client_configuration(),'Active own database config differs')
    uid=pwd.getpwnam('melodiajest-account');data=BASE/'account-data'
    require(uid.pw_uid>0 and uid.pw_gid>0 and uid.pw_dir==str(data) and data.resolve()==data and data.stat().st_uid==uid.pw_uid and data.stat().st_mode&0o777==0o700,'Unsafe own account identity/data directory')
    for name in ['session-secret','postgres-password']:
        item=data/name;require(item.is_file() and not item.is_symlink() and item.stat().st_uid==uid.pw_uid and item.stat().st_mode&0o077==0,'Unsafe private account secret permissions')
    return value,uid,source


def verify_payload(payload,retained=False):
    metadata=json.loads(artifact.regular_bytes(payload,'account-payload.json'));require(metadata.get('kind')=='melodiajest-postgres-payload' and metadata.get('version')==2,'Unknown PostgreSQL payload')
    observed=tree(payload);observed.pop('account-payload.json')
    if retained:observed.pop('protection-receipt.json')
    expected=CORE|({'previous-release.tar.gz'} if metadata.get('previousArchiveSha256') else set())
    require(set(observed)==expected and observed==metadata['files'],'PostgreSQL payload file/size/SHA256 mismatch')
    snapshot=json.loads(artifact.regular_bytes(payload/'data','snapshot.json'));require(snapshot['consistentSnapshot'] is True and snapshot['restoredUsersMustSignIn'] is True and snapshot['digest']==metadata['dataDigest'] and snapshot['exported']==observed['data/postgres.dump'],'PostgreSQL snapshot identity differs')
    require(json.loads(artifact.regular_bytes(payload/'data','postgres.json'))==pg.client_configuration(),'Restored own database config differs')
    return metadata


def node_environment(dependencies):
    return {'PATH':'/usr/bin:/bin','HOME':'/root','NODE_NO_WARNINGS':'1','NODE_PATH':str(Path(dependencies)/'node_modules'),'PYTHONDONTWRITEBYTECODE':'1','DOCKER_HOST':'unix:///var/run/docker.sock','DOCKER_CONFIG':str(BASE/'ops/docker-client')}


def source_paths(value):
    sources=BASE/'account-service'
    if not value['standby']:return sources/deployment.pointer(sources)
    return Path(deployment.stage_sources(BASE/'account-postgres-staging',value['archive'],value['archiveSha256'])['directory'])


def control_sources():
    return {name:(Path('/etc/systemd/system')/name if name.endswith('.service') or name.endswith('.timer') else BASE/'deploy'/name) for name in CONTROLS}


def dependency_tool():
    spec=importlib.util.spec_from_file_location('melodiajest_dependency_package',ROOT/'tools/package-service-dependencies.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def stop_owned(name,role):
    observed=subprocess.run(['docker','inspect',name],text=True,capture_output=True,timeout=10)
    if observed.returncode:return
    value=json.loads(observed.stdout)[0];require(value['Config']['Labels'].get('com.melodiajest.role')==role,'Refuse to stop another container')
    subprocess.run(['docker','stop','--time','10',value['Id']],check=True,capture_output=True,timeout=20)
    for attempt in range(50):
        if subprocess.run(['docker','inspect',value['Id']],capture_output=True,timeout=10).returncode:return
        time.sleep(.1)
    raise RuntimeError('Own restore container did not disappear')


def neighbors():
    # The scheduled host worker deliberately has only AF_UNIX and a private
    # network. As with its S3 transport, the daemon runs the bounded HTTPS
    # probe in a disposable container, with no mounts or credentials.
    hosts=['libreta.ru','praicer.ru','grigorova.libreta.ru'];name='melodiajest-neighbors-'+uuid.uuid4().hex[:12]
    script="import json,urllib.request; hosts="+repr(hosts)+"; result={};\nfor host in hosts:\n with urllib.request.urlopen('https://'+host+'/',timeout=15) as response:\n  assert response.status==200; result[host]=response.status\nprint(json.dumps(result))"
    command=['docker','run','--rm','--pull','never','--name',name,'--label','com.melodiajest.role=neighbor-health','--network','bridge','--read-only','--user','65534:65534','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','64m','--cpus','0.2','--pids-limit','32','--entrypoint','python3',transport.IMAGE,'-c',script]
    try:
        result=subprocess.run(command,capture_output=True,text=True,timeout=70);require(result.returncode==0,'Neighbor HTTPS probe failed')
        statuses=json.loads(result.stdout);require(statuses=={host:200 for host in hosts},'Neighbor status differs');return statuses
    finally:stop_owned(name,'neighbor-health')


def exercise_restore(payload,uid):
    metadata=verify_payload(payload);work=legacy.owned_work(BASE/'account-restore-work',uid);work.chmod(0o755)
    pg_name='melodiajest-pg-restore-'+work.name[:12];api_name='melodiajest-api-restore-'+work.name[:12]
    try:
        image_proof=images.load(payload/'postgres-image.tar.gz')
        copy(payload/'node.tar.xz',work/'node.tar.xz');deployment.unpack_node(work/'node.tar.xz',work/'runtime')
        copy(payload/'release.tar.gz',work/'release.tar.gz');staged=deployment.stage_sources(work/'sources',work/'release.tar.gz',metadata['archiveSha256']);source=Path(staged['directory']);(source/'service/node_modules').mkdir(exist_ok=True)
        dependencies=work/'dependencies';dependency_tool().restore(payload/'pg-dependencies.tar.gz',dependencies,metadata['files']['pg-dependencies.tar.gz']['sha256'])
        data=work/'data';data.mkdir(mode=0o700);os.chown(data,uid.pw_uid,uid.pw_gid)
        for name in ['session-secret','postgres-password','postgres.json']:
            copy(payload/'data'/name,data/name);os.chown(data/name,uid.pw_uid,uid.pw_gid)
        pgdata=work/'pgdata';pgdata.mkdir(mode=0o700);os.chown(pgdata,999,999)
        pgsocket=work/'pgsocket';pgsocket.mkdir(mode=0o755);pgsocket.chmod(0o755);os.chown(pgsocket,999,999)
        http_socket=work/'http';http_socket.mkdir(mode=0o755);http_socket.chmod(0o755);os.chown(http_socket,uid.pw_uid,uid.pw_gid)
        configs=work/'pgconfig';configs.mkdir(mode=0o755);configs.chmod(0o755)
        for name in pg.configuration():copy(payload/'controls/postgres-config'/name,configs/name);(configs/name).chmod(0o644)
        bootstrap=work/'bootstrap';copy(payload/'data/postgres-bootstrap',bootstrap);os.chown(bootstrap,999,999)
        # Every mount comes from this disposable restore directory, never from
        # /opt/melodiajest/postgres-data or another application's volume.
        command=['docker','run','-d','--rm','--pull','never','--name',pg_name,'--label','com.melodiajest.role=postgres-restore','--network','none','--read-only','--user','999:999','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','256m','--cpus','0.5','--pids-limit','96','--shm-size','64m','--tmpfs','/tmp:rw,mode=1777,size=16m','--tmpfs','/var/run/postgresql:rw,uid=999,gid=999,mode=2775,size=4m']
        for origin,target,readonly in [(pgdata,'/var/lib/postgresql',False),(pgsocket,pg.SOCKET,False),(configs,'/etc/melodiajest-postgres',True),(bootstrap,'/run/secrets/melodiajest-bootstrap',True)]:command+=['--mount','type=bind,source='+str(origin)+',target='+target+(',readonly' if readonly else '')]
        command+=['--env','POSTGRES_USER=melodiajest_admin','--env','POSTGRES_DB=melodiajest','--env','POSTGRES_PASSWORD_FILE=/run/secrets/melodiajest-bootstrap','--env','POSTGRES_INITDB_ARGS=--locale=C.UTF-8 --encoding=UTF8 --auth-local=peer --auth-host=scram-sha-256',pg.PIN['imageId'],'postgres','-c','config_file=/etc/melodiajest-postgres/postgresql.conf','-c','shared_buffers=32MB']
        subprocess.run(command,check=True,capture_output=True,timeout=30);pg.wait(pg_name);pg.prepare_roles((data/'postgres-password').read_text().strip(),container=pg_name)
        with (payload/'data/postgres.dump').open('rb') as dump:
            restored=subprocess.run(['docker','exec','--user','postgres','-i',pg_name,'pg_restore','-h',pg.SOCKET,'-U','melodiajest_owner','-d','melodiajest','--no-owner','--no-acl','--exit-on-error'],stdin=dump,capture_output=True,timeout=120)
        require(restored.returncode==0,'Isolated PostgreSQL restore failed');pg.grants(container=pg_name)
        cli=['docker','run','--rm','--pull','never','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m','--cpus','0.7','--pids-limit','64','--user',str(uid.pw_uid)+':'+str(uid.pw_gid),'--mount','type=bind,source='+str(source)+',target=/app,readonly','--mount','type=bind,source='+str(work/'runtime')+',target=/node,readonly','--mount','type=bind,source='+str(dependencies/'node_modules')+',target=/app/service/node_modules,readonly','--mount','type=bind,source='+str(data)+',target=/opt/melodiajest/account-data,readonly','--mount','type=bind,source='+str(pgsocket)+',target='+pg.SOCKET+',readonly','--entrypoint','/node/node',pg.PIN['imageId']]
        inspect="const {PostgresDatabase}=require('/app/service/database.cjs'),M=require('/app/service/migration.cjs'),C=require('/app/service/db-config.cjs');(async()=>{const config=C.loadPostgresConfig(C.CONFIG),db=new PostgresDatabase(config);try{const data=M.describe((await M.exportPostgres(db)).tables,{excludeVolatile:true});let denied=false;try{await db.execute('run','CREATE TABLE forbidden_fixture(id text)');}catch(error){denied=error.code==='42501';}if(!denied)throw Error('App role has DDL access');const wrong=new PostgresDatabase({...config,password:'invalid-isolated-fixture-password'});let passwordDenied=false;try{await wrong.execute('get','SELECT 1');}catch(error){passwordDenied=error.code==='28P01';}finally{await wrong.close();}if(!passwordDenied)throw Error('Wrong database password accepted');console.log(JSON.stringify({...data,ddlDenied:denied,passwordDenied}));}finally{await db.close();}})().catch(()=>{process.exitCode=1;});"
        inspected=subprocess.run(cli+['--eval',inspect],text=True,capture_output=True,timeout=120);require(inspected.returncode==0,'Restored data/least-privilege inspection failed');logical=json.loads(inspected.stdout.strip());require(logical['digest']==metadata['dataDigest'],'Restored PostgreSQL logical digest differs')
        pg.sql('DELETE FROM sessions; DELETE FROM rate_limits;',role='melodiajest_owner',database='melodiajest',container=pg_name)
        api_command=cli[:];api_command[2:2]=['-d','--name',api_name,'--label','com.melodiajest.role=api-restore']
        # Replace the data mount with RW and add a separate disposable HTTP UDS.
        api_command=[value[:-9] if value=='type=bind,source='+str(data)+',target=/opt/melodiajest/account-data,readonly' else value for value in api_command]
        image_index=api_command.index('--entrypoint');api_command[image_index:image_index]=['--mount','type=bind,source='+str(http_socket)+',target=/run/melodiajest-account','--env','MELODIA_SERVICE_DATA_DIR=/opt/melodiajest/account-data','--env','MELODIA_SERVICE_ORIGIN=https://melodiajest.ru','--env','MELODIA_SERVICE_SOCKET=/run/melodiajest-account/api.sock','--env','MELODIA_POSTGRES_CONFIG=/opt/melodiajest/account-data/postgres.json','--env','MELODIA_REGISTRATION_ENABLED=1','--env','NODE_NO_WARNINGS=1','--env','UV_THREADPOOL_SIZE=2']
        subprocess.run(api_command+['/app/service/server.cjs'],check=True,capture_output=True,timeout=30)
        sock=http_socket/'api.sock'
        for attempt in range(150):
            if sock.exists():break
            time.sleep(.1)
        status,health=legacy.request(sock,'/health');require(status==200 and health['engine']=='postgres' and health['implementationSha256']==metadata['sourceSha256'],'Restored code/runtime/database health differs')
        first={};second={}
        for client in [first,second]:
            require(legacy.request(sock,'/session',client=client)[0]==200,'Restored session failed')
            status,registered=legacy.request(sock,'/auth/register','POST',{'username':'restore_'+uuid.uuid4().hex[:14],'displayName':'Disposable restore check','password':'isolated recovered music account phrase'},client)
            require(status==200 and len(registered.get('recoveryCode',''))==43,'Restored registration failed')
        require(legacy.request(sock,'/preferences','PUT',{'expectedRevision':0,'raw':'{"restoreFixture":true}'},first)[0]==200,'Restored private write failed')
        require(legacy.request(sock,'/preferences',client=first)[1].get('raw')=='{"restoreFixture":true}','Restored private write readback failed')
        require(legacy.request(sock,'/preferences',client=second)[1].get('raw') is None,'Restored owner boundary failed')
        forged={**second,'account':first['account']};require(legacy.request(sock,'/preferences',client=forged)[0]==409,'Restored forged-owner denial failed')
        require(legacy.request(sock,'/learning/state',client=first)[1]['completed']==0,'New restored user inherited another progress')
        return {'productionDataUsed':False,'productionVolumesMounted':False,'network':'none','postgresImageImported':True,'imageBlobsVerified':image_proof['blobsVerified'],'daemonLayerReusePossible':True,'nodeFromRestoredArchive':True,'pgDependenciesFromRestoredArchive':True,'sourceSha256':metadata['sourceSha256'],'dataDigestMatched':True,'ddlDenied':True,'wrongPasswordDenied':True,'restoredSessionsRevoked':True,'apiHealth':'ok','twoUsersRegistered':True,'privateWriteReadback':True,'forgedOwnerDenied':True,'syntheticMidiDeviceUsed':False}
    finally:
        stop_owned(api_name,'api-restore');stop_owned(pg_name,'postgres-restore');legacy.cleanup_work(work)


def run(force_restore=False,profile_path=BASE/'ops/account-profile.json'):
    value,uid,source=profile(profile_path);home=legacy.private(HOME);state={'kind':'melodiajest-postgres-protection','version':2,'status':'started','startedAt':now(),'standby':value['standby']};work=None;transport_work=None
    with ExitStack() as stack:
        stack.enter_context(base_backup.worker_lock(BASE/'ops/external-s3/scheduled'))
        stack.enter_context(update.operation_locks(BASE));update.ensure_idle(BASE);neighbors()
        try:
            deployment.save(home/'latest-attempt.json',state);work=legacy.owned_work(BASE/'account-backup-work',uid);work.chmod(0o700);os.chown(work,0,0)
            dump=work/'postgres.dump';env=node_environment(value['dependenciesDirectory']);snapshot_run=subprocess.run([str(Path(value['nodeDirectory'])/'node'),str(source_paths(value)/'service/pg-snapshot.cjs'),str(dump)],text=True,capture_output=True,timeout=150,env=env)
            require(snapshot_run.returncode==0,'Consistent own PostgreSQL snapshot failed');snapshot=json.loads(snapshot_run.stdout.strip());deployment.save(work/'snapshot.json',snapshot)
            controls={name:images.descriptor(path) for name,path in control_sources().items()}
            private_files={name:images.descriptor(BASE/'account-data'/name) for name in ['session-secret','postgres-password']}
            fingerprint=hashlib.sha256(json.dumps({'data':snapshot['digest'],'source':source['sourceSha256'],'archives':{name:value[name+'Sha256'] for name in ['archive','nodeArchive','dependenciesArchive','imageArchive']},'previous':value.get('previousArchiveSha256'),'controls':controls,'private':private_files,'standby':value['standby']},sort_keys=True,separators=(',',':')).encode()).hexdigest()
            if (home/'latest-success.json').exists():
                last=json.loads((home/'latest-success.json').read_text())
                if not force_restore and last.get('fingerprint')==fingerprint and age(last['restoredAt'])<7*86400:
                    verify_payload(Path(last['localPayload']),retained=True);last.update(checkedAt=now(),newSnapshotCreated=False,dataComparedAt=now());deployment.save(home/'latest-attempt.json',last);deployment.save(home/'latest-success.json',last);return last
            require(shutil.disk_usage(BASE).free>800*1024*1024,'Insufficient free disk for independent PostgreSQL recovery')
            transport_work=legacy.private(BASE/'ops/external-work'/uuid.uuid4().hex);payload=legacy.private(transport_work/'payload')
            for key,target in [('archive','release.tar.gz'),('nodeArchive','node.tar.xz'),('dependenciesArchive','pg-dependencies.tar.gz'),('imageArchive','postgres-image.tar.gz')]:copy(value[key],payload/target,immutable=key=='imageArchive')
            if value.get('previousArchive'):
                require(images.descriptor(value['previousArchive'])['sha256']==value['previousArchiveSha256'],'Previous API archive changed');copy(value['previousArchive'],payload/'previous-release.tar.gz')
            copy(dump,payload/'data/postgres.dump');copy(work/'snapshot.json',payload/'data/snapshot.json')
            for name in ['session-secret','postgres-password']:copy(BASE/'account-data'/name,payload/'data'/name)
            deployment.save(payload/'data/postgres.json',pg.client_configuration());copy(BASE/'ops/secrets/postgres-bootstrap',payload/'data/postgres-bootstrap');deployment.save(payload/'profile.json',value)
            for name,path in control_sources().items():copy(path,payload/'controls'/name)
            metadata={'kind':'melodiajest-postgres-payload','version':2,'createdAt':now(),'fingerprint':fingerprint,'dataDigest':snapshot['digest'],'archiveSha256':value['archiveSha256'],'previousArchiveSha256':value.get('previousArchiveSha256'),'sourceSha256':source['sourceSha256'],'standby':value['standby'],'files':tree(payload)};deployment.save(payload/'account-payload.json',metadata);verify_payload(payload)
            credentials=transport.resolve_credentials();password=Path(transport.PASSWORD_FILE).read_bytes();transport.password_value(password)
            copied=transport.run(transport.configuration(),'backup',credentials,password,cache=str(legacy.private(transport_work/'backup-cache')),source=str(payload),kit_sha=images.descriptor(payload/'account-payload.json')['sha256'],checkout_sha=value['archiveSha256']);require(copied['exitCode']==0,'Independent PostgreSQL copy failed')
            summaries=[record for record in copied['result'] if record.get('message_type')=='summary' and record.get('snapshot_id')];require(len(summaries)==1,'Missing PostgreSQL backup snapshot')
            snapshot_id=summaries[0]['snapshot_id'];require(re.fullmatch('[a-f0-9]{64}',snapshot_id),'Invalid independent snapshot ID')
            state.update(status='copy-created-restore-pending',snapshot=snapshot_id,copyCreatedAt=now(),fingerprint=fingerprint);deployment.save(home/'latest-attempt.json',state)
            parked=transport_work/'parked';os.rename(payload,parked);restored_root=legacy.private(transport_work/'restored')
            restored=transport.run(transport.configuration(),'restore',credentials,password,cache=str(legacy.private(transport_work/'restore-cache')),destination=str(restored_root),snapshot=snapshot_id);require(restored['exitCode']==0,'Independent PostgreSQL read/decryption failed');require(verify_payload(restored_root/'payload')==metadata,'Independently restored PostgreSQL payload differs')
            proof=exercise_restore(restored_root/'payload',uid);neighbors()
            retained=home/('verified-'+uuid.uuid4().hex);os.rename(parked,retained)
            state={'kind':'melodiajest-postgres-protection','version':2,'status':'verified','standby':value['standby'],'checkedAt':now(),'restoredAt':now(),'copyCreatedAt':state['copyCreatedAt'],'dataComparedAt':now(),'fingerprint':fingerprint,'sourceSha256':source['sourceSha256'],'dataDigest':metadata['dataDigest'],'snapshot':snapshot_id,'localPayload':str(retained),'newSnapshotCreated':True,'filesVerified':len(metadata['files']),'payloadBytes':sum(item['bytes'] for item in metadata['files'].values()),'copyMetrics':copied,'restoreMetrics':restored,'restore':proof,'billingMeasured':False,'retention':'latest three verified own local payloads; immutable local image hard-links; no external deletion'}
            deployment.save(retained/'protection-receipt.json',state);deployment.save(home/'latest-success.json',state);deployment.save(home/'latest-attempt.json',state)
            candidates=sorted([path for path in home.glob('verified-*') if path.is_dir() and not path.is_symlink()],key=lambda path:path.stat().st_mtime,reverse=True)
            for obsolete in candidates[3:]:
                require(obsolete.resolve().parent==home and len(obsolete.name)==41,'Unsafe own PostgreSQL rotation candidate');receipt=json.loads(artifact.regular_bytes(obsolete,'protection-receipt.json'));require(receipt['status']=='verified' and receipt['restore']['productionVolumesMounted'] is False,'Unverified PostgreSQL rotation candidate');verify_payload(obsolete,retained=True)
                for item in sorted(obsolete.rglob('*'),key=lambda path:len(path.parts),reverse=True):require(not item.is_symlink(),'Linked rotation member');item.unlink() if item.is_file() else item.rmdir()
                obsolete.rmdir()
            return state
        except Exception as error:
            state.update(status='failed',failedAt=now(),errorType=type(error).__name__);deployment.save(home/'latest-attempt.json',state);raise
        finally:
            if work is not None:legacy.cleanup_work(work)
            if transport_work is not None:legacy.cleanup_work(transport_work)


if __name__=='__main__':
    try:
        require(sys.argv[1:] in [['run'],['run','--force-restore'],['prepare-standby']],'Usage: postgres_backup.py run [--force-restore] | prepare-standby')
        result=run('--force-restore' in sys.argv,BASE/'ops/postgres-preparation-profile.json' if 'prepare-standby' in sys.argv else BASE/'ops/account-profile.json')
        print(json.dumps({key:result[key] for key in ['status','standby','checkedAt','newSnapshotCreated','snapshot','filesVerified','payloadBytes','restore','billingMeasured']},sort_keys=True))
    except Exception as error:print(json.dumps({'status':'failed','errorType':type(error).__name__,'message':str(error)[:300]}),file=sys.stderr);sys.exit(1)
