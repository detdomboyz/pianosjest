'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const {create}=require('../service-client.js');
function setup(){
  const requests=[],writes=[],storage={getItem:()=>null,setItem:(...x)=>writes.push(x)};
  let user=null,course={version:1,sha256:'same-course',lessons:[{id:'one',rating:null}]},failure=null,delayed=null;
  const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const fetch=async(url,options)=>{
    requests.push({url,options});
    if(url.endsWith('/session'))return response(200,{user,csrfToken:'test-csrf'});
    if(url.endsWith('/preferences'))return response(200,{revision:0,raw:null});
    if(url.endsWith('/course')&&options.method==='GET'){
      if(delayed){const x=delayed;delayed=null;return x;}
      if(failure instanceof Error)throw failure;
      if(failure==='bad-json')return {ok:true,status:200,json:async()=>{throw SyntaxError('synthetic broken JSON');}};
      if(failure==='raw304')return {ok:false,status:304,json:async()=>{throw SyntaxError('304 has no cached representation');}};
      if(failure===503)return response(503,{error:{code:'TEMPORARILY_UNAVAILABLE',message:'synthetic outage'}});
      return response(200,course);
    }
    return response(200,{ok:true});
  };
  return {client:create({fetch,storage}),requests,writes,response,setUser:x=>user=x,setCourse:x=>course=x,setFailure:x=>failure=x,delayNext:x=>delayed=x};
}
test('only an exact public course GET opts into native revalidation without credentials or owner headers',async()=>{
  const x=setup(),result=await x.client.api('/course',{publicRequest:true});assert.equal(result.sha256,'same-course');
  assert.equal(x.requests.length,1);const r=x.requests[0];assert.equal(r.url,'/api/service/v1/course');assert.equal(r.options.method,'GET');assert.equal(r.options.cache,'no-cache');assert.equal(r.options.credentials,'omit');assert.deepEqual(r.options.headers,{});assert.equal(r.options.body,undefined);assert.deepEqual(x.writes,[]);
});
test('a signed-in client still requests the public course anonymously and retains its account state',async()=>{
  const x=setup();x.setUser({id:'account-a'});await x.client.init();await x.client.api('/course',{publicRequest:true});
  const r=x.requests.at(-1);assert.equal(r.options.credentials,'omit');assert.equal(r.options.cache,'no-cache');assert.equal(r.options.headers['X-Melodiajest-Account'],undefined);assert.equal(r.options.headers['X-Melodiajest-CSRF'],undefined);assert.equal(x.client.status().user.id,'account-a');
});
test('queries, nonpublic calls, other routes and mutations retain no-store and same-origin credentials',async()=>{
  const x=setup();x.setUser({id:'account-a'});await x.client.init();
  for(const [route,options]of [['/course',{}],['/course?view=one',{publicRequest:true}],['/course/',{publicRequest:true}],['/course',{method:'POST',data:{},publicRequest:true}],['/course',{method:'PUT',data:{}}],['/publications',{publicRequest:true}],['/learning/state',{}],['/catalog',{}]]){
    await x.client.api(route,options);const r=x.requests.at(-1);assert.equal(r.options.cache,'no-store',route);assert.equal(r.options.credentials,'same-origin',route);
    if(!options.publicRequest)assert.equal(r.options.headers['X-Melodiajest-Account'],'account-a');
    if(r.options.method!=='GET')assert.equal(r.options.headers['X-Melodiajest-CSRF'],'test-csrf');
  }
});
test('a 503 after a valid course propagates instead of returning an application-cached course',async()=>{
  const x=setup();await x.client.api('/course',{publicRequest:true});x.setFailure(503);await assert.rejects(()=>x.client.api('/course',{publicRequest:true}),{code:'TEMPORARILY_UNAVAILABLE',status:503});
  x.setFailure(null);x.setCourse({sha256:'same-course',lessons:[{id:'one',rating:{n:1}}]});assert.deepEqual((await x.client.api('/course',{publicRequest:true})).lessons[0].rating,{n:1});assert.deepEqual(x.writes,[]);
});
test('offline and aborted revalidation never silently reuse an earlier course response',async()=>{
  const x=setup();await x.client.api('/course',{publicRequest:true});x.setFailure(TypeError('synthetic offline'));await assert.rejects(()=>x.client.api('/course',{publicRequest:true}),/synthetic offline/);
  const abort=Error('synthetic aborted');abort.name='AbortError';x.setFailure(abort);await assert.rejects(()=>x.client.api('/course',{publicRequest:true}),{code:'TIMEOUT'});assert.deepEqual(x.writes,[]);
});
test('broken JSON and a raw304 without a native cached body fail explicitly',async()=>{
  const x=setup();await x.client.api('/course',{publicRequest:true});for(const mode of ['bad-json','raw304']){x.setFailure(mode);await assert.rejects(()=>x.client.api('/course',{publicRequest:true}),{code:'BAD_RESPONSE'});}assert.deepEqual(x.writes,[]);
});
test('a late public course response cannot adopt or unlock a different account',async()=>{
  const x=setup();x.setUser({id:'account-a'});await x.client.init();let resolve;x.delayNext(new Promise(r=>resolve=r));const pending=x.client.api('/course',{publicRequest:true});
  x.setUser({id:'account-b'});await x.client.checkSession();assert.equal(x.client.status().locked,true);resolve(x.response(200,{sha256:'public',lessons:[]}));assert.equal((await pending).sha256,'public');assert.equal(x.client.status().user.id,'account-a');assert.equal(x.client.status().locked,true);assert.deepEqual(x.writes,[]);
});
test('public course caching preserves all610 full records,462 editions,ordered routes,grades and the guitar baseline',()=>{
  const before=require('./fixtures/piano-before-public-course-cache-v1.json'),currentCounts=require('./fixtures/piano-curriculum-counts.json'),{loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),app=loadApp(),course=JSON.parse(fs.readFileSync('service/course-registry.json','utf8')),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
  assert.equal(app.lessons.length,currentCounts.catalogRecords);assert.equal(course.lessons.length,currentCounts.implementedLearningLessons);const oldIds=new Set(before.catalog.map(x=>x.id)),oldServerIds=new Set(before.server.lessons.map(x=>x.id)),oldCatalog=app.lessons.filter(x=>oldIds.has(x.id)),oldRows=course.lessons.filter(x=>oldServerIds.has(x.id)),oldRoute=course.route.filter(x=>oldServerIds.has(x));assert.equal(oldCatalog.length,610);assert.equal(oldRows.length,462);
  assert.deepEqual(JSON.parse(JSON.stringify(oldCatalog.map(x=>({id:x.id,fullRecordSha256:hash(x),grade:A.pianoSignature(x),order:x.order,themeId:x.themeId})))),before.catalog);
  assertPreservedThemes(app.themes,before.themes);assert.deepEqual(oldRows.map(x=>({id:x.id,fullRecordSha256:hash(x),musicVersion:x.musicVersion,editionVersion:x.editionVersion,goalKey:x.goalKey})),before.server.lessons);assert.deepEqual(oldRoute,before.server.route);assert.equal(require('../service/canonical.cjs').hash({route:oldRoute,lessons:oldRows}),before.server.contentSha256);
  const ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);assert.deepEqual(Array.from(ctx.MUSIC_CURRICULUM_PLAN.piano,x=>x.id).filter(id=>oldIds.has(id)),before.pianoRoute);assert.equal(hash(ctx.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);
});
