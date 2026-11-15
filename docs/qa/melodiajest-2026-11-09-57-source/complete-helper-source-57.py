import base64,copy,hashlib,json,shutil,sys
from pathlib import Path
root=Path.cwd()
def r(p):return json.loads((root/p).read_text(encoding='utf-8-sig'))
def w(p,v):(root/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=r('docs/product-development-state.json');s=r('docs/piano-curriculum-state.json');qa=r('docs/qa/melodiajest-2026-11-09-57-local.json');before=r('tmp/melodiajest-57-before-product-development-state.json');old=r('tmp/melodiajest-57-final-source-checkpoint.json');a=r('tmp/melodiajest-57-artifact.json');o=p['operations']
assert old['sha256']=='763077fea9d5d02d654e998183523e4a09bcdaa9e8f3dfff8dcca3c9eb0bd490'
assert hashlib.sha256(Path(old['archive']).read_bytes()).hexdigest()==old['sha256']
old.update(helperBodiesIncluded=False,helperDigestsOnly=True,completenessCorrection='docs allowlist includes md/json,not rawpy/cjs. This local restore retained application sources and helper digests;the checked JSON envelope is provided by the later final-verified checkpoint.')
w('tmp/melodiajest-57-final-source-initial-checkpoint.json',old)
folder=root/'docs/qa/melodiajest-2026-11-09-57-source';shutil.copyfile(root/'tmp/complete-helper-source-57.py',folder/'complete-helper-source-57.py')
source=r('docs/qa/melodiajest-2026-11-09-57-operations-source.json');encoded={}
for f in sorted(folder.iterdir()):
 raw=f.read_bytes();encoded[f.name]={'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'base64':base64.b64encode(raw).decode('ascii')}
for name,item in encoded.items():assert base64.b64decode(item['base64'])==(folder/name).read_bytes()
source.update(exactSources={name:item['sha256'] for name,item in encoded.items()},encodedSources=encoded,sourceEnvelopeEncoding='base64-authoritative-original-bytes;SHA256-and-size-per-file',rawScriptFilesSelectedByDocsAllowlist=False,sourceEnvelopeReadBackVerified=True,archivedBodyVerification='Performed from the isolated restored JSON envelope;see final checkpoint receipt.',initialFinalSourceCompletenessCorrection=old)
w('docs/qa/melodiajest-2026-11-09-57-operations-source.json',source)
o['activeStage'].update(finalLocalSourceCheckpointPending=True,initialLocalSourceCheckpointCompletenessCorrected=old)
qa.update(finalLocalSourceCheckpointPending=True,initialLocalSourceCheckpointCompletenessCorrected=old)
o.setdefault('operationalSourceCheckpointHistory',[]).append(copy.deepcopy(old))
w('docs/product-development-state.json',p);w('docs/qa/melodiajest-2026-11-09-57-local.json',qa)
report=root/'docs/reports/melodiajest-operations-2026-11-09-57.md'
with report.open('a',encoding='utf-8') as out:out.write('\nУточнение полноты source57: первая финальная копия763077fe… локально восстановила приложение,но docs-allowlist исключил сырые.py/.cjs вспомогательные файлы. В ней оставались только ихSHA. Это не полныйbackup тел адаптеров. Allowlist не расширялся:теперь точные исходные байты/SHA/размеры каждого адаптера сохранены в разрешённом QA JSON(base64). Для изменившегося доказательства создаётся отдельная final-verified копия;первая сохранена как история,тот же кандидат79 не перепаковывается.\n')
sys.path.insert(0,str(root/'deploy/shared-host'));import release_artifact as bundle
assert bundle.source_allowed('docs/qa/melodiajest-2026-11-09-57-operations-source.json')
output=root/'dist/backups/melodiajest-source-23.5.79-20261109-57-final-verified.tar.gz';assert not output.exists()
record=bundle.pack(root/'dist/web',root/'deploy/shared-host',output,root);restored=bundle.restore(output,root/'tmp/melodiajest-57-final-verified-source-restored',record['sha256'])
assert record['version']=='23.5.79' and record['webManifestSha256']==a['webManifestSha256'] and restored['restoreVerified']
actual=json.loads((root/'tmp/melodiajest-57-final-verified-source-restored/source/docs/qa/melodiajest-2026-11-09-57-operations-source.json').read_text(encoding='utf-8'))
assert actual['encodedSources']==encoded
for name,item in actual['encodedSources'].items():
 raw=base64.b64decode(item['base64'],validate=True);assert len(raw)==item['bytes'] and hashlib.sha256(raw).hexdigest()==item['sha256'] and raw==(folder/name).read_bytes()
freeze=r('tmp/melodiajest-57-runtime-freeze.json');assert len(freeze)==457
for name,digest in freeze.items():
 for directory in [root,root/'tmp/melodiajest-57-final-verified-source-restored/source']:assert hashlib.sha256((directory/name).read_bytes()).hexdigest()==digest,name
record.update(localRestoreVerified=True,restoredFiles=restored['filesVerified'],independentExternalCopy=False,candidateArtifactChanged=False,serverChanged=False,deployedVersion='23.5.78',previousPublishedVersion='23.5.77',runtimeTestFilesCompared=457,exactHelperBodiesDecodedAndHashVerified=True,helperBodiesVerified=len(encoded),supersedesIncompleteHelperCheckpoint=old['sha256'],
 scope='Final verified LOCAL source57 candidate79:UI/full1246/target35/status8/browser390both/memory/hiddenreload,calendar78/resource gate/native same automation,and exact helper bytes preserved in allowlisted JSON envelope. Each helper decoded from isolated restored JSON and matched byte-for-byte/SHA/size. Application457runtime/test also matched. Public78/previous77 and independent PG/static/kit remain separate;this wholefinalsource only locally restored,not independentexternal.')
o['activeStage'].update(finalLocalSourceCheckpoint=record,finalLocalSourceCheckpointPending=False)
o['latestOperationalSourceCheckpoint']=record
s['pendingProductCheckpoint']['finalLocalSourceCheckpoint']=record;s['lastLocalProductCheckpoint']=copy.deepcopy(s['pendingProductCheckpoint'])
qa.update(finalLocalSourceCheckpoint=record,finalLocalSourceCheckpointPending=False,exactHelperBodiesDecodedAndHashVerified=True,helperBodiesVerified=len(encoded))
assert {k:v for k,v in o.items() if k.startswith('local')}=={k:v for k,v in before['operations'].items() if k.startswith('local')}
assert o['backup']['latestDevelopmentCheckpoint']==before['operations']['backup']['latestDevelopmentCheckpoint']
assert o['accountWorkerUpdater']==before['operations']['accountWorkerUpdater'] and o['s3']['workerKitRecovery']==before['operations']['s3']['workerKitRecovery']
for key in ['firstPostgresCalendarAttempt','nativeAutomaticRetry']:assert p['accountService']['backup'][key]==before['accountService']['backup'][key]
w('docs/product-development-state.json',p);w('docs/piano-curriculum-state.json',s);w('docs/qa/melodiajest-2026-11-09-57-local.json',qa);w('tmp/melodiajest-57-final-source-checkpoint.json',record)
with report.open('a',encoding='utf-8') as out:out.write('\nТекущий финальный **локальный source57 final-verified**: **'+record['sha256']+'**, '+str(record['bytes'])+'байт/'+str(record['sourceFiles'])+'source/40public/'+str(record['restoredFiles'])+'восстановленных файлов. Все457runtime/test и'+str(len(encoded))+'тел адаптеров,декодированных именно из изолированно восстановленного JSON,побайтно/SHA/размером совпали. Этот checkpoint заменяет неполное утверждение о телах адаптеров в763077fe…;обе локальные копии сохранены,кандидат79/публичные78/previous77 не перепаковывались и не менялись. Указатели на эту квитанцию обновлены после упаковки. Внешняя независимость всемуfinalcheckout не приписывается.\n')
print(json.dumps(record))
