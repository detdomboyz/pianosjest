"""Manual, checkpointed external backup and cold restore; own namespace only.

prepare/backup are server operations. restore requires a password recovered from
the independent Windows DPAPI copy on stdin; it never reads the VPS password.
This CLI does not install a timer, prune, change policies, or restore production.
"""
import argparse,base64,bz2,datetime,hashlib,json,os,re,shutil,subprocess,sys,uuid
from pathlib import Path
import backup_s3_runtime as runtime
import backup_replica as replica
import release_artifact as artifact
import release_backup as backup
import release_update as update

BASE=Path('/opt/melodiajest');OPS=BASE/'ops';STATE=OPS/'external-s3'
require=runtime.require
SCHEDULE_TOOL_FILES={'deploy/shared-host/'+name for name in ['backup_s3_schedule.py','backup_s3_runtime.py','backup_s3_job.py','backup_replica.py','backup_units.py','release_backup.py','release_update.py','release_artifact.py','public-assets.json']}|{'tools/melodiajest_secret.py','tests/backup_s3_runtime_test.py','tests/backup_s3_schedule_test.py'}
SCHEDULE_CONTROL_NAMES={'config/'+name+'.json' for name in ['s3-schedule','s3-backup','restic-runtime','password-copy-receipt','external-repository']}|{'tooling/'+name for name in SCHEDULE_TOOL_FILES}|{'systemd/melodiajest-'+name+'.service.d/20-external-s3.conf' for name in ['backup','restore-check','backup-health']}

def private_directory(path):
    path.mkdir(mode=0o700,parents=True,exist_ok=True)
    require(path.resolve()==path and path.is_dir() and not path.is_symlink() and path.stat().st_uid==0 and path.stat().st_mode&0o077==0,'own root-private directory required')
    return path

def save(path,value):
    require(path.parent.resolve()==path.parent and not path.is_symlink(),'unsafe receipt path')
    raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode();tmp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
    with tmp.open('xb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
    tmp.chmod(0o600);os.replace(tmp,path)
    if os.name=='posix':update.sync_directory(path.parent)

def read(path):return json.loads(artifact.regular_bytes(path.parent,path.name))
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()

def work_directory(token):
    require(re.fullmatch(r'payload-[a-f0-9]{16}',token or ''),'invalid own work token')
    return private_directory(OPS/'external-work'/token)

def schedule_controls(raw,destination=None):
    require(type(raw) is bytes and len(raw)<=2*1024*1024,'oversized schedule controls')
    meta=json.loads(raw);require(meta.get('format')=='melodiajest-s3-controls-v1' and set(meta.get('files',{}))==SCHEDULE_CONTROL_NAMES,'unexpected schedule control names')
    files={}
    for name,entry in meta['files'].items():
        require(type(entry) is dict and set(entry)=={'sha256','bytes','data'} and type(entry['bytes']) is int,'invalid schedule control descriptor')
        data=base64.b64decode(entry['data'],validate=True);require(artifact.descriptor(data)=={k:entry[k] for k in ['sha256','bytes']},'schedule control checksum differs');files[name]=data
    if destination is not None:
        require(not destination.exists() and not destination.is_symlink(),'schedule restore destination must be new');private_directory(destination)
        for name,data in files.items():
            p=destination/name;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);require(p.parent.resolve()==p.parent,'linked schedule restore directory')
            with p.open('xb') as out:out.write(data)
            p.chmod(0o600);require(p.read_bytes()==data,'restored schedule control differs')
    return len(files)

