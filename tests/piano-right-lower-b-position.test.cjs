'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-right-lower-b-position-v1.json');
const currentCounts=require('./fixtures/piano-curriculum-counts.json');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const id='detail-p-right-lower-b-position-01',notes=[62,60,59,60,62,65,64,62,60,59],digits=[3,2,1,2,3,5,4,3,2,1],starts=[0,1,2,3,4,7,8,9,10,11],requires=['course02-04','detail-p-right-upper-position-01','detail-p-relocate-01'],app=loadApp();
const lesson=()=>{const l=app.lessons.find(l=>l.id===id);assert.ok(l,'Missing B3-F4 preparation');return l;};
function events(mode='clean'){
 const beat=60000/52,out=[];
 for(let i=0;i<notes.length;i++){
  let midi=notes[i],start=starts[i],end=start+1;
  if(mode==='b-flat'&&midi===59)midi=58;
  if(mode==='old-c-thumb'&&i===9)midi=60;
  if(mode==='f-sharp'&&i===5)midi=66;
  if(mode==='low-register'&&midi===59)midi=47;
  if(mode==='skip-rest'&&i>=5){start-=2;end-=2;}
  if(mode==='hold-through-rest'&&i===4)end=7;
  if(mode==='early-top'&&i===5){start=6;end=7;}
  if(mode==='short-final'&&i===9)end=start+.1;
  if(mode==='missing-top'&&i===5)continue;
  const source=mode==='keyboard'?'keyboard':'midi';
  out.push({type:'on',midi,source,at:1000+start*beat},{type:'off',midi,source,at:1000+end*beat});
 }
 if(mode==='note-in-rest')out.push({type:'on',midi:60,source:'midi',at:1000+5.5*beat},{type:'off',midi:60,source:'midi',at:1000+5.7*beat});
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),events:es,bpm:52,targetBpm:52,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}

test('lower right position adds one preparation while preserving612 complete records and their maintained order',()=>{
 lesson();assert.equal(app.lessons.length,currentCounts.catalogRecords);const old=new Set(before.catalog.map(x=>x.id));const cohort=app.lessons.filter(x=>old.has(x.id)||x.id===id);assert.equal(cohort.length,613);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),[id]);assert.deepEqual(copy(app.lessons.filter(x=>old.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
 assertPreservedThemes(app.themes,before.themes);assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});

test('B3 thumb,C4 index and F4 pinky are assigned to the right hand with two quiet beats and complete quarters',()=>{
 const l=lesson();assert.equal(app.challengeEligible(l),true);assert.equal(l.handMode,'right');assert.deepEqual(copy(l.steps.map(app.stepMidiList)),notes.map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps),digits.map(num=>[{hand:'right',num}]));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,0,0,0,2,0,0,0,0]);assert.equal(l.rhythm.practiceBpm,52);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,12);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.goalCounting,undefined);assert.equal(l.learning.ending,undefined);assert.equal(60-59,1);
});

test('actual client and canonical grader reject old C ending,black-key substitutions and filled or shortened silence',()=>{
 const l=lesson(),row=require('../service/course-registry.json').lessons.find(v=>v.id===id);assert.ok(row);
 for(const mode of ['clean','b-flat','old-c-thumb','f-sharp','low-register','skip-rest','hold-through-rest','early-top','short-final','missing-top','note-in-rest','keyboard']){const es=events(mode),end=es.at(-1).at;if(mode!=='clean')assert.notDeepEqual(es,events(),mode);assert.equal(assess(l,es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);}
});

test('real MIDI handlers require the last B3 release and cannot grant prerequisite or future ring-pinky credit',async()=>{
 lesson();
 for(const mode of ['clean','old-c-thumb','hold-through-rest']){const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(v=>v.id===id));a.state.attemptMode='challenge';const es=events(mode);
  for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false);if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}
  assert.equal(a.state.passed,mode==='clean');assert.equal(a.state.learningProgress[id]?.cleanTakes??0,mode==='clean'?1:0);if(mode==='clean')assert.equal(a.state.learningProgress[id].fingerprint,A.pianoSignature(a.state.lesson));
  for(const other of [...requires,'detail-p-eighth-rest-ring-middle-right-01','detail-p-eighth-rest-ring-little-right-01'])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);
  await a.legacyProgressStore.settled();a.resetLessonState();
 }
});

test('lower position has earlier preparations,source applications,small practice and manual transfer while memory has no hints',()=>{
 const l=lesson(),c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),sources=require('../docs/piano-curriculum-sources.json');assert.deepEqual(copy(l.learning.requires),requires);for(const x of requires)assert.ok(route.indexOf(x)>=0&&route.indexOf(x)<route.indexOf(id));assert.equal(l.learning.after,'detail-p-relocate-01');assert.equal(l.learning.coverageDomain,'positions');assert.equal(l.learning.stage,'p3');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.sourceEvidenceIds.length,4);
 for(const x of l.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===x)?.applications.some(a=>a.batch==='2026-11-12-06'&&a.freshReadInCurrentBatch&&a.lessonIds.includes(id)),x);
 app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['B3 под большим 1','C4 под указательным 2','не полная гамма','две доли тишины','не новый урок','на следующий день','MIDI не видит','не является независимым тестом слуха','4→5 после восьмой паузы'])assert.ok(html.includes(text),text);for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
});

test('audio preview keeps full quarter lengths at three practice tempos',()=>{
 const l=lesson();app.state.lesson=l;for(const bpm of [36,52,60])for(let i=0;i<10;i++)assert.ok(Math.abs(app.previewSoundDurationMs(l,i,bpm,60000/bpm)-60000/bpm)<1e-6);
});

test('catalogue reinstall and exchange retain personal lower-position notes,instructions and classification',async()=>{
 lesson();const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),l=a.lessons.find(l=>l.id===id);l.contentKind='piece';l.guide.setup='personal-lower-position';l.learning.practiceSteps[0]='personal-steps';l.pattern=l.pattern.replace(/^\S+/,'9');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(l=>l.id===id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const now=a.lessons.find(l=>l.id===id);assert.equal(now.contentKind,'piece');assert.equal(now.guide.setup,'personal-lower-position');assert.deepEqual(copy(now.steps),saved.steps);assert.equal(a.lessons.filter(l=>l.id===id).length,1);
});

test('canonical course preserves464 complete editions and adds only one independently keyed preparation without schema change',()=>{
 const l=lesson(),course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,currentCounts.implementedLearningLessons);for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);const row=course.lessons.find(l=>l.id===id);assert.equal(row.goalKey,id);assert.equal(row.gradeFingerprint,A.pianoSignature(l));assert.deepEqual(row.requires,requires);
 const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build(),counts=require('./fixtures/piano-curriculum-counts.json');for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(report.counts.goalGroupUpperBound-coverage.goalAccounting(report.lessons.filter(x=>x.id!==id)).goalGroupUpperBound,1);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});
