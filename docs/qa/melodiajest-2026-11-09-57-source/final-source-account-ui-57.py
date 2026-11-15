import copy,datetime,hashlib,json,shutil,sys
from pathlib import Path
root=Path.cwd()
def r(p):return json.loads((root/p).read_text(encoding='utf-8-sig'))
def w(p,v):(root/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=r('docs/product-development-state.json');s=r('docs/piano-curriculum-state.json');before=r('tmp/melodiajest-57-before-product-development-state.json');qa=r('docs/qa/melodiajest-2026-11-09-57-local.json');a=r('tmp/melodiajest-57-artifact.json');native=r('tmp/melodiajest-57-automation-verified.json');usage=r('tmp/melodiajest-57-usage-before-checkpoint.json');o=p['operations']
assert native['sameAutomationVerified'] and usage['ordinaryUsageAllowed'] and usage['remainingPercent']>0 and not usage['spendControlReached']
assert p['release']['deployedVersion']=='23.5.78' and p['release']['candidateVersion']=='23.5.79' and p['release']['candidateBrowserVerified'] and not p['release']['candidatePublicationReady']
def protected():
 assert {k:v for k,v in o.items() if k.startswith('local')}=={k:v for k,v in before['operations'].items() if k.startswith('local')}
 assert o['backup']['latestDevelopmentCheckpoint']==before['operations']['backup']['latestDevelopmentCheckpoint']
 assert o['accountWorkerUpdater']==before['operations']['accountWorkerUpdater'] and o['s3']['workerKitRecovery']==before['operations']['s3']['workerKitRecovery']
 for k in ['firstPostgresCalendarAttempt','nativeAutomaticRetry']:assert p['accountService']['backup'][k]==before['accountService']['backup'][k]
protected()
freeze=r('tmp/melodiajest-57-runtime-freeze.json');assert len(freeze)==457
for name,digest in freeze.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
native.update(canonicalRawFileSha256=hashlib.sha256((root/'docs/MELODIAJEST_AUTOMATION_PROMPT.md').read_bytes()).hexdigest(),nativePromptNormalization='universal-newlines-and-trailing-newline-trimmed')
w('tmp/melodiajest-57-automation-verified.json',native)
p['automation'].update(promptSha256=native['canonicalSha256'],canonicalRawFileSha256=native['canonicalRawFileSha256'],nativePromptSha256=native['nativePromptSha256'],nativePromptNormalization=native['nativePromptNormalization'],lastNativeUpdateVerifiedAt=native['checkedAt'],sameAutomationVerified=True,latestUpdateReason='Phase57 candidate79 local account status visibility verified;public78 protected. Next bounded resource preparation before publication,then return to own piano two-hands readiness.')
o['activeStage']['sameAutomation']=native;qa.update(sameAutomation=native,finalLocalSourceCheckpointPending=True)
s['budget']['lastObservation']={'observedAt':usage['checkedAt'],'ordinaryUsageAllowed':usage['ordinaryUsageAllowed'],'usedPercent':usage['usedPercent'],'remainingPercent':usage['remainingPercent'],'windowDurationMins':usage['windowDurationMins'],'resetsAt':usage['resetsAt'],'spendControlReached':usage['spendControlReached'],'reservePercent':0,'policy':'until-exhausted'}
folder=root/'docs/qa/melodiajest-2026-11-09-57-source'
for name in ['read-native-health-57.py','read-melodiajest-native-36.py','write-prompt-account-ui-57.py','final-source-account-ui-57.py']:shutil.copyfile(root/'tmp'/name,folder/name)
sourceProof={'phase':'57','temporaryOnly':True,'notInstalledAsWorkerOrTimer':True,'exactSources':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.iterdir()},'externalSshTransport':'Existing diary/deploy/production/ssh_client.py;strict known-host transport reused read-only,not copied or changed.','sourceVersionOnlyFix':'Node builder output serialized before comparison to the serialized registry;only sourceVersion changed.','replayWarning':'Completed version-bound helpers are evidence,not an instruction to rerun pack/finalize or historical operations.'}
w('docs/qa/melodiajest-2026-11-09-57-operations-source.json',sourceProof)
w('docs/product-development-state.json',p);w('docs/piano-curriculum-state.json',s);w('docs/qa/melodiajest-2026-11-09-57-local.json',qa)
report=root/'docs/reports/melodiajest-operations-2026-11-09-57.md'
with report.open('a',encoding='utf-8') as out:out.write('\nТа же ACTIVE20min автоматизация `automation` нативно сверена '+native['checkedAt']+'. Тот же thread/schedule,дубликатов нет. Canonical LF-normalizedSHA '+native['canonicalSha256']+',raw-fileSHA '+native['canonicalRawFileSha256']+',native trimmed promptSHA '+native['nativePromptSha256']+'. Стабильное указание пользователя после маркера7ноября сохранено. Перед финальным checkpoint обычная квота разрешена:used'+str(usage['usedPercent'])+'%/remaining'+str(usage['remainingPercent'])+'%,окно10080min,резерв0%;это общая квота,не индивидуальный бюджет.\n')
sys.path.insert(0,str(root/'deploy/shared-host'));import release_artifact as bundle
output=root/'dist/backups/melodiajest-source-23.5.79-20261109-57-final.tar.gz';assert not output.exists()
record=bundle.pack(root/'dist/web',root/'deploy/shared-host',output,root);restored=bundle.restore(output,root/'tmp/melodiajest-57-final-source-restored',record['sha256'])
assert record['version']=='23.5.79' and record['webManifestSha256']==a['webManifestSha256'] and restored['restoreVerified']
for name,digest in freeze.items():assert hashlib.sha256((root/'tmp/melodiajest-57-final-source-restored/source'/name).read_bytes()).hexdigest()==digest,name
record.update(localRestoreVerified=True,restoredFiles=restored['filesVerified'],independentExternalCopy=False,candidateArtifactChanged=False,serverChanged=False,deployedVersion='23.5.78',previousPublishedVersion='23.5.77',runtimeTestFilesCompared=457,
 scope='Final allowlisted LOCAL source57 for candidate79 account-status visibility:1246npm/35targeted/8new regressions,sourceVersion-only registry correction,450unchanged course editions,local auth pending/error/ack+guest policy+390px both+3memory+hiddenreload,closed QA previews/reset viewport,calendar78 exact timer/journal/receipts,resource prepare gate failing,exact temporary helper sources and same native automation verification. Public78/previous77 and their independent PG/static/kit remain separate historical protections. No raw DB/browser data/secrets. This entire final source is only locally file-restored,not independently external.')