def verify_payload(path,expected):
    require(runtime.SHA.fullmatch(expected or ''),'expected payload SHA required')
    raw=artifact.regular_bytes(path,'payload.json');require(len(raw)<=65536 and artifact.sha256(raw)==expected,'payload manifest changed')
    meta=json.loads(raw);require(meta.get('format')=='melodiajest-external-payload-v1' and type(meta.get('files')) is dict and 8<=len(meta['files'])<=32,'invalid payload manifest')
    def allowed(name):
        return name in {'checkout.tar.gz','external-config.json','runtime-pin.json','schedule-controls.json','runtime/restic_0.19.1_linux_amd64.bz2','runtime/SHA256SUMS','runtime/SHA256SUMS.asc','runtime/restic-signing-key.asc'} or re.fullmatch(r'published/(?:kit\.json|last-backup-success\.json|snapshots/[a-f0-9]{32}\.json|controls/[a-f0-9]{64}\.json|blobs/[a-f0-9]{64}\.tar\.gz)',name)
    require(all(allowed(name) for name in meta['files']),'unapproved payload file name')
    actual={}
    for p in path.rglob('*'):
        require(not p.is_symlink() and p.resolve()==p,'link in restored payload')
        relative=p.relative_to(path).as_posix()
        if p.is_file() and relative!='payload.json':
            require(allowed(relative),'unapproved restored payload file')
            actual[relative]=artifact.descriptor(p.read_bytes())
    require(actual==meta['files'] and sum(v['bytes'] for v in actual.values())<=64*1024*1024,'payload file set, sizes or SHA differ')
    runtime.validate_configuration(read(path/'external-config.json'))
    if (path/'schedule-controls.json').exists():schedule_controls(artifact.regular_bytes(path,'schedule-controls.json'))
    return meta

def prepare(checkout_sha,controls=None):
    require(runtime.SHA.fullmatch(checkout_sha or ''),'exact checkout SHA required')
    checkout=OPS/('development-source-'+checkout_sha[:12])/'selected-checkout.tar.gz'
    _,catalog=artifact.read_bundle(checkout,checkout_sha);require(catalog['sourceSnapshotIncluded'],'selected checkout source missing')
    kit=replica.prepare(BASE) # Acquires/releases worker + actual shared/own locks.
    if controls is not None:schedule_controls(controls)
    token='payload-'+artifact.sha256((kit['manifestSha256']+checkout_sha+runtime.BINARY_SHA+(artifact.sha256(controls) if controls else '')).encode())[:16]
    with update.operation_locks(BASE):
        update.ensure_idle(BASE);update.expect_current(BASE,catalog['webManifestSha256']);private_directory(STATE)
        work=work_directory(token);payload=work/'payload'
        if (work/'prepared.json').exists():
            saved=read(work/'prepared.json');verify_payload(payload,saved['payloadManifestSha256']);return {**saved,'reused':True}
        require(not payload.exists(),'unfinished payload requires inspection; never overwrite')
        private_directory(payload);shutil.copytree(kit['path'],payload/'published');shutil.copyfile(checkout,payload/'checkout.tar.gz')
        if controls is not None:
            (payload/'schedule-controls.json').write_bytes(controls);(payload/'schedule-controls.json').chmod(0o600)
        save(payload/'external-config.json',runtime.configuration())
        pin=read(OPS/'restic-runtime.json');require(pin['signatureVerified'] and pin['binarySha256']==runtime.BINARY_SHA,'unverified runtime pin')
        source=Path(pin['sourceVerificationDirectory']);require(source.resolve()==source and source.parent==OPS,'runtime sources outside own ops')
        folder=private_directory(payload/'runtime')
        for name in ['restic_0.19.1_linux_amd64.bz2','SHA256SUMS','SHA256SUMS.asc','restic-signing-key.asc']:
            data=artifact.regular_bytes(source,name);(folder/name).write_bytes(data);(folder/name).chmod(0o600)
        require(artifact.sha256((folder/'restic_0.19.1_linux_amd64.bz2').read_bytes())==pin['compressedSha256'],'compressed runtime changed')
        save(payload/'runtime-pin.json',{k:pin[k] for k in ['version','binarySha256','compressedSha256','signatureVerified','signingPrimaryFingerprint','releaseUrl']})
        listed={p.relative_to(payload).as_posix():artifact.descriptor(p.read_bytes()) for p in payload.rglob('*') if p.is_file()}
        meta={'format':'melodiajest-external-payload-v1','kitManifestSha256':kit['manifestSha256'],'checkoutArchiveSha256':checkout_sha,'currentWebManifestSha256':catalog['webManifestSha256'],'files':listed}
        save(payload/'payload.json',meta);digest=artifact.sha256((payload/'payload.json').read_bytes());verify_payload(payload,digest)
        result={'checkedAt':now(),'work':token,'payloadManifestSha256':digest,'kitManifestSha256':kit['manifestSha256'],'publishedSnapshotId':kit['snapshotId'],'checkoutArchiveSha256':checkout_sha,'currentWebManifestSha256':catalog['webManifestSha256'],'files':len(listed)+1,'bytes':sum(v['bytes'] for v in listed.values())+(payload/'payload.json').stat().st_size,'reused':False}
        save(work/'prepared.json',result);save(OPS/'s3-backup.json',runtime.configuration());return result

