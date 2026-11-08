(function(root,factory){const common=typeof module==='object'&&module.exports,api=factory(common?require('./piano-progress-store.js'):root.PianoProgressStore,common?require('./piano-browser-checkpoint-candidate.js'):root.PianoBrowserCheckpointCandidate);if(common)module.exports=api;else root.PianoLegacyCheckpointOwner=api;})(typeof window==='object'?window:globalThis,function(Progress,Candidate){
 'use strict';
 // Private opt-in owner. The shipped application still creates its original writer.
 const VERSION=1,FORMAT='melodiajest-legacy-progress-owner-v1';
 const messages={INPUT:'Некорректные параметры снимка журнала.',UNAVAILABLE:'Снимок журнала недоступен.',BUSY:'Журнал ещё выполняет запись или уведомление.',CLOSED:'Подготовка снимков журнала закрыта.',PLAN:'Снимок должен принадлежать этому владельцу.',LIMIT:'Снимок журнала превышает предел кандидата.'};
 const fail=code=>{throw Object.assign(new Error(messages[code]),{name:'LegacyCheckpointOwnerError',code});};
 function create(options){
  if(!Progress||typeof Progress.create!=='function'||!Candidate||!Number.isSafeInteger(Candidate.MAX_VALUE_CODE_UNITS))fail('UNAVAILABLE');
  if(!options||typeof options!=='object'||typeof options.now!=='function'||(options.onChange!==undefined&&typeof options.onChange!=='function'))fail('INPUT');
  const onChange=options.onChange??(()=>{});let revision=0,revisionUnavailable=false,calls=0,notifications=0,closed=false,tokens=new WeakMap();
  function changed(){if(revision===Number.MAX_SAFE_INTEGER)revisionUnavailable=true;else revision++;}
  const owner=Progress.create({...options,onChange(snapshot){changed();notifications++;try{onChange(snapshot);}finally{notifications--;changed();}}});
  function tracked(method,args){
   calls++;changed();let work;
   try{work=owner[method](...args);}catch(error){calls--;changed();throw error;}
   return Promise.resolve(work).finally(()=>{calls--;changed();});
  }
  function ensureOpen(){if(closed)fail('CLOSED');if(revisionUnavailable)fail('UNAVAILABLE');}
  function capture(){
   ensureOpen();if(calls||notifications)fail('BUSY');
   let snapshot,recovery,confirmed;
   try{snapshot=owner.snapshot();if(snapshot.saving)fail('BUSY');recovery=owner.exportRecovery();confirmed=owner.confirmedProgress();}
   catch(error){if(error?.name==='LegacyCheckpointOwnerError')throw error;fail('UNAVAILABLE');}
   if(snapshot.generation!==recovery.generation||snapshot.pendingCount!==recovery.pending.length)fail('UNAVAILABLE');
   let raw;try{raw=JSON.stringify({format:FORMAT,version:VERSION,sourceGeneration:snapshot.generation,snapshot,confirmed,recovery});}catch{fail('UNAVAILABLE');}
   if(raw.length>Candidate.MAX_VALUE_CODE_UNITS)fail('LIMIT');
   return {raw,sourceGeneration:snapshot.generation,pendingCount:snapshot.pendingCount,confirmedAvailable:confirmed!==null,generation:revision};
  }
  function prepareCheckpoint(){
   const value=capture(),token=Object.freeze({format:FORMAT,version:VERSION,componentId:'legacy-progress',generation:value.generation,sourceGeneration:value.sourceGeneration,pendingCount:value.pendingCount,confirmedAvailable:value.confirmedAvailable,codeUnits:value.raw.length,completeCopy:false});
   tokens.set(token,Object.freeze({id:'legacy-progress',status:'observed',raw:value.raw,generation:value.generation}));return token;
  }
  function readCheckpoint(token){ensureOpen();const value=tokens.get(token);if(!value)fail('PLAN');return value;}
  function isCurrent(token){
   ensureOpen();const value=tokens.get(token);if(!value)fail('PLAN');if(calls||notifications||token.generation!==revision)return false;
   const current=capture();return current.generation===token.generation&&current.raw===value.raw;
  }
  function closeCheckpoint(){closed=true;tokens=new WeakMap();changed();}
  return Object.freeze({record:operation=>tracked('record',[operation]),refresh:()=>tracked('refresh',[]),retry:()=>tracked('retry',[]),snapshot:()=>owner.snapshot(),confirmedProgress:()=>owner.confirmedProgress(),exportRecovery:()=>owner.exportRecovery(),settled:()=>owner.settled(),prepareCheckpoint,readCheckpoint,isCurrent,closeCheckpoint});
 }
 return Object.freeze({VERSION,FORMAT,create});
});
