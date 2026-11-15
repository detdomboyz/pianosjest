# Точные временные адаптеры фазы56

Фаза уже завершена;этот текст — доказательство исполненного кода,не очередь повторного запуска. Постоянныеupdater/worker не заменялись,новыеCLI/таймеры не устанавливались. Тот же архив78/03d90e7c…,безновыхуроков/миграций/удалений.

## preflight-melodiajest-course-56.py

SHA256 `003392441a0300707b8c3f4246940b67ce0662c2e02eb634a9040d92718e0e18`

```python
import json,runpy,subprocess
from pathlib import Path
h=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
code=r'''
import datetime,hashlib,json,os,pathlib,shutil,subprocess,urllib.request
base=pathlib.Path('/opt/melodiajest');ops=base/'ops';read=lambda p:json.loads(p.read_text());now=datetime.datetime.now(datetime.timezone.utc)
sites={}
for host in ['melodiajest.ru','libreta.ru','praicer.ru','grigorova.libreta.ru']:
 with urllib.request.urlopen('https://'+host+'/',timeout=15) as r:assert r.status==200;sites[host]=200
with urllib.request.urlopen('https://melodiajest.ru/web-release.json',timeout=15) as r:manifest_bytes=r.read(131073)
assert len(manifest_bytes)<=131072
web=json.loads(manifest_bytes);assert web['version']=='23.5.77' and hashlib.sha256(manifest_bytes).hexdigest()=='dfe4860f62425b1b0e216ba9b728a3bff3001311b747be2e9abbde80c761a080'
import sys
budget_path=pathlib.Path('/opt/melodiajest/ops/course-27-202d50f7ff6d/restored/source/deploy/shared-host/release_start_budget.py');assert hashlib.sha256(budget_path.read_bytes()).hexdigest()=='aba34fb8bbfc0c5d7fd7e254afdd13d5a0161ac57708298af03e9f2170f9317a'
import importlib.util
budget_spec=importlib.util.spec_from_file_location('budget29',budget_path);budget=importlib.util.module_from_spec(budget_spec);budget_spec.loader.exec_module(budget);start_budget=budget.observe_start_budget(planned_starts=2)
profile=read(ops/'account-profile.json');schedule=read(ops/'s3-schedule.json')
receipts={}
for name in ['server-backups/health.json','server-backups/last-restore-success.json','external-s3/scheduled/health.json','external-s3/scheduled/last-restore-success.json','account-postgres-backups/latest-attempt.json','account-postgres-backups/latest-success.json','account-postgres-backups/latest-success.json']:
 value=read(ops/name);receipts[name]={k:value[k] for k in ['checkedAt','restoredAt','dataComparedAt','status','success','snapshot','snapshotId','sourceSha256','accountBackup','problems'] if k in value}
def sd(unit):return dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',unit,'-p','Result','-p','ExecMainStatus','-p','ExecMainStartTimestamp','-p','StartLimitBurst','-p','StartLimitIntervalUSec','-p','LastTriggerUSec','-p','NextElapseUSecRealtime'],text=True).splitlines() if '=' in x)
units={name:sd('melodiajest-'+name+suffix) for name,suffix in [('backup','.service'),('backup-health','.service'),('restore-check','.service'),('account-backup','.timer')]}
journal=subprocess.check_output(['journalctl','-u','melodiajest-account-backup.service','--since','2 hours ago','-n','160','--output=json','--no-pager'],text=True)
starts=[datetime.datetime.fromtimestamp(int(row['__REALTIME_TIMESTAMP'])/1000000,datetime.timezone.utc).isoformat() for line in journal.splitlines() if (row:=json.loads(line)).get('MESSAGE','').startswith('Starting melodiajest-account-backup.service')]
account_limits=sd('melodiajest-account-backup.service')
controls={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('/etc/systemd/system').glob('melodiajest-*.timer')}
for p in [pathlib.Path('/opt/libre/deploy/vps/Caddyfile'),ops/'account-profile.json',pathlib.Path('/etc/systemd/system/melodiajest-account.service')]:controls[str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
print(json.dumps({'checkedAt':now.isoformat(),'sites':sites,'version':web['version'],'webCurrent':os.readlink(base/'current'),'webPrevious':os.readlink(base/'previous'),'backendCurrent':os.readlink(base/'account-service/current'),'backendPrevious':os.readlink(base/'account-service/previous'),'profile':profile,'schedule':schedule,'receipts':receipts,'units':units,'accountUnitRecentStarts':starts,'accountUnitLimits':account_limits,'controls':controls,'caddyInode':pathlib.Path('/opt/libre/deploy/vps/Caddyfile').stat().st_ino,'freeBytes':shutil.disk_usage(base).free,'startBudget':start_budget}))
'''
r=subprocess.run(h['ssh_command']()+['python3','-B','-'],input=code,text=True,encoding='utf-8',capture_output=True,timeout=110)
if r.returncode:print(r.stderr[-1800:]);r.check_returncode()
d=json.loads(r.stdout);Path('tmp/melodiajest-56-before.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:d[k] for k in ['checkedAt','sites','version','webCurrent','backendCurrent','freeBytes','startBudget']}))

```

## prepare-melodiajest-course-56-server.py

SHA256 `a5ab49432b101271a67a26827618d9b2543440ddfaf6ef2949d0c2b79eb6ae39`