def empty_prefix(credentials):
    image=json.loads(subprocess.check_output(['docker','inspect','libre-app-1'],text=True))[0]['Image']
    code=r"""const {S3Client,ListObjectsV2Command}=require('@aws-sdk/client-s3');let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>raw+=x);process.stdin.on('end',async()=>{const p=JSON.parse(raw),c=new S3Client({endpoint:'https://s3.ru-3.storage.selcloud.ru',region:'ru-3',forcePathStyle:true,maxAttempts:1,credentials:p}),a=new AbortController(),t=setTimeout(()=>a.abort(),12000);try{const r=await c.send(new ListObjectsV2Command({Bucket:'libreta-backups-a7f39c',Prefix:'melodiajest/backups/v1/',MaxKeys:1}),{abortSignal:a.signal});process.stdout.write(JSON.stringify({status:r.$metadata.httpStatusCode,attempts:r.$metadata.attempts,empty:!r.KeyCount&&!r.IsTruncated}));}finally{clearTimeout(t);c.destroy();}});"""
    mapped={'accessKeyId':credentials['AWS_ACCESS_KEY_ID'],'secretAccessKey':credentials['AWS_SECRET_ACCESS_KEY']}
    if credentials.get('AWS_SESSION_TOKEN'):mapped['sessionToken']=credentials['AWS_SESSION_TOKEN']
    r=subprocess.run(['docker','run','--rm','-i','--pull','never','--name','melodiajest-s3-empty-'+uuid.uuid4().hex[:12],'--read-only','--network','bridge','--memory','256m','--cpus','0.5','--pids-limit','64','--entrypoint','node',image,'-e',code],input=json.dumps(mapped),capture_output=True,text=True,timeout=35)
    require(r.returncode==0,'own-prefix inspection failed; provider error suppressed');observed=json.loads(r.stdout);require(observed['status']==200 and observed['empty'],'do not initialize a non-empty or inaccessible namespace');return observed

def anonymous_config_status():
    # systemd keeps the host PrivateNetwork/AF_UNIX sandbox. Network access is
    # limited to this short-lived, secret-free Docker probe on the default bridge.
    nonce=uuid.uuid4().hex;name='melodiajest-s3-anonymous-'+nonce[:12]
    code="import urllib.request,urllib.error;url="+repr(runtime.ENDPOINT+'/'+runtime.BUCKET+'/'+runtime.PREFIX+'/config')+"\ntry:\n r=urllib.request.urlopen(url,timeout=15);print(r.status);r.close()\nexcept urllib.error.HTTPError as e:print(e.code)"
    command=['docker','run','--rm','--pull','never','--name',name,'--label','com.melodiajest.s3-probe='+nonce,'--read-only','--network','bridge','--memory','64m','--cpus','0.5','--pids-limit','32','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','python3',runtime.IMAGE,'-c',code]
    try:r=subprocess.run(command,capture_output=True,text=True,timeout=25)
    except subprocess.TimeoutExpired:
        inspected=subprocess.run(['docker','inspect',name],capture_output=True,text=True,timeout=10)
        if inspected.returncode==0:
            require(json.loads(inspected.stdout)[0]['Config']['Labels'].get('com.melodiajest.s3-probe')==nonce,'refuse foreign probe cleanup');subprocess.run(['docker','rm','-f',name],capture_output=True,check=True,timeout=15)
        raise ValueError('MelodiaJest external backup: anonymous probe timed out') from None
    require(r.returncode==0 and r.stdout.strip() in ['403','404'],'own repository config is anonymously readable or access is unknown');return int(r.stdout.strip())

