# Точный временный контракт runtime53

Код исполнен только в fixtures;production-режим plan не удалял/не создавал intent. Постоянный worker не установлен. Старые64MiB инструменты не менялись.

## runtime-retire-53.py

SHA256 `82e199bf2c36058c5dccae642d7139041ebdce67e0543261003e5ed04ab1d1f7`.

```python
"""One exact reproducible Node extraction; no recursive or general retention API.

Production integration supplies the established locks and an observed live guard.
There is no production write CLI. Old payload/staging executors are unchanged.
"""
import copy,datetime,hashlib,json,os,stat,tarfile,time,uuid
from pathlib import Path

TARGET='ops/account-stage-21-03be786f085e/runtime'
ARCHIVES=('ops/account-stage-21-03be786f085e/node.tar.xz','ops/account-stage-21-0efdc441ee74/node.tar.xz')
CANONICAL='runtime/node-v24.22.2-48cc0e21e048'
NAMES=('node','LICENSE','runtime.json')
POLICY='one-exact-node-v24.22.2-extraction-three-pinned-files-v1'
MAX_AGE=600

class Refusal(ValueError):pass
def need(ok,message):
    if not ok:raise Refusal(message)
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def seal(value):
    value=copy.deepcopy(value);value.pop('planSha256',None)
    return hashlib.sha256(canonical(value)).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def metadata(path):
    item=Path(path).lstat()
    return dict(device=item.st_dev,inode=item.st_ino,bytes=item.st_size,allocated=item.st_blocks*512,
                mode=stat.S_IMODE(item.st_mode),uid=item.st_uid,gid=item.st_gid,links=item.st_nlink,
                mtimeNs=item.st_mtime_ns,ctimeNs=item.st_ctime_ns)
def regular(path,expected_uid,limit=150*1024*1024):
    path=Path(path);need(path.resolve(strict=True)==path,'Linked/noncanonical file')
    item=path.lstat();need(stat.S_ISREG(item.st_mode) and item.st_nlink==1 and item.st_uid==expected_uid and item.st_gid==expected_uid,'File type/link/owner differs')
    need(item.st_size<=limit,'File too large');return metadata(path)
def directory(path,uid):
    path=Path(path);need(path.resolve(strict=True)==path,'Linked/noncanonical directory')
    item=path.lstat();need(stat.S_ISDIR(item.st_mode) and item.st_uid==uid and item.st_gid==uid,'Directory type/owner differs')
    need(stat.S_IMODE(item.st_mode)&0o022==0,'Writable directory outside owner')
    return metadata(path)
def descriptor(path,uid):
    before=regular(path,uid);value=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):value.update(chunk)
    need(before==metadata(path),'File changed while hashing')
    return dict(bytes=before['bytes'],sha256=value.hexdigest())
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def paths(base,uid):
    base=Path(base).absolute();directory(base,uid)
    target=base/TARGET;archives=[base/name for name in ARCHIVES];live=base/CANONICAL
    for path in [target.parent,*[a.parent for a in archives],live]:directory(path,uid)
    need(target!=live and not target.is_relative_to(live) and not live.is_relative_to(target),'Protected overlap')
    return target,archives,live

def check_guard(guard):
    value=guard()
    need(type(value) is dict and value.get('referenceFree') is True,'Live reference/observation unavailable')
    need(value.get('productionIdle') is True and value.get('mountsSafe') is True,'Production busy or mount unsafe')
    need(value.get('existingS3SharedOwnLocksHeld') is True,'Established locks required')
    need(type(value.get('identity')) is dict and bool(value['identity']),'Guard identity required')
    return value

def tree(target,contract,uid):
    directory(target,uid)
    need(stat.S_IMODE(target.stat().st_mode)==0o755,'Runtime directory mode differs')
    need(set(p.name for p in target.iterdir())==set(NAMES),'Unexpected or missing runtime member')
    result={};device=target.stat().st_dev
    for name in NAMES:
        path=target/name;info=regular(path,uid)
        need(info['device']==device and info['mode']==(0o755 if name=='node' else 0o644),'Runtime mode/filesystem differs')
        need(descriptor(path,uid)==contract['files'][name],'Pinned runtime contents differ')
        result[name]=info
    return result

def archive_check(path,contract,uid):
    need(regular(path,uid)['mode']==0o600,'Private archive mode differs')
    need(descriptor(path,uid)==contract['archive'],'Pinned archive changed')
    selected={'node-v24.22.2-linux-x64/bin/node':'node','node-v24.22.2-linux-x64/LICENSE':'LICENSE'}
    seen={}
    with tarfile.open(path,'r|xz') as archive:
        for member in archive:
            if member.name not in selected:continue
            name=selected[member.name]
            need(name not in seen and member.isfile() and not member.issparse() and member.size<=150*1024*1024,'Invalid archive member')
            value=hashlib.sha256();size=0
            with archive.extractfile(member) as stream:
                for chunk in iter(lambda:stream.read(1024*1024),b''):value.update(chunk);size+=len(chunk)
            seen[name]=dict(bytes=size,sha256=value.hexdigest())
    need(seen=={name:contract['files'][name] for name in ('node','LICENSE')},'Archive content index differs')

def observe(base,contract,uid,guard):
    need(set(contract)=={'archive','files'} and set(contract['files'])==set(NAMES),'Contract fields differ')
    target,archives,live=paths(base,uid)
    identity=check_guard(guard)
    for archive in archives:archive_check(archive,contract,uid)
    canonical_tree=tree(live,contract,uid);target_tree=tree(target,contract,uid)
    need(all(row['device']==target.stat().st_dev for row in target_tree.values()),'Cross-device candidate')
    need(identity==check_guard(guard),'Live context changed during observation')
    return dict(target=target_tree,targetDirectory=metadata(target),archives={str(p):metadata(p) for p in archives},
                canonical=canonical_tree,guard=identity)

def plan(base,contract,uid,guard):
    snapshot=observe(base,contract,uid,guard)
    value=dict(kind='one-exact-node-extraction-retirement-plan',version=1,policy=POLICY,checkedAt=now(),
               validForSeconds=MAX_AGE,target=str(Path(base)/TARGET),candidateCount=1,fileNames=list(NAMES),
               contract=contract,uid=uid,snapshot=snapshot,deletionPerformed=False,archivesPreserved=True)
    value['planSha256']=seal(value);return value

def validate(value,expected_sha,base,contract,uid,guard,fresh=True):
    need(value.get('planSha256')==expected_sha==seal(value),'Plan SHA differs')
    need(value.get('kind')=='one-exact-node-extraction-retirement-plan' and value.get('version')==1 and value.get('policy')==POLICY,'Plan identity differs')
    need(value.get('candidateCount')==1 and value.get('fileNames')==list(NAMES) and value.get('target')==str(Path(base)/TARGET),'Exact target scope differs')
    need(value.get('contract')==contract and value.get('uid')==uid and value.get('validForSeconds')==MAX_AGE,'Contract/owner/time bound differs')
    need(value.get('deletionPerformed') is False and value.get('archivesPreserved') is True,'Plan operation differs')
    if fresh:
        stamp=datetime.datetime.fromisoformat(value['checkedAt']);need(stamp.tzinfo is not None,'Timezone missing')
        need(0<=time.time()-stamp.timestamp()<=MAX_AGE,'Expired/future plan')
        need(observe(base,contract,uid,guard)==value['snapshot'],'Fresh full CAS differs')

def receipt_paths(base,sha,uid):
    need(len(sha)==64 and all(c in '0123456789abcdef' for c in sha),'Invalid receipt SHA')
    home=Path(base)/'ops/runtime-retire-53'
    if not home.exists():home.mkdir(mode=0o700)
    directory(home,uid);need(stat.S_IMODE(home.stat().st_mode)==0o700,'Receipt directory mode differs')
    return home,home/('intent-'+sha+'.json'),home/('status-'+sha+'.json')

def save(path,value,uid,exclusive=False):
    directory(path.parent,uid);raw=canonical(value)+b'\n'
    temporary=path.with_name('.'+path.name+'-'+uuid.uuid4().hex)
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        if exclusive:
            os.link(temporary,path);temporary.unlink()
        else:
            need(not path.is_symlink(),'Linked status file');os.replace(temporary,path)
        sync(path.parent)
    finally:
        if temporary.exists():temporary.unlink()

def retired_path(base,sha):return (Path(base)/TARGET).with_name('runtime-retired-'+sha[:16])

def restore_missing(folder,archive,contract,uid):
    if not folder.exists():folder.mkdir(mode=0o755);folder.chmod(0o755)
    directory(folder,uid);need({p.name for p in folder.iterdir()}.issubset(NAMES),'Recovery unknown member')
    for path in folder.iterdir():need(descriptor(path,uid)==contract['files'][path.name],'Recovery existing member changed')
    selected={'node-v24.22.2-linux-x64/bin/node':'node','node-v24.22.2-linux-x64/LICENSE':'LICENSE'}
    archive_check(archive,contract,uid)
    with tarfile.open(archive,'r|xz') as source:
        for member in source:
            if member.name not in selected:continue
            name=selected[member.name];path=folder/name
            if path.exists():continue
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o755 if name=='node' else 0o644)
            os.fchmod(fd,0o755 if name=='node' else 0o644)
            with os.fdopen(fd,'wb') as output,source.extractfile(member) as inp:
                for chunk in iter(lambda:inp.read(1024*1024),b''):output.write(chunk)
                output.flush();os.fsync(output.fileno())
    manifest=folder/'runtime.json'
    if not manifest.exists():
        # The complete original manifest is part of the immutable intent.
        raw=bytes.fromhex(contract['_runtimeManifestHex']) if '_runtimeManifestHex' in contract else None
        need(raw is not None,'Recovery manifest bytes unavailable')
        need(dict(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())==contract['files']['runtime.json'],'Recovery manifest differs from pin')
        fd=os.open(manifest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
        os.fchmod(fd,0o644)
        with os.fdopen(fd,'wb') as output:output.write(raw);output.flush();os.fsync(output.fileno())

def recover(value,expected_sha,base,contract,uid,guard):
    validate(value,expected_sha,base,contract,uid,guard,fresh=False)
    target,archives,live=paths(base,uid);retired=retired_path(base,expected_sha)
    home,intent_path,status_path=receipt_paths(base,expected_sha,uid)
    need(intent_path.exists(),'Recovery intent missing')
    info=regular(intent_path,uid,512*1024);need(info['mode']==0o600,'Recovery intent mode differs')
    intent=json.loads(intent_path.read_bytes());need(intent.get('plan')==value and intent.get('retiredPath')==str(retired),'Recovery intent differs')
    raw_manifest=bytes.fromhex(intent['runtimeManifestHex'])
    need(dict(bytes=len(raw_manifest),sha256=hashlib.sha256(raw_manifest).hexdigest())==contract['files']['runtime.json'],'Recovery manifest pin differs')
    check_guard(guard)
    if target.exists():
        tree(target,contract,uid);need(not retired.exists(),'Ambiguous recovery paths')
    else:
        augmented={**contract,'_runtimeManifestHex':intent['runtimeManifestHex']}
        restore_missing(retired,archives[0],augmented,uid)
        tree(retired,contract,uid);need(not target.exists(),'Recovery target appeared')
        os.rename(retired,target);sync(target.parent);tree(target,contract,uid)
    result=dict(status='recovered',checkedAt=now(),planSha256=expected_sha,target=str(target),filesRestored=True,archivesPreserved=True)
    save(status_path,result,uid);return result

def apply(value,expected_sha,base,contract,uid,guard,fault=None):
    validate(value,expected_sha,base,contract,uid,guard)
    target,archives,live=paths(base,uid);retired=retired_path(base,expected_sha)
    need(not retired.exists(),'Retired path already exists')
    home,intent_path,status_path=receipt_paths(base,expected_sha,uid)
    need(not intent_path.exists() and not status_path.exists(),'Intent already exists;explicit recovery required')
    manifest=(target/'runtime.json').read_bytes()
    save(intent_path,dict(plan=value,retiredPath=str(retired),runtimeManifestHex=manifest.hex(),createdAt=now()),uid,exclusive=True)
    renamed=False
    try:
        need(observe(base,contract,uid,guard)==value['snapshot'],'Context changed before rename')
        os.rename(target,retired);renamed=True;sync(target.parent)
        if fault:fault('after-rename')
        fd=os.open(retired,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            need(tree(retired,contract,uid)==value['snapshot']['target'],'Retired tree changed')
            for name in NAMES:
                need(metadata(retired/name)==value['snapshot']['target'][name],'Member changed before unlink')
                os.unlink(name,dir_fd=fd)
                if fault:fault('after-unlink-'+name)
            os.fsync(fd)
        finally:os.close(fd)
        need(not list(retired.iterdir()),'Unknown retired contents');os.rmdir(retired);sync(target.parent)
        if fault:fault('after-rmdir')
        need(check_guard(guard)==value['snapshot']['guard'],'Live context changed after operation')
        for archive in archives:need(descriptor(archive,uid)==contract['archive'],'Archive changed after operation')
        need(tree(live,contract,uid)==value['snapshot']['canonical'],'Canonical runtime changed')
        result=dict(status='complete',checkedAt=now(),planSha256=expected_sha,target=str(target),removedFiles=list(NAMES),
                    removedAttributedFileBytes=sum(row['allocated'] for row in value['snapshot']['target'].values()),
                    archivesPreserved=True,canonicalRuntimePreserved=True,guardUnchanged=True)
        save(status_path,result,uid);return result
    except Exception:
        if renamed:recover(value,expected_sha,base,contract,uid,guard)
        raise

if __name__=='__main__':raise SystemExit('No production write CLI;use the checked fixed-scope integration under established locks.')
```

