(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PianoLessonPackageStore=factory();})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Persistence only. A verified package planner must produce the candidate first.
  // Production catalog/progress writers have not switched to this store yet.
  const VERSION=1,DATABASE='melodiajest-piano-packages-v1',SLOTS='slots';
  const MAX_CATALOG_BYTES=32*1024*1024,MAX_STRING_BYTES=1024*1024,MAX_DEPTH=80,MAX_NODES=1000000;
  const MAX_ARCHIVE_BYTES=3*MAX_CATALOG_BYTES,MAX_RECOVERY_BYTES=10*MAX_CATALOG_BYTES;
  const CORE_SLOTS=Object.freeze(['current','previous','receipt','pending']);
  const encoder=new TextEncoder();
  const messages={INPUT:'Некорректные данные. Исходная копия сохранена.',LIMIT:'Материал превышает допустимый объём.',SOURCE:'Не совпадает версия источника.',STALE:'Каталог изменён в другой вкладке. Подготовь обновление заново.',PLAN:'Подготовь обновление в этой вкладке заново.',UNAVAILABLE:'Хранилище браузера недоступно.',BLOCKED:'Другая вкладка удерживает несовместимую версию хранилища.',SCHEMA:'Версия хранилища не поддерживается. Данные сохранены.',CLOSED:'Это соединение уже закрыто.',ABORTED:'Сохранение отменено. Рабочая версия сохранена.',QUOTA:'Недостаточно места. Рабочая версия сохранена.',ID_REUSED:'Идентификатор записи уже использован.'};
  messages.PENDING='Есть незавершённое сохранение. Сначала восстанови его или сохрани копию для разбора.';
  messages.ARCHIVE_FULL='Архив незавершённой правки уже занят. Сохрани его для отдельного разбора.';
  messages.CONFLICT='Хранилище уже содержит данные. Импорт не заменяет существующие записи.';
  function failure(code){const e=new Error(messages[code]);e.name='LessonPackageStoreError';e.code=code;return e;}
  function requireValue(ok,code='INPUT'){if(!ok)throw failure(code);}
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const identifier=x=>typeof x==='string'&&x.length>0&&x.length<=160;
  const exact=(x,names)=>object(x)&&Object.keys(x).length===names.length&&names.every(k=>Object.hasOwn(x,k));
  function jsonData(value,max=MAX_CATALOG_BYTES,extraDepth=0,strict=false){
    const seen=new Set();let nodes=0,bytes=0;
    const add=n=>{bytes+=n;requireValue(bytes<=max,'LIMIT');};
    function copy(v,depth){
      requireValue(depth<=MAX_DEPTH+extraDepth&&++nodes<=MAX_NODES*Math.ceil(max/MAX_CATALOG_BYTES),'LIMIT');
      if(v===null||typeof v==='boolean'){add(v===null?4:v?4:5);return v;}
      if(typeof v==='number'){requireValue(Number.isFinite(v)&&(!strict||!Object.is(v,-0)));add(String(v).length);return v;}
      if(typeof v==='string'){const n=encoder.encode(JSON.stringify(v)).byteLength;requireValue(n<=MAX_STRING_BYTES,'LIMIT');add(n);return v;}
      requireValue(object(v)||Array.isArray(v));requireValue(!seen.has(v));
      const proto=Object.getPrototypeOf(v);requireValue(Array.isArray(v)||proto===Object.prototype||proto===null);
      seen.add(v);let out;
      if(Array.isArray(v)){
        requireValue(v.length<=10000,'LIMIT');add(2+Math.max(0,v.length-1));
        out=Array.from({length:v.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(v,String(i));requireValue(d&&Object.hasOwn(d,'value'));return copy(d.value,depth+1);});
      }else{
        const descriptors=Object.getOwnPropertyDescriptors(v),entries=[];
        requireValue(Reflect.ownKeys(descriptors).every(k=>typeof k==='string'));
        requireValue(Object.keys(descriptors).length<=10000,'LIMIT');add(2);
        for(const k of Object.keys(descriptors).sort()){
          const d=descriptors[k];requireValue(Object.hasOwn(d,'value'));
          if(d.value===undefined){requireValue(!strict);continue;}
          const n=encoder.encode(JSON.stringify(k)).byteLength;requireValue(n<=MAX_STRING_BYTES,'LIMIT');add(n+1+(entries.length?1:0));entries.push([k,copy(d.value,depth+1)]);
        }
        out=Object.fromEntries(entries);
      }
      seen.delete(v);return out;
    }
    return copy(value,0);
  }
  function freeze(v){if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
  const canonical=v=>JSON.stringify(jsonData(v));
  function validatePin(pin){
    requireValue(exact(pin,['release','manifestSha256','webManifestSha256']));
    requireValue(typeof pin.release==='string'&&/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(pin.release)&&sha(pin.manifestSha256)&&sha(pin.webManifestSha256),'SOURCE');
  }
  function validateCandidate(value){
    const result=jsonData(value);requireValue(exact(result,['active','catalog']));validatePin(result.active);
    const c=result.catalog;requireValue(object(c)&&c.version===7&&Array.isArray(c.themes)&&Array.isArray(c.lessons)&&Object.keys(c).every(k=>['version','savedAt','themes','lessons'].includes(k)));
    requireValue(!Object.hasOwn(c,'savedAt')||typeof c.savedAt==='string');
    requireValue(c.themes.length<=2048&&c.lessons.length<=10000,'LIMIT');
    const themes=new Set(),lessons=new Set();
    for(const t of c.themes){requireValue(object(t)&&identifier(t.id)&&typeof t.name==='string'&&Number.isSafeInteger(t.order)&&t.order>=1&&!themes.has(t.id));themes.add(t.id);}
    for(const l of c.lessons){requireValue(object(l)&&identifier(l.id)&&typeof l.pattern==='string'&&themes.has(l.themeId)&&Number.isSafeInteger(l.order)&&l.order>=1&&!lessons.has(l.id));lessons.add(l.id);}
    return result;
  }
  function state(value){
    requireValue(exact(value,['format','revision','operationId','active','catalog']),'SCHEMA');
    requireValue(value.format==='melodiajest-piano-package-state-v1'&&Number.isSafeInteger(value.revision)&&value.revision>=1&&identifier(value.operationId),'SCHEMA');
    const c=validateCandidate({active:value.active,catalog:value.catalog});
    return {format:value.format,revision:value.revision,operationId:value.operationId,active:c.active,catalog:c.catalog};
  }
  function forward(from,to){
    const x=from.release.split('.').map(Number),y=to.release.split('.').map(Number);
    const i=x.findIndex((v,i)=>v!==y[i]);
    requireValue(i<0?canonical(from)===canonical(to):y[i]>x[i],'SOURCE');
  }
  function pendingState(value){
    const data=jsonData(value,3*MAX_CATALOG_BYTES,4);
    requireValue(exact(data,['format','before','after'])&&data.format==='melodiajest-piano-package-pending-v1','SCHEMA');
    const before=data.before===null?null:state(data.before),after=state(data.after);
    requireValue(after.revision===(before?.revision??0)+1&&after.operationId!==before?.operationId,'SCHEMA');
    if(before)forward(before.active,after.active);
    return {format:data.format,before,after};
  }
  const pendingCanonical=value=>JSON.stringify(pendingState(value));
  function create({indexedDB,name=DATABASE,id=()=>crypto.randomUUID()}={}){
    requireValue(indexedDB&&typeof indexedDB.open==='function','UNAVAILABLE');
    requireValue(typeof name==='string'&&/^melodiajest-piano-packages-v1(?:-qa-[a-z0-9-]{1,80})?$/.test(name));
    requireValue(typeof id==='function');
    let connection=null,opening=null,closed=false;const views=new WeakMap(),changes=new WeakMap(),archives=new WeakMap(),pendingRestores=new WeakMap(),recoveryImports=new WeakMap();
    function view(raw){const result=freeze(state(raw));views.set(result,canonical(result));return result;}
    function open(){
      if(closed)return Promise.reject(failure('CLOSED'));
      if(connection)return Promise.resolve(connection);
      if(opening)return opening;
      opening=new Promise((resolve,reject)=>{
        let settled=false,request;
        const fail=code=>{if(!settled){settled=true;reject(failure(code));}};
        try{request=indexedDB.open(name,VERSION);}catch{fail('UNAVAILABLE');return;}
        request.onblocked=()=>fail('BLOCKED');
        request.onerror=()=>fail(request.error?.name==='VersionError'?'SCHEMA':'UNAVAILABLE');
        request.onupgradeneeded=e=>{
          if(settled||closed||e.oldVersion!==0){request.transaction.abort();return;}
          request.result.createObjectStore(SLOTS);
        };
        request.onsuccess=()=>{
          const db=request.result;
          if(settled||closed){db.close();fail('CLOSED');return;}
          if(db.objectStoreNames.length!==1||!db.objectStoreNames.contains(SLOTS)){db.close();fail('SCHEMA');return;}
          db.onversionchange=()=>{db.close();if(connection===db)connection=null;};
          connection=db;settled=true;resolve(db);
        };
      }).finally(()=>{opening=null;});
      return opening;
    }
    async function readSlots(includeArchive=false,includePendingPresence=false){
      const db=await open();return new Promise((resolve,reject)=>{
        let tx;const out={};
        try{
          tx=db.transaction(SLOTS,'readonly');const slots=tx.objectStore(SLOTS);
          for(const k of includeArchive?[...CORE_SLOTS,'pendingArchive']:CORE_SLOTS){const r=slots.get(k);r.onsuccess=()=>{out[k]=k==='pendingArchive'?r.result:r.result??null;};}
          if(includeArchive){const r=slots.getKey('pendingArchive');r.onsuccess=()=>{out.hasPendingArchive=r.result!==undefined;};}
          if(includePendingPresence){const r=slots.getKey('pending');r.onsuccess=()=>{out.hasPending=r.result!==undefined;};}
        }
        catch{reject(failure('UNAVAILABLE'));return;}
        tx.onabort=()=>reject(failure('ABORTED'));
        tx.oncomplete=()=>resolve(out);
      });
    }
    async function read(){const raw=(await readSlots()).current;return raw===null?null:view(raw);}
    function planFor(before,after,pendingRequired=false){
      const plan=freeze({version:VERSION,fromRevision:before?.revision??0,toRevision:after.revision,active:jsonData(after.active),operationId:after.operationId,catalogBytes:encoder.encode(JSON.stringify(after.catalog)).byteLength});
      changes.set(plan,{base:before===null?null:canonical(before),before,after:state(after),pendingRequired});return plan;
    }
    function prepare(expected,candidate){
      requireValue(!closed,'CLOSED');requireValue(expected===null||views.has(expected),'PLAN');
      const next=validateCandidate(candidate),before=expected===null?null:state(expected);
      if(before)forward(before.active,next.active);
      const operationId=id();requireValue(identifier(operationId));
      const revision=(before?.revision??0)+1;requireValue(Number.isSafeInteger(revision),'LIMIT');
      const after={format:'melodiajest-piano-package-state-v1',revision,operationId,active:next.active,catalog:next.catalog};
      requireValue(operationId!==before?.operationId,'ID_REUSED');
      return planFor(before,after);
    }
    function recoverablePending(slots){
      const pending=pendingState(slots.pending),current=slots.current===null?null:canonical(state(slots.current));
      requireValue(current===(pending.before===null?null:canonical(pending.before))||current===canonical(pending.after),'STALE');
      return pending;
    }
    async function recoverPending(){
      const slots=await readSlots();if(slots.pending===null)return null;
      const pending=recoverablePending(slots);
      return planFor(pending.before,pending.after,true);
    }
    async function writeChange(plan,mode){
      const change=changes.get(plan);requireValue(change,'PLAN');
      const desired=pendingState({format:'melodiajest-piano-package-pending-v1',before:change.before,after:change.after}),pendingText=pendingCanonical(desired);
      const db=await open();return new Promise((resolve,reject)=>{
        let tx,reason=null,replayed=false;
        const abort=error=>{reason=error;try{tx.abort();}catch{reject(reason);}};
        try{
          tx=db.transaction(SLOTS,'readwrite',{durability:'strict'});
          tx.onabort=()=>reject(reason??failure(tx.error?.name==='QuotaExceededError'?'QUOTA':'ABORTED'));
          tx.oncomplete=()=>resolve(mode==='stage'?{status:replayed?'replayed':'staged',operationId:change.after.operationId,durability:tx.durability??'unknown'}:{status:replayed?'replayed':'committed',current:view(change.after),durability:tx.durability??'unknown'});
          const slots=tx.objectStore(SLOTS),request=slots.get('current');
          request.onsuccess=()=>{
            try{
              const raw=request.result??null,current=raw===null?null:state(raw);
              const pendingRequest=slots.get('pending');
              pendingRequest.onsuccess=()=>{
                try{
                  const pending=pendingRequest.result??null,matching=pending!==null&&pendingCanonical(pending)===pendingText;
                  requireValue(pending===null||matching,'PENDING');
                  if(mode==='stage'){
                    requireValue((current===null?null:canonical(current))===change.base,'STALE');
                    if(matching)replayed=true;else slots.put(desired,'pending');
                    return;
                  }
                  if(current?.operationId===change.after.operationId){requireValue(canonical(current)===canonical(change.after),'ID_REUSED');replayed=true;if(matching)slots.delete('pending');return;}
                  requireValue((current===null?null:canonical(current))===change.base,'STALE');
                  requireValue(!change.pendingRequired||matching,'PENDING');
                  if(current!==null)slots.put(current,'previous');
                  slots.put(change.after,'current');
                  slots.put({format:'melodiajest-piano-package-receipt-v1',operationId:change.after.operationId,revision:change.after.revision,previousRevision:current?.revision??0},'receipt');
                  if(matching)slots.delete('pending');
                }catch(error){abort(error?.name==='LessonPackageStoreError'?error:failure(error?.name==='QuotaExceededError'?'QUOTA':'ABORTED'));}
              };
            }catch(error){abort(error?.name==='LessonPackageStoreError'?error:failure(error?.name==='QuotaExceededError'?'QUOTA':'ABORTED'));}
          };
        }catch(error){if(tx)abort(error?.name==='LessonPackageStoreError'?error:failure(error?.name==='QuotaExceededError'?'QUOTA':'UNAVAILABLE'));else reject(failure('UNAVAILABLE'));}
      });
    }
    const stage=plan=>writeChange(plan,'stage'),commit=plan=>writeChange(plan,'commit');
    const archiveText=value=>JSON.stringify(jsonData(value,MAX_ARCHIVE_BYTES,8,true));
    async function preparePendingArchive(){
      const slots=await readSlots(true);requireValue(!closed,'CLOSED');
      if(slots.pending===null)return null;
      requireValue(!slots.hasPendingArchive,'ARCHIVE_FULL');
      let archiveId;try{archiveId=id();}catch{throw failure('UNAVAILABLE');}requireValue(identifier(archiveId));
      const {pendingArchive,hasPendingArchive,...captured}=slots;
      // Future/stale records are captured as bounded JSON values, never normalized as v7.
      const snapshot=freeze(jsonData({format:'melodiajest-piano-pending-archive-v1',database:name,archiveId,slots:captured},MAX_ARCHIVE_BYTES,8,true));
      const plan=Object.freeze({version:VERSION,archiveId,pendingBytes:encoder.encode(JSON.stringify(snapshot.slots.pending)).byteLength});
      archives.set(plan,{snapshot,baseText:archiveText(snapshot.slots),snapshotText:archiveText(snapshot)});return plan;
    }
    async function archivePending(plan){
      requireValue(!closed,'CLOSED');const prepared=archives.get(plan);requireValue(prepared,'PLAN');
      const db=await open();return new Promise((resolve,reject)=>{
        let tx,reason=null,replayed=false;
        const abort=error=>{reason=error;try{tx.abort();}catch{reject(reason);}};
        const safe=error=>error?.name==='LessonPackageStoreError'?error:failure(error?.name==='QuotaExceededError'?'QUOTA':'ABORTED');
        try{
          tx=db.transaction(SLOTS,'readwrite',{durability:'strict'});
          tx.onabort=()=>reject(reason??failure(tx.error?.name==='QuotaExceededError'?'QUOTA':'ABORTED'));
          tx.oncomplete=()=>resolve({status:replayed?'replayed':'archived',archiveId:plan.archiveId,durability:tx.durability??'unknown'});
          const slots=tx.objectStore(SLOTS),actual={};let remaining=CORE_SLOTS.length+2;
          const completed=()=>{
              if(--remaining)return;
              try{
                const {pendingArchive,hasPendingArchive,...current}=actual;
                if(hasPendingArchive){
                  requireValue(archiveText(pendingArchive)===prepared.snapshotText,'ARCHIVE_FULL');
                  // An acknowledged retry never deletes a subsequently staged pending record.
                  replayed=true;return;
                }
                requireValue(archiveText(current)===prepared.baseText,'STALE');
                slots.add(prepared.snapshot,'pendingArchive');slots.delete('pending');
              }catch(error){abort(safe(error));}
          };
          for(const key of [...CORE_SLOTS,'pendingArchive']){const request=slots.get(key);request.onsuccess=()=>{actual[key]=key==='pendingArchive'?request.result:request.result??null;completed();};}
          const presence=slots.getKey('pendingArchive');presence.onsuccess=()=>{actual.hasPendingArchive=presence.result!==undefined;completed();};
        }catch(error){if(tx)abort(safe(error));else reject(failure('UNAVAILABLE'));}
      });
    }
    const workingContext=slots=>Object.fromEntries(CORE_SLOTS.slice(0,3).map(k=>[k,slots[k]??null]));
    async function preparePendingRestore(){
      const slots=await readSlots(true,true);requireValue(!closed,'CLOSED');
      if(!slots.hasPendingArchive)return null;
      requireValue(!slots.hasPending,'PENDING');
      requireValue(object(slots.pendingArchive),'SCHEMA');
      const archive=freeze(jsonData(slots.pendingArchive,MAX_ARCHIVE_BYTES,8,true));
      requireValue(exact(archive,['format','database','archiveId','slots'])&&archive.format==='melodiajest-piano-pending-archive-v1'&&archive.database===name&&identifier(archive.archiveId)&&exact(archive.slots,CORE_SLOTS)&&archive.slots.pending!==null,'SCHEMA');
      const contextText=archiveText(workingContext(slots));
      requireValue(contextText===archiveText(workingContext(archive.slots)),'STALE');
      // The ordinary pending-recovery validator also governs archive restoration.
      // Future or originally stale pending remains archived for explicit export.
      recoverablePending({current:slots.current,pending:archive.slots.pending});
      const plan=Object.freeze({version:VERSION,archiveId:archive.archiveId,pendingBytes:encoder.encode(JSON.stringify(archive.slots.pending)).byteLength});
      pendingRestores.set(plan,{archiveText:archiveText(archive),contextText,pendingText:archiveText(archive.slots.pending),pending:archive.slots.pending});return plan;
    }
    async function restorePending(plan){
      requireValue(!closed,'CLOSED');const prepared=pendingRestores.get(plan);requireValue(prepared,'PLAN');
      const db=await open();return new Promise((resolve,reject)=>{
        let tx,reason=null,replayed=false;
        const abort=error=>{reason=error;try{tx.abort();}catch{reject(reason);}};
        const safe=error=>error?.name==='LessonPackageStoreError'?error:failure(error?.name==='QuotaExceededError'?'QUOTA':'ABORTED');
        try{
          tx=db.transaction(SLOTS,'readwrite',{durability:'strict'});
          tx.onabort=()=>reject(reason??failure(tx.error?.name==='QuotaExceededError'?'QUOTA':'ABORTED'));
          tx.oncomplete=()=>resolve({status:replayed?'replayed':'restored',archiveId:plan.archiveId,durability:tx.durability??'unknown'});
          const slots=tx.objectStore(SLOTS),actual={};let remaining=CORE_SLOTS.length+3;
          const completed=()=>{
            if(--remaining)return;
            try{
              requireValue(actual.hasPendingArchive&&archiveText(actual.pendingArchive)===prepared.archiveText,'STALE');
              requireValue(archiveText(workingContext(actual))===prepared.contextText,'STALE');
              if(actual.hasPending){requireValue(archiveText(actual.pending??null)===prepared.pendingText,'PENDING');replayed=true;return;}
              // add protects even an occupied null/undefined key; the archive is retained.
              slots.add(prepared.pending,'pending');
            }catch(error){abort(safe(error));}
          };
          for(const key of [...CORE_SLOTS,'pendingArchive']){const request=slots.get(key);request.onsuccess=()=>{actual[key]=key==='pendingArchive'?request.result:request.result??null;completed();};}
          for(const [key,flag]of [['pendingArchive','hasPendingArchive'],['pending','hasPending']]){const request=slots.getKey(key);request.onsuccess=()=>{actual[flag]=request.result!==undefined;completed();};}
        }catch(error){if(tx)abort(safe(error));else reject(failure('UNAVAILABLE'));}
      });
    }
    function recoveryFile(text){
      requireValue(typeof text==='string');requireValue(text.length<=MAX_RECOVERY_BYTES,'LIMIT');
      const bytes=encoder.encode(text).byteLength;requireValue(bytes<=MAX_RECOVERY_BYTES,'LIMIT');
      let parsed;try{parsed=JSON.parse(text);}catch{throw failure('INPUT');}
      const data=jsonData(parsed,MAX_RECOVERY_BYTES,12,true);
      requireValue(exact(data,['format','database',...CORE_SLOTS,'pendingArchive'])&&data.format==='melodiajest-piano-package-recovery-v2','SCHEMA');
      requireValue(data.database===name,'SOURCE');
      // Accept the exact own export encoding. This also rejects duplicate JSON keys
      // and alternate number/string spellings that JSON.parse would otherwise lose.
      requireValue(JSON.stringify(data)===text);
      const known=value=>{requireValue(object(value)&&object(value.catalog)&&value.catalog.version===7,'SCHEMA');return state(value);};
      const current=data.current===null?null:known(data.current),previous=data.previous===null?null:known(data.previous);
      if(current===null)requireValue(previous===null&&data.receipt===null,'SCHEMA');
      else{
        const receipt=data.receipt;
        requireValue(exact(receipt,['format','operationId','revision','previousRevision'])&&receipt.format==='melodiajest-piano-package-receipt-v1'&&receipt.operationId===current.operationId&&receipt.revision===current.revision&&receipt.previousRevision===(previous?.revision??0)&&current.revision===(previous?.revision??0)+1&&current.operationId!==previous?.operationId,'SCHEMA');
        if(previous)forward(previous.active,current.active);
      }
      // Drafts and archives are preserved, including stale/future JSON. Import is
      // not permission to resume either one and does not upgrade older schemas.
      jsonData(data.pending,3*MAX_CATALOG_BYTES,4,true);jsonData(data.pendingArchive,MAX_ARCHIVE_BYTES,8,true);
      const archive=data.pendingArchive;
      if(object(archive)&&archive.format==='melodiajest-piano-pending-archive-v1'){
        requireValue(exact(archive,['format','database','archiveId','slots'])&&identifier(archive.archiveId)&&exact(archive.slots,CORE_SLOTS)&&archive.slots.pending!==null,'SCHEMA');
        requireValue(archive.database===name,'SOURCE');
      }
      // v2 represents missing core slots as null; their original physical presence
      // is not encoded. The archive key, unlike core nulls, is explicitly present.
      const entries=CORE_SLOTS.filter(key=>data[key]!==null).map(key=>[key,data[key]]);entries.push(['pendingArchive',data.pendingArchive]);
      const slots=freeze(Object.fromEntries(entries)),keys=entries.map(([key])=>key).sort();
      return {slots,keys,text:JSON.stringify(jsonData(slots,MAX_RECOVERY_BYTES,12,true)),bytes,sourceRevision:current?.revision??0,completed:false};
    }
    async function prepareRecoveryImport(text){
      requireValue(!closed,'CLOSED');const prepared=recoveryFile(text),db=await open();
      await new Promise((resolve,reject)=>{
        let tx,occupied=false;
        try{tx=db.transaction(SLOTS,'readonly');const request=tx.objectStore(SLOTS).getAllKeys(undefined,1);request.onsuccess=()=>{occupied=request.result.length>0;};}
        catch{reject(failure('UNAVAILABLE'));return;}
        tx.onabort=()=>reject(failure('ABORTED'));tx.oncomplete=()=>occupied?reject(failure('CONFLICT')):resolve();
      });
      requireValue(!closed,'CLOSED');const plan=Object.freeze({version:VERSION,database:name,sourceRevision:prepared.sourceRevision,bytes:prepared.bytes});
      recoveryImports.set(plan,prepared);return plan;
    }
    async function importRecovery(plan){
      requireValue(!closed,'CLOSED');const prepared=recoveryImports.get(plan);requireValue(prepared,'PLAN');
      const db=await open();return new Promise((resolve,reject)=>{
        let tx,reason=null,replayed=false;
        const abort=error=>{reason=error;try{tx.abort();}catch{reject(reason);}};
        const safe=error=>error?.name==='LessonPackageStoreError'?error:failure(error?.name==='QuotaExceededError'?'QUOTA':'ABORTED');
        try{
          tx=db.transaction(SLOTS,'readwrite',{durability:'strict'});
          tx.onabort=()=>reject(reason??failure(tx.error?.name==='QuotaExceededError'?'QUOTA':'ABORTED'));
          tx.oncomplete=()=>{prepared.completed=true;resolve({status:replayed?'replayed':'imported',sourceRevision:prepared.sourceRevision,bytes:prepared.bytes,durability:tx.durability??'unknown'});};
          const slots=tx.objectStore(SLOTS),request=slots.getAllKeys(undefined,6);
          request.onsuccess=()=>{
            try{
              const keys=request.result;
              if(keys.length===0){requireValue(!prepared.completed,'STALE');for(const key of prepared.keys)slots.add(prepared.slots[key],key);return;}
              requireValue(keys.length===prepared.keys.length&&keys.every((key,i)=>key===prepared.keys[i]),'STALE');
              const actual=Object.create(null);let remaining=keys.length;
              for(const key of keys){const read=slots.get(key);read.onsuccess=()=>{
                actual[key]=read.result;if(--remaining)return;
                try{let matches=false;try{matches=JSON.stringify(jsonData(actual,MAX_RECOVERY_BYTES,12,true))===prepared.text;}catch{/* Occupied unknown values are never repaired. */}requireValue(matches,'STALE');replayed=true;}catch(error){abort(safe(error));}
              };}
            }catch(error){abort(safe(error));}
          };
        }catch(error){if(tx)abort(safe(error));else reject(failure('UNAVAILABLE'));}
      });
    }
    async function exportRecovery(){
      const slots=await readSlots(true),{pendingArchive,hasPendingArchive,...current}=slots;
      // Private export on explicit request. Reading never resets damaged/future data.
      if(!hasPendingArchive)return JSON.stringify(jsonData({format:'melodiajest-piano-package-recovery-v1',database:name,...current},6*MAX_CATALOG_BYTES,6));
      return JSON.stringify(jsonData({format:'melodiajest-piano-package-recovery-v2',database:name,...current,pendingArchive},MAX_RECOVERY_BYTES,12,true));
    }
    function close(){closed=true;if(connection)connection.close();connection=null;}
    return {read,prepare,stage,recoverPending,commit,preparePendingArchive,archivePending,preparePendingRestore,restorePending,prepareRecoveryImport,importRecovery,exportRecovery,close};
  }
  return {VERSION,DATABASE,MAX_CATALOG_BYTES,MAX_STRING_BYTES,MAX_DEPTH,MAX_NODES,MAX_ARCHIVE_BYTES,MAX_RECOVERY_BYTES,validateCandidate,create};
});
