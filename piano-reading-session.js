(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-staff-view.js')):factory(root.PianoStaffView);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoReadingSession=api;})(typeof window==='object'?window:globalThis,function(Staff){
  'use strict';
  const VERSION=1,SCOPE='piano-staff-reading',REASONS=Object.freeze(['requested-practice','already-exposed','published-example','answer','names','fingering','audio-replay','text-alternative','retry','interrupted','non-midi-input','duplicate-note-on','overlap']);
  const copy=x=>JSON.parse(JSON.stringify(x)),text=x=>typeof x==='string'&&x.trim().length>0,integer=x=>Number.isSafeInteger(x)&&x>=0,stamp=x=>text(x)&&Number.isFinite(Date.parse(x)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function fail(code){const e=new Error(code);e.code=code;throw e;}
  function need(ok,code){if(!ok)fail(code);}
  function emptyHistory(){return {schemaVersion:VERSION,scope:SCOPE,revision:0,exposures:[],attempts:[]};}
  function keyData(key){try{const a=JSON.parse(key),labels=a.slice(3),allowed=a[2]==='treble'?['C4','D4','E4']:a[2]==='bass'?['C3','D3','E3']:[];need(a[0]===1&&a[1]==='pitch-order'&&labels.length>0&&labels.length<=8&&labels.every(x=>allowed.includes(x))&&JSON.stringify(a)===key,'HISTORY_INVALID');return a;}catch{fail('HISTORY_INVALID');}}
  function midiForKey(key){return keyData(key).slice(3).map(l=>({C:0,D:2,E:4}[l[0]]+12*(Number(l[1])+1)));}
  function identityValid(i){return i&&i.instrument==='piano'&&['lessonId','itemId','itemVersion','documentId','documentRevision','partId'].every(k=>text(i[k]));}
  function reasonList(a){return Array.isArray(a)&&new Set(a).size===a.length&&a.every(x=>REASONS.includes(x));}
  function resultValid(r){return r&&r.schemaVersion===1&&r.scope==='pitch-order-only'&&r.executionVerified===false&&['first-pitch-order-matched','first-needs-repeat','practice-only'].includes(r.outcome)&&typeof r.matched==='boolean'&&reasonList(r.reasons)&&Array.isArray(r.played)&&r.played.every(m=>integer(m)&&m<=127)&&stamp(r.finishedAt)&&((r.outcome==='practice-only'&&r.reasons.length>0)||(r.outcome==='first-pitch-order-matched'&&r.matched&&r.reasons.length===0)||(r.outcome==='first-needs-repeat'&&!r.matched&&r.reasons.length===0));}
  function validateHistory(history){
    need(history&&history.schemaVersion===VERSION&&history.scope===SCOPE,'HISTORY_VERSION');
    need(integer(history.revision)&&Array.isArray(history.exposures)&&Array.isArray(history.attempts),'HISTORY_INVALID');
    need(history.revision>=history.attempts.length,'HISTORY_INVALID');
    const exposures=new Map(),ids=new Set(),groups=new Map();
    for(const e of history.exposures){need(e&&text(e.contentKey)&&stamp(e.openedAt)&&!exposures.has(e.contentKey),'HISTORY_INVALID');keyData(e.contentKey);exposures.set(e.contentKey,e);}
    for(const a of history.attempts){
      need(a&&text(a.id)&&!ids.has(a.id)&&identityValid(a.identity)&&exposures.has(a.contentKey)&&stamp(a.openedAt)&&['first','practice'].includes(a.mode)&&reasonList(a.reasons),'HISTORY_INVALID');ids.add(a.id);
      need(a.mode==='first'||a.reasons.length>0,'HISTORY_INVALID');
      need(a.result===null||resultValid(a.result),'HISTORY_INVALID');
      if(a.result)need(same(a.reasons,a.result.reasons)&&a.result.matched===same(a.result.played,midiForKey(a.contentKey))&&(a.mode==='first'||a.result.outcome==='practice-only'),'HISTORY_INVALID');
      const group=groups.get(a.contentKey)||[];group.push(a);groups.set(a.contentKey,group);
    }
    // Never reconstruct a fresh attempt from an exposure without its reservation.
    for(const e of history.exposures){const related=groups.get(e.contentKey)||[];need(related.length>0&&related[0].openedAt===e.openedAt&&related.filter(a=>a.mode==='first').length<=1&&(related.every(a=>a.mode!=='first')||related[0].mode==='first'),'HISTORY_INVALID');}
    return copy(history);
  }
  function parseHistory(raw){if(raw===null)return emptyHistory();need(typeof raw==='string','HISTORY_INVALID');let h;try{h=JSON.parse(raw);}catch{fail('HISTORY_INVALID');}return validateHistory(h);}
  function itemView(item){
    need(item&&item.schemaVersion===1&&item.instrument==='piano'&&['itemId','itemVersion','lessonId'].every(k=>text(item[k])),'ITEM_INVALID');
    const view=Staff.project(item.music,item.notation);need(view.status==='ready','ITEM_UNSUPPORTED');
    return view;
  }
  // Pitch-only reading: IDs, titles, BPM and duration changes cannot reset exposure.
  function contentKey(item){const v=itemView(item);return JSON.stringify([1,'pitch-order',v.clef,...v.notes.map(n=>n.label)]);}
  function exclusions(publishedExamples){need(Array.isArray(publishedExamples)&&publishedExamples.length>0,'PUBLISHED_EXAMPLES_REQUIRED');return new Set(publishedExamples.map(contentKey));}
  function selectUnseen(history,bank,publishedExamples){const h=validateHistory(history),known=new Set(h.exposures.map(e=>e.contentKey)),published=exclusions(publishedExamples);need(Array.isArray(bank),'BANK_INVALID');for(const item of bank){const key=contentKey(item);if(!known.has(key)&&!published.has(key))return copy(item);}return null;}
  function open(history,item,options){
    const h=validateHistory(history),v=itemView(item),key=contentKey(item),published=exclusions(options?.publishedExamples);
    need(text(options?.sessionId)&&stamp(options?.now)&&['first','practice'].includes(options?.mode),'OPEN_OPTIONS');
    need(!h.attempts.some(a=>a.id===options.sessionId),'SESSION_ID_REUSED');
    const reasons=[];if(options.mode==='practice')reasons.push('requested-practice');if(h.exposures.some(e=>e.contentKey===key))reasons.push('already-exposed');if(published.has(key))reasons.push('published-example');
    const identity={instrument:'piano',lessonId:item.lessonId,itemId:item.itemId,itemVersion:item.itemVersion,documentId:v.documentId,documentRevision:v.documentRevision,partId:v.partId};
    const reservation={id:options.sessionId,identity,contentKey:key,openedAt:options.now,mode:reasons.length?'practice':'first',reasons,result:null};
    if(!h.exposures.some(e=>e.contentKey===key))h.exposures.push({contentKey:key,openedAt:options.now});
    h.attempts.push(copy(reservation));h.revision++;
    return {history:h,session:{schemaVersion:1,phase:'awaiting-save',reservation,expected:v.notes.map(n=>n.midi),played:[],held:[],reasons:reasons.slice()}};
  }
  function reservationFor(history,session){
    need(session&&session.schemaVersion===1&&['awaiting-save','active','finished'].includes(session.phase),'SESSION_INVALID');
    const a=history.attempts.find(x=>x.id===session.reservation?.id);need(a&&same(a.identity,session.reservation.identity)&&a.contentKey===session.reservation.contentKey&&a.openedAt===session.reservation.openedAt&&a.mode===session.reservation.mode,'SESSION_NOT_FOUND');
    need(same(session.expected,midiForKey(a.contentKey))&&reasonList(session.reasons)&&reasonList(session.reservation.reasons)&&session.reservation.reasons.every(r=>session.reasons.includes(r))&&Array.isArray(session.played)&&session.played.every(m=>integer(m)&&m<=127)&&Array.isArray(session.held)&&session.held.every(m=>integer(m)&&m<=127)&&new Set(session.held).size===session.held.length,'SESSION_INVALID');return a;
  }
  function activate(session,savedHistory){const h=validateHistory(savedHistory),a=reservationFor(h,session);need(session.phase==='awaiting-save'&&!a.result,'SESSION_PHASE');const next=copy(session);next.phase='active';return next;}
  function active(session){need(session?.phase==='active','SESSION_NOT_ACTIVE');}
  function assist(session,reason){active(session);need(REASONS.includes(reason),'ASSISTANCE_INVALID');const s=copy(session);if(!s.reasons.includes(reason))s.reasons.push(reason);if(reason==='retry'){s.played=[];s.held=[];}return s;}
  function input(session,event){
    active(session);need(event&&['note-on','note-off'].includes(event.type)&&integer(event.midi)&&event.midi<=127&&['midi','pointer','keyboard'].includes(event.source),'INPUT_INVALID');
    let s=copy(session);if(event.source!=='midi')s=assist(s,'non-midi-input');
    if(event.type==='note-off')s.held=s.held.filter(m=>m!==event.midi);
    else if(s.held.includes(event.midi))s=assist(s,'duplicate-note-on');
    else{if(s.held.length)s=assist(s,'overlap');s.played.push(event.midi);s.held.push(event.midi);}return s;
  }
  function rememberAssistance(history,session){const h=validateHistory(history),a=reservationFor(h,session);active(session);need(!a.result,'SESSION_FINISHED');a.reasons=[...new Set([...a.reasons,...session.reasons])];h.revision++;return {history:h,session:{...copy(session),reasons:a.reasons.slice()}};}
  function finish(history,session,options){
    const h=validateHistory(history),a=reservationFor(h,session);need(stamp(options?.now),'FINISH_OPTIONS');
    if(a.result)return {history:h,session:{...copy(session),phase:'finished',reasons:a.result.reasons.slice()},result:copy(a.result)};
    active(session);need(session.held.length===0,'RELEASE_REQUIRED');
    const reasons=[...new Set([...a.reasons,...session.reasons])],matched=same(session.played,session.expected),outcome=reasons.length?'practice-only':matched?'first-pitch-order-matched':'first-needs-repeat';
    const result={schemaVersion:1,scope:'pitch-order-only',executionVerified:false,outcome,matched,reasons,played:session.played.slice(),finishedAt:options.now};
    a.reasons=reasons;a.result=result;h.revision++;return {history:h,session:{...copy(session),phase:'finished',reasons},result:copy(result)};
  }
  return {VERSION,SCOPE,REASONS,emptyHistory,validateHistory,parseHistory,contentKey,selectUnseen,open,activate,input,assist,rememberAssistance,finish};
});