```python
"""Stage one verified artifact and test its reader against an isolated backup."""
import hashlib,json,runpy,subprocess,sys
from pathlib import Path

root=Path.cwd();record=json.loads((root/'tmp/melodiajest-56-artifact.json').read_text(encoding='utf-8'));before_path=root/(sys.argv[sys.argv.index('--before-json')+1] if '--before-json' in sys.argv else 'tmp/melodiajest-56-before.json');before=json.loads(before_path.read_text(encoding='utf-8'));checks=json.loads((root/'tmp/melodiajest-56-local-proof.json').read_text(encoding='utf-8'))
before['webManifestSha256']='dfe4860f62425b1b0e216ba9b728a3bff3001311b747be2e9abbde80c761a080';before['caddySha256']=before['controls']['/opt/libre/deploy/vps/Caddyfile'];before['timerHashes']={k:v for k,v in before['controls'].items() if k.endswith('.timer')};before['developmentPin']=before['schedule']['developmentArchiveSha256']
assert checks['fullTestsPassed']==1238 and checks['newLocalRegressionTestsPassed']==10 and checks['windowsServiceTestsPassed']==43 and checks['browserVerified'] and record['restoreVerified']
assert hashlib.sha256(Path(record['archive']).read_bytes()).hexdigest()==record['sha256']
h=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py');ssh=h['ssh_command']()
settings={'stage':'/opt/melodiajest/ops/course-56-'+record['sha256'][:12],'archiveSha':record['sha256'],'manifestSha':record['webManifestSha256'],'updater':'/opt/melodiajest/ops/tooling/updater-a3fe61ded8b1e6b8','before':before,'deploymentWorkerSha256':hashlib.sha256((root/'service/deployment.py').read_bytes()).hexdigest(),'startBudgetSha256':hashlib.sha256((root/'deploy/shared-host/release_start_budget.py').read_bytes()).hexdigest(),'stageOnly':'--stage-only' in sys.argv}
def remote(code,timeout=180):
 r=subprocess.run(ssh+['python3','-B','-'],input='SETTINGS='+repr(settings)+'\n'+code,text=True,encoding='utf-8',capture_output=True,timeout=timeout)
 if r.returncode:print(r.stdout[-1500:]);print(r.stderr[-3000:]);r.check_returncode()
 return json.loads(r.stdout)
present=remote(r'''
import hashlib,json,pathlib,shutil,sys
base=pathlib.Path('/opt/melodiajest');stage=pathlib.Path(SETTINGS['stage']);sys.path.insert(0,SETTINGS['updater']);import release_update as u
with u.operation_locks(base):
 u.ensure_idle(base);u.expect_current(base,SETTINGS['before']['webManifestSha256']);u.ProductionRuntime(base).neighbors();assert shutil.disk_usage(base).free>1000*1024*1024
 assert stage.parent==base/'ops';stage.mkdir(mode=0o700,exist_ok=True);assert stage.resolve()==stage
 archive=stage/'release.tar.gz'
 if archive.exists():assert not archive.is_symlink() and hashlib.sha256(archive.read_bytes()).hexdigest()==SETTINGS['archiveSha']
 print(json.dumps(archive.exists()))
''')
if not present:
 scp=['scp','-i',ssh[ssh.index('-i')+1],'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes']
 if '-b' in ssh:scp+=['-o','BindAddress='+ssh[ssh.index('-b')+1]]
 subprocess.run(scp+[record['archive'],'root@135.106.217.27:'+settings['stage']+'/release.tar.gz'],check=True,timeout=100)
result=remote(r'''
import copy,datetime,hashlib,json,os,pathlib,pwd,subprocess,sys
base=pathlib.Path('/opt/melodiajest');ops=base/'ops';stage=pathlib.Path(SETTINGS['stage']);old=SETTINGS['before']['profile'];tool=pathlib.Path(old['tooling']);sys.path.insert(0,str(tool/'service'));sys.path.insert(0,SETTINGS['updater'])
import deployment as d,operate,release_artifact as a,release_update as u,release_backup as b,postgres_backup as pb
digest=lambda data:hashlib.sha256(data).hexdigest()
stamp=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
with b.worker_lock(ops/'external-s3/scheduled'),u.operation_locks(base):
 u.ensure_idle(base);u.expect_current(base,SETTINGS['before']['webManifestSha256']);u.ProductionRuntime(base).neighbors()
 assert json.loads((ops/'account-profile.json').read_text())==old and d.pointer(base/'account-service')==SETTINGS['before']['backendCurrent']
 assert digest((tool/'service/deployment.py').read_bytes())==SETTINGS['deploymentWorkerSha256']
 if not(stage/'restored').exists():a.restore(stage/'release.tar.gz',stage/'restored',SETTINGS['archiveSha'])
 source=stage/'restored/source';source.joinpath('tmp').mkdir(exist_ok=True)
 selected,manifest=d.source_plan(stage/'release.tar.gz',SETTINGS['archiveSha']);assert manifest['dataSchemaVersion']==2 and manifest['files']['service/schema.pg.sql']==json.loads((base/'account-service/current/backend.json').read_text())['files']['service/schema.pg.sql']
 node=pathlib.Path(old['nodeDirectory']);d.verify_node(node)
image='sha256:3ec2edd1174df69efd176ebb3e20c2f73ff32b6a4e4fe7ae7f32b7d94ebb13c1'
cached=json.loads(subprocess.check_output(['docker','image','inspect',image],text=True))[0];assert cached['Id']==image and cached['Os']=='linux' and cached['Architecture']=='amd64'
runner='melodiajest-course-test-56-'+SETTINGS['archiveSha'][:8]
args=['docker','run','--rm','--pull','never','--name',runner,'--label','com.melodiajest.role=isolated-course-test','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m','--cpus','0.65','--pids-limit','96','--mount','type=bind,source='+str(source)+',target=/fixture,readonly','--mount','type=bind,source='+str(node)+',target=/node,readonly','--tmpfs','/tmp:rw,mode=1777,size=64m','--tmpfs','/fixture/tmp:rw,mode=1777,size=64m','--workdir','/fixture','--entrypoint','/node/node',image,'--test','--test-concurrency=1','--test-reporter=tap','tests/piano-f-major-thumb-fourth-connected.test.cjs','tests/piano-f-major-left-descent-checkpoint.test.cjs','service/tests/game.test.cjs']
try:
 verified=stage/'linux-tests-verified.json'
 if verified.exists():
  prior_tests=json.loads(verified.read_text());assert prior_tests['archiveSha256']==SETTINGS['archiveSha'] and prior_tests['tapSha256']==digest((stage/'linux-course-tests.tap').read_bytes()) and prior_tests['passed']==39
 else:
  tests=subprocess.run(args,capture_output=True,text=True,timeout=180);(stage/'linux-course-tests.tap').write_text(tests.stdout+'\n'+tests.stderr);assert tests.returncode==0,tests.stdout[-2200:]+'\n'+tests.stderr[-1000:];assert '# tests 39' in tests.stdout and '# pass 39' in tests.stdout and '# skipped 0' in tests.stdout
  d.save(verified,{'archiveSha256':SETTINGS['archiveSha'],'passed':39,'tapSha256':digest((stage/'linux-course-tests.tap').read_bytes())})
finally:
 r=subprocess.run(['docker','inspect',runner],capture_output=True,text=True,timeout=10)
 if r.returncode==0:
  assert json.loads(r.stdout)[0]['Config']['Labels'].get('com.melodiajest.role')=='isolated-course-test';subprocess.run(['docker','stop','--time','5',runner],check=True,capture_output=True,timeout=15)
with b.worker_lock(ops/'external-s3/scheduled'),u.operation_locks(base):
 u.ensure_idle(base);u.expect_current(base,SETTINGS['before']['webManifestSha256']);assert json.loads((ops/'account-profile.json').read_text())==old and d.pointer(base/'account-service')==SETTINGS['before']['backendCurrent']
 d.save(stage/'before-api-profile.json',old)
# Refresh the actual current data copy before switching readers. The existing
# worker serializes through its established locks and never replaces live data.
import importlib.util
budget_path=source/'deploy/shared-host/release_start_budget.py';assert digest(budget_path.read_bytes())==SETTINGS['startBudgetSha256']
budget_spec=importlib.util.spec_from_file_location('melodiajest_release_budget30',budget_path);budget=importlib.util.module_from_spec(budget_spec);budget_spec.loader.exec_module(budget)
tests_budget=subprocess.run(['python3','-B',str(source/'tests/release_start_budget_test.py')],capture_output=True,text=True,timeout=25);assert tests_budget.returncode==0 and 'Ran 7 tests' in tests_budget.stderr,tests_budget.stderr
try:start_budget=budget.observe_start_budget(planned_starts=2)
except ValueError:
 result={'status':'deferred-native-account-service-active-or-failed','checkedAt':stamp(),'stage':str(stage),'artifactSha256':SETTINGS['archiveSha'],'newSourceSha256':manifest['sourceSha256'],'linuxTestsPassed':39,'preUpdateAccountSnapshot':None,'liveApiAndPublicUnchanged':True,'dataMigrationPerformed':False}
 d.save(stage/'waiting-account-service.json',result);print(json.dumps(result));sys.exit(0)
d.save(stage/'start-budget.json',start_budget)
if not start_budget['allowed']:
 result={'status':'deferred-start-budget-before-any-api-change','checkedAt':stamp(),'stage':str(stage),'artifactSha256':SETTINGS['archiveSha'],'newSourceSha256':manifest['sourceSha256'],'linuxTestsPassed':39,'startBudgetTestsPassed':7,'preUpdateAccountSnapshot':None,'liveApiAndPublicUnchanged':True,'dataMigrationPerformed':False,'startBudget':start_budget,'notBefore':start_budget['notBefore']}
 d.save(stage/'waiting-start-budget.json',result);print(json.dumps(result));sys.exit(0)
if SETTINGS['stageOnly']:
 result={'status':'deferred-to-separate-publication-phase-current-data-copy-required','checkedAt':stamp(),'stage':str(stage),'artifactSha256':SETTINGS['archiveSha'],'newSourceSha256':manifest['sourceSha256'],'linuxTestsPassed':39,'startBudgetTestsPassed':7,'preUpdateAccountSnapshot':None,'liveApiAndPublicUnchanged':True,'dataMigrationPerformed':False,'startBudget':start_budget,'notBefore':start_budget['notBefore']}
 d.save(stage/'staging-only.json',result);print(json.dumps(result));sys.exit(0)
# Reuse only an actually completed native daily comparison from this batch.
# No service start, synthetic receipt/date or independent-restore claim here.
def sd(unit):return dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show',unit,'-p','InvocationID','-p','Result','-p','ExecMainStatus','-p','ActiveState','-p','ExecMainStartTimestamp','-p','ExecMainExitTimestamp','-p','LastTriggerUSec'],text=True).splitlines() if '=' in line)
native_service=sd('melodiajest-account-backup.service');native_timer=sd('melodiajest-account-backup.timer')
prior=json.loads((ops/'account-postgres-backups/latest-success.json').read_text());attempt=json.loads((ops/'account-postgres-backups/latest-attempt.json').read_text())
ts=lambda value:datetime.datetime.strptime(value,'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=datetime.timezone.utc)
native_daily=None
if native_timer.get('LastTriggerUSec') and native_timer['LastTriggerUSec']==native_service.get('ExecMainStartTimestamp') and native_service.get('ActiveState')=='inactive' and native_service.get('Result')=='success' and native_service.get('ExecMainStatus')=='0':
 start=ts(native_service['ExecMainStartTimestamp']);end=ts(native_service['ExecMainExitTimestamp']);checked=datetime.datetime.fromisoformat(prior['checkedAt']);compared=datetime.datetime.fromisoformat(prior['dataComparedAt']);inv=native_service['InvocationID']
 journal=[json.loads(line) for line in subprocess.check_output(['journalctl','--no-pager','-o','json','-n','80','INVOCATION_ID='+inv,'+','_SYSTEMD_INVOCATION_ID='+inv],text=True).splitlines()]
 parsed=[json.loads(row['MESSAGE']) for row in journal if row.get('MESSAGE','').startswith('{')]
 if (start>=datetime.datetime(2026,11,9,2,0,tzinfo=datetime.timezone.utc) and end>=start and start<=checked<=end+datetime.timedelta(seconds=1) and start<=compared<=end+datetime.timedelta(seconds=1) and (datetime.datetime.now(datetime.timezone.utc)-compared).total_seconds()<1800 and prior==attempt and prior['status']=='verified' and prior['sourceSha256']==old['sourceSha256'] and any(row.get('JOB_RESULT')=='done' and row.get('MESSAGE','').startswith('Finished ') for row in journal) and any(row.get('status')=='verified' and row.get('snapshot')==prior['snapshot'] and row.get('checkedAt')==prior['checkedAt'] for row in parsed)):
  assert all(row.get('_SYSTEMD_INVOCATION_ID',row.get('INVOCATION_ID'))==inv for row in journal)
  native_daily={'invocationId':inv,'startedAt':start.isoformat(),'finishedAt':end.isoformat(),'timerMatched':True,'journalMatched':True,'snapshot':prior['snapshot'],'checkedAt':prior['checkedAt'],'dataComparedAt':prior['dataComparedAt'],'restoredAt':prior['restoredAt'],'newSnapshotCreated':prior['newSnapshotCreated'],'nativeBackupReusedAsPreUpdateCopy':True,'serviceStartsByPreparation':0,'independentRestorePerformedByPreparation':False}
pre_protection=None
if native_daily is not None:
 pre_protection={'mode':'verified-direct-native-daily-reuse','nativeDaily':native_daily,'manualPreUpdateStarts':0};d.save(stage/'native-daily-pre-update.json',native_daily)
else:
 # A failed direct timer invocation or a stale successful retry is not relabelled
 # as direct calendar success. Wait for TWO ordinary starts, then use the existing
 # native service for a fresh comparison and one later post-reader protection.
 two_starts=budget.observe_start_budget(planned_starts=2);d.save(stage/'two-start-budget.json',two_starts)
 if not two_starts['allowed']:
  result={'status':'deferred-two-start-budget-current-copy-needs-refresh','checkedAt':stamp(),'stage':str(stage),'artifactSha256':SETTINGS['archiveSha'],'newSourceSha256':manifest['sourceSha256'],'linuxTestsPassed':39,'preUpdateAccountSnapshot':None,'liveApiAndPublicUnchanged':True,'dataMigrationPerformed':False,'nativeService':native_service,'nativeTimer':native_timer,'startBudget':two_starts,'notBefore':two_starts['notBefore']}
  d.save(stage/'waiting-two-start-budget.json',result);print(json.dumps(result));sys.exit(0)
 refresh_began=datetime.datetime.now(datetime.timezone.utc)
 r=subprocess.run(['systemctl','start','melodiajest-account-backup.service'],capture_output=True,text=True,timeout=850);assert r.returncode==0,'Normal pre-update protection failed'
 prior=json.loads((ops/'account-postgres-backups/latest-success.json').read_text());attempt=json.loads((ops/'account-postgres-backups/latest-attempt.json').read_text());assert prior==attempt and prior['status']=='verified' and prior['sourceSha256']==old['sourceSha256'] and datetime.datetime.fromisoformat(prior['dataComparedAt'])>=refresh_began
 start_budget=two_starts;pre_protection={'mode':'normal-service-fresh-comparison-after-budget-window','manualPreUpdateStarts':1,'checkedAt':prior['checkedAt'],'dataComparedAt':prior['dataComparedAt'],'restoredAt':prior['restoredAt'],'snapshot':prior['snapshot'],'newSnapshotCreated':prior['newSnapshotCreated'],'directCalendarSuccessClaimed':False}
d.save(stage/'pre-update-protection.json',pre_protection)
with b.worker_lock(ops/'external-s3/scheduled'),u.operation_locks(base):
 u.ensure_idle(base);u.expect_current(base,SETTINGS['before']['webManifestSha256']);assert d.pointer(base/'account-service')==SETTINGS['before']['backendCurrent']
 prior=json.loads((ops/'account-postgres-backups/latest-success.json').read_text());attempt=json.loads((ops/'account-postgres-backups/latest-attempt.json').read_text());assert prior['status']==attempt['status']=='verified' and prior['snapshot']==attempt['snapshot'] and prior['sourceSha256']==old['sourceSha256']
 prior_payload=pathlib.Path(prior['localPayload']);metadata=pb.verify_payload(prior_payload,retained=True)
 payload=stage/'isolated-candidate-payload-v2';assert not payload.exists();payload.mkdir(mode=0o700);assert payload.resolve().parent==stage
 for name in metadata['files']:
  if name in {'release.tar.gz','previous-release.tar.gz','profile.json'}:continue
  if name=='postgres-image.tar.gz':
   assert pb.images.descriptor(old['imageArchive'])==metadata['files'][name]
   pb.copy(old['imageArchive'],payload/name,immutable=True)
  else:pb.copy(prior_payload/name,payload/name)
 candidate={**old,'archive':str(stage/'release.tar.gz'),'archiveSha256':SETTINGS['archiveSha'],'sourceSha256':manifest['sourceSha256'],'previousArchive':old['archive'],'previousArchiveSha256':old['archiveSha256']}
 pb.copy(stage/'release.tar.gz',payload/'release.tar.gz');pb.copy(old['archive'],payload/'previous-release.tar.gz');d.save(payload/'profile.json',candidate)
 files=pb.tree(payload);fingerprint=digest(json.dumps({'isolatedCandidate':True,'priorSnapshot':prior['snapshot'],'source':manifest['sourceSha256'],'files':files},sort_keys=True).encode())
 combined={**metadata,'createdAt':stamp(),'sourceSha256':manifest['sourceSha256'],'archiveSha256':SETTINGS['archiveSha'],'previousArchiveSha256':old['archiveSha256'],'files':files,'fingerprint':fingerprint,'isolatedCandidateFixture':True};d.save(payload/'account-payload.json',combined);pb.verify_payload(payload)
 proof=pb.exercise_restore(payload,pwd.getpwnam('melodiajest-account'));assert proof['apiHealth']=='ok' and proof['sourceSha256']==manifest['sourceSha256'] and proof['dataDigestMatched'] and proof['productionVolumesMounted'] is False
 assert json.loads((ops/'account-profile.json').read_text())==old and d.pointer(base/'account-service')==SETTINGS['before']['backendCurrent']
 u.ProductionRuntime(base).neighbors()
 result={'status':'isolated-candidate-reader-verified-current-data-protected','checkedAt':stamp(),'stage':str(stage),'artifactSha256':SETTINGS['archiveSha'],'webManifestSha256':SETTINGS['manifestSha'],'newSourceSha256':manifest['sourceSha256'],'linuxTestsPassed':39,'startBudgetTestsPassed':7,'startBudget':start_budget,'startBudgetModule':str(budget_path),'startBudgetSha256':SETTINGS['startBudgetSha256'],'linuxSkipped':0,'nativeDailyPreUpdate':native_daily,'preUpdateProtection':pre_protection,'preUpdateAccountSnapshot':prior['snapshot'],'preUpdateDataComparedAt':prior['dataComparedAt'],'isolatedCandidateRestore':proof,'independentCandidateSnapshotClaimed':False,'candidateProfile':candidate,'beforeProfile':old,'expectedBackend':SETTINGS['before']['backendCurrent'],'expectedWebManifest':SETTINGS['before']['webManifestSha256'],'caddySha256':SETTINGS['before']['caddySha256'],'caddyInode':SETTINGS['before']['caddyInode'],'timerHashes':SETTINGS['before']['timerHashes'],'developmentPin':SETTINGS['before']['developmentPin'],'updater':SETTINGS['updater'],'liveApiAndPublicUnchanged':True,'dataMigrationPerformed':False,'newTimersCreated':0}
 d.save(stage/'candidate-ready.json',result);print(json.dumps(result))
''',timeout=1500)
(root/'tmp/melodiajest-56-server-ready.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:result[k] for k in ['status','checkedAt','stage','artifactSha256','newSourceSha256','linuxTestsPassed','preUpdateAccountSnapshot','liveApiAndPublicUnchanged','dataMigrationPerformed']}))

```

