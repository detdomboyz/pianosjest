'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const Parts=require('../piano-lesson-parts.js'),Loader=require('../piano-lesson-package-loader.js'),Update=require('../piano-lesson-package-update.js');
const {loadApp}=require('./helpers/load-app.cjs'),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const all=copy(loadApp().catalogSnapshot()),themeId=all.lessons.find(l=>l.id==='course01-01').themeId;
const small={version:7,themes:all.themes.filter(t=>t.id===themeId),lessons:all.lessons.filter(l=>l.themeId===themeId)};
function setup(release='23.5.43',catalog=small){const b=Parts.build(catalog,{release,webManifestSha256:'a'.repeat(64),themeIds:[themeId]}),pin={...b.manifest.source,manifestSha256:b.manifestSha256};return {b,pin,files:new Map([[b.manifestKey,b.manifestBytes],...b.files])};}
const response=(bytes,headers={})=>new Response(bytes,{headers:{'Content-Type':'application/json',...headers}});
function client(s,{fetcher,cache=null,path=''}={}){const calls=[],f=fetcher||((url,options)=>{calls.push({url,options});const raw=s.files.get(new URL(url).pathname.slice(1+path.length));return Promise.resolve(raw?response(raw):new Response(null,{status:404}));});return {calls,load:Loader.create({baseUrl:'https://melodiajest.test/'+path,origin:'https://melodiajest.test',fetch:f,subtle:crypto.webcrypto.subtle,cache}).load};}
const rejects=(work,code)=>assert.rejects(work,e=>e.name==='LessonPackageLoadError'&&e.code===code&&!e.message.includes('PRIVATE'));
function cache(){const entries=new Map();return {entries,async match(url){return entries.get(url)?.clone();},async put(url,res){entries.set(url,res.clone());}};}
function alteredTopic(change){const s=setup(),m=copy(s.b.manifest),d=m.parts[0],topic=JSON.parse(s.b.files.get(d.key));change(topic);const bytes=Buffer.from(JSON.stringify(topic));d.sha256=hash(bytes);d.key='parts/v1/'+d.sha256+'.json';d.bytes=bytes.length;const raw=Buffer.from(JSON.stringify(m));return {b:{...s.b,manifest:m,manifestKey:'manifests/v1/'+hash(raw)+'.json'},pin:{...s.pin,manifestSha256:hash(raw)},files:new Map([['manifests/v1/'+hash(raw)+'.json',raw],[d.key,bytes]])};}

