'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-left-syncopation-v1.json'),id='detail-p-syncopation-hold-left-01',prep='detail-p-eighth-rest-offbeat-left-01';
const notes=[48,50,52,50,48,50,52,50],digits=[5,4,3,4,5,4,3,4],starts=[0,1,2.5,3.5,4,5,6.5,7.5],durations=[1,1,1,.5,1,1,1,.5];
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const app=loadApp(),lesson=app.lessons.find(x=>x.id===id);
function events(mode='clean'){
 const oldStarts=[0,1,2.5,3,4,5,6.5,7],oldDur=[1,1,.5,1,1,1,.5,1];
 return notes.flatMap((midi,i)=>{
  let start=starts[i],end=start+durations[i];
  if(mode==='previous-left-rhythm'){start=oldStarts[i];end=start+oldDur[i];}
  if(mode==='filled-rest'&&(i===1||i===5))end+=.5;
  if(mode==='early-entry'&&(i===2||i===6)){start-=.5;end-=.5;}
  if(mode==='early-release'&&(i===2||i===6))end-=.5;
  if(mode==='late-final-entry'&&(i===3||i===7))start+=.25;
  if(mode==='short-final'&&i===7)end=start+.1;
  if(mode==='missing-note'&&i===2)return[];
  if(mode==='wrong-pitch'&&i===2)midi++;
  const source=mode==='keyboard'?'keyboard':'midi',on=(m,t)=>({type:'on',midi:m,source,at:1000+t*1250}),off=(m,t)=>({type:'off',midi:m,source,at:1000+t*1250});
  if(mode==='reattack-on-four'&&(i===2||i===6))return[on(midi,start),off(midi,start+.5),on(midi,start+.5),off(midi,end)];
  return[on(midi,start),off(midi,end)];
 }).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),events:es,bpm:48,targetBpm:48,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}

test('one left syncopation keeps every601 old complete record,grade,theme,order and route',()=>{
 assert.ok(lesson);const old=new Set(before.catalog.map(x=>x.id)),cohort=app.lessons.filter(x=>old.has(x.id)||x.id===id);assert.equal(cohort.length,602);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),[id]);
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
 assertPreservedThemes(app.themes,before.themes);assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});

test('left middle3 holds through four and ring4 enters only on four-and with exact eight-beat ending',()=>{
 assert.equal(app.challengeEligible(lesson),true);assert.equal(lesson.handMode,'left');assert.deepEqual(copy(lesson.steps.map(app.stepMidiList)),notes.map(n=>[n]));assert.deepEqual(copy(lesson.fingeringSpec.steps.map(s=>s.map(n=>[n.hand,n.num]))),digits.map(n=>[['left',n]]));
 assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.startBeat)),starts);assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.durationBeats)),durations);assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,.5,0,0,0,.5,0]);assert.equal(lesson.rhythm.steps.at(-1).startBeat+lesson.rhythm.steps.at(-1).durationBeats,8);
 assert.equal(lesson.rhythm.practiceBpm,48);assert.deepEqual(copy(lesson.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(lesson.learning.articulation,'standard');assert.equal(lesson.learning.timingPrecision,'beat-boundary-v2');assert.equal(lesson.learning.sameGoalAs,undefined);assert.equal(lesson.learning.ending,undefined);
 for(const beat of [3,7])assert.equal(lesson.rhythm.steps.some(s=>s.startBeat===beat),false);
});

test('actual client/server reject reattack,early release and previous offbeat rhythm in both directions',()=>{
 const course=require('../service/course-registry.json'),row=course.lessons.find(x=>x.id===id),old=app.lessons.find(x=>x.id===prep),oldRow=course.lessons.find(x=>x.id===prep);assert.ok(row);
 for(const mode of ['clean','reattack-on-four','early-release','filled-rest','early-entry','late-final-entry','short-final','missing-note','wrong-pitch','keyboard','previous-left-rhythm']){
  const es=events(mode),end=es.at(-1).at;assert.equal(assess(lesson,es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);
 }
 for(const mode of ['clean','previous-left-rhythm']){const es=events(mode),end=es.at(-1).at;assert.equal(assess(old,es).clean,mode==='previous-left-rhythm','old client '+mode);assert.equal(G.grade(oldRow,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='previous-left-rhythm','old server '+mode);}
 assert.notEqual(A.pianoSignature(lesson),A.pianoSignature(old));
});

test('actual MIDI handlers retain E3 at the crossed pulse and wait for the final eighth release',async()=>{
 const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(x=>x.id===id));a.state.attemptMode='challenge';const es=events();
 for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false);if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);if(e.type==='on'&&e.midi===52){clock.now+=625;assert.equal(a.state.active.has(52),true);assert.equal(a.state.completed,false);}}
 assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[id].fingerprint,A.pianoSignature(lesson));for(const other of [...lesson.learning.requires,'detail-p-syncopation-hold-right-01'])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);await a.legacyProgressStore.settled();a.resetLessonState();
});

