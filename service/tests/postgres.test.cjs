'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const {PostgresDatabase}=require('../database.cjs'),{openRepository}=require('../repository.cjs'),{createService}=require('../server.cjs'),S=require('../security.cjs');
const configFile=process.env.MELODIA_POSTGRES_TEST_CONFIG;
const pgTest=(name,fn)=>test(name,{skip:!configFile},fn);
async function setup(t,api=false){
  const config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  assert.equal(config.isolatedFixture,true);assert.equal(config.database,'melodiajest_fixture');assert.equal(config.user,'melodiajest_fixture_owner');assert.equal(config.host,'/pg-socket');
  const {Pool}=require('pg'),schema='melodiajest_test_'+randomUUID().replaceAll('-',''),admin=new Pool({...config,max:1});
  await admin.query('CREATE SCHEMA '+schema);await admin.query('SET search_path TO '+schema+',pg_catalog');await admin.query(fs.readFileSync(path.join(__dirname,'../schema.pg.sql'),'utf8'));
  const adapter=new PostgresDatabase({...config,schema}),root=fs.mkdtempSync(path.resolve(__dirname,'../../tmp/postgres-test-'));
  let service,store;const clock={now:Date.now()};
  if(api){service=await createService({database:adapter,dataDir:path.join(root,'data'),origin:'http://127.0.0.1:0',development:true,now:()=>clock.now,diskFreeBytes:()=>2*1024**3,onError:error=>console.error('Isolated API:',error.code||error.name,error.message)});service.server.listen(0,'127.0.0.1');await once(service.server,'listening');service.options.origin.port=String(service.server.address().port);store=service.store;}
  else store=await openRepository({database:adapter});
  t.after(async()=>{if(service)await service.close();else await store.close();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();fs.rmSync(root,{recursive:true,force:true});});
  async function client(){
    let cookie='',csrf='',account='';
    async function request(route,method='GET',data){
      const response=await fetch(service.options.origin.origin+'/api/service/v1'+route,{method,headers:{Connection:'close',...(cookie?{Cookie:cookie}:{}),...(account?{'X-Melodiajest-Account':account}:{}),...(method!=='GET'?{Origin:service.options.origin.origin,'Content-Type':'application/json','X-Melodiajest-CSRF':csrf}:{})},body:data===undefined?undefined:JSON.stringify(data)});
      const value=await response.json();if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];if(value.csrfToken)csrf=value.csrfToken;if('user'in value)account=value.user?.id||'';return {status:response.status,data:value};
    }
    assert.equal((await request('/session')).status,200);
    return {request,async register(username){const result=await request('/auth/register','POST',{username,displayName:'PG fixture','password':'isolated postgres piano phrase'});assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}};
  }
  return {store,adapter,service,client,clock,root};
}
pgTest('PostgreSQL real API preserves private data, public snapshots, revisions and owner denial',async t=>{
  const {client,store}=await setup(t,true),a=await client(),b=await client();await a.register('pg_first');await b.register('pg_second');
  assert.equal((await a.request('/preferences','PUT',{expectedRevision:0,raw:'{"materialMode":"hidden"}'})).status,200);assert.equal((await b.request('/preferences')).data.raw,null);
  const melody={entry:{id:'fixture',themeId:'fixture-theme',title:'PG phrase',pattern:'t y u',contentKind:'piece',description:'Isolated fixture'},origin:'original',source:''};
  const operationId=randomUUID(),created=await a.request('/library','POST',{data:melody,operationId});assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;
  assert.equal((await b.request('/library/'+id)).status,404);assert.equal((await a.request('/library','POST',{data:melody,operationId})).data.id,id);
  const publication=await a.request('/library/'+id+'/publish','POST',{expectedRevision:1,expectedPublicationRevision:0,rightsConfirmed:true,rights:'Original disposable fixture'});assert.equal(publication.status,200,JSON.stringify(publication.data));
  assert.equal((await b.request('/publications')).data.items[0].data.entry.title,'PG phrase');
  assert.equal((await b.request('/library/'+id+'/unpublish','POST',{expectedPublicationRevision:1})).status,404);
  assert.equal((await a.request('/library/'+id+'/unpublish','POST',{expectedPublicationRevision:1})).status,200);assert.equal((await b.request('/publications')).data.items.length,0);
  const feedback=await a.request('/feedback','POST',{title:'PG correction',body:'A private isolated correction proposal',target:'course01-01',operationId:randomUUID()});assert.equal(feedback.status,201);assert.equal((await b.request('/feedback')).data.items.length,0);
  assert.equal((await store.health()).engine,'postgres');
});
pgTest('PostgreSQL concurrent compare-and-set and duplicate operations commit once',async t=>{
  const {store}=await setup(t),user=await store.register('pg_revision','PG revision','hash','recovery',1);
  const saved=await Promise.allSettled([store.putObject(user.id,'catalog',0,'{"a":1}',2),store.putObject(user.id,'catalog',0,'{"b":2}',2)]);assert.equal(saved.filter(x=>x.status==='fulfilled').length,1);assert.equal(saved.find(x=>x.status==='rejected').reason.status,409);
  const op=randomUUID(),feedback=await Promise.all([store.createFeedback(user.id,'One','One private body','',2,op),store.createFeedback(user.id,'One','One private body','',2,op)]);assert.equal(feedback[0].id,feedback[1].id);
  const credential=await Promise.allSettled([store.resetPassword(user.id,'new-one','code-one',2,{passwordHash:'hash'}),store.resetPassword(user.id,'new-two','code-two',2,{passwordHash:'hash'})]);assert.equal(credential.filter(x=>x.status==='fulfilled').length,1);
});
pgTest('PostgreSQL MVCC hides partial changes without blocking a different account transaction',async t=>{
  const {store}=await setup(t),a=await store.register('pg_mvcc_one','First','hash','code',1),b=await store.register('pg_mvcc_two','Second','hash','code',1);
  let release,entered;const gate=new Promise(r=>{release=r;}),ready=new Promise(r=>{entered=r;});
  const changing=store.atomic(async()=>{await store.statement('UPDATE users SET display_name=? WHERE id=?').run('Uncommitted',a.id);entered();await gate;throw Error('rollback fixture');},a.id);
  await ready;try{assert.equal((await store.getUser(a.id)).displayName,'First');assert.equal((await store.putObject(b.id,'preferences',0,'{}',2)).revision,1);}finally{release();}
  await assert.rejects(changing,/rollback fixture/);assert.equal((await store.getUser(a.id)).displayName,'First');
});
pgTest('PostgreSQL retains case-insensitive identities and bounded sessions across async operations',async t=>{
  const {store}=await setup(t),user=await store.register('Pg_Case','Case','hash','recovery',Date.now());
  assert.equal((await store.credentials('PG_CASE')).user_id,user.id);await assert.rejects(()=>store.register('pg_case','Duplicate','hash','code',1),{status:409});
  for(let n=0;n<12;n++)await store.newSession(S.token(),user.id,Date.now()+n);
  assert.equal((await store.statement('SELECT count(*) AS n FROM sessions WHERE user_id=?').get(user.id)).n,10);
});
pgTest('PostgreSQL real HTTP challenge, XP, ratings and comments are atomic and owner-scoped',async t=>{
  const {client,clock}=await setup(t,true),a=await client(),b=await client();await a.register('pg_game_first');await b.register('pg_game_second');
  const course=(await a.request('/course')).data,first=course.lessons.find(row=>row.id===course.route[0]),second=course.lessons.find(row=>row.id===course.route[1]),nonce=S.token();
  const input=row=>({lessonId:row.id,musicVersion:row.musicVersion,editionVersion:row.editionVersion,mode:'challenge',nonce,operationId:randomUUID()});
  assert.equal((await a.request('/learning/attempts','POST',input(second))).data.error.code,'LESSON_LOCKED');
  const started=await a.request('/learning/attempts','POST',input(first));assert.equal(started.status,201,JSON.stringify(started.data));
  const plan=require('../course.cjs').loadCourse().lesson(first.id),beat=60000/plan.bpm,events=plan.steps.flatMap(step=>step.midis.flatMap(midi=>[{type:'on',midi,at:step.startBeat*beat+100,source:'midi'},{type:'off',midi,at:(step.startBeat+step.durationBeats)*beat+100,source:'midi'}])).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1)),submission={nonce,events,observedUntil:events.at(-1).at+10,observationInterrupted:false};
  clock.now+=30000;const graded=await a.request('/learning/attempts/'+started.data.id,'POST',submission);assert.equal(graded.status,200,JSON.stringify(graded.data));assert.equal(graded.data.xp.earned,100);assert.equal(graded.data.passed,true);
  assert.deepEqual((await a.request('/learning/attempts/'+started.data.id,'POST',submission)).data,graded.data);assert.equal((await b.request('/learning/attempts/'+started.data.id)).status,404);assert.equal((await b.request('/learning/state')).data.completed,0);
  const rating={editionVersion:first.editionVersion,system:'ten',value:0,expectedRevision:0,operationId:randomUUID()};assert.equal((await a.request('/lessons/'+first.id+'/rating','PUT',rating)).data.average.decimalTen,0);
  const comment=await a.request('/comments','POST',{scope:'lesson',lessonId:first.id,parentId:null,body:'A real isolated PostgreSQL comment',operationId:randomUUID()});assert.equal(comment.status,201,JSON.stringify(comment.data));assert.equal((await b.request('/comments/'+comment.data.id,'PUT',{body:'forged',deleted:false,expectedRevision:1,operationId:randomUUID()})).status,404);
  assert.equal((await a.request('/learning/state')).data.experience.musicXp,100);assert.equal((await b.request('/comments?scope=lesson&lessonId='+first.id)).data.items[0].mine,false);
});
pgTest('SQLite to PostgreSQL preserves the full private dataset, credentials and all histories without overwriting a populated target',async t=>{
  const {adapter,store,root,client}=await setup(t,true),legacy=await openRepository({filename:path.join(root,'legacy.sqlite')}),M=require('../migration.cjs'),{createGame}=require('../game.cjs');
  try{
    const hash=await S.hashPassword('isolated postgres piano phrase'),user=await legacy.register('pg_migrated','Migrated fixture',hash,'recovery-fixture',1),other=await legacy.register('pg_migrated_other','Other fixture',hash,'other-recovery',1);
    await legacy.putObject(user.id,'preferences',0,'{"mode":"hidden","zero":0}',2);await legacy.createFeedback(user.id,'Correction','Keep exact private text','course01-01',3,randomUUID());
    const melody=await legacy.createMelody(user.id,{entry:{id:'kept-note',title:'Private phrase',themeId:'keep',contentKind:'piece',pattern:'t y u',rhythm:{version:1,bpm:60,steps:[{startBeat:0,durationBeats:1},{startBeat:1,durationBeats:1},{startBeat:2,durationBeats:1}]},fingeringSpec:{version:1}},origin:'original',source:''},4,randomUUID());await legacy.publish(user.id,melody.id,1,0,'Own isolated phrase',5);await legacy.updateMelody(user.id,melody.id,1,{...(await legacy.melody(user.id,melody.id)).data,source:'Exact retained revision'},6);
    const game=createGame(legacy),row=game.registry.lesson(game.course.route[0]);await game.saveRating(user.id,row.id,{editionVersion:row.editionVersion,system:'ten_decimal',value:8.37,expectedRevision:0,operationId:randomUUID()},7);
    const parent=await game.createComment(user.id,{scope:'global',lessonId:'',parentId:null,body:'Parent',operationId:randomUUID()},8);await game.createComment(other.id,{scope:'global',lessonId:'',parentId:parent.id,body:'Reply at same timestamp',operationId:randomUUID()},8);
    const dataset=M.exportSqlite(legacy.filename),before=fs.readFileSync(legacy.filename),proof=await M.importPostgres(dataset,adapter,{expectedDigest:dataset.digest});assert.equal(proof.digest,dataset.digest);assert.equal(M.describe((await M.exportPostgres(adapter)).tables).digest,dataset.digest);assert.deepEqual(fs.readFileSync(legacy.filename),before);
    assert.equal((await store.melody(user.id,melody.id)).data.source,'Exact retained revision');assert.equal((await store.publicMelody((await store.melody(user.id,melody.id)).publication.id)).data.source,'');
    const http=await client();assert.equal((await http.request('/auth/login','POST',{username:'pg_migrated',password:'isolated postgres piano phrase'})).status,200);assert.equal((await http.request('/preferences')).data.raw,'{"mode":"hidden","zero":0}');
    assert.equal((await require('../game.cjs').createGame(store).rating(user.id,row.id)).rating.value,8.37);await assert.rejects(()=>M.importPostgres(dataset,adapter,{expectedDigest:dataset.digest}),{code:'MIGRATION_NOT_EMPTY'});
  }finally{await legacy.close();}
});
pgTest('exported repeatable-read snapshot stays consistent while another user commits',async t=>{
  const {adapter,store}=await setup(t),user=await store.register('pg_snapshot','Snapshot','hash','recovery',1),{consistentSnapshot}=require('../pg-snapshot.cjs');
  await store.putObject(user.id,'preferences',0,'{"before":true}',2);let released=false;
  const proof=await consistentSnapshot(adapter,async snapshot=>{
    assert.match(snapshot,/^[A-Fa-f0-9-]+$/);
    // A second adapter uses a genuinely separate connection and transaction.
    const another=new PostgresDatabase({...JSON.parse(fs.readFileSync(configFile,'utf8')),schema:adapter.schema});try{await another.transaction(()=>another.execute('run','UPDATE objects SET raw=?,revision=revision+1 WHERE user_id=? AND kind=?',['{"after":true}',user.id,'preferences']),user.id);released=true;}finally{await another.close();}
    assert.equal((await store.getObject(user.id,'preferences')).raw,'{"before":true}');return {verifiedFixture:true};
  });
  assert.equal(released,true);assert.equal(proof.consistentSnapshot,true);assert.equal((await store.getObject(user.id,'preferences')).raw,'{"after":true}');
});