def backup_payload(token,initialize):
    work=work_directory(token);prepared=read(work/'prepared.json');verify_payload(work/'payload',prepared['payloadManifestSha256']);config=runtime.validate_configuration(read(OPS/'s3-backup.json'))
    with update.operation_locks(BASE):
        update.ensure_idle(BASE);update.expect_current(BASE,prepared['currentWebManifestSha256']);private_directory(STATE)
        require(shutil.disk_usage(BASE).free>=512*1024*1024,'insufficient disk')
        receipt=read(OPS/'password-copy-receipt.json');require(receipt['roundtripVerified'] and receipt['outsideVps'] and not receipt['plaintextFileWrittenOnDesktop'],'independent protected password copy required')
        p=Path(runtime.PASSWORD_FILE);require(p.resolve()==p and not p.is_symlink() and p.stat().st_uid==0 and p.stat().st_mode&0o077==0,'own password file not private');password=p.read_bytes();runtime.password_value(password)
        credentials=runtime.resolve_credentials();cache=private_directory(work/'cache-backup');calls=[]
        repository=STATE/'repository.json'
        if not repository.exists():
            require(initialize,'explicit first own-repository initialization required')
            intent=STATE/'init-intent.json'
            if intent.exists():
                old=read(intent);require(old['repository']==runtime.REPOSITORY and old['passwordCopySha256']==receipt['encryptedFileSha256'],'different unfinished repository initialization')
                calls.append(runtime.run(config,'check',credentials,password,cache=str(cache)))
            else:
                observed=empty_prefix(credentials);save(STATE/'prefix-empty-proof.json',{'checkedAt':now(),**observed,'scope':runtime.PREFIX,'maxKeys':1})
                save(intent,{'checkedAt':now(),'repository':runtime.REPOSITORY,'passwordCopySha256':receipt['encryptedFileSha256'],'emptyPrefixVerified':True})
                calls.append(runtime.run(config,'init',credentials,password,cache=str(cache)))
            save(repository,{'checkedAt':now(),'repository':runtime.REPOSITORY,'version':2,'initializedForMelodiaJest':True,'passwordCopySha256':receipt['encryptedFileSha256']})
        else:require(read(repository)['repository']==runtime.REPOSITORY,'repository ownership receipt differs')
        anonymous_status=anonymous_config_status()
        save(STATE/'last-attempt.json',{'checkedAt':now(),'status':'running','step':'backup','work':token,'payloadManifestSha256':prepared['payloadManifestSha256']})
        result=runtime.run(config,'backup',credentials,password,cache=str(cache),source=str(work/'payload'),kit_sha=prepared['kitManifestSha256'],checkout_sha=prepared['checkoutArchiveSha256']);calls.append(result)
        summary=next((x for x in result['result'] if x.get('message_type')=='summary'),None);require(summary and runtime.SHA.fullmatch(summary.get('snapshot_id','')),'backup snapshot receipt missing')
        out={'checkedAt':now(),'success':True,'repository':runtime.REPOSITORY,'snapshotId':summary['snapshot_id'],'work':token,'prepared':prepared,'calls':calls,'summary':summary,'anonymousConfigReadStatus':anonymous_status,'independentExternalCopyVerified':False,'restorePending':True,'s3HttpRequestCount':None,'billingMeasured':False}
        save(work/'backup-success.json',out);save(STATE/'last-backup-success.json',out);save(STATE/'last-attempt.json',{'checkedAt':now(),'status':'backup-succeeded-restore-pending','work':token,'snapshotId':out['snapshotId']});return out

