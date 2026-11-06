(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-preparation.js')):factory(root.PianoPreparation);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoPreparationStore=api;})(typeof window==='object'?window:globalThis,function(Preparation){
 'use strict';
 const MAX_CHARS=2000000,MAX_ENTRIES=512;
 const whole=Object.freeze({STORAGE_KEY:'music-preparation-piano-v1',LOCK_NAME:'melodiajest:piano-preparation-v1',SCOPE:'piano-whole-preparation-v1',kind:'whole'});
 const fragment=Object.freeze({STORAGE_KEY:'music-preparation-fragments-piano-v1',LOCK_NAME:'melodiajest:piano-preparation-fragments-v1',SCOPE:'piano-fragment-preparation-v1',kind:'fragment'});
 const copy=x=>JSON.parse(JSON.stringify(x));
 function fail(code){throw Object.assign(Error(code),{code});}
 function clock(now){if(!Number.isSafeInteger(now)||now<0)fail('PREPARATION_CLOCK_INVALID');}
 function empty(profile){return {schemaVersion:1,scope:profile.SCOPE,revision:0,entries:[]};}
 function validate(history,now,profile){
  clock(now);if(history?.schemaVersion!==1||history.scope!==profile.SCOPE||!Number.isSafeInteger(history.revision)||history.revision<0||!Array.isArray(history.entries)||history.entries.length>MAX_ENTRIES)fail('PREPARATION_LOG_FORMAT');
  const ids=new Set();for(const entry of history.entries){if(entry?.requirement?.range?.kind!==profile.kind||ids.has(entry?.attempt?.attemptId))fail('PREPARATION_LOG_ENTRY_INVALID');const r=Preparation.assessAttempt(entry.requirement,entry.attempt,{now});if(r.status!=='matched')fail('PREPARATION_LOG_ENTRY_INVALID');ids.add(entry.attempt.attemptId);}
  return copy(history);
 }
 function parse(raw,now,profile){clock(now);if(raw===null)return empty(profile);if(typeof raw!=='string'||raw.length>MAX_CHARS)fail('PREPARATION_LOG_FORMAT');let value;try{value=JSON.parse(raw);}catch{fail('PREPARATION_LOG_FORMAT');}return validate(value,now,profile);}
 // Shared transactions, separate keys/locks and accepted ranges: a fragment
 // can never enter whole credit. Neither journal migrates the other.
 function create({storage,locks},profile){
  async function transaction(work,now,failureStatus){
   let raw;try{
    clock(now);if(!locks||typeof locks.request!=='function')fail('LOCKS_UNAVAILABLE');
    return await locks.request(profile.LOCK_NAME,{mode:'exclusive'},async lock=>{
     if(!lock)fail('LOCK_NOT_ACQUIRED');if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')fail('STORAGE_UNAVAILABLE');
     try{raw=storage.getItem(profile.STORAGE_KEY);}catch{fail('STORAGE_READ_FAILED');}
     const change=work(parse(raw,now,profile));
     if(change.changed){const text=JSON.stringify(validate(change.history,now,profile));if(text.length>MAX_CHARS)fail('PREPARATION_LOG_FULL');try{storage.setItem(profile.STORAGE_KEY,text);}catch{fail('STORAGE_WRITE_FAILED');}let saved;try{saved=storage.getItem(profile.STORAGE_KEY);}catch{fail('SAVE_NOT_CONFIRMED');}if(saved!==text)fail('SAVE_NOT_CONFIRMED');raw=saved;}
     return {status:change.changed===undefined?'ready':'saved',history:change.history,raw};
    });
   }catch(e){return {status:failureStatus,code:typeof e?.code==='string'?e.code:'LOCK_OR_STORAGE_FAILED',...(typeof raw==='string'||raw===null?{raw}:{})};}
  }
  return {
   read({now}){return transaction(h=>({history:h}),now,'blocked');},
   append(entry,{now}){
    let captured;try{captured=copy(entry);if(captured.requirement?.range?.kind!==profile.kind)fail(profile.kind==='whole'?'WHOLE_PREPARATION_REQUIRED':'FRAGMENT_PREPARATION_REQUIRED');if(Preparation.assessAttempt(captured.requirement,captured.attempt,{now}).status!=='matched')fail('PREPARATION_NOT_MATCHED');}catch(e){return Promise.resolve({status:'unsaved',code:e?.code||'PREPARATION_ENTRY_INVALID'});}
    return transaction(h=>{const existing=h.entries.find(e=>e.attempt.attemptId===captured.attempt.attemptId);if(existing){if(JSON.stringify(existing)!==JSON.stringify(captured))fail('PREPARATION_ATTEMPT_ID_CONFLICT');return {history:h,changed:false};}if(h.entries.length>=MAX_ENTRIES)fail('PREPARATION_LOG_FULL');return {history:{...h,revision:h.revision+1,entries:[...h.entries,captured]},changed:true};},now,'unsaved');
   }
  };
 }
 function scoped(profile){return Object.freeze({STORAGE_KEY:profile.STORAGE_KEY,LOCK_NAME:profile.LOCK_NAME,SCOPE:profile.SCOPE,empty:()=>empty(profile),parse:(raw,now)=>parse(raw,now,profile),validate:(history,now)=>validate(history,now,profile),create:dependencies=>create(dependencies,profile)});}
 return {...scoped(whole),MAX_CHARS,MAX_ENTRIES,fragments:scoped(fragment)};
});