## publish-melodiajest-course-56.py

SHA256 `7c845000855e9ad16b4d30b92ade3c20e46539d571a273217007e25d39e16d5a`

```python
"""Use the existing API/static updaters and existing backup services only."""
import json,runpy,subprocess
from pathlib import Path

root=Path.cwd();ready=json.loads((root/'tmp/melodiajest-56-server-ready.json').read_text(encoding='utf-8'));assert ready['status']=='isolated-candidate-reader-verified-current-data-protected' and ready['linuxTestsPassed']==39
browser=json.loads((root/'docs/qa/melodiajest-2026-11-09-56-browser.json').read_text(encoding='utf-8'))['local'];assert len(browser['cards'])==1 and len(browser['paths'])==2 and len(browser['memory'])==3 and not browser['consoleErrors'];assert all(x['count'] and x['source'] and x['manualReadiness'] and x['checkpointOnly'] for x in browser['cards']);assert all(x['focus']['tag']=='H2' for x in browser['paths']);assert {x['id'] for x in browser['enterExpanded']['prerequisites']}=={'detail-p-black-position-left-01','detail-p-scale-04'};assert all(x['cards']==0 and not x['body'] and x['preparations']==0 and x['choiceDisabled'] for x in browser['memory']);assert {x['from'] for x in browser['memory']}=={'compact','expanded','hidden'};assert all(browser['keyboardMouse'].values());assert browser['hiddenReload']['mode']=='hidden' and browser['hiddenReload']['cardCount']==0 and browser['serverAcknowledgement']['dom']=='Сохранено в аккаунте';assert browser['mobile']['innerWidth']==390 and browser['mobile']['visibleLines']<=5.001 and browser['viewportReset']
proof_path=root/'tmp/melodiajest-56-local-proof.json';proof=json.loads(proof_path.read_text(encoding='utf-8'));proof.update(browserVerificationPending=False,browserVerified=True,browserReport='docs/qa/melodiajest-2026-11-09-56-browser.json',ownPreviewClosed=True);proof_path.write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
h=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
code=r'''
import datetime,hashlib,json,os,pathlib,shutil,subprocess,sys,urllib.error,urllib.request
base=pathlib.Path('/opt/melodiajest');ops=base/'ops';stage=pathlib.Path(READY['stage']);profile_path=ops/'account-profile.json';old=READY['beforeProfile'];candidate=READY['candidateProfile'];tool=pathlib.Path(old['tooling']);sys.path.insert(0,str(tool/'service'));sys.path.insert(0,READY['updater'])
import deployment as d,operate,account_backup as account,release_update as u,release_backup as b
read=lambda p:json.loads(p.read_text());digest=lambda data:hashlib.sha256(data).hexdigest();stamp=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
prefix=['python3','-B',str(pathlib.Path(READY['updater'])/'release_update.py')]
archive=stage/'release.tar.gz';backend_changed=False;web_committed=False;new_pointer=None
def guard_controls():
 caddy=pathlib.Path('/opt/libre/deploy/vps/Caddyfile');assert (digest(caddy.read_bytes()),caddy.stat().st_ino)==(READY['caddySha256'],READY['caddyInode'])
 assert {name:digest(pathlib.Path(name).read_bytes()) for name in READY['timerHashes']}==READY['timerHashes']
 assert read(ops/'s3-schedule.json')['developmentArchiveSha256']==READY['developmentPin']
def native(unit):
 r=subprocess.run(['systemctl','start',unit],capture_output=True,text=True,timeout=850)
 assert r.returncode==0,'Existing own unit failed: '+unit
 state=subprocess.check_output(['systemctl','show',unit,'-p','Result','-p','ExecMainStatus'],text=True);assert 'Result=success' in state and 'ExecMainStatus=0' in state
try:
 with b.worker_lock(ops/'external-s3/scheduled'),u.operation_locks(base):
  import importlib.util
  budget_path=pathlib.Path(READY['startBudgetModule']);assert digest(budget_path.read_bytes())==READY['startBudgetSha256'];budget_spec=importlib.util.spec_from_file_location('melodiajest_release_budget30',budget_path);budget=importlib.util.module_from_spec(budget_spec);budget_spec.loader.exec_module(budget);budget_now=budget.observe_start_budget(planned_starts=1);assert budget_now['allowed'],'Native account start budget changed before reader switch; wait without changing readers'
  u.ensure_idle(base);u.expect_current(base,READY['expectedWebManifest']);u.ProductionRuntime(base).neighbors();guard_controls();assert read(profile_path)==old and d.pointer(base/'account-service')==READY['expectedBackend'];assert shutil.disk_usage(base).free>900*1024*1024
  copy=read(ops/'account-postgres-backups/latest-success.json');attempt=read(ops/'account-postgres-backups/latest-attempt.json');assert copy['status']==attempt['status']=='verified' and copy['snapshot']==READY['preUpdateAccountSnapshot'] and copy['snapshot']==attempt['snapshot'];assert (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(copy['dataComparedAt'])).total_seconds()<1800
  staged=d.stage_sources(base/'account-service',archive,READY['artifactSha256']);new_pointer='releases/'+pathlib.Path(staged['directory']).name;assert staged['manifest']['sourceSha256']==READY['newSourceSha256']
  updated_api=d.apply_backend(base/'account-service',new_pointer,READY['expectedBackend'],operate.Runtime(),ops/'account-update.json');assert updated_api['status']=='committed';backend_changed=True
  d.save(profile_path,candidate);guard_controls();d.save(stage/'api-installed.json',{'checkedAt':stamp(),'backend':updated_api,'dataMigrationPerformed':False,'publicVersion':'23.5.77'})
 # This actual independent snapshot contains the exact candidate browser files,
 # new registry/reader, previous compatible reader, current data and controls.
 native('melodiajest-account-backup.service')
 protected=read(ops/'account-postgres-backups/latest-success.json');attempt=read(ops/'account-postgres-backups/latest-attempt.json');assert protected['status']==attempt['status']=='verified' and protected['snapshot']==attempt['snapshot'] and protected['sourceSha256']==READY['newSourceSha256']
 payload=read(pathlib.Path(protected['localPayload'])/'account-payload.json');assert payload['archiveSha256']==READY['artifactSha256'] and payload['previousArchiveSha256']==old['archiveSha256'] and protected['restore']['dataDigestMatched'] and protected['restore']['productionVolumesMounted'] is False
 args=[str(archive),'--sha256',READY['artifactSha256'],'--expected-current',READY['expectedWebManifest']]
 plan=json.loads(subprocess.check_output(prefix+['plan']+args,text=True,timeout=90));assert plan['version']=='23.5.78' and plan['newSha256']==READY['webManifestSha256'] and plan['changed'];d.save(stage/'public-plan.json',plan)
 run=subprocess.run(prefix+['install']+args,capture_output=True,text=True,timeout=300)
 if run.returncode:raise RuntimeError('Own permanent static updater failed; inspect transaction receipt')
 updated_web=json.loads(run.stdout);assert updated_web['phase']=='committed' and updated_web['verification']['healthy'] and updated_web['verification']['publicFilesVerified']==40;web_committed=True
 with u.operation_locks(base):
  guard_controls();assert u.current_sha(base)==READY['webManifestSha256'] and d.pointer(base/'account-service')==new_pointer;assert account.request('/run/melodiajest-account/api.sock','/health')[1]['implementationSha256']==READY['newSourceSha256'];u.ProductionRuntime(base).neighbors()
 publication={'checkedAt':stamp(),'status':'api-and-static78-verified-independent-account-copy-confirmed','version':'23.5.78','operationsPhase':'2026-11-09-56','musicalBatch':'2026-11-09-14','newLessonsThisOperationsPhase':0,'newLessons':0,'reviewedLessons':0,'newLearningRecordCount':1,'newIndependentGoalCount':0,'newCheckpointCount':1,'artifactSha256':READY['artifactSha256'],'webManifestSha256':READY['webManifestSha256'],'sourceSha256':READY['newSourceSha256'],'apiPointer':new_pointer,'previousApiPointer':READY['expectedBackend'],'webUpdate':updated_web,'apiUpdate':updated_api,'prePublicationAccountSnapshot':protected['snapshot'],'dataMigrationPerformed':False,'newTimersCreated':0,'caddyAndTimersUnchanged':True,'developmentPinPreserved':True}
 d.save(stage/'published.json',publication)
except Exception:
 # Restore only our compatible readers and profile. Never replace the live DB.
 actual=u.current_sha(base)
 if actual==READY['webManifestSha256']:
  r=subprocess.run(prefix+['rollback','--expected-current',READY['webManifestSha256']],capture_output=True,text=True,timeout=300);assert r.returncode==0,'Own web rollback failed'
 else:assert actual==READY['expectedWebManifest'],'Own web pointer changed concurrently; inspect before rollback'
 if backend_changed:
  with b.worker_lock(ops/'external-s3/scheduled'),u.operation_locks(base):
   assert d.pointer(base/'account-service')==new_pointer and read(profile_path) in [old,candidate]
   d.apply_backend(base/'account-service',READY['expectedBackend'],new_pointer,operate.Runtime(),ops/'account-update.json');d.save(profile_path,old);guard_controls()
  # Do not spend an unplanned fifth start or interrupt native backoff on an
  # error path. Preserve the failed receipt and leave recovery explicit.
  recovery={'status':'pending-native-backoff-or-budget','manualStartPerformed':False}
  try:
   recovery_budget=budget.observe_start_budget(planned_starts=1)
   recovery['startBudget']=recovery_budget
   if recovery_budget['allowed']:
    native('melodiajest-account-backup.service');recovery={'status':'normal-service-verified','manualStartPerformed':True}
  except ValueError:pass
  d.save(stage/'rollback-account-protection.json',recovery)
 d.save(stage/'rollback-result.json',{'checkedAt':stamp(),'status':'own-readers-restored-inspect-account-protection','dataRestorePerformed':False,'publicManifestSha256':u.current_sha(base)})
 raise
# A separate measurable post-release protection phase. A transient backup error
# leaves the already protected working release available for an exact retry.
for unit in ['melodiajest-backup.service','melodiajest-restore-check.service','melodiajest-backup-health.service']:native(unit)
external=read(ops/'external-s3/scheduled/last-success.json');restored=read(ops/'external-s3/scheduled/last-restore-success.json');health=read(ops/'external-s3/scheduled/health.json');assert health['success'] and health['accountBackup']['success'] and restored['independentExternalCopyVerified'] and restored['snapshotId']==external['snapshotId']
assert restored['publishedRestore']['entries']['current']['manifestSha256']==READY['webManifestSha256'];assert restored['publishedRestore']['entries']['previous']['manifestSha256']==READY['expectedWebManifest']
with u.operation_locks(base):guard_controls();u.ProductionRuntime(base).neighbors();assert u.current_sha(base)==READY['webManifestSha256']
publication.update(status='published-and-account-static-independent-restores-verified',postReleaseVerifiedAt=stamp(),accountCopy=protected,externalSnapshot=external['snapshotId'],externalRestore=restored,health=health);d.save(stage/'complete.json',publication);print(json.dumps(publication))
'''
r=subprocess.run(h['ssh_command']()+['python3','-B','-'],input='READY='+repr(ready)+'\n'+code,text=True,encoding='utf-8',capture_output=True,timeout=2400)
if r.returncode:print(r.stdout[-1800:]);print(r.stderr[-3000:]);r.check_returncode()
d=json.loads(r.stdout);(root/'tmp/melodiajest-56-published.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:d[k] for k in ['status','version','newLessons','artifactSha256','webManifestSha256','sourceSha256','apiPointer','prePublicationAccountSnapshot','externalSnapshot','caddyAndTimersUnchanged']}))

```

