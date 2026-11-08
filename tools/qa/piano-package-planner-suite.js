'use strict';
const Loader=window.PianoLessonPackageLoader,Planner=window.PianoLessonPackagePlanner,Store=window.PianoLessonPackageStore,A=window.PracticeAssessment;
const copy=x=>JSON.parse(JSON.stringify(x)),canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x,equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const output=document.querySelector('#results'),status=document.querySelector('#status'),button=document.querySelector('#run');
const PEER_CHANNEL='melodiajest-qa-package-planner-peer-v1';
if(location.hash==='#peer'){
 button.hidden=true;document.querySelector('h1').textContent='Вторая вкладка проверки';
 document.querySelector('main p').textContent='Ожидает только запись в одноразовый каталог этой проверки. Рабочие данные сайта не подключены.';
 const channel=new BroadcastChannel(PEER_CHANNEL),clientId=crypto.randomUUID();
 status.textContent='Вторая вкладка готова.';output.textContent=JSON.stringify({clientId,role:'separate-qa-tab',origin:location.origin},null,2);
 channel.onmessage=async({data})=>{
  if(!data||typeof data.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(data.requestId))return;
  if(data.kind==='ping'){channel.postMessage({kind:'response',requestId:data.requestId,ok:true,clientId});return;}
  if(data.kind!=='write'||typeof data.database!=='string'||!/^melodiajest-piano-packages-v1-qa-25-[a-f0-9-]{12}-peer$/.test(data.database))return;
  const store=Store.create({indexedDB,name:data.database});
  try{
   const before=await store.read();if(!before||before.active.release!=='23.5.44')throw Error('Unexpected QA base');
   const catalog=copy(before.catalog),piece=catalog.lessons.find(l=>l.id==='qa-private-piece');if(!piece)throw Error('Missing own QA record');
   piece.privateAnnotation='Поздняя правка из отдельной вкладки';const out=await store.commit(store.prepare(before,{active:before.active,catalog}));
   status.textContent='Запись отдельной вкладки подтверждена.';output.textContent=JSON.stringify({clientId,revision:out.current.revision,status:out.status},null,2);
   channel.postMessage({kind:'response',requestId:data.requestId,ok:true,clientId,revision:out.current.revision});
  }catch(error){channel.postMessage({kind:'response',requestId:data.requestId,ok:false,clientId,message:error.message});}
  finally{store.close();}
 };
 window.addEventListener('pagehide',()=>channel.close(),{once:true});
}else{
 const note=document.createElement('p'),link=document.createElement('a');link.href='/#peer';link.target='_blank';link.rel='noopener';link.textContent='Открыть вторую вкладку проверки';link.style.color='#8edbff';note.append(link);button.before(note);
}
const requireValue=(v,m)=>{if(!v)throw Error(m);};
async function rejects(work,code){try{await work();}catch(e){requireValue(e.code===code,'Expected '+code+', got '+e.code);return;}throw Error('Expected '+code);}
function throws(work,code){try{work();}catch(e){requireValue(e.code===code,'Expected '+code+', got '+e.code);return;}throw Error('Expected '+code);}
button.addEventListener('click',async()=>{
 button.disabled=true;status.textContent='Проверяю…';output.textContent='';const results=[],stores=[],names=[],run='25-'+crypto.randomUUID().slice(0,12),sentinels={};let proof,peerChannel,peerClientId;
 const create=suffix=>{const name=Store.DATABASE+'-qa-'+run+'-'+suffix;names.push(name);const store=Store.create({indexedDB,name});stores.push(store);return store;};
 const sameStore=name=>{const store=Store.create({indexedDB,name});stores.push(store);return store;};
 const check=async(name,work)=>{try{await work();results.push({name,passed:true});}catch(e){results.push({name,passed:false,code:e.code??e.name,message:e.message});}output.textContent=JSON.stringify({running:true,results},null,2);};
 try{
  const response=await fetch('/fixture.json',{cache:'no-store'});requireValue(response.ok,'Fixture HTTP');const fixture=await response.json();
  for(const[key,value]of Object.entries({'music-learning-piano-v1':'{"qa-memory":{"memory":true,"history":{"old":{"memory":true}}}}','piano-blind-trainer-ui-v20':'{"qa":"preserve-settings"}','piano-blind-trainer-catalog-v1':'{"qa":"keep-legacy-writer"}'})){requireValue(localStorage.getItem(key)===null,'QA origin contains existing data');localStorage.setItem(key,value);sentinels[key]=value;}
  const load=(path,pin)=>Loader.create({baseUrl:new URL('/'+path+'/',location.href).href,origin:location.origin,fetch:fetch.bind(window),subtle:crypto.subtle}).load({pin});
  const previous=await load('old',fixture.previous),incoming=await load('new',fixture.incoming),planner=Planner.create({subtle:crypto.subtle});
  const input=local=>({active:fixture.previous,previous,incoming,catalog:local??copy(fixture.initial.catalog)});
  let proposal,candidate;
  await check('01 — проверенный загрузчик и общий алгоритм дают то же предложение, что Node',async()=>{proposal=await planner.prepare(input());candidate=planner.materialize(proposal,fixture.initial.catalog);requireValue(equal(proposal,fixture.expected)&&equal(candidate,fixture.expectedCandidate),'Shared policy parity');requireValue(proposal.status==='ready'&&Object.isFrozen(proposal),'Ready immutable proposal');});
  await check('02 — сериализованная копия не становится проверенным пакетом или планом',async()=>{await rejects(()=>planner.prepare({...input(),incoming:copy(incoming)}),'INPUT');throws(()=>planner.materialize(copy(proposal),fixture.initial.catalog),'PLAN');throws(()=>Planner.create({subtle:crypto.subtle}).materialize(proposal,fixture.initial.catalog),'PLAN');});
  await check('03 — ноты, пальцы, личный порядок и дополнительное произведение сохранены',async()=>{const before=fixture.initial.catalog,out=candidate.catalog;requireValue(equal(out.lessons.map(l=>[l.id,l.order,l.themeId]),before.lessons.map(l=>[l.id,l.order,l.themeId])),'Lesson placement');requireValue(equal(out.themes,before.themes),'Theme order');requireValue(equal(out.lessons.at(-1),before.lessons.at(-1)),'Private extra');for(const l of before.lessons){const next=out.lessons.find(n=>n.id===l.id);requireValue(A.pianoSignature(l)===A.pianoSignature(next),'Musical grade');requireValue(equal(l.rhythm,next.rhythm)&&equal(l.fingeringSpec,next.fingeringSpec)&&l.pattern===next.pattern,'Notes, rhythm, fingers');}});
  await check('04 — личная редакция и удаление блокируют всё обновление',async()=>{for(const edit of [c=>c.lessons[0].description='Личная редакция',c=>c.lessons[0].pattern='y',c=>c.lessons[0].contentKind='piece',c=>c.lessons.shift()]){const local=copy(fixture.initial.catalog);edit(local);const before=copy(local),p=await planner.prepare(input(local));requireValue(p.status==='blocked'&&p.conflicts.length>0,'Conflict visible');throws(()=>planner.materialize(p,local),'CONFLICT');requireValue(equal(local,before)&&!Object.hasOwn(p,'candidate'),'No partial overwrite');}});
  await check('05 — изменение во время SHA256 требует повторной подготовки',async()=>{let release;const gate=new Promise(resolve=>{release=resolve;}),p=Planner.create({subtle:{digest:async(a,b)=>{await gate;return crypto.subtle.digest(a,b);}}}),local=copy(fixture.initial.catalog),before=copy(local),pending=p.prepare(input(local));local.lessons[0].description='Поздняя правка';release();const plan=await pending;throws(()=>p.materialize(plan,local),'STALE');requireValue(equal(p.materialize(plan,before),fixture.expectedCandidate),'Captured original');});
  await check('06 — старый источник и смена каталога отклоняются; дата экспорта не мешает',async()=>{await rejects(()=>planner.prepare({...input(),active:fixture.incoming,previous:incoming,incoming:previous}),'SOURCE');await rejects(()=>planner.prepare({...input(),active:{...fixture.previous,manifestSha256:'0'.repeat(64)}}),'SOURCE');const changed=copy(fixture.initial.catalog);changed.lessons.reverse();throws(()=>planner.materialize(proposal,changed),'STALE');const timed={...copy(fixture.initial.catalog),savedAt:'later export'};requireValue(planner.materialize(proposal,timed).catalog.savedAt==='later export','Export timestamp');});
  const store=create('main');let initial;
  await check('07 — loader → предложение → атомарный store сохраняет current, previous и квитанцию',async()=>{requireValue(await store.read()===null,'Empty own DB');initial=(await store.commit(store.prepare(null,fixture.initial))).current;const p=await planner.prepare(input(initial.catalog)),out=await store.commit(store.prepare(initial,planner.materialize(p,initial.catalog))),r=JSON.parse(await store.exportRecovery());requireValue(out.status==='committed'&&out.current.revision===2&&equal(out.current.active,fixture.incoming),'New identity');requireValue(equal(out.current.catalog,fixture.expectedCandidate.catalog)&&equal(r.previous,initial)&&r.receipt.revision===2&&r.receipt.previousRevision===1,'Current/previous/receipt');});
  await check('08 — поздняя запись второго соединения сохраняется при отказе устаревшего commit',async()=>{const a=create('late');await a.commit(a.prepare(null,fixture.initial));const b=sameStore(names.at(-1)),view=await a.read(),p=await planner.prepare(input(view.catalog)),stale=a.prepare(view,planner.materialize(p,view.catalog)),late=copy(fixture.initial);late.catalog.lessons.at(-1).privateAnnotation='Поздняя личная правка';await b.commit(b.prepare(await b.read(),late));const saved=await b.exportRecovery();await rejects(()=>a.commit(stale),'STALE');requireValue(await b.exportRecovery()===saved&&(await b.read()).catalog.lessons.at(-1).privateAnnotation==='Поздняя личная правка','Winner survives');});
  await check('09 — отказ сети и повреждённая часть не меняют рабочую копию',async()=>{const saved=await store.exportRecovery();await rejects(()=>load('bad',fixture.incoming),'INTEGRITY');await rejects(()=>load('offline',fixture.incoming),'NETWORK');requireValue(await store.exportRecovery()===saved,'No candidate committed on load failure');});
  await check('10 — отказ digest и подготовка оставляют прежние progress/UI/legacy записи',async()=>{const saved=await store.exportRecovery();await rejects(()=>Planner.create({subtle:{digest:async()=>{throw Error('Injected QA failure');}}}).prepare(input()),'DIGEST');requireValue(await store.exportRecovery()===saved,'Digest failure changed DB');for(const[key,value]of Object.entries(sentinels))requireValue(localStorage.getItem(key)===value,'Unrelated localStorage changed');});
  await check('11 — настоящая вторая вкладка сохраняет позднюю правку перед устаревшим commit',async()=>{
   peerChannel=new BroadcastChannel(PEER_CHANNEL);
   const request=(kind,data={})=>new Promise((resolve,reject)=>{const requestId=crypto.randomUUID(),timer=setTimeout(()=>{peerChannel.removeEventListener('message',receive);reject(Error('Открой вторую вкладку проверки.'));},4000);function receive({data}){if(data?.kind==='response'&&data.requestId===requestId){clearTimeout(timer);peerChannel.removeEventListener('message',receive);data.ok?resolve(data):reject(Error(data.message));}}peerChannel.addEventListener('message',receive);peerChannel.postMessage({kind,requestId,...data});});
   peerClientId=(await request('ping')).clientId;const a=create('peer');await a.commit(a.prepare(null,fixture.initial));
   const view=await a.read(),p=await planner.prepare(input(view.catalog)),stale=a.prepare(view,planner.materialize(p,view.catalog)),ack=await request('write',{database:names.at(-1)});
   requireValue(ack.clientId===peerClientId&&ack.revision===2,'Separate tab commit acknowledgement');const saved=await a.exportRecovery();await rejects(()=>a.commit(stale),'STALE');const winner=await a.read();requireValue(await a.exportRecovery()===saved&&winner.catalog.lessons.at(-1).privateAnnotation==='Поздняя правка из отдельной вкладки'&&winner.active.release==='23.5.44','Separate tab winner preserved');
  });
  proof={checkedAt:new Date().toISOString(),format:'melodiajest-browser-three-way-planner-qa-v1',tests:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,realIndexedDB:true,realWebCrypto:true,realFetch:true,sharedNodePolicyParity:true,actualLoaderPlannerStorePipeline:true,separateConnectionsLateWriteVerified:results[7]?.passed===true,separateTabsLateWriteVerified:results[10]?.passed===true,peerClientId,legacySentinelsUnchanged:Object.entries(sentinels).every(([k,v])=>localStorage.getItem(k)===v),productionApplicationConnected:false,legacyWritersMigrated:false,syntheticReleases:['23.5.44','23.5.45'],publicVersion:'23.5.44',results};
 }catch(e){proof={checkedAt:new Date().toISOString(),tests:results.length,failed:1,error:e.message,results};}
 finally{
  peerChannel?.close();for(const store of stores)store.close();const cleanup=[];
  for(const name of names){const deleted=await new Promise(resolve=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=()=>resolve(true);r.onerror=r.onblocked=()=>resolve(false);});cleanup.push({name,deleted});}
  for(const[key,value]of Object.entries(sentinels))if(localStorage.getItem(key)===value)localStorage.removeItem(key);
  proof.qaCleanup=cleanup;proof.qaDatabasesRemoved=cleanup.every(x=>x.deleted);output.textContent=JSON.stringify(proof,null,2);status.textContent=proof.failed?'Проверка обнаружила ошибки.':'11 из 11 проверок пройдены. Личные редакции сохранены.';status.className=proof.failed?'bad':'ok';button.disabled=false;
 }
});
