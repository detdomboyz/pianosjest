import json,runpy,subprocess
from pathlib import Path
h=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
code=r'''
import datetime,json,pathlib,subprocess,urllib.request
ops=pathlib.Path('/opt/melodiajest/ops');read=lambda p:json.loads(p.read_text())
def sd(name):return dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',name,'-p','InvocationID','-p','Result','-p','ExecMainStatus','-p','ActiveState','-p','ExecMainStartTimestamp','-p','ExecMainExitTimestamp','-p','LastTriggerUSec','-p','NextElapseUSecRealtime','-p','StartLimitBurst','-p','StartLimitIntervalUSec'],text=True).splitlines() if '=' in x)
units={name:sd(unit) for name,unit in [('hourly','melodiajest-backup-health.service'),('hourlyTimer','melodiajest-backup-health.timer'),('daily','melodiajest-account-backup.service'),('dailyTimer','melodiajest-account-backup.timer')]}
journal={}
for key in ['hourly','daily']:
 inv=units[key].get('InvocationID');journal[key]=[json.loads(x) for x in subprocess.check_output(['journalctl','--no-pager','-o','json','-n','80','INVOCATION_ID='+inv,'+','_SYSTEMD_INVOCATION_ID='+inv],text=True).splitlines()] if inv else []
r={name:read(ops/p) for name,p in [('baseHealth','server-backups/health.json'),('externalHealth','external-s3/scheduled/health.json'),('accountAttempt','account-postgres-backups/latest-attempt.json'),('accountSuccess','account-postgres-backups/latest-success.json')]}
with urllib.request.urlopen('https://melodiajest.ru/web-release.json',timeout=15) as response:version=json.load(response)['version']
print(json.dumps({'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'publicVersion':version,'profile':read(ops/'account-profile.json'),'units':units,'journal':journal,'receipts':r,'mutationsPerformed':False,'archivesDownloaded':False,'backupCreatedByObservation':False}))
'''
r=subprocess.run(h['ssh_command']()+['python3','-B','-'],input=code,text=True,encoding='utf-8',capture_output=True,timeout=80);assert r.returncode==0,r.stderr[-1500:]
d=json.loads(r.stdout);Path('tmp/melodiajest-36-native-observation.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8');print(json.dumps({'checkedAt':d['checkedAt'],'version':d['publicVersion'],'units':d['units'],'receiptTimes':{k:{n:v.get(n) for n in ['checkedAt','dataComparedAt','status','success','snapshot']} for k,v in d['receipts'].items()}}))