## runtime-retire-53-tests.py

SHA256 `2376d2a42503b5cf0ac68297430ab7be57f99ed207f757b778d86da63edbb316`.

```python
import copy,datetime,hashlib,importlib.util,io,json,os,stat,tarfile,tempfile,unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('retire',Path(__file__).with_name('runtime-retire-53.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def desc(raw):return dict(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())

class HardStop(BaseException):pass

class RuntimeRetirementTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name)/'melodiajest';self.base.mkdir()
  self.uid=os.geteuid();self.target=self.base/m.TARGET;self.live=self.base/m.CANONICAL
  node=b'\x7fELF'+bytes(range(256))*80;license=b'fixture license\n'*100
  manifest=json.dumps({'kind':'melodiajest-node-runtime','version':1,'nodeVersion':'v24.22.2','files':{'node':desc(node),'LICENSE':desc(license)}},sort_keys=True,indent=2).encode()+b'\n'
  self.data={'node':node,'LICENSE':license,'runtime.json':manifest}
  for folder in [self.target,self.live]:
   folder.mkdir(parents=True)
   for name,raw in self.data.items():(folder/name).write_bytes(raw);(folder/name).chmod(0o755 if name=='node' else 0o644)
  first=self.base/m.ARCHIVES[0]
  with tarfile.open(first,'w:xz') as archive:
   for name,raw in [('bin/node',node),('LICENSE',license)]:
    info=tarfile.TarInfo('node-v24.22.2-linux-x64/'+name);info.size=len(raw);archive.addfile(info,io.BytesIO(raw))
  second=self.base/m.ARCHIVES[1];second.parent.mkdir(parents=True);second.write_bytes(first.read_bytes())
  first.chmod(0o600);second.chmod(0o600)
  self.contract={'archive':desc(first.read_bytes()),'files':{name:desc(raw) for name,raw in self.data.items()}}
  self.control=self.base/'ops/live.json';self.control.write_text('{"ready":true}')
  self.busy=False;self.linked=False;self.locks=True
 def guard(self):
  return {'referenceFree':not self.busy,'productionIdle':not self.busy,'mountsSafe':not self.linked,'existingS3SharedOwnLocksHeld':self.locks,
          'identity':{'liveControlSha256':desc(self.control.read_bytes())['sha256']}}
 def plan(self):return m.plan(self.base,self.contract,self.uid,self.guard)
 def apply(self,p,**extra):return m.apply(p,p['planSha256'],self.base,self.contract,self.uid,self.guard,**extra)
 def recovered(self):
  self.assertEqual({name:(self.target/name).read_bytes() for name in m.NAMES},self.data)
  m.tree(self.target,self.contract,self.uid)
 def snapshot_protected(self):
  paths=[self.control,*[self.base/name for name in m.ARCHIVES],*[self.live/name for name in m.NAMES]]
  return {str(p):(p.read_bytes(),p.stat().st_ino) for p in paths}
 def test_plan_is_read_only_and_exact(self):
  before=self.snapshot_protected();p=self.plan();self.assertEqual(p['candidateCount'],1);self.assertEqual(p['fileNames'],list(m.NAMES))
  self.assertEqual(before,self.snapshot_protected());self.assertFalse((self.base/'ops/runtime-retire-53').exists());self.recovered()
 def test_apply_removes_only_three_extracted_files(self):
  before=self.snapshot_protected();p=self.plan();result=self.apply(p)
  self.assertEqual(result['status'],'complete');self.assertEqual(result['removedFiles'],list(m.NAMES));self.assertFalse(self.target.exists())
  self.assertEqual(before,self.snapshot_protected());self.assertFalse(m.retired_path(self.base,p['planSha256']).exists())
  home,intent,status=m.receipt_paths(self.base,p['planSha256'],self.uid)
  self.assertEqual(stat.S_IMODE(intent.stat().st_mode),0o600);self.assertEqual(stat.S_IMODE(home.stat().st_mode),0o700)
 def test_changed_target_or_unknown_file_refused_before_any_removal(self):
  p=self.plan();(self.target/'extra').write_text('keep')
  with self.assertRaises(m.Refusal):self.apply(p)
  self.assertTrue((self.target/'extra').exists());(self.target/'extra').unlink();self.recovered()
  (self.target/'node').write_bytes(b'changed')
  with self.assertRaises(m.Refusal):self.apply(p)
  self.assertEqual((self.target/'node').read_bytes(),b'changed')
 def test_links_modes_and_mount_guard_refused(self):
  p=self.plan();node=self.target/'node';backup=self.target.parent/'node-elsewhere';os.link(node,backup)
  with self.assertRaises(m.Refusal):self.apply(p)
  backup.unlink();node.chmod(0o644)
  with self.assertRaises(m.Refusal):self.plan()
  node.chmod(0o755);node.unlink();node.symlink_to(self.live/'node')
  with self.assertRaises(m.Refusal):self.plan()
  node.unlink();node.write_bytes(self.data['node']);node.chmod(0o755);self.linked=True
  with self.assertRaises(m.Refusal):self.plan()
 def test_changed_archives_or_canonical_runtime_refused(self):
  p=self.plan();archive=self.base/m.ARCHIVES[1];raw=archive.read_bytes();archive.write_bytes(b'changed')
  with self.assertRaises(m.Refusal):self.apply(p)
  archive.write_bytes(raw);p=self.plan();(self.live/'LICENSE').write_bytes(b'changed')
  with self.assertRaises(m.Refusal):self.apply(p)
  self.recovered()
 def test_freshness_forgery_scope_and_locks_refused(self):
  p=self.plan();bad=copy.deepcopy(p);bad['checkedAt']='2020-01-01T00:00:00+00:00';bad['planSha256']=m.seal(bad)
  with self.assertRaises(m.Refusal):self.apply(bad)
  bad=copy.deepcopy(p);bad['target']=str(self.live);bad['planSha256']=m.seal(bad)
  with self.assertRaises(m.Refusal):self.apply(bad)
  bad=copy.deepcopy(p);bad['candidateCount']=2;bad['planSha256']=m.seal(bad)
  with self.assertRaises(m.Refusal):self.apply(bad)
  bad=copy.deepcopy(p);bad['policy']='unbounded';bad['planSha256']=m.seal(bad)
  with self.assertRaises(m.Refusal):self.apply(bad)
  self.locks=False
  with self.assertRaises(m.Refusal):self.apply(p)
  self.recovered()
 def test_live_control_change_busy_or_reference_refused(self):
  p=self.plan();self.control.write_text('{"ready":false}')
  with self.assertRaises(m.Refusal):self.apply(p)
  self.control.write_text('{"ready":true}');self.busy=True
  with self.assertRaises(m.Refusal):self.apply(p)
  self.recovered()
 def test_caught_fault_recreates_complete_copy(self):
  for point in ['after-rename','after-unlink-node','after-unlink-LICENSE','after-unlink-runtime.json','after-rmdir']:
   with self.subTest(point=point):
    p=self.plan();protected=self.snapshot_protected()
    def fail(observed):
     if observed==point:raise RuntimeError('fixture interruption')
    with self.assertRaises(RuntimeError):self.apply(p,fault=fail)
    self.recovered();self.assertEqual(protected,self.snapshot_protected())
 def test_hard_interruption_recovered_from_intent_without_plan_expiry_bypass(self):
  p=self.plan()
  def stop(point):
   if point=='after-unlink-node':raise HardStop()
  with self.assertRaises(HardStop):self.apply(p,fault=stop)
  self.assertFalse(self.target.exists());retired=m.retired_path(self.base,p['planSha256']);self.assertFalse((retired/'node').exists())
  result=m.recover(p,p['planSha256'],self.base,self.contract,self.uid,self.guard)
  self.assertEqual(result['status'],'recovered');self.recovered();self.assertFalse(retired.exists())
 def test_recovery_preserves_unknown_or_changed_files(self):
  p=self.plan()
  def stop(point):
   if point=='after-rename':raise HardStop()
  with self.assertRaises(HardStop):self.apply(p,fault=stop)
  retired=m.retired_path(self.base,p['planSha256']);(retired/'unknown').write_bytes(b'keep')
  with self.assertRaises(m.Refusal):m.recover(p,p['planSha256'],self.base,self.contract,self.uid,self.guard)
  self.assertEqual((retired/'unknown').read_bytes(),b'keep')
  (retired/'unknown').unlink();(retired/'LICENSE').write_bytes(b'changed')
  with self.assertRaises(m.Refusal):m.recover(p,p['planSha256'],self.base,self.contract,self.uid,self.guard)
  self.assertEqual((retired/'LICENSE').read_bytes(),b'changed')
 def test_repeat_apply_refused(self):
  p=self.plan();self.apply(p)
  with self.assertRaises((m.Refusal,FileNotFoundError)):self.apply(p)
 def test_private_umask_recovery_restores_expected_modes(self):
  p=self.plan();old=os.umask(0o077)
  try:
   def fail(point):
    if point=='after-rmdir':raise RuntimeError('fixture interruption')
   with self.assertRaises(RuntimeError):self.apply(p,fault=fail)
   self.recovered()
  finally:os.umask(old)
 def test_corrupt_intent_manifest_is_refused_before_recovery_writes(self):
  p=self.plan()
  def stop(point):
   if point=='after-unlink-node':raise HardStop()
  with self.assertRaises(HardStop):self.apply(p,fault=stop)
  home,intent,status=m.receipt_paths(self.base,p['planSha256'],self.uid)
  value=json.loads(intent.read_bytes());value['runtimeManifestHex']=b'changed'.hex();intent.write_text(json.dumps(value))
  retired=m.retired_path(self.base,p['planSha256']);before={path.name:path.read_bytes() for path in retired.iterdir()}
  with self.assertRaises(m.Refusal):m.recover(p,p['planSha256'],self.base,self.contract,self.uid,self.guard)
  self.assertEqual(before,{path.name:path.read_bytes() for path in retired.iterdir()})

if __name__=='__main__':unittest.main(verbosity=2)
```

