(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MelodiaLearning=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const KEY='melodiajest-learning-pending-v1';
  function create({client,crypto=globalThis.crypto,clock=()=>performance.now(),locks=globalThis.navigator?.locks,requireLocks=false,onChange=()=>{}}){
    let pending=null,origin=null,busy=false,unpersisted=false,writerRelease=null;
    const writerId=crypto.randomUUID();
    const owner=()=>client.requireUser().id;
    const notify=()=>onChange(status());
    function status(){return {pending,busy,ready:pending?.kind==='ready'&&!pending.expiredConfirmed&&origin!==null&&(!requireLocks||Boolean(writerRelease)),captureOrigin:origin};}
    function releaseOwnership(){writerRelease?.();writerRelease=null;}
    async function claimWriter(){
      if(writerRelease||!locks?.request)return;
      const acquired=await new Promise((resolve,reject)=>{void locks.request('melodiajest:learning-writer:'+owner(),{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){resolve(false);return;}await new Promise(release=>{writerRelease=release;resolve(true);});}).catch(reject);});
      if(!acquired)throw Error('Эта попытка открыта в другой вкладке. Продолжи там или закрой её перед восстановлением.');
    }
    function save(record){const previous=pending;pending=record;try{client.storage.setItem(KEY,record?JSON.stringify(record):'');unpersisted=false;}catch(error){if(record===null)pending=previous;unpersisted=true;throw error;}if(!record)releaseOwnership();notify();}
    function read(){if(pending&&pending.ownerId!==owner())throw Error('Не совпал аккаунт ожидающей записи.');if(pending&&unpersisted)return pending;const raw=client.storage.getItem(KEY);if(!raw){pending=null;return null;}const value=JSON.parse(raw);if(value.version!==1||value.ownerId!==owner()||!['starting','ready','submitting'].includes(value.kind))throw Error('Не совпал аккаунт ожидающей записи.');pending=value;return pending;}
    async function exclusive(fn){if(busy)throw Error('Дождись подтверждения текущей записи.');busy=true;notify();try{if(requireLocks&&!locks?.request)throw Error('Для сохранения испытаний нужен актуальный браузер с поддержкой защищённой записи. Практика остаётся доступна.');return locks?.request?await locks.request('melodiajest:learning-operation:'+owner(),{mode:'exclusive'},fn):await fn();}finally{busy=false;notify();}}
    async function start(row,mode){
      return exclusive(async()=>{
        const previous=read();if(previous)throw Error('Сначала восстанови или отмени предыдущую попытку.');
        await claimWriter();
        const bytes=crypto.getRandomValues(new Uint8Array(32)),nonce=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
        const input={lessonId:row.id,musicVersion:row.musicVersion,editionVersion:row.editionVersion,mode,nonce,operationId:crypto.randomUUID()};
        save({version:1,ownerId:owner(),writerId,kind:'starting',input});let attempt;
        try{attempt=await client.api('/learning/attempts',{method:'POST',data:input});}catch(error){if(error.status>=400&&error.status<500)save(null);throw error;}
        save({...pending,kind:'ready',attempt});origin=clock();return attempt;
      });
    }
    async function recover(){return exclusive(async()=>{
      let saved=read();if(!saved)return null;await claimWriter();saved={...saved,writerId};save(saved);
      if(saved.kind==='starting'){const attempt=await client.api('/learning/attempts',{method:'POST',data:saved.input});save({...saved,kind:'ready',attempt});origin=clock();return {attempt};}
      if(saved.kind==='ready'){const current=await client.api('/learning/attempts/'+saved.attempt.id);if(current.result){save(null);return {result:current.result};}if(current.expiresAt<=current.serverTime){save({...saved,expiredConfirmed:true});return {expired:true};}origin=clock();notify();return {attempt:saved.attempt};}
      const current=await client.api('/learning/attempts/'+saved.attempt.id);
      if(!current.result&&current.expiresAt<=current.serverTime){save({...saved,expiredConfirmed:true});return {expired:true};}
      const result=current.result||await client.api('/learning/attempts/'+saved.attempt.id,{method:'POST',data:saved.submission});save(null);return {result};
    });}
    async function submit({events,observedAt,interrupted}){return exclusive(async()=>{
      const saved=read();if(saved?.kind!=='ready'||origin===null)throw Error('Сначала открой серверную попытку.');
      const submission={nonce:saved.input.nonce,events:events.map(event=>({type:event.type,midi:event.midi,at:Math.max(0,event.at-origin),source:event.source==='manual'?'keyboard':event.source||'midi'})),observedUntil:Math.max(0,observedAt-origin),observationInterrupted:Boolean(interrupted)};
      save({...saved,kind:'submitting',submission});const result=await client.api('/learning/attempts/'+saved.attempt.id,{method:'POST',data:submission});save(null);return result;
    });}
    async function cancel(){return exclusive(async()=>{
      let saved=read();if(!saved)return;await claimWriter();
      if(saved.kind==='submitting'&&!saved.expiredConfirmed)throw Error('Запись уже отправлялась. Сначала проверь её сохранение.');
      if(saved.kind==='starting'){const attempt=await client.api('/learning/attempts',{method:'POST',data:saved.input});save({...saved,kind:'ready',attempt});saved=pending;}
      const response=await client.api('/learning/attempts/'+saved.attempt.id+'/cancel',{method:'POST',data:{nonce:saved.input.nonce}});save(null);return response;
    });}
    function exportPending(){return JSON.stringify({kind:'melodiajest-private-learning-recovery',version:1,accountId:owner(),pending:read()},null,2)+'\n';}
    return {start,submit,recover,cancel,read,status,exportPending,releaseOwnership};
  }
  return {create,KEY};
});
