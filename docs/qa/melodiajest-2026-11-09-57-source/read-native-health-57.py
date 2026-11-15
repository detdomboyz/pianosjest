import ast,json,runpy,subprocess
from pathlib import Path
root=Path.cwd();module=ast.parse((root/'tmp/read-melodiajest-native-36.py').read_text(encoding='utf-8'));node=next(n for n in module.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='code' for t in n.targets));code=ast.literal_eval(node.value).replace("'mutationsPerformed':False","'freeBytes':__import__('shutil').disk_usage('/opt/melodiajest').free,'mutationsPerformed':False")
h=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py');result=subprocess.run(h['ssh_command']()+['python3','-B','-'],input=code,text=True,encoding='utf-8',capture_output=True,timeout=90);assert result.returncode==0,result.stderr[-1400:]
d=json.loads(result.stdout);assert d['publicVersion']=='23.5.78' and d['receipts']['externalHealth']['success'] and d['receipts']['baseHealth']['success']
assert d['profile']['sourceSha256']=='2c0af582e1055d802262f248d3a88a7d7a2dc11ed9453d3212116ef8dbc944aa'
(root/'tmp/melodiajest-57-native-observation.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checkedAt':d['checkedAt'],'version':d['publicVersion'],'hourlyInvocationId':d['units']['hourly']['InvocationID'],'hourlyReceiptCheckedAt':d['receipts']['externalHealth']['checkedAt'],'pgSnapshot':d['receipts']['accountSuccess']['snapshot'],'pgRestoredAt':d['receipts']['accountSuccess']['restoredAt'],'freeBytes':d['freeBytes'],'archivesDownloaded':False,'backupCreatedByObservation':False,'mutationsPerformed':False}))
