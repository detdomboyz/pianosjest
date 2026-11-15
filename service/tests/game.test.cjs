'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID,randomBytes}=require('node:crypto');
const {openRepository}=require('../repository.cjs'),{createGame}=require('../game.cjs'),{loadCourse}=require('../course.cjs');
const registry=loadCourse();
async function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'melodiajest-game-test-')),store=await openRepository({filename:path.join(dir,'accounts.sqlite')}),game=createGame(store);
  t.after(async()=>{await store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const a=await store.register('game_first','First','test-only-hash','test-only-recovery',1),b=await store.register('game_second','Second','test-only-hash','test-only-recovery',1);
  return {store,game,a:a.id,b:b.id};
}
function startInput(row,mode='challenge'){return {lessonId:row.id,musicVersion:row.musicVersion,editionVersion:row.editionVersion,mode,nonce:randomBytes(32).toString('base64url'),operationId:randomUUID()};}
function performance(row,{source='midi',jitter=0}={}){
  const beat=60000/row.bpm,events=row.steps.flatMap((step,i)=>step.midis.flatMap(midi=>[{type:'on',midi,at:(step.startBeat-row.steps[0].startBeat)*beat+100+(i%2)*jitter,source},{type:'off',midi,at:(step.startBeat-row.steps[0].startBeat+step.durationBeats)*beat+100,source}])).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
  return {events,observedUntil:Math.max(events.at(-1).at,((row.ending?.endBeat||0)-row.steps[0].startBeat)*beat+100)+10,observationInterrupted:false};
}
async function take(game,owner,row,{now=1000,mode='challenge',...options}={}){const input=startInput(row,mode),started=await game.start(owner,input,now),data={nonce:input.nonce,...performance(row,options)},result=await game.submit(owner,started.id,data,now+Math.ceil(data.observedUntil));return {input,started,data,result};}

test('connected F-major goal rejects the paused trace and awards only its own bounded improvement',async t=>{
 const {game,a}=await setup(t),stopped=game.registry.lesson('detail-p-f-major-fourth-thumb-prep-right-01'),connected=game.registry.lesson('detail-p-f-major-fourth-thumb-connected-right-01');
 await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);assert.notEqual(stopped.goalKey,connected.goalKey);
 assert.equal((await take(game,a,stopped,{now:10000})).result.xp.earned,100);
 const input=startInput(connected),started=await game.start(a,input,60000),bad={nonce:input.nonce,...performance(stopped)},failed=await game.submit(a,started.id,bad,80000);assert.equal(failed.passed,false);assert.equal(failed.xp.earned,0);
 const clean=await take(game,a,connected,{now:100000});assert.equal(clean.result.passed,true);assert.equal(clean.result.xp.earned,100);assert.equal((await take(game,a,connected,{now:130000})).result.xp.earned,0);assert.equal((await game.state(a)).experience.musicXp,200);
});

