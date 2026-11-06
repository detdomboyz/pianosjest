(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-preparation.js'),require('./piano-preparation-store.js'),require('./piano-progress-store.js'),require('./piano-preparation-capture.js'),require('./piano-preparation-fragment.js')):factory(root.PianoPreparation,root.PianoPreparationStore,root.PianoProgressStore,root.PianoPreparationCapture,root.PianoPreparationFragment);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoPreparationTransfer=api;})(typeof window==='object'?window:globalThis,function(Preparation,Store,Progress,Capture,Fragment){
 'use strict';
 const MAX_CHARS=32000000,MAX_DEPTH=64,MAX_NODES=2000000,MAX_RECOVERY_ENTRIES=4096;
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),integer=x=>Number.isSafeInteger(x)&&x>=0;
 function fail(code){throw Object.assign(Error(code),{code});}
 // JSON.parse alone silently loses duplicate names. This lexical pass checks
 // decoded names (including unicode escapes) and bounds before interpretation.
 function json(raw,limit=MAX_CHARS){
  if(typeof raw!=='string'||raw.length>limit)fail('TRANSFER_SIZE');let stack=[],keys=0;
  for(let i=0;i<raw.length;i++){
   const c=raw[i];if(c==='{')stack.push(new Set());else if(c==='[')stack.push(null);else if(c==='}'||c===']')stack.pop();
   else if(c==='"'){const start=i++;for(;i<raw.length;i++){if(raw[i]==='\\'){i++;continue;}if(raw[i]==='"')break;}let j=i+1;while(/\s/.test(raw[j]||'')&&j<raw.length)j++;if(raw[j]===':'){let key;try{key=JSON.parse(raw.slice(start,i+1));}catch{fail('TRANSFER_JSON');}const names=stack.at(-1);if(!names)fail('TRANSFER_JSON');if(names.has(key))fail('TRANSFER_DUPLICATE_KEY');names.add(key);if(++keys>MAX_NODES)fail('TRANSFER_COMPLEXITY');}}
   if(stack.length>MAX_DEPTH)fail('TRANSFER_DEPTH');
  }
  let data;try{data=JSON.parse(raw);}catch{fail('TRANSFER_JSON');}let nodes=0;
  function check(value){if(++nodes>MAX_NODES)fail('TRANSFER_COMPLEXITY');if(typeof value==='number'&&(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value))))fail('TRANSFER_NUMBER_RANGE');if(value&&typeof value==='object')for(const v of Object.values(value))check(v);}
  check(data);return data;
 }
 function canonical(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
 function currentRequirements(lessons){
  if(!Array.isArray(lessons)||new Set(lessons.map(l=>l?.id)).size!==lessons.length)fail('TRANSFER_CONTEXT');const result=[];
  for(const id of Capture.TARGET_IDS){const lesson=lessons.find(l=>l?.id===id);if(!lesson)continue;try{result.push(Preparation.compile({id:'transfer:'+id,hand:lesson.fingeringSpec?.steps?.[0]?.[0]?.hand,requires:[id]},[lesson]).requirements[0]);}catch{/* Changed unsupported local editions have no current preparation credit. */}}
  for(const id of Fragment.TARGET_IDS){const lesson=lessons.find(l=>l?.id===id);if(lesson){const selected=Fragment.prepare(lesson);if(selected)result.push(selected.requirement);}}
  return result;
 }
 function requirementData(r){const keys=['key','lessonId','assessmentVersion','fingerprint','range','steps','targetBpm','adaptation','articulation','timingPrecision','ending'];return Object.fromEntries(keys.filter(k=>Object.hasOwn(r,k)).map(k=>[k,r[k]]));}
 function inspect(raw,{lessons,now}={}){
  const base={status:'invalid',code:null,sourceVersion:null,sourceCharacters:typeof raw==='string'?raw.length:0,canWrite:false};
  try{
   if(!integer(now))fail('TRANSFER_CLOCK');const bundle=json(raw);if(!object(bundle)||bundle.kind!=='melodiajest-preparation-export')fail('TRANSFER_KIND');if(![1,2].includes(bundle.schemaVersion))return {...base,status:'unsupported',code:'TRANSFER_VERSION'};
   base.sourceVersion=bundle.schemaVersion;const requirements=currentRequirements(lessons),known=new Map(requirements.map(r=>[r.key,r])),attempts=new Map(),operations=new Map();let incomplete=false;
   function rememberOperation(op){const text=canonical(op),old=operations.get(op.id);if(old!==undefined&&old!==text)fail('TRANSFER_OPERATION_ID_CONFLICT');operations.set(op.id,text);}
   function legacySnapshot(value){if(value!==null)json(value,Progress.MAX_CHARS);const info=Progress.inspect(value,now);for(const op of info.receiptOperations)rememberOperation(op);const {receiptOperations,...summary}=info;return {...summary,receipts:receiptOperations.length};}
   function journal(j,profile){
    if(!object(j)||!['ready','unavailable'].includes(j.storageStatus)||!(j.storedHistoryRaw===null||typeof j.storedHistoryRaw==='string')||!Array.isArray(j.recoveryEntries)||j.recoveryEntries.length>MAX_RECOVERY_ENTRIES)fail('TRANSFER_JOURNAL');
    let stored=[];if(j.storageStatus==='ready'){if(j.storedHistoryRaw!==null)json(j.storedHistoryRaw,Store.MAX_CHARS);const parsed=profile.parse(j.storedHistoryRaw,now);if(canonical(parsed)!==canonical(j.storedHistory))fail('TRANSFER_RAW_MISMATCH');stored=parsed.entries;}else{if(j.storedHistory!==null)fail('TRANSFER_JOURNAL');incomplete=true;}
    const local=new Map();let duplicateCopies=0,currentEntries=0,archivedEntries=0;
    for(const [index,e]of [...stored,...j.recoveryEntries].entries()){
     if(index>=stored.length)profile.validate({...profile.empty(),entries:[e]},now);
     const text=canonical(e),id=e.attempt.attemptId,old=attempts.get(id);if(old&&old.text!==text)fail('TRANSFER_ATTEMPT_ID_CONFLICT');if(local.has(id)){duplicateCopies++;continue;}local.set(id,e);
     const current=known.get(e.requirement.key);if(current&&canonical(requirementData(current))!==canonical(requirementData(e.requirement)))fail('TRANSFER_CURRENT_REQUIREMENT_MISMATCH');
     if(current)currentEntries++;else archivedEntries++;if(!old)attempts.set(id,{text,entry:e,current:Boolean(current)});
    }
    const capacityExceeded=local.size>Store.MAX_ENTRIES;if(capacityExceeded)incomplete=true;
    return {available:j.storageStatus==='ready',storedEntries:stored.length,recoveryEntries:j.recoveryEntries.length,uniqueEntries:local.size,duplicateCopies,currentEntries,archivedEntries,capacityExceeded};
   }
   let whole,fragments=null;if(bundle.schemaVersion===1)whole=journal(bundle,Store);else{if(!object(bundle.journals))fail('TRANSFER_JOURNAL');whole=journal(bundle.journals.whole,Store);fragments=journal(bundle.journals.fragments,Store.fragments);}
   const legacy=bundle.legacy;if(!object(legacy)||!['available','unavailable'].includes(legacy.status)||!(legacy.raw===null||typeof legacy.raw==='string')||(legacy.status==='unavailable'&&legacy.raw!==null))fail('TRANSFER_LEGACY');let legacyInfo=null;if(legacy.status==='available')legacyInfo=legacySnapshot(legacy.raw);else incomplete=true;
   let archiveAvailable=true,archivePending=false;if(bundle.transferArchive!==undefined){const a=bundle.transferArchive;if(bundle.schemaVersion!==2||!object(a)||!['available','unavailable'].includes(a.status)||!(a.raw===null||typeof a.raw==='string'))fail('TRANSFER_ARCHIVE');if(a.status==='unavailable'){archiveAvailable=false;incomplete=true;}else if(a.raw!==null){const log=json(a.raw);if(!object(log)||log.schemaVersion!==1||log.kind!=='piano-preparation-transfer-backups'||!Array.isArray(log.operations)||log.operations.length>8)fail('TRANSFER_ARCHIVE');archivePending=log.operations.some(r=>r?.phase==='prepared');if(archivePending)incomplete=true;}}
   const expectedComplete=whole.available&&(fragments===null||fragments.available)&&legacy.status==='available'&&archiveAvailable;if(typeof bundle.completeCopy!=='boolean'||bundle.completeCopy!==expectedComplete)fail('TRANSFER_COMPLETENESS');
   let legacyRecovery=null;if(bundle.legacyRecovery!==undefined){
    const r=bundle.legacyRecovery;if(bundle.schemaVersion!==2||!object(r)||r.schemaVersion!==1||r.kind!=='piano-legacy-save-recovery'||!Array.isArray(r.pending)||r.pending.length>Progress.MAX_RECEIPTS||!(r.baseRaw===null||typeof r.baseRaw==='string')||!(r.draftRaw===null||typeof r.draftRaw==='string'))fail('TRANSFER_LEGACY_RECOVERY');
    legacySnapshot(r.baseRaw);legacySnapshot(r.draftRaw);const pending=new Set();for(const op of r.pending){if(!Progress.isOperation(op,now))fail('TRANSFER_LEGACY_RECOVERY');rememberOperation(op);pending.add(op.id);}legacyRecovery={operations:r.pending.length,uniqueOperations:pending.size,applied:false,grantsPreparation:false};
   }
   const readiness=[];for(const r of requirements){const observations=[...attempts.values()].filter(x=>x.current&&x.entry.requirement.key===r.key).map(x=>x.entry.attempt);if(observations.length>Store.MAX_ENTRIES){incomplete=true;continue;}const evaluated=Preparation.evaluate({schemaVersion:1,kind:'piano-preparation-contract',planId:'transfer-preview',policy:Preparation.POLICY,requirements:[r]},observations,{now});if(evaluated.status==='invalid-evidence')fail('TRANSFER_EVIDENCE');readiness.push(evaluated.requirements[0]);}
   return {...base,status:incomplete?'incomplete':'valid',archivePending,completeCopy:bundle.completeCopy,scopes:bundle.schemaVersion===1?['whole','legacy']:['whole','fragments','legacy'],whole,fragments,legacy:legacyInfo,legacyRecovery,readiness,localMidiDataOnly:true,teacherReviewed:false,physicalPerformanceVerified:false};
  }catch(e){return {...base,code:typeof e?.code==='string'?e.code:'TRANSFER_INVALID'};}
 }
 return {MAX_CHARS,MAX_DEPTH,MAX_NODES,MAX_RECOVERY_ENTRIES,currentRequirements,inspect,decode:json,canonical};
});