test('own prerequisites,counts,fingers,sources and transfer render without leaking memory hints',()=>{
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id);assert.deepEqual(copy(lesson.learning.requires),[prep,'detail-p-left-half-01']);for(const req of lesson.learning.requires)assert.ok(route.indexOf(req)>=0&&route.indexOf(req)<route.indexOf(id),req);
 assert.equal(lesson.learning.stage,'p3');assert.equal(lesson.learning.coverageDomain,'rhythm');assert.equal(lesson.learning.provenance.type,'project-technical-drill');assert.ok(lesson.guide.blind.includes('Оба такта заканчиваются ре.'));
 const sources=require('../docs/piano-curriculum-sources.json');for(const sourceId of lesson.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===sourceId)?.applications.some(a=>a.batch==='2026-11-11-03'&&a.freshReadInCurrentBatch&&a.lessonIds.includes(id)),sourceId);
 app.state.lesson=lesson;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['5–4–3–4 / 5–4–3–4','четыре-и','2–2,5','6–6,5','8 долей','на следующий день','не является независимым тестом слуха','не новый урок','MIDI не видит'])assert.ok(html.includes(text),text);
 for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
});

test('preview keeps held E3 a full pulse and final D3 half a pulse at three practice tempos',()=>{
 app.state.lesson=lesson;for(const bpm of [36,48,60])for(const[i,d]of durations.entries())assert.ok(Math.abs(app.previewSoundDurationMs(lesson,i,bpm,60000/bpm)-d*60000/bpm)<1e-6);
});

test('reinstall and catalogue exchange preserve a personal syncopation edition and classification',async()=>{
 const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),l=a.lessons.find(x=>x.id===id);l.contentKind='piece';l.guide.setup='personal-left-sync';l.learning.practiceSteps[0]='personal-sync-step';l.pattern=l.pattern.replace(/^\S+/,'9');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);
 a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(x=>x.id===id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const now=a.lessons.find(x=>x.id===id);assert.equal(now.contentKind,'piece');assert.equal(now.guide.setup,'personal-left-sync');assert.deepEqual(copy(now.steps),saved.steps);assert.equal(a.lessons.filter(x=>x.id===id).length,1);
});

test('server preserves453 old editions and schema2 and counts one project goal without inflating controls',()=>{
 const course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));const old=new Set(before.server.lessons.map(x=>x.id));assert.equal(course.lessons.filter(x=>old.has(x.id)||x.id===id).length,454);
 for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>old.has(x)),before.server.route);const row=course.lessons.find(x=>x.id===id);assert.equal(row.goalKey,id);assert.equal(row.gradeFingerprint,A.pianoSignature(lesson));assert.deepEqual(row.requires,copy(lesson.learning.requires));
 const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build(),counts=require('./fixtures/piano-curriculum-counts.json');for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(app.themes.length,counts.themes);const cohort=report.lessons.filter(x=>old.has(x.id)||x.id===id);assert.equal(coverage.goalAccounting(cohort).goalGroupUpperBound-coverage.goalAccounting(cohort.filter(x=>x.id!==id)).goalGroupUpperBound,1);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});

test('lesson contract mentions simultaneous chords only for a scored chord lesson',()=>{
 app.state.attemptMode='practice';app.state.lesson=lesson;
 const mono=app.learningContractHtml(true);assert.doesNotMatch(mono,/одновременные аккорды/);assert.match(mono,/48 BPM/);
 const chord=app.lessons.find(l=>app.challengeEligible(l)&&l.steps.some(s=>s.type==='chord'));assert.ok(chord);
 app.state.lesson=chord;assert.match(app.learningContractHtml(true),/одновременные аккорды/);
 app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');
});
