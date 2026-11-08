import json,runpy,subprocess
from pathlib import Path
h=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
code=r'''
import datetime,json,os,pathlib,subprocess
base=pathlib.Path('/opt/melodiajest');home=base/'ops/server-backups'
def show(unit,properties):return dict(x.split('=',1) for x in subprocess.check_output(['systemctl','show',unit,'--property='+properties],text=True).splitlines() if '=' in x)
timer=show('melodiajest-backup.timer','LastTriggerUSec,NextElapseUSecRealtime')
service=show('melodiajest-backup.service','Result,ExecMainStatus,ExecMainStartTimestamp,ExecMainExitTimestamp')
backup=json.loads((home/'last-backup-success.json').read_text());attempt=json.loads((home/'last-backup-attempt.json').read_text())
restore=json.loads((home/'last-restore-success.json').read_text());health=json.loads((home/'health.json').read_text())
snapshot=json.loads((home/backup['snapshot']).read_text())
stats=json.loads(subprocess.check_output(['docker','stats','--no-stream','--format','{{json .}}','melodiajest-web-1'],text=True))
out={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'current':os.readlink(base/'current'),'scheduledBackup':{'timer':timer,'service':service,'backup':backup,'lastAttempt':attempt},'snapshot':snapshot,'latestRestore':{'checkedAt':restore['checkedAt'],'snapshotId':restore['snapshotId'],'success':restore['success'],'currentManifestSha256':restore['entries']['current']['manifestSha256'],'previousManifestSha256':restore['entries']['previous']['manifestSha256']},'health':health,'ownContainerIdleSample':stats,'hostLoadAverage':os.getloadavg(),'manualJobsStarted':False,'serviceOrPolicyChanged':False}
print(json.dumps(out))
'''
r=subprocess.run(h['ssh_command']()+['python3','-'],input=code,text=True,encoding='utf-8',capture_output=True,timeout=60)
if r.returncode:print(r.stderr[-2500:]);r.check_returncode()
d=json.loads(r.stdout);Path('tmp/melodiajest-11-server.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8');print(json.dumps({'checkedAt':d['checkedAt'],'timer':d['scheduledBackup']['timer'],'service':d['scheduledBackup']['service'],'snapshotId':d['snapshot']['id'],'ownContainerIdleSample':d['ownContainerIdleSample'],'hostLoadAverage':d['hostLoadAverage']}))
