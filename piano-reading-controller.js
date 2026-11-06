(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-reading-session.js')):factory(root.PianoReadingSession);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoReadingController=api;})(typeof window==='object'?window:globalThis,function(Core){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  function create({store,bank,clef,now,sessionId,onChange=()=>{}}){
    const candidates=bank.items.filter(i=>i.notation.clef===clef),demo=bank.publishedExamples.find(i=>i.notation.clef===clef&&i.role==='demonstration');
    if(!demo||!candidates.length)throw Error('READING_BANK_EMPTY');
    const published=new Set(bank.publishedExamples.map(Core.contentKey)),candidateKeys=candidates.map(Core.contentKey);
    let history=null,session=null,item=demo,phase='ready',busy=false,accepting=false,revealed=true,code=null,result=null,exportText='',practiceCursor=0;
    function remember(h){if(h&&(!history||h.revision>=history.revision))history=h;}
    function snapshot(){const known=new Set(history?.exposures.map(e=>e.contentKey)||[]);return copy({phase,busy,code,item,mode:revealed?'study':'first',attemptMode:session?.reservation.mode||'practice',reasons:session?.reasons||[],captured:session?.played.length||0,held:session?.held.length||0,remaining:candidateKeys.filter(k=>!known.has(k)&&!published.has(k)).length,result,exportText});}
    function emit(){onChange(snapshot());}
    async function run(action){if(busy)return;busy=true;code=null;emit();try{await action();}catch(e){code=e?.code||'ACTION_FAILED';phase='blocked';accepting=false;}finally{busy=false;emit();}}
    function failure(r){code=r.code;phase=r.status==='unsaved'?'unsaved':'blocked';if(r.session)session=r.session;accepting=false;}
    function settings(mode){return {sessionId:sessionId(),mode,now:now(),publishedExamples:bank.publishedExamples};}
    function canLeave(){return !session||session.phase==='finished';}
    function active(){return session?.phase==='active';}
    function applyReason(reason){if(active()){session=Core.assist(session,reason);emit();}}
    return {
      snapshot,
      refresh(){return run(async()=>{const r=await store.read();if(r.status==='ready'){remember(r.history);if(!session)phase='ready';}else failure(r);});},
      start(kind){return run(async()=>{
        if(!canLeave()){code='ATTEMPT_ACTIVE';return;}
        accepting=false;exportText='';result=null;phase='saving';emit();
        let practiceItem=demo;if(kind==='variation'){practiceItem=candidates[practiceCursor++%candidates.length];if(practiceItem.itemId===item.itemId)practiceItem=candidates[practiceCursor++%candidates.length];}
        const r=kind==='first'?await store.openNext(candidates,settings('first')):await store.open(practiceItem,settings('practice'));
        if(r.status==='exhausted'){remember(r.history);session=null;item=demo;revealed=true;phase='exhausted';return;}
        if(r.status!=='saved'){failure(r);return;}
        remember(r.history);session=r.session;item=kind==='first'?candidates.find(i=>i.itemId===r.item.itemId):practiceItem;revealed=kind!=='first';phase='active';accepting=true;
      });},
      input(event){if(!active()||!accepting)return;try{session=Core.input(session,event);emit();}catch(e){code=e.code||'INPUT_INVALID';emit();}},
      reveal(){return run(async()=>{if(!active()||!accepting)return;applyReason('names');revealed=true;emit();const r=await store.assist(session,'names');remember(r.history);if(r.status!=='saved'){code=r.code;/* local reason remains irreversible; capture may continue as practice */}});},
      interrupt(){if(!active()||!accepting)return Promise.resolve();applyReason('interrupted');const id=session.reservation.id,captured=copy(session);return store.assist(captured,'interrupted').then(r=>{remember(r.history);if(session?.reservation.id===id&&active()){if(r.status!=='saved')code=r.code;emit();}});},
      finish(){return run(async()=>{if(!active())return;accepting=false;phase='saving';emit();const r=await store.finish(session,{now:now()});if(r.status!=='saved'){if(r.code==='RELEASE_REQUIRED'){phase='active';code=r.code;accepting=true;}else failure(r);return;}remember(r.history);session=r.session;result=r.result;revealed=true;phase='finished';});},
      cancel(){return run(async()=>{accepting=false;if(active()){session=Core.assist(session,'interrupted');const r=await store.assist(session,'interrupted');remember(r.history);if(r.status!=='saved')code=r.code;}session=null;item=demo;result=null;revealed=true;phase='ready';});},
      exportHistory(){return run(async()=>{if(!canLeave()){code='ATTEMPT_ACTIVE';return;}const r=await store.read();if(r.status!=='ready'){failure(r);return;}remember(r.history);exportText=JSON.stringify(r.history,null,2);});},
      importHistory(raw){return run(async()=>{if(!canLeave()){code='ATTEMPT_ACTIVE';return;}const r=await store.importHistory(raw);if(r.status!=='saved'){code=r.code;return;}remember(r.history);session=null;item=demo;revealed=true;result=null;exportText='';phase='ready';});}
    };
  }
  return {create};
});