## verify-melodiajest-course-56-public.py

SHA256 `25f05694c272cf70b2e8259a862dfcdc4577db7f50b2c68d5c48559391d5bdac`

```python
import json,runpy,subprocess
from pathlib import Path
h=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
code=r'''
import datetime,hashlib,json,pathlib,shutil,socket,ssl,subprocess,urllib.error,urllib.request
base=pathlib.Path('/opt/melodiajest');ops=base/'ops'
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):return None
opener=urllib.request.build_opener(NoRedirect())
def head(url):
 try:
  with opener.open(urllib.request.Request(url,method='HEAD'),timeout=15) as r:return {'status':r.status,'location':r.headers.get('Location')}
 except urllib.error.HTTPError as e:return {'status':e.code,'location':e.headers.get('Location')}
redirects={'http':head('http://melodiajest.ru/'),'www':head('https://www.melodiajest.ru/')};assert redirects['http']['status']==308 and redirects['www']['status']==301
paths={path:head('https://melodiajest.ru'+path)['status'] for path in ['/server.cjs','/trainer-content.json','/.git/config','/.env','/service/server.cjs','/service/course-registry.json','/api/content','/api/launch-app']};assert all(status in [401,403,404,405] for status in paths.values())
certs={}
for host in ['melodiajest.ru','www.melodiajest.ru']:
 with socket.create_connection((host,443),timeout=10) as raw:
  with ssl.create_default_context().wrap_socket(raw,server_hostname=host) as tls:certs[host]={'verified':True,'expires':tls.getpeercert()['notAfter']}
with urllib.request.urlopen('https://melodiajest.ru/web-release.json',timeout=15) as r:data=r.read(131073);assert len(data)<=131072
manifest=json.loads(data);sha=hashlib.sha256(data).hexdigest();assert manifest['version']=='23.5.78' and sha==EXPECTED['webManifestSha256']
with urllib.request.urlopen('https://melodiajest.ru/api/service/v1/health',timeout=15) as r:api=json.load(r);assert api['engine']=='postgres' and api['implementationSha256']==EXPECTED['sourceSha256'] and api['databaseSchemaVersion']==2 and api['courseSha256']=='334e7971ea614a6dd155e94cd9deb074ebd0d15b13befaaed4351319e09d94ee'
web=json.loads(subprocess.check_output(['docker','inspect','melodiajest-web-1'],text=True))[0];assert web['State']['Health']['Status']=='healthy';aliases=web['NetworkSettings']['Networks']['libre_public']['Aliases'];assert all(name.startswith('melodiajest-') for name in aliases)
def sd(unit,props):return dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show',unit]+[x for p in props for x in ['-p',p]],text=True).splitlines() if '=' in line)
read=lambda p:json.loads(p.read_text());health=read(ops/'external-s3/scheduled/health.json');assert health['success'] and health['accountBackup']['success'] and health['accountBackup']['sourceSha256']==api['implementationSha256']
result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'publicVersion':manifest['version'],'manifestSha256':sha,'publicFilesPreviouslyHashVerified':40,'redirects':redirects,'certificates':certs,'forbiddenPaths':paths,'api':{k:api[k] for k in ['status','engine','implementationSha256','databaseSchemaVersion','courseSha256']},'staticAliases':aliases,'staticService':web['Config']['Labels']['com.docker.compose.service'],'current':(base/'current').readlink().as_posix(),'previous':(base/'previous').readlink().as_posix(),'health':health,'hourlyService':sd('melodiajest-backup-health.service',['Result','ExecMainStatus','ExecMainStartTimestamp','ExecMainExitTimestamp','InvocationID']),'hourlyTimer':sd('melodiajest-backup-health.timer',['LastTriggerUSec','NextElapseUSecRealtime','ActiveState','UnitFileState']),'accountTimer':sd('melodiajest-account-backup.timer',['LastTriggerUSec','NextElapseUSecRealtime','ActiveState','UnitFileState']),'resources':{'freeDiskBytes':shutil.disk_usage(base).free,'api':sd('melodiajest-account.service',['MemoryCurrent','MemoryPeak','CPUUsageNSec']),'containers':[json.loads(line) for line in subprocess.check_output(['docker','stats','--no-stream','--format','{{json .}}','melodiajest-web-1','melodiajest-postgres-1'],text=True).splitlines()],'loadTest':False},'billingMeasured':False}
print(json.dumps(result))
'''
r=subprocess.run(h['ssh_command']()+['python3','-B','-'],input='EXPECTED='+repr(json.loads(Path('tmp/melodiajest-56-published.json').read_text(encoding='utf-8')))+'\n'+code,text=True,encoding='utf-8',capture_output=True,timeout=180)
if r.returncode:print(r.stderr[-2200:]);r.check_returncode()
d=json.loads(r.stdout);Path('tmp/melodiajest-56-final-public.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:d[k] for k in ['checkedAt','publicVersion','redirects','forbiddenPaths','staticAliases','hourlyService','hourlyTimer','accountTimer']}))

```

