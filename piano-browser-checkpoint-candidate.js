(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./piano-legacy-catalog-copy.js'):root.PianoLegacyCatalogCopy);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoBrowserCheckpointCandidate=api;})(typeof window==='object'?window:globalThis,function(Copy){
 'use strict';
 // Isolated preparation only. No persistence, writer lock, apply, restore or global storage access.
 const VERSION=1,FORMAT='melodiajest-browser-checkpoint-candidate-v1';
 const KEYS=Object.freeze(['piano-blind-trainer-catalog-v1','piano-blind-trainer-ui-v20','music-catalog-workspace-piano-v1','music-learning-piano-v1','music-preparation-piano-v1','music-preparation-fragments-piano-v1','music-preparation-transfer-backups-piano-v1']);
 const COMPONENT_IDS=Object.freeze(['catalog-state','ui-workspace','legacy-progress','whole-capture','fragment-capture','transfer','editor-draft','active-attempt']);
 const MAX_VALUE_CODE_UNITS=16*1024*1024,MAX_TOTAL_CODE_UNITS=32*1024*1024;
 const messages={INPUT:'Некорректные данные кандидата.',LIMIT:'Объём кандидата превышает предел подготовки. Исходники не изменены.',UNAVAILABLE:'Подготовка кандидата недоступна.',DIGEST:'Не удалось проверить контрольную сумму.',CLOSED:'Подготовка кандидата закрыта.',PLAN:'Кандидат должен принадлежать этому соединению.'};
 const failure=code=>Object.assign(new Error(messages[code]),{name:'BrowserCheckpointCandidateError',code});
 const requireValue=(value,code='INPUT')=>{if(!value)throw failure(code);};
 const safe=error=>failure(error?.name==='BrowserCheckpointCandidateError'&&Object.hasOwn(messages,error.code)?error.code:error?.name==='LegacyCatalogCopyError'&&Object.hasOwn(messages,error.code)?error.code:'UNAVAILABLE');
 const validTime=value=>{try{return typeof value==='string'&&value.length===24&&new Date(value).toISOString()===value;}catch{return false;}};
 function shape(value,keys){
  requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null));
  const descriptors=Object.getOwnPropertyDescriptors(value);requireValue(Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(descriptors,key)&&Object.hasOwn(descriptors[key],'value')));return value;
 }
 function rawValue(raw){requireValue(raw===null||typeof raw==='string');requireValue((raw?.length??0)<=MAX_VALUE_CODE_UNITS,'LIMIT');return raw;}
 function componentsFrom(value){
  requireValue(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=COMPONENT_IDS.length);
  const descriptors=Object.getOwnPropertyDescriptors(value);requireValue(Reflect.ownKeys(value).length===value.length+1);
  const found=new Map();
  for(let i=0;i<value.length;i++){
   requireValue(Object.hasOwn(descriptors,String(i))&&Object.hasOwn(descriptors[i],'value'));
   const item=descriptors[i].value;requireValue(item&&typeof item==='object'&&!Array.isArray(item));const kind=Object.getOwnPropertyDescriptor(item,'status');requireValue(kind&&Object.hasOwn(kind,'value'));
   if(kind.value==='observed'){
    shape(item,['id','status','raw','generation']);requireValue(COMPONENT_IDS.includes(item.id)&&Number.isSafeInteger(item.generation)&&item.generation>=0&&!Object.is(item.generation,-0));rawValue(item.raw);
    requireValue(!found.has(item.id));found.set(item.id,Object.freeze({id:item.id,status:'observed',raw:item.raw,generation:item.generation}));
   }else{
    shape(item,['id','status','reason']);requireValue(kind.value==='unavailable'&&COMPONENT_IDS.includes(item.id)&&['NOT_CAPTURED','UNSUPPORTED','READ_FAILED'].includes(item.reason));requireValue(!found.has(item.id));found.set(item.id,Object.freeze({id:item.id,status:'unavailable',reason:item.reason}));
   }
  }
  return COMPONENT_IDS.map(id=>found.get(id)??Object.freeze({id,status:'unavailable',reason:'NOT_CAPTURED'}));
 }
 function create({subtle,now=()=>new Date().toISOString()}={}){
  requireValue(Copy&&typeof Copy.create==='function'&&Copy.MAX_CODE_UNITS===MAX_VALUE_CODE_UNITS&&typeof now==='function','UNAVAILABLE');
  let copier;try{copier=Copy.create({indexedDB:{open(){throw failure('UNAVAILABLE');}},subtle,now});}catch(error){throw safe(error);}
  let closed=false,changes=new WeakMap();
  const ensureOpen=()=>requireValue(!closed,'CLOSED');
  async function digest(raw){const metadata=await copier.prepareFrom({getItem:()=>raw});return metadata.id;}
  async function prepareFrom(storage,components=[]){
   try{
    ensureOpen();requireValue(storage&&typeof storage.getItem==='function');const read=storage.getItem,memory=componentsFrom(components),capturedAt=now();requireValue(validTime(capturedAt));
    let total=memory.reduce((n,item)=>n+(item.status==='observed'?(item.raw?.length??0):0),0);requireValue(total<=MAX_TOTAL_CODE_UNITS,'LIMIT');
    // All exact primitives are captured synchronously before any digest await.
    const persisted=KEYS.map(key=>{
     let raw;try{raw=read.call(storage,key);}catch{return Object.freeze({key,status:'unavailable',reason:'READ_FAILED'});}
     if(raw!==null&&typeof raw!=='string')return Object.freeze({key,status:'unavailable',reason:'READ_INVALID'});
     rawValue(raw);total+=raw?.length??0;requireValue(total<=MAX_TOTAL_CODE_UNITS,'LIMIT');return Object.freeze({key,status:'observed',raw});
    });
    const sign=async item=>Object.freeze(item.status==='observed'?{...item,codeUnits:item.raw?.length??0,digest:await digest(item.raw)}:{...item});
    const signedPersisted=Object.freeze(await Promise.all(persisted.map(sign))),signedMemory=Object.freeze(await Promise.all(memory.map(sign)));ensureOpen();
    const reasons=Object.freeze(['WRITER_BARRIER_NOT_IMPLEMENTED','MEMORY_CONTRACTS_NOT_VALIDATED',...persisted.filter(x=>x.status==='unavailable').map(x=>'persisted:'+x.key+':'+x.reason),...memory.filter(x=>x.status==='unavailable').map(x=>'component:'+x.id+':'+x.reason)]);
    const metadata=item=>item.status==='observed'?Object.fromEntries(Object.entries(item).filter(([key])=>key!=='raw')):item;
    const manifest={format:FORMAT,version:VERSION,completeCopy:false,consistency:'uncoordinated',persisted:signedPersisted.map(metadata),components:signedMemory.map(metadata),reasons};
    const id=await digest(JSON.stringify(manifest));ensureOpen();
    const counts=Object.freeze({persistedObserved:persisted.filter(x=>x.status==='observed').length,persistedUnavailable:persisted.filter(x=>x.status==='unavailable').length,componentsObserved:memory.filter(x=>x.status==='observed').length,componentsUnavailable:memory.filter(x=>x.status==='unavailable').length,rawCodeUnits:total});
    const token=Object.freeze({format:FORMAT,version:VERSION,id,capturedAt,status:'prepared-incomplete',completeCopy:false,consistency:'uncoordinated',counts,reasons});
    changes.set(token,Object.freeze({...token,persisted:signedPersisted,components:signedMemory}));return token;
   }catch(error){throw safe(error);}
  }
  function readCandidate(token){ensureOpen();const value=changes.get(token);requireValue(value,'PLAN');return value;}
  function close(){closed=true;changes=new WeakMap();copier.close();}
  return Object.freeze({prepareFrom,readCandidate,close});
 }
 return Object.freeze({VERSION,FORMAT,KEYS,COMPONENT_IDS,MAX_VALUE_CODE_UNITS,MAX_TOTAL_CODE_UNITS,create});
});
