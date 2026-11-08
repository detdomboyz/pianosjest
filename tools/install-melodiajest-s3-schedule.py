"""Install/roll back own S3 post-hooks after Linux and source-restore proofs.

Uses the existing strict-host-key Windows SSH helper. No service is started,
no timer is created, and no credential value is copied or printed.
"""
import argparse,hashlib,json,re,runpy,subprocess,sys
from pathlib import Path

REMOTE=r'''
import base64,datetime,hashlib,json,os,pathlib,subprocess,sys,tempfile,urllib.request,uuid
base=pathlib.Path('/opt/melodiajest');ops=base/'ops';tool=pathlib.Path(SETTINGS['stage']['stage']);units=pathlib.Path('/etc/systemd/system')
assert tool.parent==ops/'tooling' and tool.resolve()==tool
sys.dont_write_bytecode=True;sys.path.insert(0,str(tool/'deploy/shared-host'))
import backup_s3_schedule as schedule,backup_s3_job as job,backup_s3_runtime as runtime,release_artifact as artifact,release_backup as backup,release_update as update
for name,sha in SETTINGS['stage']['files'].items():assert artifact.sha256(artifact.regular_bytes(tool,name))==sha
source=SETTINGS['source'];archive=pathlib.Path(source['archive']);assert archive==ops/('development-source-'+source['sha256'][:12])/'selected-checkout.tar.gz'
members,meta=artifact.read_bundle(archive,source['sha256']);assert meta['sourceSnapshotIncluded'] and meta['webManifestSha256']==source['webManifestSha256']
for name,sha in SETTINGS['stage']['files'].items():assert artifact.sha256(members['source/'+name])==sha
assert artifact.sha256(members['source/tools/install-melodiajest-s3-schedule.py'])==SETTINGS['installerSha256']
password_copy=job.read(ops/'password-copy-receipt.json');assert password_copy['roundtripVerified'] and password_copy['outsideVps']
config=schedule.validate_configuration({'format':'melodiajest-s3-schedule-v1','enabled':True,'tooling':str(tool),'files':{name:SETTINGS['stage']['files'][name] for name in job.SCHEDULE_TOOL_FILES},'developmentArchiveSha256':source['sha256'],'developmentWebManifestSha256':meta['webManifestSha256'],'passwordCopySha256':password_copy['encryptedFileSha256']})
dropins={units/name:body.encode() for name,body in schedule.render_dropins(tool).items()}
targets={ops/'s3-schedule.json':backup.encoded(config),ops/'s3-backup.json':backup.encoded(runtime.configuration()),ops/'s3-tooling.json':backup.encoded(SETTINGS['stage']),**dropins}
identifier=artifact.sha256(backup.encoded({str(p):artifact.sha256(data) for p,data in targets.items()}))[:16]
installation=pathlib.Path(SETTINGS['rollbackInstallation']) if SETTINGS.get('rollbackInstallation') else ops/('s3-install-'+identifier)
assert installation.parent==ops and installation.name.startswith('s3-install-') and len(installation.name)==27
job.private_directory(installation)
def sites():
 result={}
 for name in ['melodiajest.ru','libreta.ru','praicer.ru','grigorova.libreta.ru']:
  with urllib.request.urlopen('https://'+name+'/',timeout=12) as response:assert response.status==200;result[name]=response.status
 return result
def properties():
 result={}
 for name in schedule.JOBS:
  values=subprocess.check_output(['systemctl','show','melodiajest-'+name+'.service','-p','ActiveState','-p','ExecStart','-p','ExecStartPost','-p','PrivateNetwork','-p','RestrictAddressFamilies','-p','ProtectSystem','-p','MemoryMax'],text=True)
  result[name]=dict(line.split('=',1) for line in values.splitlines())
 return result
def encode(path):
 if not path.exists():assert not path.is_symlink();return None
 assert path.resolve()==path and path.is_file() and not path.is_symlink()
 raw=path.read_bytes();return {**artifact.descriptor(raw),'data':base64.b64encode(raw).decode(),'mode':path.stat().st_mode&0o777}
def decode(entry):
 raw=base64.b64decode(entry['data'],validate=True);assert artifact.descriptor(raw)=={k:entry[k] for k in ['sha256','bytes']};return raw
def put(path,data,mode):
 assert path in targets and not path.is_symlink()
 path.parent.mkdir(mode=0o755 if path in dropins else 0o700,exist_ok=True);assert path.parent.resolve()==path.parent
 temporary=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
 with temporary.open('xb') as output:output.write(data);output.flush();os.fsync(output.fileno())
 temporary.chmod(mode);os.replace(temporary,path);update.sync_directory(path.parent)
def revert(saved,expected_descriptors=None):
 assert set(saved['targets'])=={str(p) for p in targets}
 if expected_descriptors is None:expected_descriptors={str(p):artifact.descriptor(data) for p,data in targets.items()}
 assert set(expected_descriptors)=={str(p) for p in targets}
 for p,expected in targets.items():
  assert not p.is_symlink()
  if p.exists():
   original=saved['targets'][str(p)];assert artifact.descriptor(p.read_bytes())==expected_descriptors[str(p)] or original is not None and p.read_bytes()==decode(original),'Own target changed after installation; inspect before rollback'
 for p in targets:
  entry=saved['targets'][str(p)]
  if entry is None:
   if p.exists():assert p.resolve()==p and p in targets;p.unlink();update.sync_directory(p.parent)
  else:put(p,decode(entry),entry['mode'])
 subprocess.run(['systemctl','daemon-reload'],check=True,timeout=40)
 for p in targets:
  entry=saved['targets'][str(p)];assert (not p.exists()) if entry is None else p.read_bytes()==decode(entry)
before_sites=sites();before_properties=properties();before_caddy=artifact.sha256(pathlib.Path('/opt/libre/deploy/vps/Caddyfile').read_bytes())
with backup.worker_lock(backup.layout(base)):
 with update.operation_locks(base):
  update.ensure_idle(base);update.expect_current(base,source['webManifestSha256'])
  assert all(p['ActiveState'] not in ['active','activating','deactivating'] for p in properties().values()),'Own service is busy; retry later'
  baseline=installation/'before.json'
  if SETTINGS['mode']=='rollback':
   installed_receipt=job.read(installation/'receipt.json');assert artifact.sha256(baseline.read_bytes())==installed_receipt['baselineSha256']
   saved=job.read(baseline);revert(saved,installed_receipt['expectedFiles']);status='rolled-back'
  else:
   if baseline.exists():
    saved=job.read(baseline)
    installed=all(p.exists() and p.read_bytes()==data for p,data in targets.items())
    original=all((not p.exists() and not p.is_symlink()) if saved['targets'][str(p)] is None else p.exists() and p.read_bytes()==decode(saved['targets'][str(p)]) for p in targets)
    assert installed or original,'Partial prior installation requires its explicit rollback'
   else:
    if (ops/'s3-schedule.json').exists():
     old=schedule.validate_configuration(job.read(ops/'s3-schedule.json'))
     for name,body in schedule.render_dropins(old['tooling']).items():assert artifact.regular_bytes(units,name)==body.encode(),'Unrecognized existing own hook'
    else:assert all(not p.exists() and not p.is_symlink() for p in dropins),'Unrecognized existing drop-in'
    saved={'format':'melodiajest-s3-install-baseline-v1','targets':{str(p):encode(p) for p in targets},'baseUnits':{name:encode(units/name) for name in backup.UNITS},'caddySha256':before_caddy,'publicManifestSha256':source['webManifestSha256']}
    job.save(baseline,saved)
   # Read the saved copy and restore its actual bytes to a fresh private fixture.
   saved=job.read(baseline)
   with tempfile.TemporaryDirectory(prefix='verify-before-',dir=installation) as temporary:
    work=pathlib.Path(temporary);assert work.resolve()==work and work.parent==installation
    for number,entry in enumerate([*saved['targets'].values(),*saved['baseUnits'].values()]):
     if entry is not None:
      p=work/str(number);p.write_bytes(decode(entry));assert artifact.descriptor(p.read_bytes())=={k:entry[k] for k in ['sha256','bytes']}
   try:
    for p,data in targets.items():put(p,data,0o644 if p in dropins else 0o600)
    subprocess.run(['systemd-analyze','verify',*[str(units/('melodiajest-'+name+'.service')) for name in schedule.JOBS]],check=True,capture_output=True,timeout=40)
    subprocess.run(['systemctl','daemon-reload'],check=True,timeout=40)
    after_properties=properties()
    for name,old in before_properties.items():
     assert after_properties[name]['ExecStart'].split('; start_time=')[0]==old['ExecStart'].split('; start_time=')[0]
     for key in ['PrivateNetwork','RestrictAddressFamilies','ProtectSystem','MemoryMax']:assert after_properties[name][key]==old[key]
     assert str(tool)+'/deploy/shared-host/backup_s3_schedule.py '+schedule.JOBS[name] in after_properties[name]['ExecStartPost']
    status='installed'
   except Exception:
    # Revert only this installation's own expected bytes, never other edits.
    revert(saved);job.save(installation/'last-attempt.json',{'checkedAt':job.now(),'status':'rolled-back-after-install-failure'});raise
  for name,entry in saved['baseUnits'].items():assert (units/name).read_bytes()==decode(entry)
  assert artifact.sha256(pathlib.Path('/opt/libre/deploy/vps/Caddyfile').read_bytes())==saved['caddySha256']
  update.expect_current(base,source['webManifestSha256'])
result={'checkedAt':job.now(),'status':status,'installation':str(installation),'baseline':str(baseline),'baselineSha256':artifact.sha256(baseline.read_bytes()),'baselineFileRestoreVerified':True,'stage':str(tool),'developmentArchiveSha256':source['sha256'],'newTimersCreated':0,'baseUnitFilesUnchanged':6,'ownDropins':3,'expectedFiles':{str(p):artifact.descriptor(data) for p,data in targets.items()},'sharedAndOwnLocksUsed':True,'beforeSites':before_sites,'afterSites':sites(),'beforeProperties':before_properties,'afterProperties':properties(),'publicReleaseChanged':False,'caddyChanged':False}
job.save(installation/'last-attempt.json',{'checkedAt':result['checkedAt'],'status':status});job.save(installation/('rollback-receipt.json' if status=='rolled-back' else 'receipt.json'),result);print(json.dumps(result))
'''

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('mode',choices=['install','rollback']);parser.add_argument('--stage-proof',required=True,type=Path);parser.add_argument('--source-proof',required=True,type=Path);parser.add_argument('--output',required=True,type=Path);parser.add_argument('--rollback-installation');args=parser.parse_args()
 root=Path(__file__).resolve().parents[1];stage=json.loads(args.stage_proof.read_text(encoding='utf-8'));source=json.loads(args.source_proof.read_text(encoding='utf-8'))
 assert re.fullmatch(r'/opt/melodiajest/ops/tooling/s3-[a-f0-9]{16}',stage['stage']) and stage['linuxContractPassed']>=34 and stage['windowsOnlySkipped']==1
 assert source['fileRestoreVerified'] and re.fullmatch(r'[a-f0-9]{64}',source['sha256']) and source['archive']=='/opt/melodiajest/ops/development-source-'+source['sha256'][:12]+'/selected-checkout.tar.gz'
 for name,sha in stage['files'].items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==sha
 if args.rollback_installation:assert args.mode=='rollback' and re.fullmatch(r'/opt/melodiajest/ops/s3-install-[a-f0-9]{16}',args.rollback_installation)
 settings={'mode':args.mode,'stage':stage,'source':source,'installerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'rollbackInstallation':args.rollback_installation}
 helper=runpy.run_path(r'C:\Users\Alexander\Documents\web\diary\deploy\production\ssh_client.py')
 result=subprocess.run(helper['ssh_command']()+['python3','-B','-'],input='SETTINGS='+repr(settings)+'\n'+REMOTE,capture_output=True,text=True,encoding='utf-8',timeout=200)
 if result.returncode:
  print(result.stderr[-2200:],file=sys.stderr);raise SystemExit(result.returncode)
 value=json.loads(result.stdout);args.output.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:value[k] for k in ['status','installation','baselineFileRestoreVerified','newTimersCreated','ownDropins','publicReleaseChanged']}))

if __name__=='__main__':main()