## record-calendar-77-phase56.py

SHA256 `3482fec2d894922519d062a7e389436fcbd2c0edd03ab9d60cd48a205088c548`

```python
import datetime,json
from pathlib import Path
root=Path.cwd();x=json.loads((root/'tmp/melodiajest-56-native-observation.json').read_text(encoding='utf-8'));u=x['units']['hourly'];timer=x['units']['hourlyTimer'];rows=x['journal']['hourly'];inv=u['InvocationID']
assert inv=='8f185f9865a44c06911897daf8f76da2' and u['Result']=='success' and u['ExecMainStatus']=='0' and u['ActiveState']=='inactive'
assert timer['LastTriggerUSec']==u['ExecMainStartTimestamp'] and timer['ActiveState']=='active'
parsed=[]
for row in rows:
 assert row.get('_SYSTEMD_INVOCATION_ID',row.get('INVOCATION_ID'))==inv
 try:parsed.append(json.loads(row['MESSAGE']))
 except (ValueError,KeyError):pass
base=x['receipts']['baseHealth'];external=x['receipts']['externalHealth'];assert base in parsed and external in parsed
assert base['success'] and external['success'] and external['s3RequestsThisCheck']==0
starts=[r for r in rows if r.get('MESSAGE','').startswith('Starting ')];ends=[r for r in rows if r.get('MESSAGE','').startswith('Finished ') and r.get('JOB_RESULT')=='done'];assert len(starts)==len(ends)==1
stamp=lambda r:datetime.datetime.fromtimestamp(int(r['__REALTIME_TIMESTAMP'])/1000000,datetime.timezone.utc).isoformat()
started=stamp(starts[0]);finished=stamp(ends[0]);assert started<=base['checkedAt']<=finished and started<=external['checkedAt']<=finished
account=x['receipts']['accountSuccess'];assert account['snapshot']=='a02a4e05ed56109344c5d6fd5ba0ce7b0cc9c38f6400734c6ba012e014f21d50' and account['restoredAt']=='2026-11-09T13:30:50.895910+00:00'
result={'kind':'calendar-hourly77-before-candidate78','invocationId':inv,'startedAt':started,'finishedAt':finished,'timerMatched':True,'journalMatched':True,'bothFullReceiptsExactlyMatched':True,
 'unit':u,'timer':timer,'base':base,'external':external,'accountSnapshot':account['snapshot'],'sourceSha256':account['sourceSha256'],'restoredAt':account['restoredAt'],'dataComparedAt':account['dataComparedAt'],
 'newBackupCreated':False,'newRestorePerformed':False,'s3RequestsThisCheck':0,'postgresDailyClaimed':False,'journal':rows}
(root/'docs/qa/melodiajest-2026-11-09-56-calendar77.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:result[k] for k in ['invocationId','startedAt','finishedAt','timerMatched','bothFullReceiptsExactlyMatched','newBackupCreated','newRestorePerformed','s3RequestsThisCheck']}))

```