## runtime-guard-53.py

SHA256 `3b8b4def61361e9ac6084eb32d92b9c17db60b644c3b539d3a597677af0b48ec`.

```python
"""Read-only observations for the fixed runtime contract;caller holds real locks."""
import hashlib,http.client,json,os,stat,subprocess,socket
from pathlib import Path

BASE=Path('/opt/melodiajest')
TARGET=BASE/'ops/account-stage-21-03be786f085e/runtime'
CANONICAL=BASE/'runtime/node-v24.22.2-48cc0e21e048'
CONTRACT={'archive':{'bytes':32039312,'sha256':'48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75'},
 'files':{'node':{'bytes':126881248,'sha256':'904a6d3484241d466989f9df9ba3aab822b1496191bdb28230eb491a55c32a52'},
 'LICENSE':{'bytes':157609,'sha256':'5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace'},
 'runtime.json':{'bytes':491,'sha256':'cc6b777f95697b5d6cdce4a76bd769ea3060977a92ceb2d74f70d826add1330b'}}}
CONTROLS=('ops/account-profile.json','ops/postgres-preparation-profile.json','ops/account-update.json','ops/update-state.json','ops/s3-schedule.json',
 'ops/external-s3/last-attempt.json','ops/external-s3/last-backup-success.json','ops/external-s3/last-restore-success.json',
 'ops/external-s3/scheduled/pending.json','ops/external-s3/scheduled/last-attempt.json','ops/external-s3/scheduled/last-success.json',
 'ops/external-s3/scheduled/last-restore-success.json','ops/account-postgres-backups/latest-success.json','ops/account-postgres-backups/latest-attempt.json',
 'ops/server-backups/health.json','ops/external-s3/scheduled/health.json')
POINTERS={'current':'releases/23.5.77-dfe4860f6242','previous':'releases/23.5.76-4d85da38a2c1',
 'account-service/current':'releases/23.5.77-5ff25a1df85eebc3','account-service/previous':'releases/23.5.76-de50ec44843d8a9e'}
def require(ok,message):
 if not ok:raise ValueError(message)
def info(path):
 value=path.lstat();return {'inode':value.st_ino,'device':value.st_dev,'mode':stat.S_IMODE(value.st_mode),
  'uid':value.st_uid,'gid':value.st_gid,'links':value.st_nlink,'bytes':value.st_size,'mtimeNs':value.st_mtime_ns,'ctimeNs':value.st_ctime_ns}
def read(path,maximum=1024*1024):
 require(path.resolve(strict=True)==path,'Noncanonical guard file');before=info(path)
 require(stat.S_ISREG(path.lstat().st_mode) and before['links']==1 and before['uid']==before['gid']==0 and before['mode']&0o022==0 and before['bytes']<=maximum,'Unsafe guard file')
 raw=path.read_bytes();require(before==info(path) and len(raw)==before['bytes'],'Guard file changed')
 return raw,{'metadata':before,'sha256':hashlib.sha256(raw).hexdigest()}
class UnixConnection(http.client.HTTPConnection):
 def connect(self):
  self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.sock.settimeout(10);self.sock.connect('/run/melodiajest-account/api.sock')

class Guard:
 def __init__(self,lock_fds):
  self.lock_fds=tuple(lock_fds);self.last=None
  node=TARGET/'node';self.candidate_inode=(node.stat().st_dev,node.stat().st_ino) if node.exists() else None
 def __call__(self):
  lock_paths=[BASE/'ops/external-s3/scheduled/worker.lock',Path('/run/lock/libre-deploy.lock'),BASE/'ops/operation.lock']
  require(len(self.lock_fds)==3,'Three existing lock descriptors required')
  for fd,path in zip(self.lock_fds,lock_paths):
   actual=os.fstat(fd);expected=path.lstat()
   require((actual.st_dev,actual.st_ino)==(expected.st_dev,expected.st_ino) and stat.S_ISREG(actual.st_mode),'Lock identity changed')
  controls={};refs=[];values={}
  for name in CONTROLS:
   path=BASE/name
   if not path.exists():controls[name]={'missing':True};continue
   raw,controls[name]=read(path);values[name]=json.loads(raw)
   if str(TARGET.parent).encode() in raw:refs.append('control:'+name)
  profile=values['ops/account-profile.json']
  require(profile['nodeDirectory']==str(CANONICAL) and profile['nodeArchive']==str(BASE/'ops/account-stage-21-0efdc441ee74/node.tar.xz'),'Active Node binding changed')
  require(profile['sourceSha256']=='ff248aeaee1ebf1c8d153bb62ec44891d2067eda62e8c6ad0e68e9a400a6fab2','Active source changed')
  pointers={name:os.readlink(BASE/name) for name in POINTERS};require(pointers==POINTERS,'Current/previous changed')
  idle=values['ops/update-state.json'].get('phase') in ['committed','rolled-back']
  mounts=[]
  for line in Path('/proc/self/mountinfo').read_text().splitlines():
   raw=line.split()[4]
   for old,new in [('\\040',' '),('\\011','\t'),('\\012','\n'),('\\134','\\')]:raw=raw.replace(old,new)
   path=Path(raw)
   if path==TARGET or path.is_relative_to(TARGET) or ('runtime-retired-' in raw and path.parent==TARGET.parent):mounts.append(raw)
  unit_names=[line.split()[0] for line in subprocess.check_output(['systemctl','list-unit-files','melodiajest-*','--no-pager','--no-legend'],text=True).splitlines() if line.strip()]
  require(len(unit_names)==10,'Own unit inventory changed')
  units={};groups=[];api_pid=None
  for name in unit_names:
   raw=subprocess.check_output(['systemctl','show',name,'-p','FragmentPath','-p','DropInPaths','-p','ExecStart','-p','ExecStartPre','-p','ExecStop','-p','WorkingDirectory','-p','RootDirectory','-p','EnvironmentFiles','-p','ControlGroup','-p','MainPID','-p','ActiveState'],text=True)
   require(len(raw)<65536,'Oversized unit observation');fields=dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
   if str(TARGET.parent) in raw:refs.append('effective-unit:'+name)
   if fields.get('ControlGroup'):groups.append(fields['ControlGroup'])
   if name=='melodiajest-account.service':api_pid=fields.get('MainPID')
   if name.endswith('.service') and name not in ['melodiajest-account.service','melodiajest-postgres.service']:
    idle=idle and fields.get('ActiveState')=='inactive' and fields.get('MainPID')=='0'
   paths=([fields['FragmentPath']] if fields.get('FragmentPath') else [])+fields.get('DropInPaths','').split()
   config={}
   for raw_path in paths:
    require(raw_path.startswith(('/etc/systemd/system/melodiajest-','/usr/lib/systemd/system/melodiajest-')),'Foreign unit file')
    data,config[raw_path]=read(Path(raw_path),128*1024)
    if str(TARGET.parent).encode() in data:refs.append('unit-file:'+raw_path)
   units[name]={'effectiveSha256':hashlib.sha256(raw.encode()).hexdigest(),'files':config}
  containers={}
  for name in ['melodiajest-web-1','melodiajest-postgres-1']:
   template='{"pid":{{.State.Pid}},"image":{{json .Image}},"mounts":{{json .Mounts}}}'
   row=json.loads(subprocess.check_output(['docker','inspect','--format',template,name],text=True,timeout=10));require(row['pid']>0,'Own container stopped')
   group=(Path('/proc')/str(row['pid'])/'cgroup').read_text().strip().split(':',2)[-1];groups.append(group)
   stable_mounts=[{key:mount[key] for key in ['Type','Source','Destination','RW']} for mount in row['mounts']]
   for mount in stable_mounts:
    source=Path(mount['Source'])
    if str(TARGET.parent) in str(source) or TARGET.is_relative_to(source):refs.append('container:'+name)
   containers[name]={'image':row['image'],'mounts':stable_mounts}
  processes=[];incomplete=False;all_exe_matches=[]
  for proc in Path('/proc').iterdir():
   if not proc.name.isdigit():continue
   own=False
   try:
    try:
     executable=os.readlink(proc/'exe');node_stat=(proc/'exe').stat()
    except (FileNotFoundError,PermissionError):continue
    candidate_loaded=self.candidate_inode==(node_stat.st_dev,node_stat.st_ino)
    cg=[line.split(':',2)[-1] for line in (proc/'cgroup').read_text().splitlines()]
    own=executable.startswith(str(BASE)+'/') or candidate_loaded or any(value==group or value.startswith(group+'/') for value in cg for group in groups)
    if not own:continue
    matched=[]
    if candidate_loaded:matched.append('candidate-inode-executable');all_exe_matches.append(int(proc.name))
    for name in ['exe','cwd']:
     if str(TARGET.parent) in os.readlink(proc/name):matched.append(name)
    for name in ['cmdline','maps']:
     if str(TARGET.parent).encode() in (proc/name).read_bytes():matched.append(name)
    fd_paths=list((proc/'fd').iterdir());require(len(fd_paths)<4096,'Own process FD limit exceeded')
    for fd in fd_paths:
     try:
      if str(TARGET.parent) in os.readlink(fd):matched.append('fd:'+fd.name)
     except FileNotFoundError:pass
    if matched:refs.append('process:'+proc.name)
    processes.append({'pid':int(proc.name),'executable':executable,'candidateReferences':matched})
   except FileNotFoundError:
    if own:incomplete=True
  require(api_pid and any(str(row['pid'])==api_pid and row['executable']==str(CANONICAL/'node') for row in processes),'API executable binding differs')
  connection=UnixConnection('melodiajest.ru',timeout=10)
  try:
   connection.request('GET','/api/service/v1/health',headers={'Host':'melodiajest.ru','X-Real-IP':'127.0.0.1'});response=connection.getresponse();health=json.loads(response.read(65536))
   require(response.status==200 and health['implementationSha256']=='ff248aeaee1ebf1c8d153bb62ec44891d2067eda62e8c6ad0e68e9a400a6fab2' and health['courseSha256']=='1490ad7168e5e8ed2ba84629509a38af1c923e3583ec661c9c6fd8d565285675' and health['databaseSchemaVersion']==2,'API contract changed')
  finally:connection.close()
  result={'referenceFree':not refs and not incomplete,'productionIdle':idle,'mountsSafe':not mounts,'existingS3SharedOwnLocksHeld':True,
   'identity':{'controls':controls,'pointers':pointers,'units':units,'containers':containers,'apiPid':api_pid},
   'evidence':{'controlPaths':len(CONTROLS),'units':len(units),'containers':len(containers),'ownProcesses':processes,
    'references':refs,'incompleteOwnProcessRead':incomplete,'candidateMounts':mounts,'candidateLoadedPidsAcrossProcExeMetadata':all_exe_matches}}
  # Process evidence is informative and can vary;the live predicates must pass.
  self.last=result
  return {key:value for key,value in result.items() if key!='evidence'}
```

