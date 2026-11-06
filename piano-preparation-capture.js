(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-preparation.js'),require('./piano-preparation-fragment.js')):factory(root.PianoPreparation,root.PianoPreparationFragment);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoPreparationCapture=api;})(typeof window==='object'?window:globalThis,function(Preparation,Fragment){
 'use strict';
 // Exact full prerequisites of the two current reading plans. A regression
 // checks this list against the real backlog; fragments have a separate scope.
 const TARGET_IDS=Object.freeze(['course02-02','detail-p-release-01','course03-02','detail-p-release-02']);
 const copy=x=>JSON.parse(JSON.stringify(x));
 function createScoped({store,now,id,onChange=()=>{}},kind){
  const pending=new Map(),recent=new Map(),jobs=new Map();let count=null,readCode=null,saveCode=null,history=null,lastRaw,generation=0;
  function remember(r){if(r.status==='ready'||r.status==='saved'){history=r.history;count=history.entries.length;readCode=null;}else{history=null;count=null;readCode=r.code;}if(r.raw!==lastRaw){lastRaw=r.raw;generation++;}}
  function snapshot(){return {count,pendingCount:pending.size,saving:jobs.size>0,code:saveCode||readCode,generation};}
  function emit(){onChange(snapshot());}
  async function save(attemptId){
   if(jobs.has(attemptId))return jobs.get(attemptId);const entry=pending.get(attemptId);if(!entry)return {status:'saved'};
   const job=Promise.resolve().then(()=>store.append(entry,{now:now()})).then(r=>{if(r.status==='saved'){pending.delete(attemptId);generation++;remember(r);saveCode=null;}else saveCode=r.code;return r;}).catch(()=>{saveCode='STORAGE_WRITE_FAILED';return {status:'unsaved',code:saveCode};}).finally(()=>{jobs.delete(attemptId);emit();});jobs.set(attemptId,job);emit();return job;
  }
  return {
   snapshot,
   async refresh(){const r=await store.read({now:now()});remember(r);emit();return r;},
   readiness(requirement){if(!history)return {status:'pending',cleanTakes:0,memory:false,retained:false};return Preparation.evaluate({schemaVersion:1,kind:'piano-preparation-contract',planId:'local-preparation-status',policy:Preparation.POLICY,requirements:[requirement]},history.entries.map(e=>e.attempt),{now:now()}).requirements[0];},
   capture(lesson,input){
    if(!['challenge','memory'].includes(input?.mode)||(kind==='whole'?(!TARGET_IDS.includes(lesson?.id)||input.full!==true):input.full!==false))return Promise.resolve({status:'not-recorded'});
    let entry;try{let requirement;if(kind==='whole'){const hand=lesson.fingeringSpec?.steps[0]?.[0]?.hand;requirement=Preparation.compile({id:'capture:'+lesson.id,hand,requires:[lesson.id]},[lesson]).requirements[0];}else{const selected=Fragment.prepare(lesson);if(!selected||JSON.stringify(selected.requirement)!==JSON.stringify(input.requirement))return Promise.resolve({status:'not-recorded',code:'PREPARATION_FRAGMENT_CHANGED'});requirement=copy(input.requirement);}const attempt={schemaVersion:1,attemptId:id(),requirementKey:requirement.key,capturedAt:now(),bpm:input.bpm,observedUntil:input.observedUntil,mode:input.mode,assisted:input.assisted,observationInterrupted:input.observationInterrupted,timedOut:input.timedOut,errors:input.errors,events:copy(input.events)};if(Preparation.assessAttempt(requirement,attempt,{now:now()}).status!=='matched')return Promise.resolve({status:'not-recorded'});entry={requirement,attempt};}catch(e){saveCode=e?.code||'PREPARATION_ENTRY_INVALID';emit();return Promise.resolve({status:'not-recorded',code:saveCode});}
    if(recent.has(entry.attempt.attemptId)){saveCode='PREPARATION_ATTEMPT_ID_CONFLICT';emit();return Promise.resolve({status:'not-recorded',code:saveCode});}pending.set(entry.attempt.attemptId,entry);recent.set(entry.attempt.attemptId,entry);generation++;return save(entry.attempt.attemptId);
   },
   async retry(){for(const key of [...pending.keys()])await save(key);return snapshot();},
   async settled(){await Promise.all([...jobs.values()]);return snapshot();},
   async exportJournal(){const r=await store.read({now:now()});remember(r);const stored=r.status==='ready'?r.history:null,known=new Map(stored?.entries.map(e=>[e.attempt.attemptId,JSON.stringify(e)])||[]),recoveryEntries=copy([...recent.values()].filter(e=>known.get(e.attempt.attemptId)!==JSON.stringify(e)));emit();return {storageStatus:r.status==='ready'?'ready':'unavailable',storedHistory:stored,storedHistoryRaw:r.raw??null,recoveryEntries,generation};},
   async exportBundle(readLegacy){const {generation:stamp,...journal}=await this.exportJournal(),legacy=readLegacySnapshot(readLegacy);return {schemaVersion:1,kind:'melodiajest-preparation-export',...journal,legacy,completeCopy:journal.storageStatus==='ready'&&legacy.status==='available'};}
  };
 }
 function readLegacySnapshot(readLegacy){try{const raw=readLegacy();if(raw!==null&&typeof raw!=='string')throw Error();return {status:'available',raw};}catch{return {status:'unavailable',raw:null};}}
 async function exportCombined(whole,fragments,readLegacy,readLegacyRecovery){const w=await whole.exportJournal(),f=await fragments.exportJournal(),legacy=readLegacySnapshot(readLegacy),recovery=readLegacyRecovery?.(),{generation:wg,...wholeJournal}=w,{generation:fg,...fragmentJournal}=f,{generation:lg,...recoveryData}=recovery||{};return {generations:{whole:wg,fragments:fg,...(recovery?{legacy:lg}:{})},bundle:{schemaVersion:2,kind:'melodiajest-preparation-export',journals:{whole:wholeJournal,fragments:fragmentJournal},legacy,...(recovery?.pending.length?{legacyRecovery:copy(recoveryData)}:{}),completeCopy:w.storageStatus==='ready'&&f.storageStatus==='ready'&&legacy.status==='available'}};}
 return {TARGET_IDS,create:dependencies=>createScoped(dependencies,'whole'),createFragments:dependencies=>createScoped(dependencies,'fragment'),exportCombined};
});
