'use strict';
const Loader=window.PianoLessonPackageLoader,Store=window.PianoLessonPackageStore,button=document.querySelector('#run'),status=document.querySelector('#status'),output=document.querySelector('#results');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b)),requireValue=(v,m)=>{if(!v)throw Error(m);};
button.addEventListener('click',async()=>{
 button.disabled=true;status.textContent='Проверяю…';const results=[],run='23-'+crypto.randomUUID(),cacheName='melodiajest-piano-parts-v1-qa-'+run,dbName=Store.DATABASE+'-qa-'+run;let store,cleanup={cacheRemoved:false,databaseRemoved:false};
 const check=async(name,fn)=>{try{const detail=await fn();results.push({name,passed:true,...(detail?{detail}:{})});}catch(error){results.push({name,passed:false,code:error.code??error.name,message:error.message});}output.textContent=JSON.stringify({running:true,results},null,2);};
 try{
  const fixture=await(await fetch('/fixture.json',{cache:'no-store'})).json(),cache=await caches.open(cacheName);
  store=Store.create({indexedDB,name:dbName});await store.commit(store.prepare(null,fixture.initial));const before=JSON.stringify(await store.read());
  const load=(mode='packages',options={})=>Loader.create({baseUrl:location.origin+'/'+mode+'/',origin:location.origin,fetch:(url,init)=>fetch(url,init),subtle:crypto.subtle,...options}).load;
  const input={pin:fixture.pin,active:fixture.active};
  const unchanged=async()=>requireValue(JSON.stringify(await store.read())===before,'Working catalog was modified');
  const rejects=async(job,code)=>{try{await job();}catch(error){requireValue(error.name==='LessonPackageLoadError'&&error.code===code,'Expected '+code);await unchanged();return {code,workingRevisionUnchanged:true};}throw Error('Expected '+code);};
  await check('native-fetch-crypto-shared-validator',async()=>{const r=await load('packages',{cache})(input);requireValue(equal(r.catalog,fixture.catalog),'Music or metadata changed');requireValue(r.stats.requests===2&&r.stats.verifiedFiles===2,'Unexpected network inventory');requireValue(Object.isFrozen(r.catalog.lessons[0]),'Mutable decoded lesson');await unchanged();return r.stats;});
  await check('native-cache-reuse-no-fetch',async()=>{let calls=0;const r=await load('packages',{cache,fetch:async()=>{calls++;throw Error('Network deliberately unavailable');}})(input);requireValue(calls===0&&r.stats.requests===0&&r.stats.cacheHits===2&&r.stats.verifiedFiles===2,'Cache was not reverified without network');await unchanged();return r.stats;});
  await check('corrupt-part-keeps-working-catalog',()=>rejects(()=>load('corrupt')(input),'INTEGRITY'));
  await check('stale-manifest-keeps-working-catalog',()=>rejects(()=>load('stale')(input),'INTEGRITY'));
  await check('http-503-keeps-working-catalog',()=>rejects(()=>load('http')(input),'HTTP'));
  await check('actual-closed-network-keeps-working-catalog',()=>rejects(()=>load('network')(input),'NETWORK'));
  await check('native-redirect-is-refused',()=>rejects(()=>load('redirect')(input),'NETWORK'));
  await check('wrong-mime-keeps-working-catalog',()=>rejects(()=>load('mime')(input),'HTTP'));
  await check('stale-source-refused-before-fetch',async()=>{let calls=0;const fn=load('packages',{fetch:async()=>{calls++;throw Error('Unexpected network');}});await rejects(()=>fn({...input,pin:fixture.active,active:fixture.pin}),'STALE');requireValue(calls===0,'Stale source caused a request');return {requests:0};});
  await check('native-abort-refused-before-fetch',async()=>{const a=new AbortController();a.abort();return rejects(()=>load()({...input,signal:a.signal}),'ABORTED');});
  await check('corrupt-native-cache-fails-and-explicit-reload-repairs',async()=>{const url=location.origin+'/packages/'+fixture.partKey;await cache.put(url,new Response('corrupt cache fixture',{headers:{'Content-Type':'application/json'}}));await rejects(()=>load('packages',{cache})(input),'INTEGRITY');const r=await load('packages',{cache})({...input,reload:true});requireValue(equal(r.catalog,fixture.catalog)&&r.stats.requests===2,'Explicit reload did not repair verified cache');await unchanged();return {requests:r.stats.requests,workingRevisionUnchanged:true};});
  await check('private-record-order-and-pin-remain-in-native-idb',async()=>{const raw=await store.read();requireValue(raw.revision===1&&equal(raw.active,fixture.active),'Catalog or source advanced before commit');requireValue(raw.catalog.lessons.at(-1).id==='qa-personal-piece'&&raw.catalog.lessons.at(-1).contentKind==='piece','Private material lost');requireValue(equal(raw.catalog.lessons.map(l=>l.id),fixture.initial.catalog.lessons.map(l=>l.id)),'Personal order changed');return {revision:raw.revision,privateRecordPreserved:true};});
 }catch(error){results.push({name:'setup',passed:false,code:error.code??error.name,message:error.message});}
 finally{store?.close();try{cleanup.cacheRemoved=await caches.delete(cacheName);}catch{}try{cleanup.databaseRemoved=await new Promise(resolve=>{const r=indexedDB.deleteDatabase(dbName);r.onsuccess=()=>resolve(true);r.onerror=r.onblocked=()=>resolve(false);});}catch{}if(!cleanup.cacheRemoved||!cleanup.databaseRemoved)results.push({name:'own-qa-cleanup',passed:false});}
 const report={version:'23.5.43',scope:'isolated transport/cache and native IDB preservation; production writers and browser merge not connected',checkedAt:new Date().toISOString(),passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results,cleanup};
 output.textContent=JSON.stringify(report,null,2);status.textContent=report.failed?'Есть ошибки: '+report.failed:'Проверено: '+report.passed+' из '+report.passed;status.className=report.failed?'bad':'ok';button.disabled=false;
});