test('two prerequisite-only revisions keep old attempts,progress and XP while rejecting stale editions',async t=>{
 const {game,a,store}=await setup(t),before=require('../../tests/fixtures/piano-before-right-legato-preparation-v1.json');
 await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 for(const [i,id] of Object.keys(before.targets).entries()){
  const current=game.registry.lesson(id),old=before.server.targetRows[id];assert.equal(current.musicVersion,old.musicVersion);assert.notEqual(current.editionVersion,old.editionVersion);
  game.registry.byId.set(id,old);const first=await take(game,a,old,{now:10000+i*100000});assert.equal(first.result.passed,true);assert.equal(first.result.xp.earned,100);
  game.registry.byId.set(id,current);assert.ok((await game.state(a)).progress.some(p=>p.lessonId===id&&p.musicVersion===old.musicVersion));
  await assert.rejects(()=>game.start(a,startInput(old),30000+i*100000),{code:'LESSON_CHANGED'});
  const second=await take(game,a,current,{now:40000+i*100000});assert.equal(second.result.passed,true);assert.equal(second.result.xp.earned,0);
  assert.equal((await store.statement('SELECT count(*) AS n FROM course_editions WHERE lesson_id=? AND music_version=?').get(id,current.musicVersion)).n,2);
  const history=(await game.history(a)).items.filter(x=>x.lessonId===id);assert.equal(history.length,2);assert.ok(history.some(x=>x.editionVersion===old.editionVersion));assert.ok(history.some(x=>x.editionVersion===current.editionVersion));
 }
 assert.equal((await game.state(a)).experience.musicXp,200);
});
test('upper readiness text revision preserves old progress,immutable attempts and one-time XP',async t=>{
 const {game,a,store}=await setup(t),before=require('../../tests/fixtures/piano-before-f-upper-readiness-v1.json'),old=before.server.targetRow,current=game.registry.lesson(old.id);
 assert.equal(current.musicVersion,old.musicVersion);assert.equal(current.goalKey,old.goalKey);assert.notEqual(current.editionVersion,old.editionVersion);
 await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 game.registry.byId.set(old.id,old);const first=await take(game,a,old,{now:10000});assert.equal(first.result.passed,true);assert.equal(first.result.xp.earned,100);
 game.registry.byId.set(old.id,current);assert.ok((await game.state(a)).progress.some(p=>p.lessonId===old.id&&p.musicVersion===old.musicVersion));await assert.rejects(()=>game.start(a,startInput(old),40000),{code:'LESSON_CHANGED'});
 const second=await take(game,a,current,{now:60000});assert.equal(second.result.passed,true);assert.equal(second.result.xp.earned,0);assert.equal((await game.state(a)).experience.musicXp,100);
 assert.equal((await store.statement('SELECT count(*) AS n FROM course_editions WHERE lesson_id=? AND music_version=?').get(old.id,old.musicVersion)).n,2);
 const history=(await game.history(a)).items.filter(x=>x.lessonId===old.id);assert.equal(history.length,2);assert.ok(history.some(x=>x.editionVersion===old.editionVersion));assert.ok(history.some(x=>x.editionVersion===current.editionVersion));
});
test('F-major ascent checkpoint keeps separate progress and awards bounded musicXP only once',async t=>{
 const {game,a}=await setup(t),prep=game.registry.lesson('detail-p-f-major-fourth-thumb-connected-right-01'),control=game.registry.lesson('detail-p-f-major-ascent-checkpoint-right-01');await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 assert.equal((await take(game,a,prep,{now:10000})).result.xp.earned,100);assert.equal((await game.state(a)).progress.some(p=>p.lessonId===control.id),false);assert.notEqual(prep.musicVersion,control.musicVersion);
 const input=startInput(control),started=await game.start(a,input,50000),bad={nonce:input.nonce,...performance(prep)};assert.equal((await game.submit(a,started.id,bad,80000)).passed,false);
 const clean=await take(game,a,control,{now:100000});assert.equal(clean.result.passed,true);assert.equal(clean.result.xp.earned,100);assert.equal((await take(game,a,control,{now:130000})).result.xp.earned,0);const state=await game.state(a);assert.equal(state.experience.musicXp,200);assert.equal(state.experience.portal.level,null);
});
test('reverse F-major fourth preparation rejects forward credit and keeps one-time XP and owner isolation',async t=>{
 const {game,a,b}=await setup(t),forward=game.registry.lesson('detail-p-f-major-fourth-thumb-connected-right-01'),reverse=game.registry.lesson('detail-p-f-major-thumb-fourth-prep-right-01');await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 assert.equal((await take(game,a,forward,{now:10000})).result.xp.earned,100);assert.equal((await game.state(a)).progress.some(p=>p.lessonId===reverse.id),false);assert.notEqual(forward.musicVersion,reverse.musicVersion);assert.notEqual(forward.goalKey,reverse.goalKey);
 const input=startInput(reverse),started=await game.start(a,input,50000),bad={nonce:input.nonce,...performance(forward)};const failed=await game.submit(a,started.id,bad,80000);assert.equal(failed.passed,false);assert.equal(failed.xp.earned,0);
 assert.equal((await take(game,a,reverse,{now:100000})).result.xp.earned,100);assert.equal((await take(game,a,reverse,{now:130000})).result.xp.earned,0);const state=await game.state(a);assert.equal(state.experience.musicXp,200);assert.equal(state.experience.portal.level,null);assert.equal((await game.state(b)).progress.some(p=>p.lessonId===reverse.id),false);
});

