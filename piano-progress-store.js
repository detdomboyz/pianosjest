(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./practice-assessment.js')):factory(root.PracticeAssessment);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoProgressStore=api;})(typeof window==='object'?window:globalThis,function(Assessment){
 'use strict';
 const STORAGE_KEY='music-learning-piano-v1',LOCK_NAME='melodiajest:piano-progress-v1',META='melodiajestPersistence',MAX_CHARS=2000000,MAX_RECEIPTS=2048;
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),integer=x=>Number.isSafeInteger(x)&&x>=0,copy=x=>JSON.parse(JSON.stringify(x));
 function fail(code){throw Object.assign(Error(code),{code});}
 function parse(raw){if(raw===null)return {};if(typeof raw!=='string'||raw.length>MAX_CHARS)fail('LEGACY_PROGRESS_FORMAT');let data;try{data=JSON.parse(raw);}catch{fail('LEGACY_PROGRESS_FORMAT');}if(!object(data)||Object.keys(data).length>2000||typeof data.schemaVersion==='number'||typeof data.format==='string')fail('LEGACY_PROGRESS_FORMAT');return data;}
 function validOperation(op,now){return integer(now)&&object(op)&&typeof op.id==='string'&&op.id.trim()&&op.id.length<=256&&typeof op.lessonId==='string'&&op.lessonId.trim()&&op.lessonId.length<=200&&!['__proto__','constructor','prototype'].includes(op.lessonId)&&/^[a-f0-9]{8}$/.test(op.fingerprint||'')&&['challenge','memory'].includes(op.mode)&&typeof op.clean==='boolean'&&integer(op.at)&&op.at<=now;}
 function validateRow(row,id,now){if(row===undefined)return;if(!object(row)||row.version!==Assessment.VERSION||row.instrument!=='piano'||row.lessonId!==id||!/^[a-f0-9]{8}$/.test(row.fingerprint||'')||!Array.isArray(row.takes)||!row.takes.every(t=>object(t)&&integer(t.at)&&t.at<=now&&['challenge','memory'].includes(t.mode))||row.cleanTakes!==row.takes.length||!['memory','retained','ready'].every(k=>typeof row[k]==='boolean')||(row.history!==undefined&&!object(row.history))||(row.firstCleanAt!==undefined&&(!integer(row.firstCleanAt)||row.firstCleanAt>now)))fail('LEGACY_PROGRESS_ROW_UNSUPPORTED');}
 function receipts(row){const meta=row?.[META];if(meta===undefined)return [];if(!object(meta)||meta.version!==1||!Array.isArray(meta.receipts)||meta.receipts.length>MAX_RECEIPTS||new Set(meta.receipts.map(x=>x?.id)).size!==meta.receipts.length||!meta.receipts.every(x=>validOperation(x,Number.MAX_SAFE_INTEGER)))fail('LEGACY_RECEIPTS_UNSUPPORTED');return meta.receipts;}
 function apply(row,op,now){
  if(!validOperation(op,now))fail('LEGACY_OPERATION_INVALID');validateRow(row,op.lessonId,now);const previousReceipts=receipts(row),existing=previousReceipts.find(r=>r.id===op.id);
  if(existing){if(JSON.stringify(existing)!==JSON.stringify(op))fail('LEGACY_RECEIPT_CONFLICT');return row;}
  if(previousReceipts.length>=MAX_RECEIPTS)fail('LEGACY_RECEIPTS_FULL');let result;
  if(row?.fingerprint===op.fingerprint){
   if(!op.clean)result=copy(row);
   else{
    // Replay chronological observations through the actual summary reducer.
    // A late queued operation must not delete a newer take as "future".
    const takes=[...row.takes,{at:op.at,mode:op.mode}].sort((a,b)=>a.at-b.at);
    result={...row,takes:[],cleanTakes:0,memory:false,retained:false,ready:false,firstCleanAt:Math.min(row.firstCleanAt??op.at,op.at)};
    for(const take of takes)result=Assessment.record(result,{instrument:'piano',lessonId:op.lessonId,fingerprint:op.fingerprint,mode:take.mode,clean:true,now:take.at});
    result.takes=result.takes.length?copy(takes.slice(-result.takes.length)):[];
   }
  }else result=Assessment.record(row,{instrument:'piano',lessonId:op.lessonId,fingerprint:op.fingerprint,mode:op.mode,clean:op.clean,now:op.at});
  return {...(row||{}),...result,[META]:{version:1,receipts:[...previousReceipts,copy(op)]}};
 }
 // Read-only transfer validation uses the same row/receipt rules as the writer.
 // Opaque personal rows and archive extensions are retained, never promoted.
 function inspect(raw,now){
  if(!integer(now))fail('LEGACY_OPERATION_INVALID');const data=parse(raw),result={records:Object.keys(data).length,progressRecords:0,privateRecords:0,archivedEditions:0,opaqueArchives:0,receiptOperations:[]};
  const progressLike=row=>object(row)&&(row.instrument==='piano'||Object.hasOwn(row,'lessonId')||Object.hasOwn(row,'takes')||Object.hasOwn(row,'fingerprint'));
  function visit(row,id,depth){if(depth>32)fail('LEGACY_ARCHIVE_DEPTH');validateRow(row,id,now);for(const op of receipts(row)){if(op.lessonId!==id||!validOperation(op,now))fail('LEGACY_RECEIPTS_UNSUPPORTED');result.receiptOperations.push(copy(op));}for(const [key,archive]of Object.entries(row.history||{})){if(progressLike(archive)){if(key!==archive.version+':'+archive.fingerprint)fail('LEGACY_ARCHIVE_KEY');result.archivedEditions++;visit(archive,id,depth+1);}else result.opaqueArchives++;}}
  for(const[id,row]of Object.entries(data)){if(progressLike(row)){result.progressRecords++;visit(row,id,0);}else result.privateRecords++;}return result;
 }
 function create({storage,locks,now,onChange=()=>{}}){
  const pending=new Map();let job=null,confirmed=null,lastRaw,baseRaw=null,draftRaw=null,code=null,generation=0;
  function snapshot(){return {pendingCount:pending.size,saving:job!==null,code,generation};}
  function emit(){onChange(snapshot());}
  function remember(raw,data){if(raw!==lastRaw){generation++;lastRaw=raw;}confirmed=copy(data);}
  async function locked(work){try{if(!locks||typeof locks.request!=='function')fail('LOCKS_UNAVAILABLE');if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')fail('STORAGE_UNAVAILABLE');return await locks.request(LOCK_NAME,{mode:'exclusive'},lock=>{if(!lock)fail('LOCK_NOT_ACQUIRED');return work();});}catch(e){code=e?.code||'LOCK_OR_STORAGE_FAILED';return {status:'unsaved',code};}}
  async function flush(){
   if(job)return job;
   job=Promise.resolve().then(()=>locked(()=>{
    let raw;try{raw=storage.getItem(STORAGE_KEY);}catch{fail('STORAGE_READ_FAILED');}baseRaw=raw;const data=parse(raw);remember(raw,data);let next=data;
    const batch=[...pending.values()];for(const op of batch){if(!validOperation(op,now()))fail('LEGACY_OPERATION_INVALID');next={...next,[op.lessonId]:apply(next[op.lessonId],op,now())};}
    if(batch.length){const text=JSON.stringify(next);draftRaw=text;if(text.length>MAX_CHARS)fail('LEGACY_PROGRESS_FULL');if(text!==raw){try{storage.setItem(STORAGE_KEY,text);}catch{fail('STORAGE_WRITE_FAILED');}let saved;try{saved=storage.getItem(STORAGE_KEY);}catch{fail('SAVE_NOT_CONFIRMED');}if(saved!==text)fail('SAVE_NOT_CONFIRMED');raw=saved;}remember(raw,next);for(const op of batch)pending.delete(op.id);generation++;}
    code=null;if(!pending.size){baseRaw=null;draftRaw=null;}return {status:'saved'};
   })).finally(()=>{job=null;emit();if(pending.size&&!code)void flush();});emit();return job;
  }
  return {
   snapshot,confirmedProgress(){return confirmed===null?null:copy(confirmed);},
   record(operation){let op;try{op=copy(operation);if(!validOperation(op,now()))fail('LEGACY_OPERATION_INVALID');const old=pending.get(op.id);if(old&&JSON.stringify(old)!==JSON.stringify(op))fail('LEGACY_RECEIPT_CONFLICT');}catch(e){code=e?.code||'LEGACY_OPERATION_INVALID';emit();return Promise.resolve({status:'unsaved',code});}pending.set(op.id,op);generation++;if(job){emit();return job;}return flush();},
   async refresh(){const r=await locked(()=>{let raw;try{raw=storage.getItem(STORAGE_KEY);}catch{fail('STORAGE_READ_FAILED');}const data=parse(raw);remember(raw,data);code=null;return {status:'ready'};});emit();return r;},
   retry:flush,async settled(){while(job)await job;return snapshot();},
   exportRecovery(){return {schemaVersion:1,kind:'piano-legacy-save-recovery',pending:copy([...pending.values()]),baseRaw,draftRaw,generation};}
  };
 }
 return {STORAGE_KEY,LOCK_NAME,META,MAX_CHARS,MAX_RECEIPTS,parse,apply,inspect,isOperation:(operation,now)=>Boolean(validOperation(operation,now)),create};
});