o['activeStage'].update(finalLocalSourceCheckpoint=record,finalLocalSourceCheckpointPending=False)
o.setdefault('operationalSourceCheckpointHistory',[]).append(copy.deepcopy(o['latestOperationalSourceCheckpoint']));o['latestOperationalSourceCheckpoint']=record
s['pendingProductCheckpoint']['finalLocalSourceCheckpoint']=record
s['lastLocalProductCheckpoint']=copy.deepcopy(s['pendingProductCheckpoint'])
qa.update(finalLocalSourceCheckpoint=record,finalLocalSourceCheckpointPending=False,fullCheckoutIndependentlyRestored=False)
protected();w('docs/product-development-state.json',p);w('docs/piano-curriculum-state.json',s);w('docs/qa/melodiajest-2026-11-09-57-local.json',qa);w('tmp/melodiajest-57-final-source-checkpoint.json',record)
with report.open('a',encoding='utf-8') as out:out.write('\nФинальный **локальный** source57: **'+record['sha256']+'**, '+str(record['bytes'])+'байт/'+str(record['sourceFiles'])+'source/40public/'+str(record['restoredFiles'])+'восстановленных файлов;457runtime/test совпали. Содержит итоговые документы/QA/точные адаптеры/верификацию этой автоматизации до самой квитанции. Указатели на квитанцию обновлены отдельно после упаковки. Это не опубликованный79 и не независимый внешнийbackup всегоcheckout. Публичные78/previous77 и независимо восстановленныеPG/static/kit прежние.\n')
print(json.dumps(record))