test('connected reverse F-major task rejects paused credit and grants its own bounded XP without new portal level',async t=>{
 const {game,a,b}=await setup(t),paused=game.registry.lesson('detail-p-f-major-thumb-fourth-prep-right-01'),connected=game.registry.lesson('detail-p-f-major-thumb-fourth-connected-right-01');await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 assert.equal((await take(game,a,paused,{now:10000})).result.xp.earned,100);assert.equal((await game.state(a)).progress.some(p=>p.lessonId===connected.id),false);assert.notEqual(paused.musicVersion,connected.musicVersion);assert.notEqual(paused.goalKey,connected.goalKey);
 const input=startInput(connected),started=await game.start(a,input,50000),bad={nonce:input.nonce,...performance(paused)};const failed=await game.submit(a,started.id,bad,80000);assert.equal(failed.passed,false);assert.equal(failed.xp.earned,0);
 assert.equal((await take(game,a,connected,{now:100000})).result.xp.earned,100);assert.equal((await take(game,a,connected,{now:130000})).result.xp.earned,0);const state=await game.state(a);assert.equal(state.experience.musicXp,200);assert.equal(state.experience.portal.level,null);assert.equal((await game.state(b)).progress.some(p=>p.lessonId===connected.id),false);
});

test('F-major descent checkpoint rejects preparation credit and keeps separate bounded XP and owner isolation',async t=>{
 const {game,a,b}=await setup(t),prep=game.registry.lesson('detail-p-f-major-thumb-fourth-connected-right-01'),control=game.registry.lesson('detail-p-f-major-descent-checkpoint-right-01');await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 assert.equal((await take(game,a,prep,{now:10000})).result.xp.earned,100);assert.equal((await game.state(a)).progress.some(p=>p.lessonId===control.id),false);assert.notEqual(prep.musicVersion,control.musicVersion);assert.equal(control.goalKey,control.id);
 const input=startInput(control),started=await game.start(a,input,50000),bad={nonce:input.nonce,...performance(prep)};const failed=await game.submit(a,started.id,bad,80000);assert.equal(failed.passed,false);assert.equal(failed.xp.earned,0);
 assert.equal((await take(game,a,control,{now:100000})).result.xp.earned,100);assert.equal((await take(game,a,control,{now:130000})).result.xp.earned,0);const state=await game.state(a);assert.equal(state.experience.musicXp,200);assert.equal(state.experience.portal.level,null);assert.equal((await game.state(b)).progress.some(p=>p.lessonId===control.id),false);
});

test('F-major left ascent keeps own preparations,right progress and repeated XP separate',async t=>{
 const {game,a,b}=await setup(t),prep=game.registry.lesson('detail-p-black-position-left-01'),control=game.registry.lesson('detail-p-f-major-ascent-checkpoint-left-01'),right=game.registry.lesson('detail-p-f-major-ascent-checkpoint-right-01');await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 assert.deepEqual(control.requires,['detail-p-black-position-left-01','detail-p-scale-04']);assert.equal((await take(game,a,prep,{now:10000})).result.xp.earned,100);assert.equal((await game.state(a)).progress.some(p=>p.lessonId===control.id),false);assert.notEqual(prep.musicVersion,control.musicVersion);assert.equal(control.goalKey,control.id);
 const input=startInput(control),started=await game.start(a,input,50000),failed=await game.submit(a,started.id,{nonce:input.nonce,...performance(right)},80000);assert.equal(failed.passed,false);assert.equal(failed.xp.earned,0);
 assert.equal((await take(game,a,control,{now:100000})).result.xp.earned,100);assert.equal((await take(game,a,control,{now:130000})).result.xp.earned,0);const state=await game.state(a);assert.equal(state.experience.musicXp,200);assert.equal(state.experience.portal.level,null);assert.equal(state.progress.some(p=>p.lessonId===right.id),false);assert.equal((await game.state(b)).progress.some(p=>p.lessonId===control.id),false);
});