## run-runtime-retire-53.py

SHA256 `d06d17c67ea4633750e89069db6a85723455e2c7a236e8f21274e3c974b2fbf2`.

```python
"""Checked fixed production integration;default creates only a local read-only plan."""
import base64,hashlib,json,runpy,subprocess,sys
from pathlib import Path

root=Path.cwd();proof=json.loads((root/'tmp/melodiajest-53-runtime-isolated.json').read_text())
sources={name:(root/'tmp'/name).read_bytes() for name in ['runtime-retire-53.py','runtime-guard-53.py']}
assert proof['exitCode']==0 and 'Ran 13 tests' in proof['stderr'] and '\nOK\n' in proof['stderr']
assert proof['sourceHashes']['runtime-retire-53.py']==hashlib.sha256(sources['runtime-retire-53.py']).hexdigest()
mode='plan';plan=None
if len(sys.argv)>1:
    assert len(sys.argv)==3 and sys.argv[1] in ['--apply','--recover']
    mode=sys.argv[1][2:];plan=json.loads((root/sys.argv[2]).read_text())['plan']
settings={'mode':mode,'sources':{name:base64.b64encode(raw).decode() for name,raw in sources.items()},
          'hashes':{name:hashlib.sha256(raw).hexdigest() for name,raw in sources.items()},'plan':plan}
code=r'''
import base64,contextlib,datetime,fcntl,hashlib,json,os,pathlib,shutil,stat,types,urllib.request
base=pathlib.Path('/opt/melodiajest');require=lambda value:None if value else (_ for _ in ()).throw(ValueError('Production integration invariant failed'))
require(os.geteuid()==0 and set(SETTINGS['sources'])=={'runtime-retire-53.py','runtime-guard-53.py'} and SETTINGS['mode'] in ['plan','apply','recover'])
modules={}
for name,encoded in SETTINGS['sources'].items():
 raw=base64.b64decode(encoded);require(len(raw)<65536 and hashlib.sha256(raw).hexdigest()==SETTINGS['hashes'][name])
 module=types.ModuleType('checked_'+name.replace('.','_').replace('-','_'));exec(compile(raw,name,'exec'),module.__dict__);modules[name]=module
m=modules['runtime-retire-53.py'];g=modules['runtime-guard-53.py'];require(g.BASE==base and g.TARGET==base/m.TARGET)
sites={}
for host in ['melodiajest.ru','libreta.ru','praicer.ru','grigorova.libreta.ru']:
 with urllib.request.urlopen(urllib.request.Request('https://'+host+'/',method='HEAD'),timeout=15) as response:
  require(response.status==200);sites[host]=response.status
started=datetime.datetime.now(datetime.timezone.utc).isoformat();free_before=shutil.disk_usage(base).free
with contextlib.ExitStack() as stack:
 fds=[]
 for path in [base/'ops/external-s3/scheduled/worker.lock',pathlib.Path('/run/lock/libre-deploy.lock'),base/'ops/operation.lock']:
  require(path.resolve(strict=True)==path and stat.S_ISREG(path.lstat().st_mode) and path.lstat().st_uid==0)
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW);stack.callback(os.close,fd);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);fds.append(fd)
 guard=g.Guard(fds)
 if SETTINGS['mode']=='plan':
  plan=m.plan(base,g.CONTRACT,0,guard);result={'status':'read-only-plan-created','deletedFiles':0}
 else:
  plan=SETTINGS['plan'];require(type(plan) is dict and plan['contract']==g.CONTRACT)
  if SETTINGS['mode']=='apply':result=m.apply(plan,plan['planSha256'],base,g.CONTRACT,0,guard)
  else:result=m.recover(plan,plan['planSha256'],base,g.CONTRACT,0,guard)
 out={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'startedAt':started,'mode':SETTINGS['mode'],
  'sourceHashes':SETTINGS['hashes'],'plan':plan,'result':result,'guardEvidence':guard.last['evidence'],
  'sitesBefore':sites,'freeBytesBefore':free_before,'freeBytesAfter':shutil.disk_usage(base).free,
  'realS3SharedOwnLocksUsed':True,'old64MiBExecutorsInvoked':False,'oldCapsChanged':False,
  'nativeBackupWorkerStarted':False,'s3Requests':0,'nodeExecuted':False,'newWorkerInstalled':False}
print(json.dumps(out))
'''
helper=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
result=subprocess.run(helper['ssh_command']()+['python3','-B','-'],input='SETTINGS='+repr(settings)+'\n'+code,text=True,encoding='utf-8',capture_output=True,timeout=180)
path=root/('tmp/melodiajest-53-runtime-'+mode+'.json')
if result.returncode:
    (root/('tmp/melodiajest-53-runtime-'+mode+'-rejected.log')).write_text(result.stdout+'\n'+result.stderr,encoding='utf-8')
    raise RuntimeError(result.stderr[-2000:])
data=json.loads(result.stdout);path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checkedAt':data['checkedAt'],'mode':mode,'result':data['result'],'planSha256':data['plan']['planSha256'],
 'candidateCount':data['plan']['candidateCount'],'fileNames':data['plan']['fileNames'],
 'freeBytesBefore':data['freeBytesBefore'],'freeBytesAfter':data['freeBytesAfter'],'guardEvidence':data['guardEvidence'],
 'realS3SharedOwnLocksUsed':True,'newWorkerInstalled':False}))
```
