# Точный read-only проверяющий код52

SHA256 `fdba89912336a31711d9bb6f868be267a6c2143aebb69f9aaa61d679a5c546d7`. Исполнен через SSH stdin,не установлен worker. Проверяет одну точную историческую копию,два сохранённых архива и документированные ссылки своего сервиса. S3/удаление/Node-запуск/развёртывание не реализованы.

```python
import hashlib,json,runpy,subprocess
from pathlib import Path

root=Path.cwd()
settings={'tool':'/opt/melodiajest/ops/tooling/account-bce1ef52c5266336',
          'pins':json.loads((root/'service/runtime.json').read_text()),
          'toolFiles':{name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in
              ['service/deployment.py','service/runtime.json','deploy/shared-host/release_artifact.py']}}
code=r'''
import contextlib,datetime,fcntl,hashlib,json,os,pathlib,shutil,stat,subprocess,sys,tarfile,urllib.request
base=pathlib.Path('/opt/melodiajest');stage=base/'ops/account-stage-21-03be786f085e';target=stage/'runtime'
canonical=base/'runtime/node-v24.22.2-48cc0e21e048';pins=SETTINGS['pins']
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
def signature(path):
 s=path.lstat()
 return {'device':s.st_dev,'inode':s.st_ino,'bytes':s.st_size,'allocatedBytes':s.st_blocks*512,
  'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'links':s.st_nlink,
  'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns}
def read_regular(path,limit):
 assert path.resolve(strict=True)==path and stat.S_ISREG(path.lstat().st_mode)
 before=signature(path);assert before['bytes']<=limit
 raw=path.read_bytes();assert before==signature(path) and len(raw)==before['bytes']
 return raw,before
def file_digest(path,maximum=64*1024*1024):
 assert path.resolve(strict=True)==path and stat.S_ISREG(path.lstat().st_mode)
 before=signature(path);assert before['bytes']<=maximum
 value=hashlib.sha256()
 with path.open('rb') as stream:
  for chunk in iter(lambda:stream.read(1024*1024),b''):value.update(chunk)
 assert before==signature(path)
 return {'sha256':value.hexdigest(),'bytes':before['bytes'],'metadata':before}
controls=[
 'ops/account-profile.json','ops/postgres-preparation-profile.json','ops/account-update.json',
 'ops/update-state.json','ops/s3-schedule.json','ops/external-s3/last-attempt.json',
 'ops/external-s3/last-backup-success.json','ops/external-s3/last-restore-success.json',
 'ops/external-s3/scheduled/pending.json','ops/external-s3/scheduled/last-attempt.json',
 'ops/external-s3/scheduled/last-success.json','ops/external-s3/scheduled/last-restore-success.json',
 'ops/account-postgres-backups/latest-success.json','ops/account-postgres-backups/latest-attempt.json',
 'ops/server-backups/health.json','ops/external-s3/scheduled/health.json']
def captured_controls():
 result={}
 for name in controls:
  path=base/name
  if not path.exists():result[name]={'missing':True};continue
  raw,metadata=read_regular(path,1024*1024)
  value=json.loads(raw)
  def walk(obj,prefix=''):
   if isinstance(obj,dict):
    return [ref for key,item in obj.items() for ref in walk(item,prefix+'/'+str(key))]
   if isinstance(obj,list):return [ref for index,item in enumerate(obj) for ref in walk(item,prefix+'/'+str(index))]
   return [prefix] if isinstance(obj,str) and (str(target) in obj or str(stage) in obj) else []
  result[name]={'sha256':hashlib.sha256(raw).hexdigest(),'metadata':metadata,'candidateReferenceFields':walk(value)}
 return result
def pointers():
 return {name:os.readlink(base/name) for name in ['current','previous','account-service/current','account-service/previous']}
with contextlib.ExitStack() as stack:
 for lock in ['/run/lock/libre-deploy.lock',str(base/'ops/operation.lock')]:
  fd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW);stack.callback(os.close,fd);fcntl.flock(fd,fcntl.LOCK_SH|fcntl.LOCK_NB)
 before_pointers=pointers();before_controls=captured_controls()
 assert target.resolve(strict=True)==target and canonical.resolve(strict=True)==canonical and target!=canonical
 assert set(p.name for p in target.iterdir())=={'node','LICENSE','runtime.json'}
 target_before={name:signature(target/name) for name in ['node','LICENSE','runtime.json']}
 assert all(row['links']==1 and row['uid']==row['gid']==0 and row['device']==target.lstat().st_dev for row in target_before.values())
 profile=json.loads((base/'ops/account-profile.json').read_text())
 assert profile['nodeDirectory']==str(canonical)
 assert profile['nodeArchive']==str(base/'ops/account-stage-21-0efdc441ee74/node.tar.xz')
 tool=pathlib.Path(SETTINGS['tool'])
 for name,sha in SETTINGS['toolFiles'].items():
  assert file_digest(tool/name,16*1024*1024)['sha256']==sha,'installed tool file differs: '+name
 sys.path.insert(0,str(tool/'service'));sys.path.insert(0,str(tool/'deploy/shared-host'));import deployment
 candidate_manifest=deployment.verify_node(target);canonical_manifest=deployment.verify_node(canonical)
 assert candidate_manifest==canonical_manifest
 archive=stage/'node.tar.xz';archive_proof=file_digest(archive)
 active_archive=pathlib.Path(profile['nodeArchive']);active_archive_proof=file_digest(active_archive)
 assert archive_proof['sha256']==active_archive_proof['sha256']==pins['linuxArchiveSha256']
 exact={};selected={'node-v24.22.2-linux-x64/bin/node':'node','node-v24.22.2-linux-x64/LICENSE':'LICENSE'}
 with tarfile.open(archive,'r|xz') as source:
  for member in source:
   if member.name not in selected:continue
   name=selected[member.name];assert name not in exact and member.isfile() and not member.issparse() and member.size<=150*1024*1024
   digest=hashlib.sha256();count=0
   with source.extractfile(member) as left,(target/name).open('rb') as right:
    for chunk in iter(lambda:left.read(1024*1024),b''):
     assert right.read(len(chunk))==chunk,'archive byte mismatch';digest.update(chunk);count+=len(chunk)
    assert not right.read(1) and count==member.size
   exact[name]={'sha256':digest.hexdigest(),'bytes':count,'everyByteEqualToPinnedArchive':True}
 assert set(exact)=={'node','LICENSE'} and exact=={name:{**row,'everyByteEqualToPinnedArchive':True} for name,row in candidate_manifest['files'].items()}
 manifest_raw=json.dumps(candidate_manifest,sort_keys=True,indent=2)+'\n'
 actual_raw,_=read_regular(target/'runtime.json',65536)
 assert actual_raw==manifest_raw.encode(),'runtime manifest serialization differs'
 exact['runtime.json']={'sha256':hashlib.sha256(actual_raw).hexdigest(),'bytes':len(actual_raw),'everyByteEqualToRegeneratedManifest':True}
 target_after={name:signature(target/name) for name in target_before};assert target_before==target_after
 containers={};cgroups=[]
 for name in ['melodiajest-web-1','melodiajest-postgres-1']:
  template='{"pid":{{.State.Pid}},"image":{{json .Image}},"mounts":{{json .Mounts}},"labels":{{json .Config.Labels}}}'
  observed=json.loads(subprocess.check_output(['docker','inspect','--format',template,name],text=True,timeout=10))
  assert observed['pid']>0
  group=(pathlib.Path('/proc')/str(observed['pid'])/'cgroup').read_text().strip().split(':',2)[-1];cgroups.append(group)
  containers[name]={'pid':observed['pid'],'image':observed['image'],'mounts':observed['mounts'],
   'candidateMountReferences':[mount['Source'] for mount in observed['mounts'] if str(stage) in mount['Source']],
   'controlGroup':group}
 unit_names=[line.split()[0] for line in subprocess.check_output(['systemctl','list-unit-files','melodiajest-*','--no-pager','--no-legend'],text=True).splitlines() if line.strip()]
 assert len(unit_names)<=40
 units={}
 for name in unit_names:
  raw=subprocess.check_output(['systemctl','show',name,'-p','FragmentPath','-p','DropInPaths','-p','ExecStart','-p','ExecStartPre','-p','ExecStop','-p','WorkingDirectory','-p','RootDirectory','-p','EnvironmentFiles','-p','ControlGroup','-p','MainPID'],text=True)
  assert len(raw)<65536
  values=dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
  if values.get('ControlGroup'):cgroups.append(values['ControlGroup'])
  paths=[values['FragmentPath']] if values.get('FragmentPath') else []
  paths+=values.get('DropInPaths','').split()
  source_files=[];references=[]
  for path in paths:
   assert path.startswith(('/etc/systemd/system/melodiajest-','/usr/lib/systemd/system/melodiajest-'))
   data,_=read_regular(pathlib.Path(path),128*1024)
   source_files.append({'path':path,'sha256':hashlib.sha256(data).hexdigest(),'metadata':signature(pathlib.Path(path))})
   if str(stage).encode() in data:references.append(path)
  if str(stage) in raw:references.append('systemctl-show-effective-fields')
  units[name]={'referencesCandidate':references,'sourceFiles':source_files,'effectiveFieldsSha256':hashlib.sha256(raw.encode()).hexdigest()}
 processes=[];disappeared=0
 for proc in pathlib.Path('/proc').iterdir():
  if not proc.name.isdigit():continue
  try:
   groups=[line.split(':',2)[-1] for line in (proc/'cgroup').read_text().splitlines()]
   if not any(value==group or value.startswith(group+'/') for group in cgroups for value in groups):continue
   locations={'exe':os.readlink(proc/'exe'),'cwd':os.readlink(proc/'cwd')}
   matches=[name for name,value in locations.items() if str(stage) in value]
   for name in ['cmdline','maps']:
    if str(stage).encode() in (proc/name).read_bytes():matches.append(name)
   fds=list((proc/'fd').iterdir());assert len(fds)<4096
   for fd in fds:
    try:
     if str(stage) in os.readlink(fd):matches.append('fd:'+fd.name)
    except FileNotFoundError:pass
   processes.append({'pid':int(proc.name),'executable':locations['exe'],'cwd':locations['cwd'],'candidateReferences':matches,'fdCount':len(fds)})
  except FileNotFoundError:disappeared+=1
 after_controls=captured_controls();after_pointers=pointers()
 assert before_controls==after_controls and before_pointers==after_pointers
 refs={'controls':{name:row.get('candidateReferenceFields') for name,row in before_controls.items() if row.get('candidateReferenceFields')},
       'units':{name:row['referencesCandidate'] for name,row in units.items() if row['referencesCandidate']},
       'containers':{name:row['candidateMountReferences'] for name,row in containers.items() if row['candidateMountReferences']},
       'processes':{str(row['pid']):row['candidateReferences'] for row in processes if row['candidateReferences']}}
 observed_reference_free=not any(refs.values()) and disappeared==0
 free=shutil.disk_usage(base).free;allocated=sum(row['allocatedBytes'] for row in target_before.values())
 print(json.dumps({'kind':'melodiajest-one-runtime-copy-read-only-verification','startedAt':started,'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'target':str(target),'canonicalPreserved':str(canonical),'targetFiles':target_before,'targetFileContentsVerified':exact,
  'installedVerifierFilesMatched':SETTINGS['toolFiles'],'productionVerifierAcceptedBothCopies':True,'canonicalManifestEqualsCandidate':True,
  'archive':{'path':str(archive),**archive_proof},'activeArchive':{'path':str(active_archive),**active_archive_proof},
  'archiveAndBinaryPins':pins,'signatureVerificationClaimed':False,'controlsBefore':before_controls,'controlsAfter':after_controls,
  'pointersBefore':before_pointers,'pointersAfter':after_pointers,'units':units,'containers':containers,'ownProcesses':processes,
  'candidateReferences':refs,'noActiveReferencesWithinObservedScope':observed_reference_free,'processesDisappearedDuringRead':disappeared,
  'estimatedExclusiveRegularFileAllocatedBytes':allocated,'directoryAllocatedBytes':target.lstat().st_blocks*512,
  'freeBytes':free,'projectedFreeIfAllAttributedFileBlocksReleased':free+allocated,
  'prepareMinimumFreeBytes':1000*1024*1024,'postgresRecoveryMinimumFreeBytes':800*1024*1024,
  'sharedAndOwnReadLocksHeld':True,'locksWereExistingAndUnmodified':True,'readOnly':True,'deletionPlan':False,
  'deletedFiles':0,'freedBytesByThisObservation':0,'s3Requests':0,'nodeExecuted':False,'databaseOpened':False,
  'limitations':['documented current controls,units,containers and their live cgroups only;not every historical file reference',
   'no public signature revalidation;existing pinned archive and ELF identities reused',
   'non-atomic filesystem/process observation;fresh verification required before any future action',
   'exclusive inode allocation is attribution,not a guarantee of reclaimed filesystem bytes',
   'candidate exceeds old64MiB payload/staging executors;they must not be expanded or reused for it']}))
'''
helper=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
result=subprocess.run(helper['ssh_command']()+['python3','-B','-'],input='SETTINGS='+repr(settings)+'\n'+code,text=True,encoding='utf-8',capture_output=True,timeout=120)
assert result.returncode==0,result.stderr[-1800:]
data=json.loads(result.stdout)
Path('tmp/melodiajest-52-runtime-verification.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print(json.dumps({key:data[key] for key in ['checkedAt','target','productionVerifierAcceptedBothCopies','noActiveReferencesWithinObservedScope',
 'candidateReferences','estimatedExclusiveRegularFileAllocatedBytes','freeBytes','projectedFreeIfAllAttributedFileBlocksReleased','deletedFiles','readOnly']}))
```