test('F-major left descent keeps own preparations,right progress and repeated XP separate',async t=>{
 const {game,a,b}=await setup(t),prep=game.registry.lesson('detail-p-black-position-left-01'),control=game.registry.lesson('detail-p-f-major-descent-checkpoint-left-01'),right=game.registry.lesson('detail-p-f-major-ascent-checkpoint-left-01');await game.savePreferences(a,{courseMode:'free',ratingSystem:'ten',expectedRevision:0,operationId:randomUUID()},1000);
 assert.deepEqual(control.requires,['detail-p-black-position-left-01','detail-p-scale-04']);assert.equal((await take(game,a,prep,{now:10000})).result.xp.earned,100);assert.equal((await game.state(a)).progress.some(p=>p.lessonId===control.id),false);assert.notEqual(prep.musicVersion,control.musicVersion);assert.equal(control.goalKey,control.id);
 const input=startInput(control),started=await game.start(a,input,50000),failed=await game.submit(a,started.id,{nonce:input.nonce,...performance(right)},80000);assert.equal(failed.passed,false);assert.equal(failed.xp.earned,0);
 assert.equal((await take(game,a,control,{now:100000})).result.xp.earned,100);assert.equal((await take(game,a,control,{now:130000})).result.xp.earned,0);const state=await game.state(a);assert.equal(state.experience.musicXp,200);assert.equal(state.experience.portal.level,null);assert.equal(state.progress.some(p=>p.lessonId===right.id),false);assert.equal((await game.state(b)).progress.some(p=>p.lessonId===control.id),false);
});

