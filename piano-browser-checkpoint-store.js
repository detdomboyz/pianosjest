(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./piano-browser-checkpoint-candidate.js'):root.PianoBrowserCheckpointCandidate);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoBrowserCheckpointStore=api;})(typeof window==='object'?window:globalThis,function(Candidate){
 'use strict';
 // Isolated append-only observations. No production hooks, global storage, apply or delete API.
 const VERSION=1,DATABASE='melodiajest-browser-checkpoints-v1',STORE='candidates',CAPACITY=4,FORMAT='melodiajest-browser-checkpoint-store-v1';
 const messages={INPUT:'Некорректный кандидат копии.',LIMIT:'Объём кандидата превышает предел.',UNAVAILABLE:'Хранилище кандидатов недоступно.',DIGEST:'Не удалось проверить контрольную сумму.',CLOSED:'Соединение с копиями закрыто.',BLOCKED:'Открытие хранилища заблокировано.',SCHEMA:'Формат хранилища не поддерживается. Данные не сброшены.',INTEGRITY:'Кандидат повреждён. Данные не изменены.',QUOTA:'Недостаточно места для новой копии. Прежние копии сохранены.',ABORTED:'Запись отменена. Прежние копии сохранены.',CAPACITY:'Четыре кандидата уже сохранены. Прежние копии не удалены.',UNCONFIRMED:'Транзакция завершилась, но чтение копии не подтверждено.'};
 const failure=(code,extra={})=>Object.assign(new Error(messages[code]),{name:'BrowserCheckpointStoreError',code,...extra});
 const requireValue=(value,code='INPUT')=>{if(!value)throw failure(code);};
 function safe(error,fallback='UNAVAILABLE'){
  try{if(error?.name==='BrowserCheckpointStoreError'&&Object.hasOwn(messages,error.code))return failure(error.code,error.code==='UNCONFIRMED'?{writeMayHaveCommitted:error.writeMayHaveCommitted,reasonCode:error.reasonCode}:{});if(error?.name==='BrowserCheckpointCandidateError'&&['LIMIT','DIGEST','INPUT'].includes(error.code))return failure(error.code);if(error?.name==='QuotaExceededError')return failure('QUOTA');if(error?.name==='VersionError')return failure('SCHEMA');}catch{}
  return failure(fallback);
 }
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const validTime=value=>{try{return typeof value==='string'&&value.length===24&&new Date(value).toISOString()===value;}catch{return false;}};
 function fields(value,names,code='INPUT'){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null),code);
  const d=Object.getOwnPropertyDescriptors(value);requireValue(Reflect.ownKeys(value).length===names.length&&names.every(k=>Object.hasOwn(d,k)&&Object.hasOwn(d[k],'value')),code);
  return Object.fromEntries(names.map(k=>[k,d[k].value]));
 }
 function array(value,size,convert,code='INPUT'){
  requireValue(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length===size,code);const d=Object.getOwnPropertyDescriptors(value);requireValue(Reflect.ownKeys(value).length===size+1,code);
  return Array.from({length:size},(_,i)=>{requireValue(Object.hasOwn(d,i)&&Object.hasOwn(d[i],'value'),code);return convert(d[i].value,i);});
 }
 function snapshot(input,code='INPUT'){
  const x=fields(input,['format','version','id','capturedAt','status','completeCopy','consistency','counts','reasons','persisted','components'],code);
  requireValue(x.format===Candidate.FORMAT&&x.version===1&&sha(x.id)&&validTime(x.capturedAt)&&x.status==='prepared-incomplete'&&x.completeCopy===false&&x.consistency==='uncoordinated',code);
  x.counts=fields(x.counts,['persistedObserved','persistedUnavailable','componentsObserved','componentsUnavailable','rawCodeUnits'],code);
  requireValue(Object.values(x.counts).every(n=>Number.isSafeInteger(n)&&n>=0&&!Object.is(n,-0)),code);
  requireValue(Array.isArray(x.reasons)&&x.reasons.length>=2&&x.reasons.length<=17,code);x.reasons=array(x.reasons,x.reasons.length,y=>{requireValue(typeof y==='string'&&y.length<=160,code);return y;},code);
  let total=0;
  const observation=(value,id,key)=>{
   const kind=Object.getOwnPropertyDescriptor(value??{},'status');requireValue(kind&&Object.hasOwn(kind,'value'),code);
   const names=kind.value==='observed'?[key,'status','raw',...(key==='id'?['generation']:[]),'digest','codeUnits']:[key,'status','reason'];
   const v=fields(value,names,code);requireValue(v[key]===id,code);
   if(v.status==='observed'){
    requireValue(v.raw===null||typeof v.raw==='string',code);requireValue((v.raw?.length??0)<=Candidate.MAX_VALUE_CODE_UNITS,code==='INPUT'?'LIMIT':code);total+=v.raw?.length??0;requireValue(total<=Candidate.MAX_TOTAL_CODE_UNITS,code==='INPUT'?'LIMIT':code);
    requireValue(v.codeUnits===(v.raw?.length??0)&&sha(v.digest),code);if(key==='id')requireValue(Number.isSafeInteger(v.generation)&&v.generation>=0&&!Object.is(v.generation,-0),code);
   }else requireValue(v.status==='unavailable'&&(key==='key'?['READ_FAILED','READ_INVALID']:['NOT_CAPTURED','UNSUPPORTED','READ_FAILED']).includes(v.reason),code);
   return v;
  };
  x.persisted=array(x.persisted,Candidate.KEYS.length,(v,i)=>observation(v,Candidate.KEYS[i],'key'),code);x.components=array(x.components,Candidate.COMPONENT_IDS.length,(v,i)=>observation(v,Candidate.COMPONENT_IDS[i],'id'),code);
  return x;
 }
 function create({indexedDB,subtle,name=DATABASE,now=()=>new Date().toISOString()}={}){
  requireValue(Candidate&&Candidate.VERSION===1&&indexedDB&&typeof indexedDB.open==='function'&&subtle&&typeof subtle.digest==='function'&&typeof now==='function','UNAVAILABLE');
  requireValue(typeof name==='string'&&/^melodiajest-browser-checkpoints-v1(?:-qa-[a-z0-9-]{1,80})?$/.test(name));
  let connection=null,opening=null,closed=false,versionChanged=false;
  const ensureOpen=()=>{requireValue(!closed,'CLOSED');requireValue(!versionChanged,'SCHEMA');};
  async function validate(x,code){
   // Reuse the actual candidate builder/hash protocol, never a second hashing algorithm.
   const builder=Candidate.create({subtle,now:()=>x.capturedAt});
   try{
    const token=await builder.prepareFrom({getItem:key=>{const v=x.persisted[Candidate.KEYS.indexOf(key)];if(v.status==='observed')return v.raw;if(v.reason==='READ_INVALID')return undefined;throw failure('UNAVAILABLE');}},x.components.map(v=>v.status==='observed'?{id:v.id,status:v.status,raw:v.raw,generation:v.generation}:{id:v.id,status:v.status,reason:v.reason}));
    const canonical=builder.readCandidate(token);
    for(const key of ['format','version','id','capturedAt','status','completeCopy','consistency'])requireValue(x[key]===canonical[key],code);
    for(const key of Object.keys(x.counts))requireValue(x.counts[key]===canonical.counts[key],code);
    requireValue(x.reasons.length===canonical.reasons.length&&x.reasons.every((v,i)=>v===canonical.reasons[i]),code);
    for(const key of ['persisted','components'])for(const [i,v]of x[key].entries())for(const property of Object.keys(v))requireValue(v[property]===canonical[key][i][property],code);
    return canonical;
   }finally{builder.close();}
  }
  function open(){
   try{ensureOpen();}catch(e){return Promise.reject(e);}if(connection)return Promise.resolve(connection);if(opening)return opening;
   opening=new Promise((resolve,reject)=>{let settled=false,request;const fail=code=>{if(!settled){settled=true;reject(failure(code));}};
    try{request=indexedDB.open(name,VERSION);}catch(e){fail(safe(e).code);return;}
    request.onblocked=()=>fail('BLOCKED');request.onerror=()=>fail(safe(request.error).code);
    request.onupgradeneeded=e=>{try{if(settled||closed||e.oldVersion!==0){request.transaction.abort();return;}request.result.createObjectStore(STORE);}catch{try{request.transaction.abort();}catch{}fail('SCHEMA');}};
    request.onsuccess=()=>{
     const db=request.result;if(settled||closed){db.close();fail('CLOSED');return;}
     try{requireValue(db.version===VERSION&&db.objectStoreNames.length===1&&db.objectStoreNames.contains(STORE),'SCHEMA');const store=db.transaction(STORE,'readonly').objectStore(STORE);requireValue(store.keyPath===null&&store.autoIncrement===false&&store.indexNames.length===0,'SCHEMA');}catch{db.close();fail('SCHEMA');return;}
     db.onversionchange=()=>{versionChanged=true;db.close();if(connection===db)connection=null;};connection=db;settled=true;resolve(db);
    };
   }).finally(()=>{opening=null;});return opening;
  }
  async function readRecord(db,id){return await new Promise((resolve,reject)=>{let value,key,tx;try{tx=db.transaction(STORE,'readonly');const store=tx.objectStore(STORE),get=store.get(id),getKey=store.getKey(id);get.onsuccess=()=>{value=get.result;};getKey.onsuccess=()=>{key=getKey.result;};tx.oncomplete=()=>{if((key!==undefined&&key!==id)||(key===undefined&&value!==undefined))reject(failure('INTEGRITY'));else resolve({exists:key!==undefined,value});};tx.onabort=()=>reject(safe(tx.error,'ABORTED'));}catch(e){reject(safe(e));}});}
  async function verifiedRecord(value,id){
   const v=fields(value,['format','version','id','storedAt','durability','candidate'],'INTEGRITY');requireValue(v.format===FORMAT&&v.version===1&&v.id===id&&validTime(v.storedAt)&&['strict','relaxed','default','unknown'].includes(v.durability),'INTEGRITY');
   const candidate=await validate(snapshot(v.candidate,'INTEGRITY'),'INTEGRITY');requireValue(candidate.id===id,'INTEGRITY');ensureOpen();return Object.freeze({...v,candidate});
  }
  function receipt(record,operation){return Object.freeze({format:FORMAT,version:VERSION,id:record.id,storedAt:record.storedAt,capturedAt:record.candidate.capturedAt,status:'stored-incomplete',completeCopy:false,consistency:'uncoordinated',counts:record.candidate.counts,reasons:record.candidate.reasons,operation,readbackVerified:true,durability:record.durability,evictionProtectionRequested:false});}
  async function save(input){
   try{
    ensureOpen();const captured=snapshot(input),candidate=await validate(captured,'INTEGRITY');ensureOpen();const storedAt=now();requireValue(validTime(storedAt));const db=await open();ensureOpen();
    const result=await new Promise((resolve,reject)=>{let tx,reason=null,added=false;const abort=e=>{reason=safe(e);try{tx.abort();}catch{reject(reason);}};
     try{tx=db.transaction(STORE,'readwrite',{durability:'strict'});tx.onabort=()=>reject(reason??safe(tx.error,'ABORTED'));tx.oncomplete=()=>resolve({added});const store=tx.objectStore(STORE),get=store.getKey(candidate.id);get.onsuccess=()=>{if(get.result!==undefined)return;const count=store.count();count.onsuccess=()=>{try{requireValue(count.result<CAPACITY,'CAPACITY');store.add({format:FORMAT,version:VERSION,id:candidate.id,storedAt,durability:['strict','relaxed','default'].includes(tx.durability)?tx.durability:'unknown',candidate},candidate.id);added=true;}catch(e){abort(e);}};};}catch(e){if(tx)abort(e);else reject(safe(e));}
    });
    try{ensureOpen();const value=await readRecord(db,candidate.id);requireValue(value.exists,'INTEGRITY');const record=await verifiedRecord(value.value,candidate.id);return receipt(record,result.added?'saved':'reused');}
    catch(e){throw failure('UNCONFIRMED',{writeMayHaveCommitted:result.added,reasonCode:safe(e).code});}
   }catch(e){throw safe(e);}
  }
  async function read(id){
   try{ensureOpen();requireValue(sha(id));const db=await open(),value=await readRecord(db,id);ensureOpen();if(!value.exists)return null;const record=await verifiedRecord(value.value,id);return Object.freeze({receipt:receipt(record,'read'),candidate:record.candidate});}catch(e){throw safe(e);}
  }
  function close(){closed=true;connection?.close();connection=null;}
  return Object.freeze({save,read,close});
 }
 return Object.freeze({VERSION,DATABASE,STORE,CAPACITY,FORMAT,create});
});
