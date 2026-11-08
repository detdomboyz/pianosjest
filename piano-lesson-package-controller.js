(function(root,factory){const common=typeof module==='object'&&module.exports,api=common?factory(require('./piano-lesson-package-store.js'),require('./piano-lesson-package-planner.js'),require('./piano-lesson-package-loader.js'),require('./piano-legacy-catalog-copy.js'),require('./piano-legacy-v7-adapter.js')):factory(root.PianoLessonPackageStore,root.PianoLessonPackagePlanner,root.PianoLessonPackageLoader,root.PianoLegacyCatalogCopy,root.PianoLegacyV7Adapter);if(common)module.exports=api;else root.PianoLessonPackageController=api;})(typeof window==='object'?window:globalThis,function(Store,Planner,Loader,Legacy,Reader){
  'use strict';
  // Isolated coordinator. Legacy preparation is an explicit private draft, never activation.
  const VERSION=1;
  const codes=new Set(['INPUT','LIMIT','SOURCE','STALE','PLAN','UNAVAILABLE','BLOCKED','SCHEMA','CLOSED','ABORTED','QUOTA','ID_REUSED','PENDING','CONFLICT','DIGEST','EMPTY']);
  const messages={INPUT:'Некорректная правка. Рабочая версия сохранена.',LIMIT:'Материал превышает допустимый объём.',SOURCE:'Не совпадает проверенный источник.',STALE:'Каталог изменился. Подготовь правку заново.',PLAN:'Подготовь действие в этой вкладке заново.',UNAVAILABLE:'Сохранение недоступно. Сохрани копию перед закрытием.',BLOCKED:'Другая вкладка удерживает хранилище.',SCHEMA:'Неподдерживаемая версия данных. Исходник сохранён.',CLOSED:'Это соединение закрыто.',ABORTED:'Запись отменена. Рабочая версия сохранена.',QUOTA:'Недостаточно места. Проверь незавершённую правку и сохрани копию перед закрытием.',ID_REUSED:'Идентификатор записи уже использован.',PENDING:'Есть незавершённая правка. Сначала восстанови её или сохрани копию для разбора.',CONFLICT:'Личная редакция расходится с обновлением. Сначала сохрани её и разреши конфликт.',DIGEST:'Не удалось проверить контрольную сумму.',EMPTY:'Сначала подготовь исходный каталог.'};
  const failure=code=>Object.assign(new Error(messages[code]??messages.UNAVAILABLE),{name:'LessonPackageControllerError',code:codes.has(code)?code:'UNAVAILABLE'});
  const requireValue=(ok,code='INPUT')=>{if(!ok)throw failure(code);};
  const wrap=error=>failure(codes.has(error?.code)?error.code:'UNAVAILABLE');
  codes.add('CAPACITY');codes.add('INTEGRITY');messages.CAPACITY='Исходные копии заполнены. Сначала сохрани их для отдельного разбора.';messages.INTEGRITY='Исходная копия не прошла проверку. Данные не изменены.';
  codes.add('ARCHIVE_FULL');messages.ARCHIVE_FULL='Архив незавершённой правки уже занят. Сохрани его для отдельного разбора.';
  function create({store,subtle,onChange=()=>{},legacyCopies}={}){
    requireValue(Store&&Planner&&Loader&&store&&['read','prepare','stage','recoverPending','commit','exportRecovery','close'].every(k=>typeof store[k]==='function')&&typeof onChange==='function','UNAVAILABLE');
    let planner;try{planner=Planner.create({subtle});}catch(error){throw wrap(error);}const views=new WeakSet(),updates=new WeakMap(),recoveries=new WeakSet(),staged=new WeakSet();
    const legacyPlans=new WeakMap(),archivePlans=new WeakSet(),pendingRestorePlans=new WeakSet(),recoveryImportPlans=new WeakSet();
    let closed=false,tail=Promise.resolve(),summary=Object.freeze({phase:'idle',code:null,confirmedRevision:null,stagedOperationId:null});
    const notify=values=>{summary=Object.freeze({...summary,...values});try{onChange(summary);}catch{/* An observer cannot turn an already committed write into failure. */}};
    const failed=error=>{if(error?.name==='LessonPackageControllerError'&&summary.phase==='failed'&&summary.code===error.code)return error;const e=wrap(error);notify({phase:'failed',code:e.code});return e;};
    const ensureOpen=()=>requireValue(!closed,'CLOSED');
    const remember=current=>{if(current!==null)views.add(current);return current;};
    function expected(view){requireValue(view!==null&&typeof view==='object'&&views.has(view),'PLAN');return view;}
    function enqueue(work){const out=tail.then(()=>{ensureOpen();return work();}).catch(error=>{throw failed(error);});tail=out.catch(()=>{});return out;}
    async function apply(change,stageFirst){
      notify({phase:'saving',code:null});
      if(stageFirst&&!staged.has(change)){await store.stage(change);staged.add(change);notify({stagedOperationId:change.operationId});ensureOpen();}
      const out=await store.commit(change),current=remember(out.current);
      notify({phase:'saved',code:null,confirmedRevision:current.revision,stagedOperationId:null});
      return Object.freeze({...out,current});
    }
    async function read(){try{ensureOpen();const view=remember(await store.read());notify({confirmedRevision:view?.revision??null});return view;}catch(error){throw failed(error);}}
    async function initializeV7(source,catalog){
      try{ensureOpen();const verified=Loader.requireVerified(source),change=store.prepare(null,{active:verified.active,catalog});return await enqueue(()=>apply(change,true));}
      catch(error){throw failed(error);}
    }
    function checkLegacySource(storage,raw){
      let current;try{current=storage.getItem(Legacy.KEY);}catch{throw failure('UNAVAILABLE');}requireValue(current===raw,'STALE');
    }
    async function prepareLegacyV7({source,storage,decode}={}){
      try{
        ensureOpen();requireValue(Legacy&&legacyCopies&&['prepareFrom','commit','read'].every(k=>typeof legacyCopies[k]==='function'),'UNAVAILABLE');requireValue(storage&&typeof storage.getItem==='function'&&(decode===undefined||typeof decode==='function'));const verified=Loader.requireVerified(source);requireValue(decode!==undefined||Reader&&typeof Reader.create==='function','UNAVAILABLE');const decodeCatalog=decode??Reader.create({source});
        // Capture before the first await. Decode is forbidden until strict commit and verified readback.
        const captured=await legacyCopies.prepareFrom(storage);ensureOpen();await legacyCopies.commit(captured);ensureOpen();const backup=await legacyCopies.read(captured.id);ensureOpen();
        requireValue(backup&&backup.id===captured.id&&backup.key===Legacy.KEY&&(backup.raw===null||typeof backup.raw==='string'),'SOURCE');notify({legacyCopyId:backup.id});
        requireValue(await store.read()===null,'CONFLICT');ensureOpen();checkLegacySource(storage,backup.raw);
        const decoded=decodeCatalog(backup.raw);if(decoded instanceof Promise){decoded.catch(()=>{});throw failure('INPUT');}const candidate=Store.validateCandidate({active:verified.active,catalog:decoded});ensureOpen();checkLegacySource(storage,backup.raw);
        const plan=Object.freeze({version:VERSION,legacyCopyId:backup.id,active:Object.freeze({...candidate.active}),missing:backup.raw===null});legacyPlans.set(plan,{candidate,storage,raw:backup.raw});notify({phase:'legacy-prepared',code:null});return plan;
      }catch(error){throw failed(error);}
    }
    async function exportLegacyPreparation(plan){
      try{ensureOpen();const prepared=legacyPlans.get(plan);requireValue(prepared,'PLAN');try{checkLegacySource(prepared.storage,prepared.raw);}catch(error){if(error.code==='STALE')legacyPlans.delete(plan);throw error;}return JSON.stringify({format:'melodiajest-legacy-v7-preparation-v1',version:VERSION,legacyCopyId:plan.legacyCopyId,candidate:prepared.candidate,activationPerformed:false});}catch(error){throw failed(error);}
    }
    async function writeCatalog(view,catalog){
      try{ensureOpen();const before=expected(view),change=store.prepare(before,{active:before.active,catalog});return await enqueue(()=>apply(change,true));}
      catch(error){throw failed(error);}
    }
    async function prepareUpdate({previous,incoming}={}){
      try{
        ensureOpen();const old=Loader.requireVerified(previous),fresh=Loader.requireVerified(incoming),before=remember(await store.read());requireValue(before!==null,'EMPTY');
        const proposal=await planner.prepare({active:before.active,previous:old,incoming:fresh,catalog:before.catalog});ensureOpen();updates.set(proposal,{before});return proposal;
      }catch(error){throw failed(error);}
    }
    async function commitUpdate(proposal){
      try{ensureOpen();const captured=updates.get(proposal);requireValue(captured,'PLAN');if(!captured.change){const candidate=planner.materialize(proposal,captured.before.catalog);captured.change=store.prepare(captured.before,candidate);}return await enqueue(()=>apply(captured.change,true));}
      catch(error){throw failed(error);}
    }
    async function prepareRecovery(){
      try{ensureOpen();const change=await store.recoverPending();ensureOpen();if(change){recoveries.add(change);notify({stagedOperationId:change.operationId});}return change;}
      catch(error){throw failed(error);}
    }
    async function commitRecovery(change){
      try{ensureOpen();requireValue(change&&recoveries.has(change),'PLAN');return await enqueue(()=>apply(change,false));}
      catch(error){throw failed(error);}
    }
    async function preparePendingArchive(){
      try{ensureOpen();requireValue(typeof store.preparePendingArchive==='function'&&typeof store.archivePending==='function','UNAVAILABLE');const plan=await store.preparePendingArchive();ensureOpen();if(plan){archivePlans.add(plan);notify({phase:'pending-archive-prepared',code:null,pendingArchiveId:plan.archiveId});}return plan;}
      catch(error){throw failed(error);}
    }
    async function commitPendingArchive(plan){
      try{ensureOpen();requireValue(plan&&archivePlans.has(plan),'PLAN');return await enqueue(async()=>{notify({phase:'saving',code:null});const out=await store.archivePending(plan);notify({phase:'pending-archived',code:null,stagedOperationId:null,pendingArchiveId:out.archiveId});return Object.freeze({...out});});}
      catch(error){throw failed(error);}
    }
    async function preparePendingRestore(){
      try{ensureOpen();requireValue(typeof store.preparePendingRestore==='function'&&typeof store.restorePending==='function','UNAVAILABLE');const plan=await store.preparePendingRestore();ensureOpen();if(plan){pendingRestorePlans.add(plan);notify({phase:'pending-restore-prepared',code:null,pendingArchiveId:plan.archiveId});}return plan;}
      catch(error){throw failed(error);}
    }
    async function commitPendingRestore(plan){
      try{ensureOpen();requireValue(plan&&pendingRestorePlans.has(plan),'PLAN');return await enqueue(async()=>{notify({phase:'saving',code:null});const out=await store.restorePending(plan);notify({phase:'pending-restored',code:null,pendingArchiveId:out.archiveId});return Object.freeze({...out});});}
      catch(error){throw failed(error);}
    }
    async function prepareRecoveryImport(text){
      try{ensureOpen();requireValue(typeof store.prepareRecoveryImport==='function'&&typeof store.importRecovery==='function','UNAVAILABLE');const plan=await store.prepareRecoveryImport(text);ensureOpen();recoveryImportPlans.add(plan);notify({phase:'recovery-import-prepared',code:null,recoveryImportBytes:plan.bytes});return plan;}
      catch(error){throw failed(error);}
    }
    async function commitRecoveryImport(plan){
      try{ensureOpen();requireValue(plan&&recoveryImportPlans.has(plan),'PLAN');return await enqueue(async()=>{notify({phase:'saving',code:null});const out=await store.importRecovery(plan);notify({phase:'recovery-imported',code:null,recoveryImportBytes:out.bytes});return Object.freeze({...out});});}
      catch(error){throw failed(error);}
    }
    async function exportRecovery(){try{ensureOpen();return await store.exportRecovery();}catch(error){throw failed(error);}}
    function close(){closed=true;store.close();}
    return Object.freeze({read,initializeV7,prepareLegacyV7,exportLegacyPreparation,writeCatalog,prepareUpdate,commitUpdate,prepareRecovery,commitRecovery,preparePendingArchive,commitPendingArchive,preparePendingRestore,commitPendingRestore,prepareRecoveryImport,commitRecoveryImport,exportRecovery,status:()=>summary,close});
  }
  return Object.freeze({VERSION,create});
});