def restore_payload(token,request,*,password_source='independent-copy'):
    require(password_source in ['independent-copy','server-file'],'invalid password recovery source')
    work=work_directory(token);saved=read(work/'backup-success.json');prepared=saved['prepared'];config=runtime.validate_configuration(read(OPS/'s3-backup.json'));require(runtime.SHA.fullmatch(saved['snapshotId']),'exact snapshot required')
    require(set(request)=={'password','encryptedPasswordCopySha256'},'independent password envelope request required');password=runtime.password_value(request['password'].encode()).encode();copy_receipt=read(OPS/'password-copy-receipt.json');require(request['encryptedPasswordCopySha256']==copy_receipt['encryptedFileSha256'],'independent password copy receipt differs')
    with update.operation_locks(BASE):
        update.ensure_idle(BASE);current=update.current_sha(BASE);credentials=runtime.resolve_credentials();tag=uuid.uuid4().hex[:12]
        cache=private_directory(work/('cache-cold-'+tag));destination=private_directory(work/('restored-s3-'+tag));application=work/('runtime-cold-'+tag);checkout=work/('checkout-cold-'+tag);control_destination=work/('schedule-cold-'+tag);withheld=work/('source-withheld-'+tag);source=work/'payload';created=[cache,destination,application,checkout,control_destination]
        require(source.exists() and source.resolve()==source and withheld.parent==work and not withheld.exists(),'own source withholding target is unsafe')
        save(STATE/'last-attempt.json',{'checkedAt':now(),'status':'running','step':'cold-restore','snapshotId':saved['snapshotId'],'work':token,'originalPayloadWithheld':str(withheld)})
        source.rename(withheld);require(not source.exists(),'original payload is still available')
        try:
            restored=runtime.run(config,'restore',credentials,password,cache=str(cache),destination=str(destination),snapshot=saved['snapshotId']);payload=destination/'payload';meta=verify_payload(payload,prepared['payloadManifestSha256'])
            restored_checkout=artifact.restore(payload/'checkout.tar.gz',checkout,meta['checkoutArchiveSha256'])
            recovered_controls=schedule_controls(artifact.regular_bytes(payload,'schedule-controls.json'),control_destination) if (payload/'schedule-controls.json').exists() else 0
            live=replica.restore_check(payload/'published',meta['kitManifestSha256'],application,backup.IsolatedNginx)
            archive=(payload/'runtime/restic_0.19.1_linux_amd64.bz2').read_bytes();decoder=bz2.BZ2Decompressor();binary=decoder.decompress(archive,max_length=64*1024*1024);require(decoder.eof and hashlib.sha256(binary).hexdigest()==runtime.BINARY_SHA,'recovered runtime hash differs')
            require(live['success'] and live['coldRestore'] and not live['productionInputsUsed'],'cold runtime verification failed')
            out={'checkedAt':now(),'success':True,'repository':runtime.REPOSITORY,'snapshotId':saved['snapshotId'],'payloadManifestSha256':prepared['payloadManifestSha256'],'payloadFilesVerified':len(meta['files'])+1,'checkoutRestore':restored_checkout,'scheduleControlsRestored':recovered_controls,'publishedRestore':live,'resticRestore':restored,'runtimeBinaryRecoveredAndVerified':True,'originalPayloadTemporarilyUnavailable':True,'passwordReadFromVpsFile':password_source=='server-file','passwordRecoveredFromIndependentCopy':password_source=='independent-copy','productionInputsMounted':False,'independentExternalCopyVerified':True,'browserDataBackedUp':False,'scheduledExternalBackup':password_source=='server-file','s3HttpRequestCount':None,'billingMeasured':False}
        finally:
            require(not source.exists() and withheld.resolve()==withheld and withheld.parent==work,'refuse unsafe source return');withheld.rename(source)
            for item in created:
                if item.exists():
                    require(item.resolve()==item and item.parent==work and not item.is_symlink(),'refuse unsafe own restore cleanup');shutil.rmtree(item)
        out['temporaryRestoreRemoved']=True;update.expect_current(BASE,current)
        save(work/'restore-success.json',out);save(STATE/'last-restore-success.json',out);save(STATE/'last-attempt.json',{'checkedAt':now(),'status':'success','snapshotId':saved['snapshotId'],'work':token});return out

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['prepare','backup','restore']);parser.add_argument('--checkout-sha');parser.add_argument('--work');parser.add_argument('--initialize-empty',action='store_true');args=parser.parse_args()
    require(BASE.resolve()==BASE and OPS.resolve()==OPS,'own server namespace unavailable')
    try:
        if args.command=='prepare':require(not args.work and not args.initialize_empty,'unexpected prepare arguments');result=prepare(args.checkout_sha)
        elif args.command=='backup':require(args.checkout_sha is None,'unexpected backup checkout');result=backup_payload(args.work,args.initialize_empty)
        else:require(not args.checkout_sha and not args.initialize_empty,'unexpected restore arguments');request=json.loads(sys.stdin.read(8193));result=restore_payload(args.work,request)
    except Exception as error:
        message=str(error) if str(error).startswith('MelodiaJest external backup:') else type(error).__name__
        if STATE.exists():save(STATE/'last-attempt.json',{'checkedAt':now(),'status':'failed','step':args.command,'work':args.work,'error':message})
        raise RuntimeError(message) from None
    print(json.dumps(result))

if __name__=='__main__':main()
