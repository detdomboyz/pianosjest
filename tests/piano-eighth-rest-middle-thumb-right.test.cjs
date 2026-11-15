'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-eighth-rest-middle-thumb-right-v1.json'),currentCounts=require('./fixtures/piano-curriculum-counts.json');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const examples=[{id:'detail-p-eighth-rest-middle-thumb-right-01',hand:'right',notes:[64,64,65,67],digits:[3,1,2,3],starts:[0,1.5,2,3],durations:[1,.5,1,1],repeatIndex:1,requires:['detail-p-eighth-rest-thumb-middle-right-01','course02-02']}];
const app=loadApp();
function events(x,mode='clean'){
 const out=[];
 for(let i=0;i<x.notes.length;i++){
  let midi=x.notes[i],start=x.starts[i],end=start+x.durations[i];const repeated=i===x.repeatIndex||i===x.repeatIndex+4,preceding=i===x.repeatIndex-1||i===x.repeatIndex+3;
  if(mode==='stays-on-anchor'&&i>=2)midi=64;
  if(mode==='old-descent'&&i>=2)midi=[64,64,62,60][i];
  if(mode==='no-rest'&&preceding)end+=.5;
  if(mode==='early-repeat'&&repeated){start-=.5;end-=.5;}
  if(mode==='late-repeat'&&repeated){start+=.5;end+=.5;}
  if(mode==='short-final'&&i===x.notes.length-1)end=start+.1;
  if(mode==='wrong-pitch'&&repeated)midi++;
  if(mode==='missing-repeat'&&repeated)continue;
  if(mode==='continuous-hold'&&preceding)end=x.starts[i+1]+x.durations[i+1];
  if(mode==='continuous-hold'&&repeated)continue;
  const source=mode==='keyboard'?'keyboard':'midi';
  out.push({type:'on',midi,source,at:1000+start*1250});
  if(!(mode==='reattack-without-release'&&preceding))out.push({type:'off',midi,source,at:1000+end*1250});
 }
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),events:es,bpm:48,targetBpm:48,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}

test('new right middle-thumb anchor lesson preserve608 complete records and old route',()=>{
 for(const x of examples)assert.ok(app.lessons.find(l=>l.id===x.id),'Missing '+x.id);
 assert.equal(app.lessons.length,currentCounts.catalogRecords);const old=new Set(before.catalog.map(x=>x.id)),historical=app.lessons.filter(x=>old.has(x.id)||examples.some(e=>e.id===x.id));assert.equal(historical.length,609);assert.deepEqual(copy(historical.filter(x=>!old.has(x.id)).map(x=>x.id)),examples.map(x=>x.id));
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
 assertPreservedThemes(app.themes,before.themes);assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});

test('right middle-thumb anchor and following ascending1-2-3 line have exact pitches,half-rest and complete ending',()=>{
 for(const x of examples){const l=app.lessons.find(v=>v.id===x.id);assert.equal(app.challengeEligible(l),true);assert.equal(l.handMode,x.hand);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),x.notes.map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s.map(n=>[n.hand,n.num]))),x.digits.map(n=>[[x.hand,n]]));assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),x.starts);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.durationBeats)),x.durations);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),x.starts.map((s,i)=>i?s-x.starts[i-1]-x.durations[i-1]:0));assert.equal(l.rhythm.practiceBpm,48);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,4);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.goalCounting,undefined);assert.equal(l.learning.ending,undefined);}
});

test('actual client and server require silence and a new same-pitch attack for the prepared right hand',()=>{
 for(const x of examples){const l=app.lessons.find(v=>v.id===x.id),row=require('../service/course-registry.json').lessons.find(v=>v.id===x.id);assert.ok(row);for(const mode of ['clean','continuous-hold','reattack-without-release','no-rest','early-repeat','late-repeat','missing-repeat','wrong-pitch','short-final','keyboard','stays-on-anchor','old-descent']){const es=events(x,mode),end=es.at(-1).at;if(mode!=='clean')assert.notDeepEqual(es,events(x,'clean'),mode+' must alter the input trace');assert.equal(assess(l,es).clean,mode==='clean','client '+x.hand+' '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+x.hand+' '+mode);}}
});

