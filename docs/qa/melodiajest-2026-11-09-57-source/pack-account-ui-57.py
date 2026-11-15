import datetime,hashlib,json,re,sys
from pathlib import Path
root=Path.cwd()
def r(p):return json.loads((root/p).read_text(encoding='utf-8-sig'))
def w(p,v):(root/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def tap(path,passed,failed=0):
 raw=(root/path).read_bytes();totals={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)\s*$',raw.decode('utf-8-sig'),re.M)}
 assert totals.get('pass')==passed and totals.get('fail')==failed and totals.get('cancelled')==totals.get('skipped')==0,(path,totals)
 return {'path':path,'totals':totals,'sha256':hashlib.sha256(raw).hexdigest()}
full=tap('tmp/melodiajest-57-npm-final.tap',1246);target=tap('tmp/melodiajest-57-targeted.tap',35);unit=tap('tmp/melodiajest-57-status-after.tap',8)
before=tap('tmp/melodiajest-57-status-before.tap',1,7);rejected=tap('tmp/melodiajest-57-npm-initial-version-mismatch.tap',1232,14)
freeze=r('tmp/melodiajest-57-runtime-freeze.json');assert len(freeze)==457
for name,digest in freeze.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
browser=r('docs/qa/melodiajest-2026-11-09-57-browser.json');assert browser['verified'] and browser['authenticated390']['innerWidth']==390
course=r('service/course-registry.json');assert course['sourceVersion']=='23.5.79' and course['contentSha256']=='334e7971ea614a6dd155e94cd9deb074ebd0d15b13befaaed4351319e09d94ee'
delta=r('tmp/melodiajest-57-runtime-delta.json');assert delta['registryMetadataOnly'] and not delta['musicalContentChanged']
usage=r('tmp/melodiajest-57-usage-before-pack.json');assert usage['ordinaryUsageAllowed'] and usage['remainingPercent']>0
proof={'kind':'local-account-status-visibility-verified','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'candidateVersion':'23.5.79','publicVersion':'23.5.78','previousPublishedVersion':'23.5.77',
 'fullTests':full,'targetedTests':target,'newStatusTests':unit,'reproductionBeforeFix':before,
 'firstFullRunRejected':{'evidence':rejected,'cause':'Registry sourceVersion stayed78 after package bump79. Builder output differed only in serialized sourceVersion;course hash and all450lesson editions unchanged. Corrected metadata with existing builder,not by changing assertions/fixtures.'},
 'runtimeFilesFrozen':457,'runtimeDelta':delta,'browserVerifiedLocally':True,'browserReport':'docs/qa/melodiajest-2026-11-09-57-browser.json',
 'musicAuditsReusedFrom55':{'count':4,'reason':'Exact unchanged musical source/route/fingerings/baseline;registry changes only sourceVersion. No repeated heavy audits for UI-only change.'},
 'windowsServiceChecksReusedFrom55':{'passed':43,'environmentSkipped':7,'serviceLogicChanged':False},
 'newLearningRecords':0,'newIndependentGoals':0,'all598CompleteRecordsAnd450ServerMusicalEditionsPreserved':True,'personalDataChanged':False,
 'candidateLinuxTestsPending':True,'candidateReaderRestorePending':True,'serverResourcePreparationPending':True,'independentCandidateCopyVerified':False,'publicationReady':False,'publicationPending':True,
 'serverMutationsPerformed':False,'usage':usage,'calendar78Report':'docs/qa/melodiajest-2026-11-09-57-calendar78.json'}
w('tmp/melodiajest-57-local-proof.json',proof)
w('docs/qa/melodiajest-2026-11-09-57-local.json',{'proof':proof,'browser':browser,'fullCheckoutIndependentlyRestored':False})
sys.path.insert(0,str(root/'deploy/shared-host'));import release_artifact as bundle
output=root/'dist/melodiajest-23.5.79-20261109-57.tar.gz';assert not output.exists()
packed=bundle.pack(root/'dist/web',root/'deploy/shared-host',output,root)
restored=bundle.restore(output,root/'tmp/melodiajest-57-artifact-restored',packed['sha256'])
assert packed['version']=='23.5.79' and packed['publicFiles']==40 and restored['restoreVerified']
packed.update(restoreVerified=True,restoredFiles=restored['filesVerified'],browserVerifiedLocally=True,publicationReady=False,independentExternalCopy=False)
w('tmp/melodiajest-57-artifact.json',packed)
sys.path.insert(0,str(root/'service'));import deployment
selected,source=deployment.source_plan(output,packed['sha256']);proof.update(sourceSha256=source['sourceSha256'],courseSha256=course['contentSha256'])
w('tmp/melodiajest-57-local-proof.json',proof)
w('docs/qa/melodiajest-2026-11-09-57-local.json',{'artifact':packed,'proof':proof,'browser':browser,'fullCheckoutIndependentlyRestored':False})
print(json.dumps({'artifact':packed,'sourceSha256':source['sourceSha256'],'courseSha256':course['contentSha256'],'publicationReady':False}))
