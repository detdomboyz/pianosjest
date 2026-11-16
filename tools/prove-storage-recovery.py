"""Exercise API/data and both static versions from a verified private D: copy."""
import argparse
import json
from pathlib import Path
import runpy


REMOTE = r'''
import json,pathlib,os,pwd,sys,importlib.util,subprocess,uuid,time
started=time.monotonic();scratch=pathlib.Path(SCRATCH);base=pathlib.Path('/opt/melodiajest')
assert scratch.parent==base/'ops' and scratch.name.startswith('storage-restore-')
profile=json.loads((scratch/'ops/account-profile.json').read_text())
tool=scratch/pathlib.Path(profile['tooling']).relative_to(base)
sys.path.insert(0,str(tool/'service'));sys.path.insert(0,str(tool/'deploy/shared-host'))
spec=importlib.util.spec_from_file_location('restored_pg_worker',tool/'service/postgres_backup.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
payload=scratch/PAYLOAD
worker.verify_payload(payload,retained=True)
uid=pwd.getpwnam('melodiajest-account');assert uid.pw_uid>0 and uid.pw_gid>0
fixture=base/'ops'/('storage-api-input-'+uuid.uuid4().hex);fixture.mkdir(mode=0o700)
result={'inputWasRestoredFromPrivatePCArchive':True,'productionVolumesMounted':False,'api':{},'static':{}}
try:
 for p in payload.rglob('*'):
  if p.name=='protection-receipt.json':continue
  target=fixture/p.relative_to(payload)
  if p.is_dir():target.mkdir(mode=0o700,exist_ok=True)
  else:target.parent.mkdir(parents=True,exist_ok=True);os.link(p,target)
 with ns['locks'](base):
  result['api']['current']=worker.exercise_restore(fixture,uid)
  # Explicit test fixture: previous API against the copied current snapshot.
  # This does not create or relabel an actual historical database backup.
  (fixture/'release.tar.gz').unlink();os.link(fixture/'previous-release.tar.gz',fixture/'release.tar.gz')
  metadata=json.loads((fixture/'account-payload.json').read_text())
  descriptor=worker.images.descriptor(fixture/'release.tar.gz')
  _,source=worker.deployment.source_plan(fixture/'release.tar.gz',descriptor['sha256'])
  metadata['archiveSha256']=descriptor['sha256'];metadata['sourceSha256']=source['sourceSha256'];metadata['files']['release.tar.gz']=descriptor
  (fixture/'account-payload.json').unlink();(fixture/'account-payload.json').write_text(json.dumps(metadata))
  result['api']['previousCompatibilityFixture']=worker.exercise_restore(fixture,uid)
  result['previousDatabaseIsTestFixtureOfCurrentSnapshot']=True
  image=json.loads(subprocess.check_output(['docker','inspect','melodiajest-web-1']))[0]['Image']
  for label,pointer in [('current','current'),('previous','previous')]:
   root=scratch/MANIFEST['state']['pointers'][pointer]['target'];manifest=json.loads((root/'web-release.json').read_text())
   name='melodiajest-static-restore-'+uuid.uuid4().hex[:12]
   command=['docker','run','-d','--rm','--pull','never','--name',name,'--label','com.melodiajest.role=static-storage-restore','--network','none','--read-only','--user','101:101','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','64m','--cpus','0.25','--pids-limit','32','--tmpfs','/tmp:rw,uid=101,gid=101,size=16m','--mount','type=bind,source='+str(root)+',target=/usr/share/nginx/html,readonly','--mount','type=bind,source='+str(scratch/'deploy/nginx.conf')+',target=/etc/nginx/nginx.conf,readonly','--entrypoint','nginx',image,'-g','daemon off;']
   try:
    subprocess.run(command,check=True,capture_output=True,timeout=30)
    for attempt in range(30):
     response=subprocess.run(['docker','exec',name,'wget','-qO-','http://127.0.0.1:8080/web-release.json'],capture_output=True,timeout=10)
     if response.returncode==0:break
     time.sleep(.1)
    assert response.returncode==0 and json.loads(response.stdout)==manifest
    for path in ('/','/trainer.html','/healthz'):
     assert subprocess.run(['docker','exec',name,'wget','-qO-','http://127.0.0.1:8080'+path],capture_output=True,timeout=10).returncode==0
    for path in ('/server.cjs','/trainer-content.json','/.git/config'):
     denied=subprocess.run(['docker','exec',name,'wget','-S','-O','/dev/null','http://127.0.0.1:8080'+path],capture_output=True,timeout=10)
     assert denied.returncode!=0 and b'404' in denied.stderr
    result['static'][label]={'version':manifest['version'],'httpPathsVerified':True,'serviceFilesDenied':True,'network':'none','productionVolumesMounted':False}
   finally:worker.stop_owned(name,'static-storage-restore')
finally:
 for p in sorted(fixture.rglob('*'),key=lambda x:len(x.parts),reverse=True):
  if p.is_dir():p.rmdir()
  else:p.unlink()
 fixture.rmdir()
result['elapsedSeconds']=round(time.monotonic()-started,3)
print(json.dumps(result))
'''


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',type=Path,required=True);parser.add_argument('--ssh-helper',type=Path,required=True);a=parser.parse_args()
    client=runpy.run_path(str(Path(__file__).with_name('host-storage-maintenance.py')))
    if not a.run.resolve().is_relative_to(client['PRIVATE'].resolve()):raise ValueError('private D: directory required')
    receipt=json.loads((a.run/'receipt.json').read_text());manifest=json.loads((a.run/'manifest.json').read_text())
    if receipt.get('linuxRestoreVerified') is not True:raise ValueError('isolated file restore is required first')
    payload=[x for x in manifest['selected'] if x.startswith('ops/account-postgres-backups/verified-')]
    if len(payload)!=1:raise ValueError('one verified PostgreSQL snapshot required')
    ssh=runpy.run_path(str(a.ssh_helper))['ssh_command']()
    code=client['module_code']()+REMOTE.replace('SCRATCH',repr(receipt['linuxScratch'])).replace('PAYLOAD',repr(payload[0])).replace('MANIFEST',repr(manifest))
    proof=client['remote'](ssh,code);client['write'](a.run/'recovery-exercise.json',proof)
    client['call'](ssh,dict(action='cleanup-restored',scratch=receipt['linuxScratch'],manifest=manifest))
    print(json.dumps(proof))


if __name__=='__main__':main()