## record-postrelease-native-56.py

SHA256 `2eb24f7715bdbd294f6fa3923a306b231082b4b1b63b5f217ca0cf2882b0e51b`

```python
import datetime,json
from pathlib import Path
root=Path.cwd();r=lambda p:json.loads((root/p).read_text(encoding='utf-8'))
x=r('tmp/melodiajest-56-after-native-observation.json');p=r('tmp/melodiajest-56-published.json');account=p['accountCopy'];u=x['units']['daily'];rows=x['journal']['daily'];inv=u['InvocationID']
assert inv=='a3e4384b4cfe40a789a2678434605f94' and u['Result']=='success' and u['ExecMainStatus']=='0' and u['StartLimitBurst']=='4' and u['StartLimitIntervalUSec']=='2h'
published=[]
for row in rows:
 assert row.get('_SYSTEMD_INVOCATION_ID',row.get('INVOCATION_ID'))==inv
 try:
  value=json.loads(row.get('MESSAGE',''))
  if isinstance(value,dict):published.append(value)
 except ValueError:pass
assert len(published)==1 and all(k in account and account[k]==v for k,v in published[0].items())
start=next(r for r in rows if r.get('MESSAGE','').startswith('Starting '));end=next(r for r in rows if r.get('MESSAGE','').startswith('Finished ') and r.get('JOB_RESULT')=='done')
stamp=lambda row:datetime.datetime.fromtimestamp(int(row['__REALTIME_TIMESTAMP'])/1e6,datetime.timezone.utc).isoformat()
assert stamp(start)<=account['checkedAt']<=stamp(end) and x['units']['dailyTimer']['LastTriggerUSec']!=u['ExecMainStartTimestamp']
healthRows=x['journal']['hourly'];healthParsed=[]
for row in healthRows:
 try:healthParsed.append(json.loads(row.get('MESSAGE','')))
 except ValueError:pass
assert x['receipts']['baseHealth'] in healthParsed and x['receipts']['externalHealth'] in healthParsed and x['receipts']['externalHealth']==p['health']
result={'kind':'manual-post-reader-pg78','invocationId':inv,'startedAt':stamp(start),'finishedAt':stamp(end),'unit':u,'publishedReceiptFieldsExactlyMatched':True,'publishedReceipt':published[0],
 'snapshot':account['snapshot'],'sourceSha256':account['sourceSha256'],'restoredAt':account['restoredAt'],'dataComparedAt':account['dataComparedAt'],'calendarDailyClaimed':False,
 'manualHealthBothFullReceiptsExactlyMatched':True,'manualHealth':r('tmp/melodiajest-56-health-executions.json'),'accountStartLimitUnchanged':True,'systemdInternalCounterRead':False,'dataMigrationPerformed':False}
(root/'docs/qa/melodiajest-2026-11-09-56-native-postreader.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:result[k] for k in ['invocationId','startedAt','finishedAt','publishedReceiptFieldsExactlyMatched','manualHealthBothFullReceiptsExactlyMatched','calendarDailyClaimed']}))

```
