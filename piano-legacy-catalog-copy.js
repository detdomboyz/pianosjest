(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoLegacyCatalogCopy=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 // Isolated raw preservation only. Never writes legacy storage, catalog or progress.
 const VERSION=1,DATABASE='melodiajest-legacy-catalog-v1',KEY='piano-blind-trainer-catalog-v1',CAPACITY=4,MAX_CODE_UNITS=16*1024*1024,STORE='copies',FORMAT='melodiajest-legacy-catalog-copy-v1';
 const messages={INPUT:'Некорректные параметры копии.',LIMIT:'Исходная строка превышает допустимый объём.',UNAVAILABLE:'Сохранение исходной копии недоступно.',DIGEST:'Не удалось проверить контрольную сумму копии.',PLAN:'Подготовь копию в этом соединении заново.',CLOSED:'Это соединение закрыто.',BLOCKED:'Другая вкладка удерживает хранилище.',SCHEMA:'Версия копии не поддерживается. Данные не сброшены.',INTEGRITY:'Контрольная сумма копии не совпала. Данные не изменены.',QUOTA:'Недостаточно места для новой копии. Прежние копии сохранены.',ABORTED:'Запись копии отменена. Прежние копии сохранены.',CAPACITY:'Четыре исходные копии уже сохранены. Экспортируй их для отдельного разбора.',EXPORT:'Не удалось подготовить экспорт. Копии сохранены.'};
 const failure=code=>Object.assign(new Error(messages[code]),{name:'LegacyCatalogCopyError',code});
 const requireValue=(ok,code='INPUT')=>{if(!ok)throw failure(code);};
 const safe=(error,fallback='UNAVAILABLE')=>error?.name==='LegacyCatalogCopyError'&&Object.hasOwn(messages,error.code)?failure(error.code):failure(error?.name==='QuotaExceededError'?'QUOTA':error?.name==='VersionError'?'SCHEMA':fallback);
 const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 const validTime=x=>{try{return typeof x==='string'&&x.length===24&&new Date(x).toISOString()===x;}catch{return false;}};
 function rawValue(raw,code='INPUT'){requireValue(raw===null||typeof raw==='string',code);requireValue((raw?.length??0)<=MAX_CODE_UNITS,code==='INPUT'?'LIMIT':code);return raw;}
 // A presence byte followed by exact little-endian UTF-16 code units, not UTF-8 replacement.
 function bytes(raw){const out=new Uint8Array(1+(raw?.length??0)*2);out[0]=raw===null?0:1;for(let i=0;i<(raw?.length??0);i++){const unit=raw.charCodeAt(i);out[1+i*2]=unit&255;out[2+i*2]=unit>>>8;}return out;}
 function record(value){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===6&&['format','id','key','raw','codeUnits','capturedAt'].every(k=>Object.hasOwn(value,k)),'SCHEMA');
  requireValue(value.format===FORMAT&&sha(value.id)&&value.key===KEY&&validTime(value.capturedAt),'SCHEMA');rawValue(value.raw,'SCHEMA');requireValue(value.codeUnits===(value.raw?.length??0),'SCHEMA');return value;
 }
 const metadata=r=>Object.freeze({id:r.id,key:KEY,codeUnits:r.codeUnits,missing:r.raw===null,capturedAt:r.capturedAt});
 function create({indexedDB,subtle,name=DATABASE,now=()=>new Date().toISOString()}={}){
  requireValue(indexedDB&&typeof indexedDB.open==='function'&&subtle&&typeof subtle.digest==='function'&&typeof now==='function','UNAVAILABLE');
  requireValue(typeof name==='string'&&/^melodiajest-legacy-catalog-v1(?:-qa-[a-z0-9-]{1,80})?$/.test(name));
  let connection=null,opening=null,closed=false;const changes=new WeakMap();
  const ensureOpen=()=>requireValue(!closed,'CLOSED');
  async function digest(raw){let result;try{result=await subtle.digest('SHA-256',bytes(raw));}catch{throw failure('DIGEST');}requireValue(result instanceof ArrayBuffer&&result.byteLength===32,'DIGEST');return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');}
  async function prepareFrom(storage){
   try{ensureOpen();requireValue(storage&&typeof storage.getItem==='function');let raw;try{raw=storage.getItem(KEY);}catch{throw failure('UNAVAILABLE');}rawValue(raw);const capturedAt=now();requireValue(validTime(capturedAt));const id=await digest(raw);ensureOpen();const value=Object.freeze({format:FORMAT,id,key:KEY,raw,codeUnits:raw?.length??0,capturedAt}),change=Object.freeze({version:VERSION,...metadata(value)});changes.set(change,value);return change;}catch(error){throw safe(error);}
  }
  function open(){
   if(closed)return Promise.reject(failure('CLOSED'));if(connection)return Promise.resolve(connection);if(opening)return opening;
   opening=new Promise((resolve,reject)=>{let settled=false,request;const fail=code=>{if(!settled){settled=true;reject(failure(code));}};
    try{request=indexedDB.open(name,VERSION);}catch(error){fail(error?.name==='VersionError'?'SCHEMA':'UNAVAILABLE');return;}
    request.onblocked=()=>fail('BLOCKED');request.onerror=()=>fail(request.error?.name==='VersionError'?'SCHEMA':'UNAVAILABLE');
    request.onupgradeneeded=e=>{if(settled||closed||e.oldVersion!==0){request.transaction.abort();return;}request.result.createObjectStore(STORE);};
    request.onsuccess=()=>{const db=request.result;if(settled||closed){db.close();fail('CLOSED');return;}if(db.objectStoreNames.length!==1||!db.objectStoreNames.contains(STORE)){db.close();fail('SCHEMA');return;}db.onversionchange=()=>{db.close();if(connection===db)connection=null;};connection=db;settled=true;resolve(db);};
   }).finally(()=>{opening=null;});return opening;
  }
  async function commit(change){
   try{ensureOpen();const desired=changes.get(change);requireValue(desired,'PLAN');const db=await open();return await new Promise((resolve,reject)=>{let tx,reason=null,saved=desired,replayed=false;
    const abort=error=>{reason=safe(error);try{tx.abort();}catch{reject(reason);}};
    try{tx=db.transaction(STORE,'readwrite',{durability:'strict'});tx.onabort=()=>reject(reason??failure(tx.error?.name==='QuotaExceededError'?'QUOTA':'ABORTED'));tx.oncomplete=()=>resolve(Object.freeze({status:replayed?'replayed':'saved',durability:tx.durability??'unknown',snapshot:metadata(saved)}));
     const copies=tx.objectStore(STORE),get=copies.get(desired.id);get.onsuccess=()=>{try{if(get.result!==undefined){const prior=record(get.result);requireValue(prior.id===desired.id&&prior.raw===desired.raw,'INTEGRITY');saved=prior;replayed=true;return;}const count=copies.count();count.onsuccess=()=>{try{requireValue(count.result<CAPACITY,'CAPACITY');copies.add(desired,desired.id);}catch(error){abort(error);}};}catch(error){abort(error);}};
    }catch(error){if(tx)abort(error);else reject(safe(error));}
   });}catch(error){throw safe(error);}
  }
  async function read(id){
   try{ensureOpen();requireValue(sha(id));const db=await open(),value=await new Promise((resolve,reject)=>{let tx,result;
    try{tx=db.transaction(STORE,'readonly');const get=tx.objectStore(STORE).get(id);get.onsuccess=()=>{result=get.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(failure('ABORTED'));}catch(error){reject(safe(error));}
   });if(value===undefined)return null;const valid=record(value);requireValue(valid.id===id&&await digest(valid.raw)===id,'INTEGRITY');ensureOpen();return Object.freeze({...valid});}catch(error){throw safe(error);}
  }
  async function exportRecovery(){
   try{ensureOpen();const db=await open(),data=await new Promise((resolve,reject)=>{let tx,keys,values;
    try{tx=db.transaction(STORE,'readonly');const copies=tx.objectStore(STORE),k=copies.getAllKeys(undefined,CAPACITY+1),v=copies.getAll(undefined,CAPACITY+1);k.onsuccess=()=>{keys=k.result;};v.onsuccess=()=>{values=v.result;};tx.oncomplete=()=>resolve({keys,values});tx.onabort=()=>reject(failure('ABORTED'));}catch(error){reject(safe(error));}
   });requireValue(data.keys.length<=CAPACITY&&data.keys.length===data.values.length,'LIMIT');let text;try{text=JSON.stringify({format:'melodiajest-legacy-catalog-export-v1',version:VERSION,records:data.keys.map((id,i)=>({id,value:data.values[i]}))});}catch{throw failure('EXPORT');}return text;}catch(error){throw safe(error);}
  }
  function close(){closed=true;connection?.close();connection=null;}
  return Object.freeze({prepareFrom,commit,read,exportRecovery,close});
 }
 return Object.freeze({VERSION,DATABASE,KEY,CAPACITY,MAX_CODE_UNITS,create});
});
