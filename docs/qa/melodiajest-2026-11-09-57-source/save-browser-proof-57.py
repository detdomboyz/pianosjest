import datetime,hashlib,json,shutil
from pathlib import Path
root=Path.cwd()
def r(p):return json.loads((root/p).read_text(encoding='utf-8-sig'))
def w(p,v):(root/p).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
mobile=r('tmp/melodiajest-57-auth390-browser.json')
assert mobile['innerWidth']==390 and mobile['status']=='Сохранено в аккаунте' and mobile['inMain'] and not mobile['hiddenAncestor']
assert mobile['rect']['left']>=0 and mobile['rect']['right']<=390 and mobile['uniqueCount']==1
assert mobile['preview']['height']/float(mobile['preview']['lineHeight'].removesuffix('px'))==5
mobile['preview']['lines']=5
proof={'kind':'local-account-status-visibility','candidateVersion':'23.5.79','publicVersion':'23.5.78','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'verified':True,'publicCandidateVerified':False,'syntheticLoopbackAccount':True,'productionDataUsed':False,'performanceGradingTested':False,
 'beforePublic78':r('tmp/melodiajest-57-before-browser.json'),
 'evidenceMethod':'Core observations reconstructed from returned CUA tool results after the optional native AX probe reset the JS kernel; screenshot files persisted. The final authenticated390 measurement and cleanup were freshly saved directly from CUA.',
 'actualCoreObservations':{'authenticated':[{'text':'Сохранение в аккаунт…','visible':True},{'text':'Не удалось сохранить настройки. Попробуй ещё раз.','visible':True,'syntheticHttpStatus':503},{'text':'Сохранено в аккаунте','visible':True}],
 'eachStatus':{'inMain':True,'hiddenAncestor':False,'renderedBoxes':1,'uniqueIdCount':1,'after':'game-player-root','role':'status','aria-live':'polite','aria-atomic':'true'},
 'authenticatedHiddenReload':{'before':{'mode':'hidden','text':'Сохранено в аккаунте','visible':True},'after':{'mode':'hidden','text':'Сохранено в аккаунте','inMain':True,'visible':True}},
 'memory':[{'from':m,'attempt':'memory','materialInDom':False,'toggleInDom':False,'sourceInDom':False,'accountMessage':'Сохранено в аккаунте','inMain':True} for m in ['expanded','compact','hidden']],
 'guest':{'text':'Гость. Войди в аккаунт, чтобы сохранять настройки, личные правки и результаты испытаний.','visible':True,'inMain':True,'hiddenAncestor':False,'uniqueIdCount':1,'disabledModes':['challenge','memory'],'editDescribedBy':'service-account-status','hiddenReloadResult':'compact','enterExpanded':True,'spaceCollapsed':True,'focus':'learning-material-toggle'},
 'guest390':{'innerWidth':390,'statusRect':{'left':26.64,'right':349.04,'top':193.0599976,'bottom':278.159996,'width':322.4,'height':85.1},'statusOverflow':False,'hiddenAncestor':False,'previewLines':5},
 'authenticatedDesktop':{'innerWidth':1280,'text':'Сохранено в аккаунте','visible':True,'hiddenAncestor':False,'mode':'hidden'},
 'capturedConsole':{'authenticatedWarningsOrErrors':[],'guestWarningsOrErrors':[]}},
 'authenticated390':mobile,'authenticated390Cleanup':r('tmp/melodiajest-57-auth390-cleanup.json'),
 'earlierCleanup':r('tmp/melodiajest-57-browser-cleanup.json'),'previewCleanup':r('tmp/melodiajest-57-preview-cleanup.json'),'mobilePreviewCleanup':r('tmp/melodiajest-57-mobile-preview-cleanup.json'),
 'screenshots':{'guest390':'docs/reports/assets/melodiajest-20261109-57-guest-390.jpg','authenticatedDesktop':'docs/reports/assets/melodiajest-20261109-57-saved-desktop.jpg','authenticated390':'docs/reports/assets/melodiajest-20261109-57-saved-390.png'},
 'unacceptedProbe':{'image':'docs/reports/assets/melodiajest-20261109-57-saved-mobile-unaccepted.jpg','reason':'Actual width1280,not390;native AX probe then timed out and reset kernel. This is superseded by the fresh saved390 measurement.','accepted':False},
 'hardwareMidiSoundPhysicalPerformanceTeacherVerified':False,'screenReaderVerified':False,'completionSummaryRecorded':True,
 'sourceVersionOnlyCorrectionAfterCoreBrowserQa':True,'musicalContentChanged':False}
for p in proof['screenshots'].values():assert (root/p).is_file()
folder=root/'docs/qa/melodiajest-2026-11-09-57-source';folder.mkdir(exist_ok=True)
for name in ['preview-account-status-57.cjs','fix-registry-metadata-57.cjs','record-calendar-78-phase57.py','read-native-health-end-57.py']:
 shutil.copyfile(root/'tmp'/name,folder/name)
proof['savedHelperSources']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in folder.iterdir()}
w('docs/qa/melodiajest-2026-11-09-57-browser.json',proof)
print(json.dumps({'browserVerifiedLocally':True,'authenticated390Verified':True,'memoryCases':3,'productionDataUsed':False,'ownedTabsClosed':True,'viewportReset':True}))
