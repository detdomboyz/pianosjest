'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-left-offbeat-v1.json'),id='detail-p-eighth-rest-offbeat-left-01';
const notes=[48,50,52,50,48,50,52,50],digits=[5,4,3,4,5,4,3,4],starts=[0,1,2.5,3,4,5,6.5,7],durations=[1,1,.5,1,1,1,.5,1];
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const app=loadApp(),lesson=app.lessons.find(x=>x.id===id);
function events(mode='clean'){
  const oldStarts=[0,1.5,2,3,4,5.5,6,7],oldDurations=[1,.5,1,1,1,.5,1,1];
  return notes.flatMap((midi,i)=>{
    let start=starts[i],end=start+durations[i];
    if(mode==='previous-right-rhythm'){start=oldStarts[i];end=start+oldDurations[i];}
    if(mode==='filled-rest'&&(i===1||i===5))end+=.5;
    if(mode==='early-entry'&&(i===2||i===6)){start-=.5;end-=.5;}
    if(mode==='late-entry'&&(i===2||i===6)){start+=.5;end+=.5;}
    if(mode==='missing-note'&&i===2)return [];
    if(mode==='short-final'&&i===7)end=start+.1;
    if(mode==='wrong-pitch'&&i===2)midi++;
    const source=mode==='keyboard'?'keyboard':'midi';
    return [{type:'on',midi,source,at:1000+start*1250},{type:'off',midi,source,at:1000+end*1250}];
  }).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(es){return A.assessPiano({steps:lesson.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(lesson.steps[i])})),events:es,bpm:48,targetBpm:48,profile:lesson.learning.articulation,timingPrecision:lesson.learning.timingPrecision});}

test('one left-hand lesson preserves all600 complete records,grades,order,themes and old route',()=>{
  assert.ok(lesson);assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);
  const old=new Set(before.catalog.map(x=>x.id)),cohort=app.lessons.filter(x=>old.has(x.id)||x.id===id);assert.equal(cohort.length,601);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),[id]);
  for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
  assertPreservedThemes(app.themes,before.themes);
  assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);
  const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});

test('left4 release and left3 offbeat have exact notes,fingers,third-beat rests and full ending',()=>{
  assert.equal(app.challengeEligible(lesson),true);assert.equal(lesson.handMode,'left');
  assert.deepEqual(copy(lesson.steps.map(app.stepMidiList)),notes.map(n=>[n]));assert.deepEqual(copy(lesson.fingeringSpec.steps.map(s=>s.map(n=>[n.hand,n.num]))),digits.map(n=>[['left',n]]));
  assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.startBeat)),starts);assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.durationBeats)),durations);assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,.5,0,0,0,.5,0]);assert.equal(lesson.rhythm.steps.at(-1).startBeat+lesson.rhythm.steps.at(-1).durationBeats,8);
  assert.equal(lesson.rhythm.practiceBpm,48);assert.deepEqual(copy(lesson.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(lesson.learning.articulation,'standard');assert.equal(lesson.learning.timingPrecision,'beat-boundary-v2');assert.equal(lesson.learning.sameGoalAs,undefined);assert.equal(lesson.learning.ending,undefined);
});

test('actual client and server require the new rest location and reject eight concrete mistakes',()=>{
  const row=require('../service/course-registry.json').lessons.find(x=>x.id===id);assert.ok(row);
  for(const mode of ['clean','filled-rest','early-entry','late-entry','missing-note','short-final','wrong-pitch','keyboard','previous-right-rhythm']){
    const es=events(mode),end=es.at(-1).at;assert.equal(assess(es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);
  }
});

test('actual MIDI handlers wait for the final release and do not award preparations or right lessons',async()=>{
  const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(x=>x.id===id));a.state.attemptMode='challenge';const es=events();
  for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false);if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}
  assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[id].fingerprint,A.pianoSignature(lesson));
  for(const other of [...lesson.learning.requires,'detail-p-eighth-rest-offbeat-right-01','detail-p-syncopation-hold-right-01'])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);
  await a.legacyProgressStore.settled();a.resetLessonState();
});

test('own preparations,sources,hand-specific goal and transfer limits render while memory DOM stays empty',()=>{
  const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id);
  assert.deepEqual(copy(lesson.learning.requires),['course03-02','detail-p-release-02','detail-p-rhythm-04','course04-05']);for(const req of lesson.learning.requires)assert.ok(route.indexOf(req)>=0&&route.indexOf(req)<route.indexOf(id),req);
  assert.equal(lesson.learning.stage,'p3');assert.equal(lesson.learning.coverageDomain,'rhythm');assert.equal(lesson.learning.provenance.type,'project-technical-drill');assert.ok(lesson.guide.blind.includes('Оба такта заканчиваются ре.'));assert.ok(!lesson.guide.blind.includes('конец до'));assert.equal(notes.at(-1),50);
  const sources=require('../docs/piano-curriculum-sources.json');for(const sourceId of lesson.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===sourceId)?.applications.some(a=>a.batch==='2026-11-11-02'&&a.freshReadInCurrentBatch&&a.lessonIds.includes(id)),sourceId);
  app.state.lesson=lesson;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();
  for(const text of ['5–4–3–4 / 5–4–3–4','три-и','2–2,5','6–6,5','8 долей','на следующий день','не является независимым тестом слуха','не новый урок','MIDI не видит'])assert.ok(html.includes(text),text);
  for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
});

test('audio preview keeps half-beat E3 and beat-length neighbours at three practice tempos',()=>{
  app.state.lesson=lesson;for(const bpm of [36,48,60])for(const[i,d]of durations.entries())assert.ok(Math.abs(app.previewSoundDurationMs(lesson,i,bpm,60000/bpm)-d*60000/bpm)<1e-6);
});

test('reinstall and catalogue exchange preserve a personal left-hand edition and classification',async()=>{
  const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),l=a.lessons.find(x=>x.id===id);l.contentKind='piece';l.guide.setup='personal-left';l.learning.practiceSteps[0]='personal-steps';l.pattern=l.pattern.replace(/^\S+/,'9');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);
  a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(x=>x.id===id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const now=a.lessons.find(x=>x.id===id);assert.equal(now.contentKind,'piece');assert.equal(now.guide.setup,'personal-left');assert.deepEqual(copy(now.steps),saved.steps);assert.equal(a.lessons.filter(x=>x.id===id).length,1);
});

test('canonical server preserves452 editions and independently keys one new goal without a schema change',()=>{
  const course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,require('./fixtures/piano-curriculum-counts.json').implementedLearningLessons);const cohortIds=new Set(before.server.lessons.map(x=>x.id));assert.equal(course.lessons.filter(x=>cohortIds.has(x.id)||x.id===id).length,453);
  for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);
  const row=course.lessons.find(x=>x.id===id);assert.equal(row.goalKey,id);assert.equal(row.gradeFingerprint,A.pianoSignature(lesson));assert.deepEqual(row.requires,copy(lesson.learning.requires));
  const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build(),counts=require('./fixtures/piano-curriculum-counts.json');for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(app.themes.length,counts.themes);assert.equal(report.counts.goalGroupUpperBound-coverage.goalAccounting(report.lessons.filter(x=>x.id!==id)).goalGroupUpperBound,1);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});
