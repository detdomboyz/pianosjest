'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-dotted-quarter-eighth-rest-right-v1.json'),counts=require('./fixtures/piano-curriculum-counts.json');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const id='detail-p-dotted-quarter-eighth-rest-right-01',requires=['detail-p-dotted-quarter-01','detail-p-eighth-rest-offbeat-right-01','course02-02'],app=loadApp();
const notes=[[60],[62],[64],[60],[64],[62]],digits=[[1],[2],[3],[1],[3],[2]],starts=[0,2,3,4,6,7],durations=[1.5,1,1,1.5,1,1];
function lesson(){const l=app.lessons.find(x=>x.id===id);assert.ok(l,'Missing dotted-quarter eighth-rest preparation');return l;}
function events(mode='clean'){
 const out=[],beat=60000/48;
 for(let i=0;i<6;i++){
  let midi=notes[i][0],start=starts[i],end=start+durations[i];
  if(mode==='early-dot-off'&&(i===0||i===3))end=start+1;
  if(mode==='held-dot'&&(i===0||i===3))end=start+2.2;
  if(mode==='early-entry'&&(i===1||i===4))start-=.5;
  if(mode==='long-rest'&&(i===1||i===4))start+=.5;
  if(mode==='wrong-octave')midi+=12;
  if(mode==='wrong-pitch'&&i===1)midi=65;
  if(mode==='missing-note'&&i===4)continue;
  if(mode==='short-quarter'&&i===1)end=start+.1;
  if(mode==='short-final'&&i===5)end=start+.1;
  const source=mode==='keyboard'?'keyboard':'midi';out.push({type:'on',midi,source,at:1000+start*beat},{type:'off',midi,source,at:1000+end*beat});
 }
 if(mode==='sounding-eighth')for(const b of [1.5,5.5])out.push({type:'on',midi:62,source:'midi',at:1000+b*beat},{type:'off',midi:62,source:'midi',at:1000+(b+.4)*beat});
 if(mode==='filled-rest')out.push({type:'on',midi:60,source:'midi',at:1000+1.7*beat},{type:'off',midi:60,source:'midi',at:1000+1.9*beat});
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),events:es,bpm:48,targetBpm:48,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}

test('one offbeat dotted-quarter release preserves629 full records,grades,order,themes and guitar route',()=>{
 lesson();assert.equal(app.lessons.length,counts.catalogRecords);const old=new Set(before.catalog.map(x=>x.id)),cohort=app.lessons.filter(x=>old.has(x.id)||x.id===id);assert.equal(cohort.length,630);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),[id]);assert.deepEqual(copy(app.lessons.filter(x=>old.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}assertPreservedThemes(app.themes,before.themes);assert.equal(lesson().themeId,'detail-p-dotted-quarter');
 assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);const route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);assert.equal(hash(route.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(route.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});
test('a full dotted-quarter release at2-and precedes half a silent beat before beat3',()=>{
 const l=lesson();assert.equal(l.handMode,'right');assert.equal(app.challengeEligible(l),true);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),notes);assert.deepEqual(copy(l.fingeringSpec.steps),digits.map(x=>x.map(num=>({hand:'right',num}))));assert.deepEqual(copy(l.rhythm.steps.map(x=>x.startBeat)),starts);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.durationBeats)),durations);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.restBeforeBeats)),[0,.5,0,0,.5,0]);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,8);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.rhythm.bpm,48);assert.equal(starts[1]-durations[0],.5);assert.equal(starts[4]-(starts[3]+durations[3]),.5);
});

