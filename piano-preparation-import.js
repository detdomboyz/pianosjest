(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-preparation-transfer.js'),require('./piano-preparation-store.js'),require('./piano-progress-store.js')):factory(root.PianoPreparationTransfer,root.PianoPreparationStore,root.PianoProgressStore);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoPreparationImport=api;})(typeof window==='object'?window:globalThis,function(Transfer,Store,Progress){
 'use strict';
 const STORAGE_KEY='music-preparation-transfer-backups-piano-v1',MAX_OPERATIONS=8,MAX_ARCHIVE_DEPTH=8,MAX_ARCHIVE_RECORDS=128;
 const LOCK_NAMES=Object.freeze([Progress.LOCK_NAME,Store.LOCK_NAME,Store.fragments.LOCK_NAME]);
 const PROFILES=new Map([[Store.STORAGE_KEY,Store],[Store.fragments.STORAGE_KEY,Store.fragments],[Progress.STORAGE_KEY,null]]);
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),integer=x=>Number.isSafeInteger(x)&&x>=0,copy=x=>JSON.parse(JSON.stringify(x));
 function fail(code){throw Object.assign(Error(code),{code});}
 function rawValue(raw){if(raw!==null&&typeof raw!=='string')fail('IMPORT_RAW_INVALID');}
 function decoded(raw,key,now){rawValue(raw);if(raw!==null)Transfer.decode(raw);const profile=PROFILES.get(key);if(profile===undefined)fail('IMPORT_KEY');if(profile)return profile.parse(raw,now);Progress.inspect(raw,now);return Progress.parse(raw);}
 function empty(data,key){return Transfer.canonical(data)===Transfer.canonical(PROFILES.get(key)?.empty()||{});}
 function trace(){return {depth:0,budget:{records:0},seen:new Map()};}
 function archive(raw,lessons,now,walk=trace()){
  if(walk.depth>MAX_ARCHIVE_DEPTH)fail('IMPORT_ARCHIVE_DEPTH');if(walk.seen.has(raw))return walk.seen.get(raw);
  const log=raw===null?{schemaVersion:1,kind:'piano-preparation-transfer-backups',operations:[]}:Transfer.decode(raw);
  if(!object(log)||log.schemaVersion!==1||log.kind!=='piano-preparation-transfer-backups'||!Array.isArray(log.operations)||log.operations.length>MAX_OPERATIONS)fail('IMPORT_BACKUP_FORMAT');const ids=new Set();let pending=0;
  for(const r of log.operations){if(++walk.budget.records>MAX_ARCHIVE_RECORDS)fail('IMPORT_ARCHIVE_LIMIT');if(!object(r)||typeof r.id!=='string'||!r.id.trim()||r.id.length>256||ids.has(r.id)||!integer(r.createdAt)||r.createdAt>now||!['prepared','applied'].includes(r.phase)||(r.phase==='applied'&&(!integer(r.appliedAt)||r.appliedAt<r.createdAt||r.appliedAt>now)))fail('IMPORT_BACKUP_FORMAT');ids.add(r.id);if(r.phase==='prepared')pending++;const expected=plan(r.sourceRaw,r.before,lessons,now,walk);if(Transfer.canonical(expected.after)!==Transfer.canonical(r.after))fail('IMPORT_BACKUP_MISMATCH');}
  if(pending>1)fail('IMPORT_BACKUP_FORMAT');walk.seen.set(raw,log);return log;
 }
 function source(raw,lessons,now,walk=trace()){
  const inspection=Transfer.inspect(raw,{lessons,now});if(inspection.status!=='valid')fail(inspection.archivePending?'IMPORT_ARCHIVE_PENDING':inspection.code||'IMPORT_SOURCE_INCOMPLETE');const bundle=Transfer.decode(raw),desired={};
  if(bundle.transferArchive?.raw!==null&&bundle.transferArchive?.raw!==undefined)archive(bundle.transferArchive.raw,lessons,now,{...walk,depth:walk.depth+1});
  function journal(j,p){
   let text=j.storedHistoryRaw;const original=j.storedHistory,entries=original.entries.slice(),ids=new Set(entries.map(e=>e.attempt.attemptId));
   for(const e of j.recoveryEntries)if(!ids.has(e.attempt.attemptId)){entries.push(e);ids.add(e.attempt.attemptId);}
   if(entries.length!==original.entries.length){const h={...original,revision:original.revision+entries.length-original.entries.length,entries};p.validate(h,now);text=JSON.stringify(h);if(text.length>Store.MAX_CHARS)fail('IMPORT_JOURNAL_FULL');}
   desired[p.STORAGE_KEY]=text;
  }
  journal(bundle.schemaVersion===1?bundle:bundle.journals.whole,Store);if(bundle.schemaVersion===2)journal(bundle.journals.fragments,Store.fragments);desired[Progress.STORAGE_KEY]=bundle.legacy.raw;
  return {desired,inspection};
 }
 function plan(raw,before,lessons,now,walk=trace()){
  const {desired,inspection}=source(raw,lessons,now,walk),keys=Object.keys(desired);if(!object(before)||Transfer.canonical(Object.keys(before).sort())!==Transfer.canonical(keys.slice().sort()))fail('IMPORT_SNAPSHOT_KEYS');const after={},actions=[];
  for(const key of keys){const local=decoded(before[key],key,now),incoming=decoded(desired[key],key,now);let action;
   if(empty(incoming,key)){after[key]=before[key];action='keep';}
   else if(empty(local,key)){after[key]=desired[key];action=before[key]===desired[key]?'identical':'write';}
   else if(Transfer.canonical(local)===Transfer.canonical(incoming)){after[key]=before[key];action='identical';}
   else fail('IMPORT_DESTINATION_CONFLICT');actions.push({key,action});
  }
  return {after,actions,inspection};
 }
 function create({storage,locks,now,lessons,id,allowed=()=>true,onChange=()=>{}}){
  let active=null,running=0,generation=0,lastArchive,logPending=false,attemptPending=false,code=null;
  const snapshot=()=>({saving:running>0,pending:logPending||attemptPending,code,generation});
  function emit(){onChange(snapshot());}
  function stamp(raw,log){if(raw!==lastArchive){lastArchive=raw;generation++;}logPending=log.operations.some(r=>r.phase==='prepared');}
  function get(key){let raw;try{raw=storage.getItem(key);}catch{fail('IMPORT_READ_FAILED');}rawValue(raw);return raw;}
  function write(key,text,backup=false){if(typeof text!=='string')fail('IMPORT_NO_DELETE');try{storage.setItem(key,text);}catch{fail(backup?'IMPORT_BACKUP_WRITE_FAILED':'IMPORT_WRITE_FAILED');}let saved;try{saved=storage.getItem(key);}catch{fail(backup?'IMPORT_BACKUP_NOT_CONFIRMED':'IMPORT_SAVE_NOT_CONFIRMED');}if(saved!==text)fail(backup?'IMPORT_BACKUP_NOT_CONFIRMED':'IMPORT_SAVE_NOT_CONFIRMED');}
  function encode(log){const text=JSON.stringify(log);if(text.length>Transfer.MAX_CHARS)fail('IMPORT_BACKUP_FULL');return text;}
  function load(context,timestamp,raw=get(STORAGE_KEY)){
   const log=archive(raw,context,timestamp);stamp(raw,log);return {raw,log};
  }
  async function locked(work){if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')fail('STORAGE_UNAVAILABLE');if(!locks||typeof locks.request!=='function')fail('LOCKS_UNAVAILABLE');async function take(index){if(index===LOCK_NAMES.length)return work();return locks.request(LOCK_NAMES[index],{mode:'exclusive'},lock=>{if(!lock)fail('LOCK_NOT_ACQUIRED');return take(index+1);});}return take(0);}
  async function operation(work,failure='blocked'){running++;emit();try{const result=await locked(work);code=result.code||null;return result;}catch(e){code=typeof e?.code==='string'?e.code:'IMPORT_FAILED';return {status:failure,code};}finally{running--;emit();}}
  function timestamp(){const value=now();if(!integer(value))fail('IMPORT_CLOCK');return value;}
  function token(){const value=id();if(typeof value!=='string'||!value.trim()||value.length>220)fail('IMPORT_ID');return value;}
  function readBefore(keys){return Object.fromEntries(keys.map(key=>[key,get(key)]));}
  function resumable(r){for(const key of Object.keys(r.before)){const current=get(key);if(current!==r.before[key]&&current!==r.after[key])fail('IMPORT_DESTINATION_CHANGED');}}
  return {
   snapshot,
   cancel(){active=null;attemptPending=false;},
   preview(sourceRaw){active=null;attemptPending=false;return operation(()=>{
    if(!allowed())fail('IMPORT_BUSY');const at=timestamp(),context=lessons(),incoming=source(sourceRaw,context,at),archive=load(context,at),previous=archive.log.operations.find(r=>r.sourceRaw===sourceRaw);
    if(previous?.phase==='applied')return {status:'already-applied',operationId:previous.id};if(archive.log.operations.some(r=>r.phase==='prepared'&&r!==previous))fail('IMPORT_OTHER_PENDING');
    const before=previous?copy(previous.before):readBefore(Object.keys(incoming.desired)),prepared=plan(sourceRaw,before,context,at);if(previous){resumable(previous);prepared.actions=prepared.actions.map(a=>a.action==='write'&&get(a.key)===previous.after[a.key]?{...a,action:'identical'}:a);}else if(archive.log.operations.length>=MAX_OPERATIONS)fail('IMPORT_BACKUP_FULL');
    const ticket=token();active={ticket,sourceRaw,before,archiveBefore:archive.raw,record:previous?copy(previous):null};
    return {status:'ready',ticket,resume:Boolean(previous),actions:prepared.actions,legacyRecoveryArchived:Boolean(incoming.inspection.legacyRecovery),backupOperations:archive.log.operations.length};
   });},
   apply(ticket){return operation(()=>{
    if(!allowed())fail('IMPORT_BUSY');const current=active;if(!current||current.ticket!==ticket)fail('IMPORT_PREVIEW_REQUIRED');const at=timestamp(),context=lessons(),archive=load(context,at),previous=archive.log.operations.find(r=>r.sourceRaw===current.sourceRaw);
    if(previous?.phase==='applied'){attemptPending=false;return {status:'already-applied',operationId:previous.id};}if(archive.log.operations.some(r=>r.phase==='prepared'&&r!==previous))fail('IMPORT_OTHER_PENDING');
    let record=previous,log=archive.log;
    if(record){plan(current.sourceRaw,record.before,context,at);resumable(record);}
    else{
     if(archive.raw!==current.archiveBefore)fail('IMPORT_DESTINATION_CHANGED');for(const[key,raw]of Object.entries(current.before))if(get(key)!==raw)fail('IMPORT_DESTINATION_CHANGED');if(log.operations.length>=MAX_OPERATIONS)fail('IMPORT_BACKUP_FULL');
     const prepared=plan(current.sourceRaw,current.before,context,at);record=current.record||{id:token(),sourceRaw:current.sourceRaw,before:copy(current.before),after:prepared.after,createdAt:at,phase:'prepared'};
     if(log.operations.some(r=>r.id===record.id))fail('IMPORT_ID');current.record=record;log={...log,operations:[...log.operations,record]};attemptPending=true;const text=encode(log);write(STORAGE_KEY,text,true);stamp(text,log);
    }
    attemptPending=true;
    for(const[key,raw]of Object.entries(record.after)){const local=get(key);if(local===raw)continue;if(local!==record.before[key])fail('IMPORT_DESTINATION_CHANGED');write(key,raw);}
    const applied={...record,phase:'applied',appliedAt:at},finished={...log,operations:log.operations.map(r=>r.id===record.id?applied:r)},text=encode(finished);write(STORAGE_KEY,text,true);stamp(text,finished);attemptPending=false;
    return {status:'saved',operationId:record.id};
   },'unsaved');},
   readArchive(){return operation(()=>{const at=timestamp(),raw=get(STORAGE_KEY);try{const archive=load(lessons(),at,raw);return {status:'ready',raw:archive.raw};}catch(e){return {status:'blocked',code:e?.code||'IMPORT_BACKUP_FORMAT',raw};}});}
  };
 }
 return {STORAGE_KEY,MAX_OPERATIONS,MAX_ARCHIVE_DEPTH,MAX_ARCHIVE_RECORDS,LOCK_NAMES,create};
});
