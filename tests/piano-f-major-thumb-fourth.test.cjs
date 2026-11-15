'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs'),before=require('./fixtures/piano-before-f-major-thumb-fourth-v1.json'),counts=require('./fixtures/piano-curriculum-counts.json');
const a=loadApp(),id='detail-p-f-major-thumb-fourth-prep-right-01',l=a.lessons.find(x=>x.id===id),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const notes=[74,72,70,69,74,72,70,69],fingers=[2,1,4,3,2,1,4,3],starts=[0,1,3,4,7,8,10,11],rests=[0,0,1,0,2,0,1,0];
function take(mode='clean'){
 const beat=60000/44,out=[];
 l.rhythm.steps.forEach((s,i)=>{let midi=notes[i],start=s.startBeat,duration=1;
  if(mode==='b-natural'&&[2,6].includes(i))midi++;
  if(mode==='wrong-octave'&&i===2)midi-=12;
  if(mode==='forward')midi=[69,70,72,74][i%4];
  if(mode==='no-pause')start=i;
  if(mode==='held-pause'&&[1,5].includes(i))duration=2;
  if(mode==='missing-return-rest'&&i>=4)start-=2;
  if(mode==='short-final'&&i===7)duration=.1;
  if(mode==='detached-pair'&&[0,2,4,6].includes(i))duration=.2;
  const source=mode==='keyboard'?'keyboard':'midi';out.push({type:'on',source,midi,at:1000+start*beat},{type:'off',source,midi,at:1000+(start+duration)*beat});
 });return out.sort((x,y)=>x.at-y.at||(x.type==='off'?-1:1));
}
test('reverse fourth preparation preserves all593 old complete records,old route order and frozen guitar/baseline',()=>{
 assert.ok(l);assert.equal(a.lessons.length,counts.catalogRecords);const ids=new Set(before.catalog.map(x=>x.id));assert.deepEqual(copy(a.lessons.filter(x=>x.id===id&&!ids.has(x.id)).map(x=>x.id)),[id]);assert.deepEqual(copy(a.lessons.filter(x=>ids.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const old of before.catalog){const now=a.lessons.find(x=>x.id===old.id);assert.equal(hash(now),old.fullRecordSha256,old.id);assert.equal(A.pianoSignature(now),old.grade,old.id);assert.equal(now.order,old.order);assert.equal(now.themeId,old.themeId);}
 assert.equal(a.themes.length,counts.themes);assert.deepEqual(copy(a.themes.filter(x=>before.themes.some(y=>y.id===x.id))),before.themes);assert.equal(crypto.createHash('sha256').update(fs.readFileSync('lesson-review-baseline.js')).digest('hex'),before.protectedBaselineSha256);
 const p={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),p);assert.equal(hash(p.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(p.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id).filter(x=>before.pianoRoute.includes(x))),before.pianoRoute);
});
test('independent expected D-C-Bflat-A RH2-1-4-3 uses quarters,full silent crossing and two-beat reset',()=>{
 assert.deepEqual(copy(l.steps.map(a.stepMidiList)),notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s.map(n=>[n.hand,n.num]))),fingers.map(n=>[['right',n]]));assert.equal(l.handMode,'right');assert.equal(l.rhythm.practiceBpm,44);assert.equal(l.learning.articulation,'legato');assert.deepEqual(copy(l.rhythm.steps.map(s=>[s.startBeat,s.durationBeats,s.restBeforeBeats])),starts.map((s,i)=>[s,1,rests[i]]));assert.equal(starts.at(-1)+1,12);assert.equal(a.challengeEligible(l),true);
});
test('actual assessment rejects forward pitches,B-natural,octave,missing/held pauses,short final and keyboard',()=>{
 const plan={steps:l.rhythm.steps.map((s,i)=>({...s,midis:[notes[i]]})),bpm:44,targetBpm:44,profile:'legato'};assert.equal(A.assessPiano({...plan,events:take()}).clean,true);
 for(const mode of ['forward','b-natural','wrong-octave','no-pause','held-pause','missing-return-rest','short-final','detached-pair','keyboard'])assert.equal(A.assessPiano({...plan,events:take(mode)}).clean,false,mode);
});
test('real MIDI handlers wait for final A release and keep preparation progress separate',async()=>{
 const clock={now:5000},app=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});app.setTestLesson(app.lessons.find(x=>x.id===id));app.state.attemptMode='challenge';const events=take();
 for(const[i,e]of events.entries()){clock.now=5000+e.at-1000;if(e.type==='on')app.handleNoteOn(e.midi,'midi');else{if(i===events.length-1)assert.equal(app.state.completed,false);app.handleNoteOff(e.midi);}}
 assert.equal(app.state.passed,true);assert.equal(app.state.learningProgress[id].fingerprint,A.pianoSignature(l));for(const old of l.learning.requires)assert.equal(Object.hasOwn(app.state.learningProgress,old),false);await app.legacyProgressStore.settled();app.resetLessonState();
});
test('existing own-hand forward crossing and reverse-third precede new preparation without requiring full ascent',()=>{
 assert.deepEqual(copy(l.learning.requires),['detail-p-f-major-fourth-thumb-connected-right-01','detail-p-cross-02']);assert.equal(l.learning.after,before.forwardPreparation.id);assert.equal(l.learning.stage,'p3');assert.equal(l.learning.coverageDomain,'crossings');const p={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),p);const route=p.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),seen=new Set(),walk=pid=>{if(seen.has(pid))return;seen.add(pid);const x=a.lessons.find(x=>x.id===pid);assert.ok(x,pid);assert.notEqual(x.contentKind,'piece');assert.ok(before.catalog.some(y=>y.id===pid));for(const r of x.learning?.requires||[])walk(r);};
 for(const pid of l.learning.requires){assert.ok(route.indexOf(pid)<route.indexOf(id));assert.equal(a.lessons.find(x=>x.id===pid).handMode,'right');walk(pid);}assert.equal(seen.has('detail-p-f-major-ascent-checkpoint-right-01'),false);assert.equal(route.filter(x=>x===id).length,1);
});
test('accepted duplicate scan uses num and distinguishes upward static1-4 from the missing reverse motion',()=>{
 assert.deepEqual(copy(before.forwardPreparation.fingeringSpec.steps.map(s=>s[0].num)),[3,4,1,2,3,4,1,2]);let forwardStatic=0,reverse=0;
 for(const x of a.lessons.filter(x=>before.catalog.some(y=>y.id===x.id))){const st=x.steps.map(a.stepMidiList),f=x.fingeringSpec?.steps;for(let i=0;i+1<st.length;i++){if(st[i].length!==1||st[i+1].length!==1||f?.[i]?.length!==1||f?.[i+1]?.length!==1)continue;const left=f[i][0],right=f[i+1][0];if(left.hand==='right'&&right.hand==='right'&&left.num===1&&right.num===4){if(st[i+1][0]<st[i][0])reverse++;else forwardStatic++;}}}
 assert.equal(reverse,0);assert.ok(forwardStatic>0);assert.notDeepEqual(copy(before.reverseThirdPreparation.fingeringSpec.steps.map(s=>s[0].num)),fingers);
});
test('dated source applications and card distinguish released preparation,known sound,memory and later connected descent',()=>{
 const ledger=require('../docs/piano-curriculum-sources.json');assert.equal(l.learning.practiceSteps.length,5);assert.equal(l.learning.selfCheck.length,5);
 for(const source of l.learning.sourceEvidenceIds)assert.ok(ledger.entries.find(e=>e.id===source)?.applications.some(x=>x.batch==='2026-11-09-10'&&x.verifiedOn==='2026-11-09'&&x.lessonIds.includes(id)&&x.recheckedInThisBatch),source);
 a.state.lesson=l;a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();for(const text of ['John Wiles','44 BPM','12 долей','полностью отпусти','тихую долю','Открытая проба','на следующий день','не является независимым тестом слуха','Связный обратный 1→4'])assert.ok(html.includes(text),text);assert.equal(l.learning.provenance.type,'project-technical-drill');
 for(const mode of ['compact','expanded','hidden']){a.state.attemptMode='memory';a.state.learningMaterialMode=mode;assert.equal(a.learningMaterialHtml(),'');}
});
test('actual audio preview releases C for its silent beat and A for the reset at every supported practice tempo',()=>{
 a.state.lesson=l;const spans=copy(a.playbackDurations());assert.deepEqual(spans,[1,2,1,3,1,2,1,1]);assert.equal(spans.reduce((x,y)=>x+y,0),12);
 for(const bpm of [36,44,60])for(const i of notes.keys())assert.ok(Math.abs(a.previewSoundDurationMs(l,i,bpm,spans[i]*60000/bpm)-60000/bpm)<1e-6);
});
test('personal score,instructions,kind and order survive reinstall/export/import of the new built-in',async()=>{
 const app=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),x=app.lessons.find(x=>x.id===id);x.title+=' personal';x.contentKind='piece';x.order=1;x.guide.setup='personal';x.learning.practiceSteps[0]='personal';x.pattern=x.pattern.replace(/^\S+/,'y');x.steps=app.parsePattern(x.pattern).steps;const old=copy(x);app.installReviewedLessons();assert.deepEqual(copy(app.lessons.find(x=>x.id===id)),old);assert.equal(await app.importCatalogText(app.catalogExportText(),()=>true),true);const after=app.lessons.find(x=>x.id===id);assert.equal(after.contentKind,'piece');assert.equal(after.order,1);assert.equal(after.guide.setup,'personal');assert.equal(after.learning.practiceSteps[0],'personal');assert.deepEqual(copy(after.steps),old.steps);assert.equal(app.lessons.filter(x=>x.id===id).length,1);
});
test('canonical server preserves all445 editions/schema and real grader enforces this reverse task',()=>{
 const c=require('../service/course-registry.json');assert.deepEqual(c,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(c.counts.learning,counts.implementedLearningLessons);assert.equal(c.counts.graded,counts.checkedMidiRouteLessons);
 for(const old of before.server.lessons)assert.equal(hash(c.lessons.find(x=>x.id===old.id)),old.fullRecordSha256,old.id);assert.deepEqual(c.route.filter(x=>before.server.route.includes(x)),before.server.route);assert.equal(crypto.createHash('sha256').update(fs.readFileSync('service/schema.pg.sql')).digest('hex'),before.server.schemaSha256);const row=c.lessons.find(x=>x.id===id);assert.equal(row.gradeFingerprint,A.pianoSignature(l));assert.equal(row.goalKey,id);
 for(const mode of ['clean','forward','held-pause','no-pause','b-natural']){const e=take(mode),end=e.at(-1).at,result=G.grade(row,G.eventsInput(e,end),'challenge',end,false);assert.equal(result.assessment.clean,mode==='clean',mode);}
 const tool=require('../tools/piano-skill-coverage.cjs'),all=tool.build();assert.equal(l.learning.goalCounting,undefined);assert.equal(l.learning.sameGoalAs,undefined);assert.equal(tool.goalAccounting(all.lessons.filter(x=>x.id===id||before.catalog.some(y=>y.id===x.id))).explicitCheckpoints,10);assert.equal(all.counts.explicitSameGoalVariants,require('./fixtures/piano-curriculum-counts.json').explicitSameGoalVariants);assert.equal(tool.goalAccounting(all.lessons.filter(x=>before.catalog.some(old=>old.id===x.id))).explicitSameGoalVariants,10);assert.equal(all.counts.independentTeacherReviewed,0);assert.equal(all.counts.verifiedDistinctGoalCount,null);for(const k of Object.keys(all.counts))assert.equal(all.counts[k],counts[k],k);
 const old=all.lessons.filter(x=>before.catalog.some(y=>y.id===x.id)),cohort=all.lessons.filter(x=>x.id===id||before.catalog.some(y=>y.id===x.id));assert.equal(tool.goalAccounting(old).goalGroupUpperBound+1,tool.goalAccounting(cohort).goalGroupUpperBound);
});
