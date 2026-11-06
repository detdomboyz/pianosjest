(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-reading-session.js')):factory(root.PianoReadingSession);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoReadingStore=api;})(typeof window==='object'?window:globalThis,function(Session){
  'use strict';
  const STORAGE_KEY='music-reading-piano-v1',LOCK_NAME='melodiajest:piano-reading-v1';
  const copy=x=>JSON.parse(JSON.stringify(x));
  // Dependencies are injected. Importing this module never opens storage, MIDI or audio.
  function create(dependencies){
    const {storage,locks}=dependencies||{};
    async function transaction(work,failureStatus,session){
      try{
        if(!locks||typeof locks.request!=='function')throw Object.assign(new Error(),{code:'LOCKS_UNAVAILABLE'});
        return await locks.request(LOCK_NAME,{mode:'exclusive'},async lock=>{
          if(!lock)throw Object.assign(new Error(),{code:'LOCK_NOT_ACQUIRED'});
          if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')throw Object.assign(new Error(),{code:'STORAGE_UNAVAILABLE'});
          let raw;try{raw=storage.getItem(STORAGE_KEY);}catch{throw Object.assign(new Error(),{code:'STORAGE_READ_FAILED'});}
          const history=Session.parseHistory(raw),change=work(history);
          if(change.history){
            const serialized=JSON.stringify(Session.validateHistory(change.history));
            if(serialized!==raw){
              try{storage.setItem(STORAGE_KEY,serialized);}catch{throw Object.assign(new Error(),{code:'STORAGE_WRITE_FAILED'});}
              let saved;try{saved=storage.getItem(STORAGE_KEY);}catch{throw Object.assign(new Error(),{code:'SAVE_NOT_CONFIRMED'});}
              if(saved!==serialized)throw Object.assign(new Error(),{code:'SAVE_NOT_CONFIRMED'});
            }
          }
          return change.saved();
        });
      }catch(error){return {status:failureStatus,code:typeof error?.code==='string'?error.code:'LOCK_OR_STORAGE_FAILED',...(session?{session}:{})};}
    }
    return {
      read(){return transaction(h=>({saved:()=>({status:'ready',history:h})}),'blocked');},
      open(item,options){let source,settings;try{source=copy(item);settings=copy(options);}catch{return Promise.resolve({status:'blocked',code:'OPEN_OPTIONS'});}return transaction(h=>{const change=Session.open(h,source,settings);return {history:change.history,saved:()=>({status:'saved',history:change.history,session:Session.activate(change.session,change.history)})};},'blocked');},
      openNext(bank,options){let candidates,settings;try{candidates=copy(bank);settings=copy(options);}catch{return Promise.resolve({status:'blocked',code:'OPEN_OPTIONS'});}return transaction(h=>{const item=Session.selectUnseen(h,candidates,settings.publishedExamples);if(!item)return {saved:()=>({status:'exhausted',history:h})};const change=Session.open(h,item,settings);return {history:change.history,saved:()=>({status:'saved',history:change.history,session:Session.activate(change.session,change.history),item})};},'blocked');},
      importHistory(raw){return transaction(h=>{const incoming=Session.parseHistory(raw),existing=JSON.stringify(h),serialized=JSON.stringify(incoming);if(existing!==JSON.stringify(Session.emptyHistory())&&existing!==serialized)throw Object.assign(new Error(),{code:'HISTORY_NOT_EMPTY'});return {history:incoming,saved:()=>({status:'saved',history:incoming})};},'blocked');},
      assist(session,reason){let marked;try{marked=Session.assist(session,reason);}catch(e){return Promise.resolve({status:'blocked',code:e.code||'SESSION_INVALID'});}return transaction(h=>{const change=Session.rememberAssistance(h,marked);return {history:change.history,saved:()=>({status:'saved',...change})};},'unsaved',marked);},
      finish(session,options){let captured,settings;try{captured=copy(session);settings=copy(options);}catch{return Promise.resolve({status:'blocked',code:'SESSION_INVALID'});}return transaction(h=>{const change=Session.finish(h,captured,settings);return {history:change.history,saved:()=>({status:'saved',...change})};},'unsaved',captured);}
    };
  }
  return {STORAGE_KEY,LOCK_NAME,create};
});
