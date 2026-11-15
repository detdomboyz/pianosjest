# Проверенный временный исполнитель staging-очистки50

Не установлен как постоянный worker. Выполнялся только для двух точных воспроизводимых restored-каталогов43/41;архивы/current/previous/данные/бэкапы исключены.8сценариев проверены в nonroot/network-none/read-only Linux без production-томов. Исходник сохранён для воспроизводимости;повторное исполнение уже удалённых целей не допускается.

```python
"""One-off, bounded removal of byte-exact obsolete staging restores only.

Kept immutable archives, production releases, PG data and backups are excluded.
Production execution always refreshes the whole signed plan under established locks.
"""
import copy,datetime,hashlib,json,os,pathlib,shutil,stat,sys,tarfile,tempfile,time,unittest

BASE=pathlib.Path('/opt/melodiajest')
KNOWN={
 'course-43-e942e0791008':'e942e0791008e05b42f6eedc734b5dec0a4e3675ab15944bef59d1a9e960abe8',
 'course-41-204443534f2f':'204443534f2f953dbf8229efecace1b1c131acea82c769c17734bc3ecfb02ed8'}
MAX_BYTES=64*1024*1024
class Refusal(ValueError):pass
def need(value,message):
 if not value:raise Refusal(message)
def digest(data):return hashlib.sha256(data).hexdigest()
def sha(path):return digest(path.read_bytes())
def sign(plan):
 value=copy.deepcopy(plan);value.pop('planSha256',None)
 return digest(json.dumps(value,sort_keys=True).encode())
def pointers(base):return [base/'current',base/'previous',base/'account-service/current',base/'account-service/previous']
def workspace_index(target,archive):
 expected={};logical=0
 with tarfile.open(archive,'r:gz') as tar:
  for member in tar.getmembers():
   rel=pathlib.PurePosixPath(member.name)
   need(member.isfile() and not rel.is_absolute() and '..' not in rel.parts and member.name not in expected,'Unsupported/duplicate archive member')
   path=target.joinpath(*rel.parts);need(path.is_file() and not path.is_symlink(),'Missing or linked restored file')
   need(all(not p.is_symlink() for p in path.parents if p!=target.parent),'Linked restored ancestor')
   data=tar.extractfile(member).read();need(path.stat().st_size==member.size and path.read_bytes()==data,'Restored bytes changed')
   need(stat.S_IMODE(path.stat().st_mode)==0o600,'Private restore mode changed')
   expected[member.name]=digest(data);logical+=member.size
 entries=list(target.rglob('*'));need(not any(p.is_symlink() for p in entries),'Linked workspace entry')
 actual={p.relative_to(target).as_posix() for p in entries if p.is_file()}
 need(actual==set(expected),'Unknown or missing restored file')
 allocated=sum(p.stat().st_blocks*512 for p in entries if p.is_file() and p.stat().st_nlink==1)
 return {'restoredFiles':len(actual),'logicalBytes':logical,'uniqueAllocatedFileBytes':allocated,'fileIndexSha256':digest(json.dumps(expected,sort_keys=True).encode())}
def validate(plan,base=BASE,known=KNOWN,now=None):
 need(plan.get('kind')=='bounded-obsolete-staging-restore-read-only-plan','Wrong plan kind')
 need(plan.get('planSha256')==sign(plan),'Plan SHA mismatch')
 checked=datetime.datetime.fromisoformat(plan['checkedAt']);need(checked.tzinfo is not None,'Plan time has no timezone')
 age=(time.time() if now is None else now)-checked.timestamp();need(-1<=age<=900 and plan.get('validForSeconds')==900,'Plan expired or future-dated')
 need(plan.get('maxTargets')==2 and plan.get('maxAllocatedBytes')==MAX_BYTES and plan.get('prepareMinimumFreeBytes')==1000*1024*1024,'Bound changed')
 need(plan.get('deleteOrMovePerformed') is False and plan.get('archiveDeletionPlanned') is False and plan.get('productionReleaseDataOrBackupDeletionPlanned') is False,'Wrong deletion scope')
 need(base.resolve()==base and not base.is_symlink(),'Unexpected base')
 expected_pointers={str(p) for p in pointers(base)};need(set(plan['pointers'])==expected_pointers,'Pointer coverage changed')
 for raw,target in plan['pointers'].items():need(os.readlink(raw)==target,'Current/previous pointer changed')
 for raw,expected in plan['controlSha256'].items():need(sha(pathlib.Path(raw))==expected,'Live control changed')
 rows=plan['candidates'];need(0<len(rows)<=2 and len({r['target'] for r in rows})==len(rows),'Target count/duplicate')
 verified=[];total=0
 for row in rows:
  target=pathlib.Path(row['target']);stage=target.parent;archive=pathlib.Path(row['keptArchive']);name=stage.name
  need(name in known and target==base/'ops'/name/'restored' and archive==stage/'release.tar.gz','Target outside exact allowlist')
  need(stage.resolve()==stage and target.resolve()==target and stage.is_dir() and target.is_dir() and not stage.is_symlink() and not target.is_symlink(),'Linked or missing target')
  need(archive.is_file() and not archive.is_symlink() and row['archiveSha256']==known[name] and sha(archive)==known[name] and archive.stat().st_size==row['archiveBytes'],'Kept archive changed')
  need(not any(name in pathlib.Path(raw).read_text() for raw in plan['controlSha256']),'Live control references target stage')
  need(not any(pathlib.Path(raw).resolve().is_relative_to(target) or target.is_relative_to(pathlib.Path(raw).resolve()) for raw in plan['pointers']),'Target overlaps current/previous')
  index=workspace_index(target,archive)
  for key,value in index.items():need(row[key]==value,'Workspace index changed: '+key)
  need(index['restoredFiles']<=1100 and index['logicalBytes']<=MAX_BYTES and row['unknownFiles']==0 and row['liveControlReferences']==0 and row['currentPreviousOverlap'] is False,'Workspace scope changed')
  need(row['allBytesMatchKeptArchive'] and row['privateRestoreMode0600Verified'],'Restoration proof missing')
  total+=index['uniqueAllocatedFileBytes'];verified.append((target,archive,row,index))
 need(total==plan['uniqueAllocatedFileBytes'] and total<=MAX_BYTES,'Total allocation limit changed')
 return verified
def run(plan,execute=False,base=BASE,known=KNOWN):
 verified=validate(plan,base,known);need(shutil.rmtree.avoids_symlink_attacks,'FD-safe Linux removal required')
 before_free=shutil.disk_usage(base).free;inodes={p:str(pathlib.Path(p).stat().st_ino) for p in plan['controlSha256']}
 result={'kind':'bounded-staging-restore-reclaim','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'planSha256':plan['planSha256'],'scriptScope':'only exact obsolete restored workspaces;kept archives/current/previous/live data/backups excluded','execute':execute,'removedTargets':[],'attemptedTargets':[],'removedFileCount':0,'removedUniqueAllocatedFileBytes':0,'freeBytesBefore':before_free,'pgWorkerStarted':False,'limitsChanged':False,'s3Requests':0,'dataMigrationPerformed':False}
 for target,archive,row,index in verified:
  if not execute:continue
  need(target.resolve()==target and not target.is_symlink(),'Target changed before removal')
  result['attemptedTargets'].append(str(target));shutil.rmtree(target);need(not target.exists(),'Target removal incomplete')
  result['removedTargets'].append(str(target));result['removedFileCount']+=index['restoredFiles'];result['removedUniqueAllocatedFileBytes']+=index['uniqueAllocatedFileBytes']
 result['keptArchives']=[{'path':str(archive),'sha256':sha(archive)} for target,archive,row,index in verified]
 need(all(x['sha256']==row['archiveSha256'] for x,(_,_,row,_) in zip(result['keptArchives'],verified)),'Kept archive changed after operation')
 need(all(os.readlink(p)==value for p,value in plan['pointers'].items()),'Pointers changed after operation')
 need(all(sha(pathlib.Path(p))==expected and str(pathlib.Path(p).stat().st_ino)==inodes[p] for p,expected in plan['controlSha256'].items()),'Control bytes/inode changed')
 result.update(freeBytesAfter=shutil.disk_usage(base).free,currentPreviousUnchanged=True,controlBytesAndInodesUnchanged=True,prepareMinimumFreeBytes=1000*1024*1024)
 result['prepareFreeGatePassed']=result['freeBytesAfter']>result['prepareMinimumFreeBytes'];return result

class ReclaimTests(unittest.TestCase):
 def fixture(self):
  import io
  temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);base=pathlib.Path(temp.name)/'opt/melodiajest';(base/'ops').mkdir(parents=True);(base/'account-service').mkdir()
  for directory in [base/'releases/76',base/'releases/75',base/'account-service/releases/76',base/'account-service/releases/75']:directory.mkdir(parents=True)
  for p,link in zip(pointers(base),['releases/76','releases/75','releases/76','releases/75']):p.symlink_to(link,target_is_directory=True)
  control=base/'ops/account-profile.json';control.write_text('{}');known={};rows=[]
  for name in KNOWN:
   stage=base/'ops'/name;target=stage/'restored';target.mkdir(parents=True);archive=stage/'release.tar.gz';files={'bundle.json':b'{"format":1}','source/example.txt':b'reproducible bytes'}
   with tarfile.open(archive,'w:gz') as tar:
    for rel,data in files.items():
     member=tarfile.TarInfo(rel);member.size=len(data);member.mode=0o644;tar.addfile(member,io.BytesIO(data));p=target/rel;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o600)
   known[name]=sha(archive);index=workspace_index(target,archive);rows.append({'target':str(target),'keptArchive':str(archive),'archiveSha256':known[name],'archiveBytes':archive.stat().st_size,**index,'allBytesMatchKeptArchive':True,'privateRestoreMode0600Verified':True,'unknownFiles':0,'liveControlReferences':0,'currentPreviousOverlap':False})
  plan={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'bounded-obsolete-staging-restore-read-only-plan','candidates':rows,'rejected':[],'prepareMinimumFreeBytes':1000*1024*1024,'uniqueAllocatedFileBytes':sum(x['uniqueAllocatedFileBytes'] for x in rows),'maxTargets':2,'maxAllocatedBytes':MAX_BYTES,'pointers':{str(p):os.readlink(p) for p in pointers(base)},'controlSha256':{str(control):sha(control)},'archiveDeletionPlanned':False,'productionReleaseDataOrBackupDeletionPlanned':False,'deleteOrMovePerformed':False,'freshCompareAndSharedLocksRequiredAtExecution':True,'validForSeconds':900};plan['planSha256']=sign(plan);return base,known,plan
 def test_dry_run_preserves_all(self):
  base,known,plan=self.fixture();result=run(plan,False,base,known);self.assertEqual(result['removedTargets'],[]);self.assertTrue(all(pathlib.Path(x['target']).is_dir() for x in plan['candidates']))
 def test_execute_keeps_archives_controls_and_pointers(self):
  base,known,plan=self.fixture();result=run(plan,True,base,known);self.assertEqual(len(result['removedTargets']),2);self.assertEqual(result['removedFileCount'],4);self.assertTrue(result['controlBytesAndInodesUnchanged']);self.assertTrue(result['currentPreviousUnchanged']);self.assertTrue(all(pathlib.Path(x['keptArchive']).is_file() for x in plan['candidates']))
 def test_stale_and_forged_plans(self):
  base,known,plan=self.fixture();self.assertRaises(Refusal,validate,plan,base,known,time.time()+901);plan['maxTargets']=3;self.assertRaises(Refusal,validate,plan,base,known)
 def test_changed_archive_is_refused(self):
  base,known,plan=self.fixture();p=pathlib.Path(plan['candidates'][0]['keptArchive']);p.write_bytes(p.read_bytes()+b'changed');self.assertRaises(Refusal,run,plan,True,base,known);self.assertTrue(pathlib.Path(plan['candidates'][0]['target']).exists())
 def test_unknown_file_and_changed_private_mode(self):
  for mutation in ['extra','mode']:
   with self.subTest(mutation=mutation):
    base,known,plan=self.fixture();target=pathlib.Path(plan['candidates'][0]['target'])
    if mutation=='extra':(target/'unrecognized').write_text('retain me')
    else:(target/'bundle.json').chmod(0o644)
    self.assertRaises(Refusal,run,plan,True,base,known);self.assertTrue(target.exists())
 def test_symlink_and_protected_pointer_are_refused(self):
  for mutation in ['link','pointer']:
   with self.subTest(mutation=mutation):
    base,known,plan=self.fixture();target=pathlib.Path(plan['candidates'][0]['target'])
    if mutation=='link':(target/'unknown-link').symlink_to(base/'ops/account-profile.json')
    else:(base/'current').unlink();(base/'current').symlink_to(target,target_is_directory=True);plan['pointers'][str(base/'current')]=str(target);plan['planSha256']=sign(plan)
    self.assertRaises(Refusal,run,plan,True,base,known);self.assertTrue(target.exists())
 def test_changed_or_referencing_live_control(self):
  for mutation in ['bytes','reference']:
   with self.subTest(mutation=mutation):
    base,known,plan=self.fixture();p=base/'ops/account-profile.json';p.write_text('changed' if mutation=='bytes' else next(iter(known)))
    if mutation=='reference':plan['controlSha256'][str(p)]=sha(p);plan['planSha256']=sign(plan)
    self.assertRaises(Refusal,run,plan,True,base,known)
 def test_limits_duplicates_and_unknown_targets(self):
  for mutation in ['bound','duplicate','unknown']:
   with self.subTest(mutation=mutation):
    base,known,plan=self.fixture()
    if mutation=='bound':plan['maxAllocatedBytes']=MAX_BYTES+1
    elif mutation=='duplicate':plan['candidates'][1]=copy.deepcopy(plan['candidates'][0])
    else:plan['candidates'][0]['target']=str(base/'ops/not-allowlisted/restored')
    plan['planSha256']=sign(plan);self.assertRaises(Refusal,run,plan,True,base,known)

def production():
 need(sys.platform=='linux' and os.geteuid()==0,'Only guarded VPS root execution is supported')
 plan=globals().get('PRODUCTION_PLAN');need(isinstance(plan,dict) and plan.get('planSha256')==globals().get('EXPECTED_PLAN_SHA'),'Explicit plan and expected SHA required')
 sys.path.insert(0,str(BASE/'ops/tooling/updater-a3fe61ded8b1e6b8'));import release_update as updater
 sys.path.insert(0,str(BASE/'ops/tooling/backup-3d670cf8764788cb'));import release_backup as backup
 with backup.worker_lock(BASE/'ops/external-s3/scheduled'),updater.operation_locks(BASE):
  updater.ensure_idle(BASE);updater.expect_current(BASE,'4d85da38a2c1efd9571d38345265158c52e167df5fa76fca2d4d7c1a1243bd7f');updater.ProductionRuntime(BASE).neighbors();result=run(plan,True);updater.ProductionRuntime(BASE).neighbors();print(json.dumps(result))
if __name__=='__main__':
 if sys.argv[1:]==['--self-test']:unittest.main(argv=['isolated-staging-reclaim'],verbosity=2)
 elif sys.argv[1:]==['--execute-inline-plan']:production()
 else:raise SystemExit('Use isolated --self-test or explicit guarded inline plan')

```