test('real MIDI handlers require reattack and final noteoff without preparation credit',async()=>{
 for(const x of examples)for(const mode of ['clean','continuous-hold','reattack-without-release']){
  const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});
  a.setTestLesson(a.lessons.find(v=>v.id===x.id));a.state.attemptMode='challenge';const es=events(x,mode);
  for(const [i,e] of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false);if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}
  assert.equal(a.state.passed,mode==='clean',x.hand+' '+mode);
  if(mode==='clean'){
   assert.equal(a.state.learningProgress[x.id].fingerprint,A.pianoSignature(a.state.lesson));assert.equal(a.state.learningProgress[x.id].cleanTakes,1);
   for(const other of [...x.requires,'detail-p-eighth-rest-thumb-middle-left-01',...examples.filter(y=>y!==x).map(y=>y.id)])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);
  }else{
   // Failed attempts may retain history; they must not earn clean takes/readiness.
   assert.equal(a.state.learningProgress[x.id]?.cleanTakes??0,0);assert.notEqual(a.state.learningProgress[x.id]?.ready,true);assert.notEqual(a.state.learningProgress[x.id]?.retained,true);
  }
  await a.legacyProgressStore.settled();a.resetLessonState();
 }
});

test('preparations,sources,own exercise origin and open transfer render;memory has no hints',()=>{
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),sources=require('../docs/piano-curriculum-sources.json');
 for(const x of examples){const l=app.lessons.find(v=>v.id===x.id);assert.deepEqual(copy(l.learning.requires),x.requires);for(const id of x.requires)assert.ok(route.indexOf(id)>=0&&route.indexOf(id)<route.indexOf(x.id));assert.equal(l.learning.coverageDomain,'positions');assert.equal(l.learning.stage,'p3');assert.equal(l.learning.provenance.type,'project-technical-drill');for(const id of l.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===id)?.applications.some(a=>a.batch==='2026-11-12-02'&&a.freshReadInCurrentBatch&&a.lessonIds.includes(x.id)),id);app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['полдоли тишины','новое нажатие той же клавиши','Правая E4: средний 3, затем большой 1','не является независимым тестом слуха','не новый урок','на следующий день','MIDI не видит'])assert.ok(html.includes(text),x.hand+' '+text);for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}}
});

test('audio-preview timing preserves the half-rest and short repeat at three practice tempos',()=>{
 for(const x of examples){const l=app.lessons.find(v=>v.id===x.id);app.state.lesson=l;for(const bpm of [36,48,60])for(const [i,d]of x.durations.entries())assert.ok(Math.abs(app.previewSoundDurationMs(l,i,bpm,60000/bpm)-d*60000/bpm)<1e-6);}
});

test('catalogue reinstall and exchange preserve personal editions,classifications and histories',async()=>{
 const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()});for(const x of examples){const l=a.lessons.find(v=>v.id===x.id);l.contentKind='piece';l.guide.setup='personal-'+x.hand;l.learning.practiceSteps[0]='personal-steps';l.pattern=l.pattern.replace(/^\S+/,'9');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(v=>v.id===x.id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const now=a.lessons.find(v=>v.id===x.id);assert.equal(now.contentKind,'piece');assert.equal(now.guide.setup,'personal-'+x.hand);assert.deepEqual(copy(now.steps),saved.steps);assert.equal(a.lessons.filter(v=>v.id===x.id).length,1);}
});

test('canonical service preserves460 editions and independently keys one new goal without schema change',()=>{
 const course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,currentCounts.implementedLearningLessons);const oldIds=new Set(before.server.lessons.map(x=>x.id));assert.equal(course.lessons.filter(x=>oldIds.has(x.id)||examples.some(e=>e.id===x.id)).length,461);for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);for(const x of examples){const row=course.lessons.find(v=>v.id===x.id);assert.equal(row.goalKey,x.id);assert.equal(row.gradeFingerprint,A.pianoSignature(app.lessons.find(v=>v.id===x.id)));assert.deepEqual(row.requires,x.requires);}const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build(),counts=require('./fixtures/piano-curriculum-counts.json');for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(report.counts.goalGroupUpperBound-coverage.goalAccounting(report.lessons.filter(x=>!examples.some(e=>e.id===x.id))).goalGroupUpperBound,1);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});
