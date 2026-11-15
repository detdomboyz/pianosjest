'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs'),before=require('./fixtures/piano-before-eighth-rest-ring-little-right-v1.json'),counts=require('./fixtures/piano-curriculum-counts.json');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const id='detail-p-eighth-rest-ring-little-right-01',notes=[65,65,64,62,60,59,60,59],digits=[4,5,4,3,2,1,2,1],starts=[0,1.5,2,3,4,5,6,7],durations=[1,.5,1,1,1,1,1,1],requires=['detail-p-eighth-rest-repeat-right-01','detail-p-right-upper-position-01','detail-p-right-lower-b-position-01'],app=loadApp();
const lesson=()=>{const l=app.lessons.find(l=>l.id===id);assert.ok(l,'Missing released-key right4to5 preparation');return l;};
function events(mode='clean'){
 const beat=60000/48,out=[];
 for(let i=0;i<notes.length;i++){
  let midi=notes[i],start=starts[i],end=start+durations[i];
  if(mode==='old-c-thumb'&&(i===5||i===7))midi=60;
  if(mode==='b-flat'&&midi===59)midi=58;
  if(mode==='wrong-register'&&i===1)midi=77;
  if(mode==='f-sharp'&&i<2)midi=66;
  if(mode==='hold-through-rest'&&i===0)end=1.5;
  if(mode==='no-second-attack'&&i===0)end=2;
  if(mode==='no-second-attack'&&i===1)continue;
  if(mode==='early-repeat'&&i===1){start=1;end=2;}
  if(mode==='late-repeat'&&i===1){start=1.8;end=2.3;}
  if(mode==='short-final'&&i===7)end=start+.1;
  if(mode==='missing-final'&&i===7)continue;
  if(mode==='short-first'&&i===0)end=.2;
  const source=mode==='keyboard'?'keyboard':'midi';out.push({type:'on',midi,source,at:1000+start*beat},{type:'off',midi,source,at:1000+end*beat});
 }
 if(mode==='note-in-rest')out.push({type:'on',midi:65,source:'midi',at:1000+1.15*beat},{type:'off',midi:65,source:'midi',at:1000+1.35*beat});
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),events:es,bpm:48,targetBpm:48,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}
test('released right4to5 adds one goal while retaining613 full records,old themes,order,grades and routes',()=>{
 lesson();assert.equal(app.lessons.length,counts.catalogRecords);const old=new Set(before.catalog.map(x=>x.id)),cohort=app.lessons.filter(x=>old.has(x.id)||x.id===id);assert.equal(cohort.length,614);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),[id]);assert.deepEqual(copy(cohort.filter(x=>old.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
 assertPreservedThemes(app.themes,before.themes);assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});
test('same F4 changes explicit right4to5 after half-beat silence,then lower B3 belongs to thumb1',()=>{
 const l=lesson();assert.equal(app.challengeEligible(l),true);assert.equal(l.handMode,'right');assert.deepEqual(copy(l.steps.map(app.stepMidiList)),notes.map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps),digits.map(num=>[{hand:'right',num}]));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.durationBeats)),durations);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),[0,.5,0,0,0,0,0,0]);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.measure)),[1,1,1,1,2,2,2,2]);assert.equal(l.rhythm.practiceBpm,48);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,8);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.goalCounting,undefined);
});
test('actual client and server graders reject held substitution,wrong entry,pause filling and the old C ending',()=>{
 const l=lesson(),row=require('../service/course-registry.json').lessons.find(v=>v.id===id);assert.ok(row);
 for(const mode of ['clean','old-c-thumb','b-flat','wrong-register','f-sharp','hold-through-rest','no-second-attack','early-repeat','late-repeat','short-final','missing-final','short-first','note-in-rest','keyboard']){const es=events(mode),end=es.at(-1).at;if(mode!=='clean')assert.notDeepEqual(es,events(),mode);assert.equal(assess(l,es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);}
});
test('real MIDI handlers wait for final B3 release and never grant lower-position or other repeat credit',async()=>{
 lesson();for(const mode of ['clean','hold-through-rest','old-c-thumb']){const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(v=>v.id===id));a.state.attemptMode='challenge';const es=events(mode);
  for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false);if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}
  assert.equal(a.state.passed,mode==='clean');assert.equal(a.state.learningProgress[id]?.cleanTakes??0,mode==='clean'?1:0);if(mode==='clean')assert.equal(a.state.learningProgress[id].fingerprint,A.pianoSignature(a.state.lesson));for(const other of [...requires,'detail-p-eighth-rest-ring-middle-right-01'])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);await a.legacyProgressStore.settled();a.resetLessonState();
 }
});
test('right4to5 has earlier positions,source-backed explanation,held contrast and open transfer without hints in memory',()=>{
 const l=lesson(),c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),sources=require('../docs/piano-curriculum-sources.json');assert.deepEqual(copy(l.learning.requires),requires);for(const x of requires)assert.ok(route.indexOf(x)>=0&&route.indexOf(x)<route.indexOf(id));assert.equal(l.learning.after,'detail-p-right-lower-b-position-01');assert.equal(l.learning.coverageDomain,'fingers');assert.equal(l.learning.stage,'p3');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.sourceEvidenceIds.length,4);for(const x of l.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===x)?.applications.some(a=>a.batch==='2026-11-12-07'&&a.freshReadInCurrentBatch&&a.lessonIds.includes(id)),x);
 app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['4→5','полдоли тишины','B3 под большим 1','не тихая подмена','не новый урок','на следующий день','MIDI не видит','не является независимым тестом слуха'])assert.ok(html.includes(text),text);for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
});
test('sound sample keeps the repeated eighth and full final quarters at slow and target tempos',()=>{
 const l=lesson();app.state.lesson=l;for(const bpm of [32,40,48])for(let i=0;i<8;i++)assert.ok(Math.abs(app.previewSoundDurationMs(l,i,bpm,durations[i]*60000/bpm)-durations[i]*60000/bpm)<1e-6);
});
test('catalogue reinstall and exchange preserve personal notes,guide and classification for new repeat',async()=>{
 lesson();const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),l=a.lessons.find(l=>l.id===id);l.contentKind='piece';l.guide.setup='personal-ring-little';l.learning.practiceSteps[0]='personal-practice';l.pattern=l.pattern.replace(/^\S+/,'9');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(l=>l.id===id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const now=a.lessons.find(l=>l.id===id);assert.equal(now.contentKind,'piece');assert.equal(now.guide.setup,'personal-ring-little');assert.deepEqual(copy(now.steps),saved.steps);assert.equal(a.lessons.filter(l=>l.id===id).length,1);
});
test('canonical course retains465 full editions and adds one goal without changing schema or aliases',()=>{
 const l=lesson(),course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,counts.implementedLearningLessons);for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);const row=course.lessons.find(l=>l.id===id);assert.equal(row.goalKey,id);assert.equal(row.gradeFingerprint,A.pianoSignature(l));assert.deepEqual(row.requires,requires);
 const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build();for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(report.counts.goalGroupUpperBound-coverage.goalAccounting(report.lessons.filter(x=>x.id!==id)).goalGroupUpperBound,1);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});
