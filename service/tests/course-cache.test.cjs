'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),{createHash,randomUUID}=require('node:crypto');
const {createService}=require('../server.cjs'),{loadCourse}=require('../course.cjs'),{hash}=require('../canonical.cjs');
const ROOT=path.resolve(__dirname,'../..');
const TEST_TMP=fs.realpathSync(path.join(ROOT,'tmp'));
async function setup(t,{registry}={}){
  const dir=fs.mkdtempSync(path.join(TEST_TMP,'course-cache-http-'));const service=await createService({dataDir:path.join(dir,'data'),origin:'http://127.0.0.1:0',development:true,...(registry?{courseRegistry:registry}:{})});
  service.server.listen(0,'127.0.0.1');await once(service.server,'listening');service.options.origin.port=String(service.server.address().port);const origin=service.options.origin.origin;
  t.after(async()=>{await service.close();assert.ok(dir.startsWith(TEST_TMP+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  async function request(route='/course',{method='GET',headers={}}={}){
    const r=await fetch(origin+'/api/service/v1'+route,{method,headers:{Connection:'close',...headers}}),raw=Buffer.from(await r.arrayBuffer());let data=null;if(raw.length)data=JSON.parse(raw.toString());return{status:r.status,headers:r.headers,raw,data};
  }
  return{service,origin,dir,request};
}
const expectedTag=raw=>'W/"'+createHash('sha256').update(raw).digest('hex')+'"';
test('public course has a whole-body weak ETag and unchanged GET returns a bodyless304',async t=>{
  const x=await setup(t),first=await x.request();assert.equal(first.status,200);assert.equal(first.headers.get('etag'),expectedTag(first.raw));assert.equal(first.headers.get('cache-control'),'public, no-cache');assert.equal(first.headers.get('set-cookie'),null);assert.equal(Number(first.headers.get('content-length')),first.raw.length);assert.ok(first.data.lessons.every(l=>!('steps'in l)));
  const second=await x.request('/course',{headers:{'If-None-Match':first.headers.get('etag')}});assert.equal(second.status,304);assert.equal(second.raw.length,0);assert.equal(second.headers.get('content-length'),null);assert.equal(second.headers.get('etag'),first.headers.get('etag'));assert.equal(second.headers.get('cache-control'),'public, no-cache');assert.equal(second.headers.get('x-content-type-options'),'nosniff');assert.equal(second.headers.get('set-cookie'),null);
});
test('GET validators support weak comparison,lists,quoted commas,empty list members and lone wildcard',async t=>{
  const x=await setup(t),first=await x.request(),tag=expectedTag(first.raw),strong=tag.slice(2);
  for(const value of [tag,strong,'"unrelated", '+tag,'W/"opaque,comma", '+strong,' , '+tag+', ,','\t*\t']){
    const r=await x.request('/course',{headers:{'If-None-Match':value}});assert.equal(r.status,304,value);assert.equal(r.raw.length,0,value);
  }
});
test('malformed,oversized and nonmatching validator fields are ignored as a whole',async t=>{
  const x=await setup(t),first=await x.request(),tag=expectedTag(first.raw);
  for(const value of ['"other"',', ,','w/'+tag.slice(2),tag+' broken',tag+',garbage','*, '+tag,tag+',*','"unterminated',tag+',"bad space"','"'+'x'.repeat(4100)+'",'+tag]){
    const r=await x.request('/course',{headers:{'If-None-Match':value}});assert.equal(r.status,200,value.slice(0,100));assert.deepEqual(r.raw,first.raw);
  }
});
test('a real rating update changes the ETag while the canonical course SHA remains unchanged',async t=>{
  const x=await setup(t),first=await x.request(),row=x.service.game.course.lessons[0],user=await x.service.store.register('cache_rater','Cache rater','test-hash','test-recovery',1000);
  await x.service.game.saveRating(user.id,row.id,{editionVersion:row.editionVersion,system:'ten',value:8,expectedRevision:0,operationId:randomUUID()},2000);
  const rated=await x.request('/course',{headers:{'If-None-Match':expectedTag(first.raw)}});assert.equal(rated.status,200);assert.equal(rated.data.sha256,first.data.sha256);assert.notDeepEqual(rated.data.lessons[0].rating,first.data.lessons[0].rating);assert.notEqual(rated.headers.get('etag'),first.headers.get('etag'));assert.equal(rated.headers.get('etag'),expectedTag(rated.raw));
  const unchanged=await x.request('/course',{headers:{'If-None-Match':rated.headers.get('etag')}});assert.equal(unchanged.status,304);
  await x.service.game.saveRating(user.id,row.id,{editionVersion:row.editionVersion,system:'ten',value:null,expectedRevision:1,operationId:randomUUID()},3000);
  const removed=await x.request('/course',{headers:{'If-None-Match':rated.headers.get('etag')}});assert.equal(removed.status,200);assert.deepEqual(removed.raw,first.raw);assert.equal(removed.headers.get('etag'),first.headers.get('etag'));
});
test('a new canonical edition cannot reuse an earlier course validator',async t=>{
  const a=await setup(t),first=await a.request(),dir=fs.mkdtempSync(path.join(TEST_TMP,'course-cache-edition-'));t.after(()=>{assert.ok(dir.startsWith(TEST_TMP+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const changed=JSON.parse(fs.readFileSync(path.join(ROOT,'service/course-registry.json'),'utf8'));changed.lessons[0].title+=' · isolated edition';changed.lessons[0].editionVersion='synthetic-edition-changed';changed.contentSha256=hash({route:changed.route,lessons:changed.lessons});const filename=path.join(dir,'registry.json');fs.writeFileSync(filename,JSON.stringify(changed));
  const b=await setup(t,{registry:loadCourse(filename)}),next=await b.request('/course',{headers:{'If-None-Match':expectedTag(first.raw)}});assert.equal(next.status,200);assert.notEqual(next.data.sha256,first.data.sha256);assert.notEqual(next.headers.get('etag'),first.headers.get('etag'));assert.equal(next.headers.get('etag'),expectedTag(next.raw));
});
test('session,private,other public,error and non-GET routes remain no-store without ETags',async t=>{
  const x=await setup(t);
  for(const [route,method]of [['/session','GET'],['/health','GET'],['/preferences','GET'],['/publications','GET'],['/course-extra','GET'],['/course','HEAD'],['/course','POST'],['/course','PUT']]){
    const r=await x.request(route,{method,headers:{'If-None-Match':'*'}});assert.notEqual(r.status,304,route+method);assert.equal(r.headers.get('cache-control'),'private, no-store',route+method);assert.equal(r.headers.get('etag'),null,route+method);
  }
});
test('an unavailable current course returns an uncached error instead of a stale304',async t=>{
  const x=await setup(t),first=await x.request(),original=x.service.game.publicCourse;x.service.game.publicCourse=async()=>{throw Error('synthetic current-rating read failure');};
  const failed=await x.request('/course',{headers:{'If-None-Match':expectedTag(first.raw)}});assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'private, no-store');assert.equal(failed.headers.get('etag'),null);assert.equal(failed.data.error.code,'TEMPORARILY_UNAVAILABLE');
  x.service.game.publicCourse=original;assert.equal((await x.request('/course',{headers:{'If-None-Match':expectedTag(first.raw)}})).status,304);
});
test('unrelated cookie and owner headers do not personalize the public representation or create sessions',async t=>{
  const x=await setup(t),a=await x.request(),b=await x.request('/course',{headers:{Cookie:'melodiajest-dev-session=unrelated-test-only-cookie','X-Melodiajest-Account':'other-test-owner'}});assert.deepEqual(b.raw,a.raw);assert.equal(b.headers.get('etag'),expectedTag(a.raw));assert.equal(b.headers.get('set-cookie'),null);assert.equal((await x.service.store.statement('SELECT count(*) AS n FROM sessions').get()).n,0);
});