test('real client and canonical grader distinguish silence after the dot from the old sounding eighth or a held dot',()=>{
 const l=lesson(),row=require('../service/course-registry.json').lessons.find(x=>x.id===id);assert.ok(row);
 for(const mode of ['clean','early-dot-off','held-dot','early-entry','long-rest','wrong-octave','wrong-pitch','missing-note','short-quarter','short-final','sounding-eighth','filled-rest','keyboard']){const es=events(mode),end=es.at(-1).at;if(mode!=='clean')assert.notDeepEqual(es,events());assert.equal(assess(l,es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);}
});
test('real MIDI handlers wait for all final releases and do not credit either prerequisite or another inversion lesson',async()=>{
 lesson();for(const mode of ['clean','held-dot','sounding-eighth','short-final']){const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(x=>x.id===id));a.state.attemptMode='challenge';const es=events(mode);
  for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false,'must wait for final key release');if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}
  assert.equal(a.state.passed,mode==='clean',mode);assert.equal(a.state.learningProgress[id]?.cleanTakes??0,mode==='clean'?1:0);for(const other of [...requires,'detail-p-c-first-inversion-shape-left-01','detail-p-c-root-first-inversion-left-01','detail-p-c-first-second-inversion-right-01'])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);await a.legacyProgressStore.settled();a.resetLessonState();
 }
});
test('route,primary figure,comfortable preparation and open transfer stay explicit with no hints in all memory modes',()=>{
 const l=lesson(),route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);const ids=route.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),sources=require('../docs/piano-curriculum-sources.json');assert.deepEqual(copy(l.learning.requires),requires);assert.equal(l.learning.after,requires[0]);for(const r of requires)assert.ok(ids.indexOf(r)>=0&&ids.indexOf(r)<ids.indexOf(id));assert.equal(l.learning.stage,'p3');assert.equal(l.learning.coverageDomain,'rhythm');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.sourceEvidenceIds.length,5);
 for(const key of l.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===key)?.applications.some(a=>a.batch==='2026-11-13-01'&&a.lessonIds.includes(id)),key);const source=sources.entries.find(e=>e.id==='ou-dots-and-ties-2026-11-05')?.applications.find(a=>a.batch==='2026-11-13-01');assert.ok(source?.freshReadInCurrentBatch&&source?.sourceTextReadInCurrentBatch);const rests=sources.entries.find(e=>e.id==='ou-rest-values-2026-11-05')?.applications.find(a=>a.batch==='2026-11-13-01');assert.ok(rests?.freshReadInCurrentBatch&&rests?.sourceTextReadInCurrentBatch);
 app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['полторы доли','полдоли тишины','на «два-и»','на «три»','полностью отпусти','при напряжении','вне MIDI-зачёта','на следующий день','MIDI не видит пальцы'])assert.ok(html.includes(text),text);for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
});
test('sound sample preserves full1.5beat dots and1beat quarters at slow and target tempos',()=>{
 const l=lesson();app.state.lesson=l;for(const bpm of [32,40,48])for(let i=0;i<6;i++)assert.ok(Math.abs(app.previewSoundDurationMs(l,i,bpm,durations[i]*60000/bpm)-durations[i]*60000/bpm)<1e-6,i+':'+bpm);
});
test('reinstall and catalogue exchange retain personal pitches,classification and instructions in the new transition',async()=>{
 lesson();const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),l=a.lessons.find(x=>x.id===id);l.contentKind='piece';l.guide.setup='personal-transition';l.learning.practiceSteps[0]='personal-practice';l.pattern='9 '+l.pattern.split(' ').slice(1).join(' ');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(x=>x.id===id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const current=a.lessons.find(x=>x.id===id);assert.equal(current.contentKind,'piece');assert.equal(current.guide.setup,saved.guide.setup);assert.deepEqual(copy(current.steps),saved.steps);assert.equal(a.lessons.filter(x=>x.id===id).length,1);
});
test('canonical registry preserves481 full editions and assigns one rhythm goal beyond a sounding eighth after a dotted quarter',()=>{
 const l=lesson(),course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,counts.implementedLearningLessons);for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);const row=course.lessons.find(x=>x.id===id);assert.equal(row.goalKey,id);assert.equal(row.gradeFingerprint,A.pianoSignature(l));assert.deepEqual(row.requires,requires);assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.goalCounting,undefined);
 const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build();for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(report.counts.goalGroupUpperBound-coverage.goalAccounting(report.lessons.filter(x=>x.id!==id)).goalGroupUpperBound,1);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});