test('default sequential route rejects skips, awards authoritative XP once and opens the next step',async t=>{
  const {game,a,b}=await setup(t),first=registry.lesson(registry.course.route[0]),second=registry.lesson(registry.course.route[1]);
  assert.deepEqual(await game.preferences(a),{courseMode:'sequential',ratingSystem:'ten',revision:0});
  await assert.rejects(()=>game.start(a,startInput(second),1000),{code:'LESSON_LOCKED'});
  const {started,data,result}=await take(game,a,first);assert.equal(result.passed,true);assert.equal(result.xp.earned,100);assert.equal(result.nextLessonId,second.id);
  assert.deepEqual(await game.submit(a,started.id,data,50000),result);assert.equal((await game.state(a)).experience.musicXp,100);assert.equal((await game.state(b)).completed,0);
  await assert.rejects(()=>game.attempt(b,started.id),{status:404});await assert.rejects(()=>game.submit(b,started.id,data,50000),{status:404});
  await assert.rejects(()=>game.submit(a,started.id,{...data,observationInterrupted:true},50000),{code:'ATTEMPT_SUBMITTED'});
  assert.equal((await game.state(a)).experience.portal.totalXp,null);
});
test('failed notes, tempo and client scores cannot grant progress or XP',async t=>{
  const {game,a}=await setup(t),row=registry.lesson(registry.course.route[0]),input=startInput(row),started=await game.start(a,input,1000),data={nonce:input.nonce,...performance(row)};data.events[0].midi++;
  const result=await game.submit(a,started.id,data,30000);assert.equal(result.passed,false);assert.equal(result.xp.earned,0);assert.equal((await game.state(a)).completed,0);
  await assert.rejects(()=>game.submit(a,started.id,{...data,xp:999},30000),{code:'FIELDS'});
  const keyboard=await take(game,a,row,{source:'keyboard',now:40000});assert.equal(keyboard.result.passed,false);assert.equal(keyboard.result.xp.earned,0);
});
test('attempt time, event order, nonce and exact lesson edition are checked',async t=>{
  const {game,a}=await setup(t),row=registry.lesson(registry.course.route[0]),input=startInput(row);
  await assert.rejects(()=>game.start(a,{...input,musicVersion:'0'.repeat(64)},1000),{code:'LESSON_CHANGED'});
  const started=await game.start(a,input,1000),data={nonce:input.nonce,...performance(row)};
  await assert.rejects(()=>game.submit(a,started.id,data,1001),{code:'ATTEMPT_TIME'});
  await assert.rejects(()=>game.submit(a,started.id,{...data,nonce:'wrong'},30000),{code:'ATTEMPT_KEY'});
  await assert.rejects(()=>game.submit(a,started.id,{...data,events:[...data.events].reverse()},30000),{code:'MIDI_EVENTS'});
  await assert.rejects(()=>game.submit(a,started.id,data,2000000),{code:'ATTEMPT_TIME'});
});
test('retries grant only quality improvement and never farm a shared goal',async t=>{
  const {game,a,store}=await setup(t),row=registry.lesson(registry.course.route[0]),first=await take(game,a,row,{jitter:80});assert(first.result.xp.earned>0&&first.result.xp.earned<100);
  const second=await take(game,a,row,{now:30000});assert.equal(first.result.xp.earned+second.result.xp.earned,100);
  const third=await take(game,a,row,{now:60000,mode:'memory'});assert.equal(third.result.xp.earned,0);assert.equal((await game.state(a)).progress[0].cleanAttempts,3);assert.equal((await game.state(a)).progress[0].memoryPassedAt,third.result.savedAt);
  const variant=registry.lesson(registry.course.route[1]);game.registry.byId.set(variant.id,{...variant,goalKey:row.goalKey});assert.equal((await take(game,a,game.registry.lesson(variant.id),{now:90000})).result.xp.earned,0);
  assert.equal((await store.statement('SELECT count(*) AS n FROM portal_experience_outbox WHERE owner_id=?').get(a)).n,1);
});
test('free mode is a saved explicit choice with CAS; start operation replays exactly',async t=>{
  const {game,a}=await setup(t),input={courseMode:'free',ratingSystem:'hundred',expectedRevision:0,operationId:randomUUID()};const prefs=await game.savePreferences(a,input,1000);assert.equal(prefs.revision,1);assert.deepEqual(await game.savePreferences(a,input,2000),prefs);
  await assert.rejects(()=>game.savePreferences(a,{...input,courseMode:'sequential'},2000),{code:'OPERATION_CONFLICT'});
  await assert.rejects(()=>game.savePreferences(a,{...input,operationId:randomUUID()},2000),{code:'REVISION_CONFLICT'});
  const row=registry.lesson(registry.course.route[2]),start=startInput(row),one=await game.start(a,start,3000);assert.deepEqual(await game.start(a,start,3001),one);
});
test('immutable attempt edition remains available after a changed live registry',async t=>{
  const {game,a}=await setup(t),row=registry.lesson(registry.course.route[0]),input=startInput(row),started=await game.start(a,input,1000),data={nonce:input.nonce,...performance(row)};
  game.registry.byId.set(row.id,{...row,musicVersion:'f'.repeat(64)});
  const result=await game.submit(a,started.id,data,30000);assert.equal(result.passed,true);assert.equal(result.musicVersion,row.musicVersion);assert.equal((await game.state(a)).completed,0);assert.equal((await game.history(a)).items[0].musicVersion,row.musicVersion);
});
test('zero rating is real, exact scales survive changes, aggregate is fractional ten and removal is separate',async t=>{
  const {game,a,b}=await setup(t),row=registry.lesson(registry.course.route[0]);
  const save=(owner,system,value,revision)=>game.saveRating(owner,row.id,{editionVersion:row.editionVersion,system,value,expectedRevision:revision,operationId:randomUUID()},1000+revision);
  assert.equal((await save(a,'ten',0,0)).average.decimalTen,0);assert.equal((await save(b,'five',5,0)).average.decimalTen,4.75);
  await game.savePreferences(a,{courseMode:'sequential',ratingSystem:'hundred',expectedRevision:0,operationId:randomUUID()},3000);assert.equal((await game.rating(a,row.id)).rating.value,0);
  assert.equal((await save(a,'ten',null,1)).average.decimalTen,9.5);assert.equal((await game.rating(a,row.id)).rating,null);
  await assert.rejects(()=>save(a,'ten',11,2),{code:'RATING'});await assert.rejects(()=>save(a,'ten',true,2),{code:'RATING'});
  assert.equal((await save(b,'ten_decimal',null,1)).average,null);
});
test('concurrent lesson ratings require one winning revision and remain owner-scoped',async t=>{
  const {game,a,b}=await setup(t),row=registry.lesson(registry.course.route[0]),input={editionVersion:row.editionVersion,system:'ten',value:8,expectedRevision:0,operationId:randomUUID()};
  const result=await Promise.allSettled([game.saveRating(a,row.id,input,1000),game.saveRating(a,row.id,{...input,value:9,operationId:randomUUID()},1000)]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.find(x=>x.status==='rejected').reason.code,'REVISION_CONFLICT');assert.equal((await game.rating(b,row.id)).rating,null);
});
test('public comments are plain text, idempotent, own-editable, versioned and soft-deleted',async t=>{
  const {game,a,b,store}=await setup(t),input={scope:'global',lessonId:'',parentId:null,body:'<script>plain text</script>',operationId:randomUUID()},created=await game.createComment(a,input,1000);assert.equal(created.body,input.body);assert.deepEqual(await game.createComment(a,input,2000),created);
  const publicItems=await game.comments('global','',null,b);assert.equal(publicItems.items[0].mine,false);assert.equal('ownerId'in publicItems.items[0],false);
  const edit={body:'Changed once',deleted:false,expectedRevision:1,operationId:randomUUID()};await assert.rejects(()=>game.updateComment(b,created.id,edit,2000),{status:404});assert.equal((await game.updateComment(a,created.id,edit,2000)).revision,2);
  await assert.rejects(()=>game.updateComment(a,created.id,{...edit,operationId:randomUUID()},3000),{code:'REVISION_CONFLICT'});
  await game.updateComment(a,created.id,{body:'',deleted:true,expectedRevision:2,operationId:randomUUID()},4000);assert.equal((await game.comments('global','',null,a)).items[0].deleted,true);assert.equal((await store.statement('SELECT count(*) AS n FROM discussion_comment_revisions WHERE comment_id=?').get(created.id)).n,3);
  assert.equal((await game.state(a)).experience.musicXp,0);
});
test('lesson replies cannot cross scopes and stable cursors preserve equal-timestamp comments',async t=>{
  const {game,a}=await setup(t),row=registry.lesson(registry.course.route[0]),global=await game.createComment(a,{scope:'global',lessonId:'',parentId:null,body:'Global',operationId:randomUUID()},1000);
  await assert.rejects(()=>game.createComment(a,{scope:'lesson',lessonId:row.id,parentId:global.id,body:'Wrong scope',operationId:randomUUID()},1000),{code:'COMMENT_PARENT'});
  for(let i=0;i<21;i++)await game.createComment(a,{scope:'lesson',lessonId:row.id,parentId:null,body:'Comment '+i,operationId:randomUUID()},1000);
  const first=await game.comments('lesson',row.id,null,a),next=await game.comments('lesson',row.id,first.nextCursor,a);assert.equal(first.items.length,20);assert.equal(next.items.length,1);assert.equal(new Set([...first.items,...next.items].map(x=>x.id)).size,21);
});
module.exports={performance,startInput};
