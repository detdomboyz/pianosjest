import datetime, json, runpy, subprocess
from pathlib import Path

helper = runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
remote = r'''
import datetime,hashlib,json,os,pathlib,shutil,subprocess,urllib.request
base=pathlib.Path('/opt/melodiajest');home=base/'ops/server-backups'
def show(unit):return dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show',unit,'--property=LastTriggerUSec,NextElapseUSecRealtime,Result,ExecMainStatus,ExecMainStartTimestamp,ExecMainExitTimestamp'],text=True).splitlines() if '=' in line)
out={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'current':os.readlink(base/'current'),'public':{},'ownUnits':{},'receipts':{},'diskFreeBytes':shutil.disk_usage(base).free}
for name in ['melodiajest.ru','libreta.ru','praicer.ru','grigorova.libreta.ru']:
 with urllib.request.urlopen('https://'+name+'/',timeout=12) as response:out['public'][name]={'status':response.status,'url':response.geturl(),'httpsCertificateVerified':True}
with urllib.request.urlopen('https://melodiajest.ru/web-release.json',timeout=12) as response:
 raw=response.read(131073);assert len(raw)<=131072;out['version']=json.loads(raw)['version'];out['manifestSha256']=hashlib.sha256(raw).hexdigest()
for suffix in ['backup','restore-check','backup-health']:
 for kind in ['timer','service']:out['ownUnits']['melodiajest-'+suffix+'.'+kind]=show('melodiajest-'+suffix+'.'+kind)
for name in ['last-backup-success.json','last-backup-attempt.json','last-restore-success.json','last-restore-attempt.json','health.json']:
 value=json.loads((home/name).read_text());out['receipts'][name]={k:value.get(k) for k in ['checkedAt','success','status','problems','agesSeconds','snapshot','snapshotId','currentManifestSha256'] if k in value}
out['manualJobsStarted']=False;out['serverChanged']=False
print(json.dumps(out))
'''
result = subprocess.run(helper['ssh_command']()+['python3','-'], input=remote, text=True, encoding='utf-8', capture_output=True, timeout=60)
if result.returncode:
    print(result.stderr[-2000:])
    result.check_returncode()
data = json.loads(result.stdout)
assert data['version']=='23.5.38' and data['manifestSha256']=='6a4a36d988c0ca9d716fe03b859d7a2363427562cc5ba76422ed86dfc78cd9cd'
assert all(value['status']==200 for value in data['public'].values())
with Path('tmp/melodiajest-11-final.json').open('x', encoding='utf-8') as target:
    json.dump(data, target, indent=2)
    target.write('\n')
print(json.dumps(data))