test('native WebCrypto decoder preserves every record, note/rhythm/finger/history and order from the real topic',async()=>{
 const s=setup(),c=client(s),r=await c.load({pin:s.pin});assert.deepEqual(r.catalog,Parts.assemble(s.b.manifest,s.b.files));assert.deepEqual(r.active,s.pin);assert.equal(r.stats.requests,2);assert.equal(r.stats.verifiedFiles,2);assert.equal(r.stats.networkBytes,[...s.files.values()].reduce((n,b)=>n+b.length,0));assert.ok(Object.isFrozen(r.catalog.lessons[0].learning));assert.deepEqual(small,{version:7,themes:all.themes.filter(t=>t.id===themeId),lessons:all.lessons.filter(l=>l.themeId===themeId)});
});
test('no request precedes rejection of stale releases, changed same-version pins or unsafe locations',async()=>{
 const s=setup(),c=client(s);await rejects(()=>c.load({pin:s.pin,active:{...s.pin,release:'23.5.44'}}),'STALE');await rejects(()=>c.load({pin:s.pin,active:{...s.pin,manifestSha256:'0'.repeat(64)}}),'SOURCE');assert.equal(c.calls.length,0);
 for(const baseUrl of ['http://melodiajest.test/','https://foreign.test/','https://user:PRIVATE@melodiajest.test/','https://melodiajest.test/?x=1','https://melodiajest.test/no-slash'])assert.throws(()=>Loader.create({baseUrl,origin:'https://melodiajest.test',fetch:fetch,subtle:crypto.webcrypto.subtle}),{name:'LessonPackageLoadError'});
});
test('network requests omit credentials, referrer and redirects and remain generated immutable GETs',async()=>{
 const s=setup(),c=client(s);await c.load({pin:s.pin});for(const {url,options:o}of c.calls){assert.match(url,/^https:\/\/melodiajest\.test\/(manifests|parts)\/v1\/[a-f0-9]{64}\.json$/);assert.equal(o.method,'GET');assert.equal(o.mode,'same-origin');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');assert.equal(o.referrerPolicy,'no-referrer');assert.equal(o.cache,'no-store');assert.deepEqual(o.headers,{Accept:'application/json'});}
});
test('wrong hashes, missing payload and truncated parts never yield a partial catalog',async()=>{
 for(const edit of [s=>s.files.set(s.b.manifestKey,Buffer.from('{}')),s=>s.files.set(s.b.manifest.parts[0].key,Buffer.from('PRIVATE')),s=>s.files.delete(s.b.manifest.parts[0].key),s=>s.files.set(s.b.manifest.parts[0].key,s.b.files.values().next().value.subarray(0,50))]){const s=setup();edit(s);await assert.rejects(()=>client(s).load({pin:s.pin}),e=>['INTEGRITY','HTTP'].includes(e.code));}
});
test('correctly hashed but unsupported or lossy music is rejected by the same offline and browser validator',async()=>{
 for(const change of [t=>t.version=2,t=>t.source.release='23.5.42',t=>t.lessons[0].contentKind='piece',t=>t.lessons[0].themeId='wrong',t=>t.lessons.reverse(),t=>t.lessons[0].pattern=7]){const s=alteredTopic(change),d=s.b.manifest.parts[0];assert.throws(()=>Parts.readPart(s.b.manifest,d.key,s.files.get(d.key)));await rejects(()=>client(s).load({pin:s.pin}),'CONTRACT');}
 const legacy=alteredTopic(t=>t.lessons[0].rhythm.steps[0].durationBeats=-1),r=await client(legacy).load({pin:legacy.pin});assert.equal(r.catalog.lessons[0].rhythm.steps[0].durationBeats,-1);assert.ok(require('../piano-catalog-adapter.js').project(r.catalog.lessons[0]).warnings.some(w=>w.code==='INVALID_STEP_TIME'),'Legacy unsupported timing stays explicit and is not silently repaired or certified');
});
test('fatal UTF-8, JSON depth and nonfinite numbers fail before the music adapter',async()=>{
 const base=setup(),d=base.b.manifest.parts[0];for(const raw of [Buffer.from([0xff]),Buffer.from('{"x":'+ '['.repeat(82)+'0'+']'.repeat(82)+'}'),Buffer.from('{"x":1e400}')]){const m=copy(base.b.manifest);Object.assign(m.parts[0],{key:'parts/v1/'+hash(raw)+'.json',sha256:hash(raw),bytes:raw.length});const manifest=Buffer.from(JSON.stringify(m)),key='manifests/v1/'+hash(manifest)+'.json';const s={b:{manifest:m,manifestKey:key},pin:{...base.pin,manifestSha256:hash(manifest)},files:new Map([[key,manifest],[m.parts[0].key,raw]])};await rejects(()=>client(s).load({pin:s.pin}),'CONTRACT');}
 assert.ok(d.bytes>0);
});
test('stream limits use decoded bytes and accept compressed Content-Length independently',async()=>{
 const s=setup(),c=client(s,{fetcher:async url=>response(s.files.get(new URL(url).pathname.slice(1)),{'Content-Length':'7','Content-Encoding':'gzip'})});assert.deepEqual((await c.load({pin:s.pin})).catalog,Parts.assemble(s.b.manifest,s.b.files));
 await rejects(()=>client(s,{fetcher:async()=>response(new Uint8Array(Parts.MAX_MANIFEST_BYTES+1))}).load({pin:s.pin}),'LIMIT');
 await rejects(()=>client(s,{fetcher:async()=>response(s.b.manifestBytes,{'Content-Length':'999999999'})}).load({pin:s.pin}),'LIMIT');
});
test('HTTP errors, wrong MIME, redirect flags and failed streams expose only typed static messages',async()=>{
 const s=setup();for(const fetcher of [async()=>new Response(null,{status:503}),async()=>new Response(null,{status:304}),async()=>response(s.b.manifestBytes,{'Content-Type':'text/html'}),async()=>({status:200,redirected:true})])await rejects(()=>client(s,{fetcher}).load({pin:s.pin}),'HTTP');
 for(const fetcher of [async()=>{throw Error('PRIVATE network detail');},async()=>new Response(new ReadableStream({start(c){c.error(Error('PRIVATE stream detail'));}}),{headers:{'Content-Type':'application/json'}})])await rejects(()=>client(s,{fetcher}).load({pin:s.pin}),'NETWORK');
});
test('a full verified immutable cache can be read offline without fetch or a bucket listing',async()=>{
 const s=setup(),store=cache();await client(s,{cache:store}).load({pin:s.pin});const r=await client(s,{cache:store,fetcher:async()=>{throw Error('PRIVATE offline');}}).load({pin:s.pin});assert.equal(r.stats.requests,0);assert.equal(r.stats.cacheHits,2);assert.equal(r.stats.verifiedFiles,2);assert.equal(r.stats.networkBytes,0);
});
test('cached corruption fails visibly; explicit reload repairs it with fully verified bytes',async()=>{
 const s=setup(),store=cache();await client(s,{cache:store}).load({pin:s.pin});store.entries.set('https://melodiajest.test/'+s.b.manifest.parts[0].key,response(Buffer.from('PRIVATE')));await rejects(()=>client(s,{cache:store}).load({pin:s.pin}),'INTEGRITY');const r=await client(s,{cache:store}).load({pin:s.pin,reload:true});assert.equal(r.stats.requests,2);assert.deepEqual(r.catalog,Parts.assemble(s.b.manifest,s.b.files));
});
test('optional cache read/quota failures retain a verified candidate and do not pretend to persist a catalog',async()=>{
 const s=setup(),r=await client(s,{cache:{async match(){throw Error('PRIVATE cache');},async put(){throw Object.assign(Error('PRIVATE quota'),{name:'QuotaExceededError'});}}}).load({pin:s.pin});assert.equal(r.stats.cacheReadFailures,2);assert.equal(r.stats.cacheWriteFailures,2);assert.equal(r.stats.verifiedFiles,2);assert.equal('commit' in r,false);assert.equal('persisted' in r,false);
});
test('cancellation/timeouts stop pending work; valid decoded packages remain compatible with private three-way planning',async()=>{
 const s=setup(),a=new AbortController();a.abort();await rejects(()=>client(s).load({pin:s.pin,signal:a.signal}),'ABORTED');await rejects(()=>client(s,{fetcher:()=>new Promise(()=>{})}).load({pin:s.pin,timeoutMs:50}),'TIMEOUT');
 const original=setup('23.5.42'),fresh=copy(small);fresh.lessons[0].description+=' Проверка новой редакции.';const incoming=setup('23.5.43',fresh),loaded=await client(incoming).load({pin:incoming.pin,active:original.pin});const repacked=Parts.build(loaded.catalog,{...loaded.active,themeIds:[themeId]});assert.equal(repacked.manifestSha256,incoming.pin.manifestSha256);
 const local=copy(small);local.lessons.reverse();local.lessons[0].order=100;local.themes.push({id:'private-theme',name:'Личная тема',order:99});local.lessons.push({...copy(local.lessons[0]),id:'private-piece',themeId:'private-theme',contentKind:'piece',privateAnnotation:'PRIVATE',order:101});const input=b=>({pin:{...b.manifest.source,manifestSha256:b.manifestSha256},manifestBytes:b.manifestBytes,files:b.files});const plan=Update.prepare({active:original.pin,previous:input(original.b),incoming:input(repacked),catalog:local}),result=Update.materialize(plan,local);assert.equal(result.catalog.lessons.at(-1).privateAnnotation,'PRIVATE');assert.deepEqual(result.catalog.lessons.map(l=>l.id),local.lessons.map(l=>l.id));assert.equal(result.catalog.lessons[0].order,100);assert.equal(result.catalog.lessons.find(l=>l.id===small.lessons[0].id).description,fresh.lessons[0].description);
});
