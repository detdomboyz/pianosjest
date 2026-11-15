'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-c-g7-common-tone-left-v1.json'),counts=require('./fixtures/piano-curriculum-counts.json');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const id='detail-p-c-g7-common-tone-left-01',requires=['detail-p-triads-02','detail-p-c-f-common-bass-left-01','detail-p-relocate-02'],app=loadApp();
const notes=[[48,52,55],[47,53,55],[48,52,55],[47,53,55],[48,52,55]],digits=[[5,3,1],[5,2,1],[5,3,1],[5,2,1],[5,3,1]],starts=[0,4,8,12,16];
function lesson(){const l=app.lessons.find(x=>x.id===id);assert.ok(l,'Missing left I-V7-I common-tone transition');return l;}
function events(mode='clean'){
 const out=[],beat=60000/44;
 for(let i=0;i<5;i++)for(let j=0;j<3;j++){
  let midi=notes[i][j],start=starts[i],end=start+2;
  if(mode==='c-only'&&i%2)midi=[48,52,55][j];
  if(mode==='g-root'&&i%2)midi=[55,59,62][j];
  if(mode==='no-seventh'&&i%2)midi=[47,50,55][j];
  if(mode==='bass-C-kept'&&i%2&&midi===47)midi=48;
  if(mode==='E-kept'&&i%2&&midi===53)midi=52;
  if(mode==='wrong-octave'&&i%2&&midi===47)midi=59;
  if(mode==='missing-bass'&&i%2&&midi===47)continue;
  if(mode==='no-common-reattack'&&i===1&&midi===55)continue;
  if(mode==='held-g'&&i===0&&midi===55)end=6;
  if(mode==='held-g'&&i===1&&midi===55)continue;
  if(mode==='rolled')start+=j*.35;
  if(mode==='early-common-off'&&i===1&&midi===55)end=start+.15;
  if(mode==='short-final'&&i===4)end=start+.1;
  const source=mode==='keyboard'?'keyboard':'midi';out.push({type:'on',midi,source,at:1000+start*beat},{type:'off',midi,source,at:1000+end*beat});
 }
 if(mode==='filled-rest')out.push({type:'on',midi:55,source:'midi',at:1000+3*beat},{type:'off',midi:55,source:'midi',at:1000+3.3*beat});
 if(mode==='full-seventh-with-D')for(const i of [1,3])out.push({type:'on',midi:50,source:'midi',at:1000+starts[i]*beat},{type:'off',midi:50,source:'midi',at:1000+(starts[i]+2)*beat});
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),events:es,bpm:44,targetBpm:44,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}

test('one functional I-V7-I transition preserves627 full records,grades,order,themes and guitar route',()=>{
 lesson();assert.equal(app.lessons.length,counts.catalogRecords);const old=new Set(before.catalog.map(x=>x.id)),cohort=app.lessons.filter(x=>old.has(x.id)||x.id===id);assert.equal(cohort.length,628);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),[id]);assert.deepEqual(copy(app.lessons.filter(x=>old.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}assertPreservedThemes(app.themes,before.themes);assert.equal(lesson().themeId,'detail-p-triads');
 assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);const route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);assert.equal(hash(route.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(route.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});
test('left I-V7-I reattacks common G3 while C descends to B and E rises to F with omitted D',()=>{
 const l=lesson();assert.equal(l.handMode,'left');assert.equal(app.challengeEligible(l),true);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),notes);assert.deepEqual(copy(l.fingeringSpec.steps),digits.map(x=>x.map(num=>({hand:'left',num}))));assert.deepEqual(copy(l.rhythm.steps.map(x=>x.startBeat)),starts);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.durationBeats)),[2,2,2,2,2]);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.restBeforeBeats)),[0,2,2,2,2]);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,18);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.rhythm.bpm,44);
 assert.equal(notes[0][2],notes[1][2]);assert.equal(notes[1][0]-notes[0][0],-1);assert.equal(notes[1][1]-notes[0][1],1);assert.deepEqual([digits[0][2],digits[1][2],digits[0][1],digits[1][1]],[1,1,3,2]);assert.ok(!notes[1].includes(50));
});
test('real client and canonical grader require fresh shared pitches after silence and complete simultaneous new shape',()=>{
 const l=lesson(),row=require('../service/course-registry.json').lessons.find(x=>x.id===id);assert.ok(row);
 for(const mode of ['clean','c-only','g-root','no-seventh','bass-C-kept','E-kept','wrong-octave','missing-bass','no-common-reattack','held-g','rolled','early-common-off','filled-rest','short-final','full-seventh-with-D','keyboard']){const es=events(mode),end=es.at(-1).at;if(mode!=='clean')assert.notDeepEqual(es,events());assert.equal(assess(l,es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);}
});
test('real MIDI handlers wait for all final releases and do not credit either prerequisite or another inversion lesson',async()=>{
 lesson();for(const mode of ['clean','held-g','no-seventh','short-final']){const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(x=>x.id===id));a.state.attemptMode='challenge';const es=events(mode);
  for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false,'must wait for final key release');if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}
  assert.equal(a.state.passed,mode==='clean',mode);assert.equal(a.state.learningProgress[id]?.cleanTakes??0,mode==='clean'?1:0);for(const other of [...requires,'detail-p-c-first-inversion-shape-left-01','detail-p-c-root-first-inversion-left-01','detail-p-c-first-second-inversion-right-01'])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);await a.legacyProgressStore.settled();a.resetLessonState();
 }
});
test('route,primary figure,comfortable preparation and open transfer stay explicit with no hints in all memory modes',()=>{
 const l=lesson(),route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);const ids=route.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),sources=require('../docs/piano-curriculum-sources.json');assert.deepEqual(copy(l.learning.requires),requires);assert.equal(l.learning.after,requires[1]);for(const r of requires)assert.ok(ids.indexOf(r)>=0&&ids.indexOf(r)<ids.indexOf(id));assert.equal(l.learning.stage,'p5');assert.equal(l.learning.coverageDomain,'inversions');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.sourceEvidenceIds.length,5);
 for(const key of l.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===key)?.applications.some(a=>a.batch==='2026-11-12-17'&&a.lessonIds.includes(id)),key);const source=sources.entries.find(e=>e.id==='gardenofpraise-I-IV-common-bass-2026-11-12')?.applications.find(a=>a.batch==='2026-11-12-17');assert.ok(source?.freshReadInCurrentBatch&&source?.sourceTextReadInCurrentBatch);const chord=sources.entries.find(e=>e.id==='narloch-v7-left-plan-2026-11-12')?.applications.find(a=>a.batch==='2026-11-12-17');assert.ok(chord?.freshReadInCurrentBatch&&chord?.sourcePageVisuallyChecked);
 app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['G3 под большим 1','C3/5 → B2/5','E3/3 → F3/2','без D','полностью отпусти','не удерживай общую соль','при напряжении','вне MIDI-зачёта','на следующий день','MIDI не видит пальцы'])assert.ok(html.includes(text),text);for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
});
test('sound sample retains all three tones for two beats in both forms at slow and target tempos',()=>{
 const l=lesson();app.state.lesson=l;for(const bpm of [32,40,44])for(let i=0;i<5;i++)assert.ok(Math.abs(app.previewSoundDurationMs(l,i,bpm,2*60000/bpm)-2*60000/bpm)<1e-6,i+':'+bpm);
});
test('reinstall and catalogue exchange retain personal pitches,classification and instructions in the new transition',async()=>{
 lesson();const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),l=a.lessons.find(x=>x.id===id);l.contentKind='piece';l.guide.setup='personal-transition';l.learning.practiceSteps[0]='personal-practice';l.pattern='9 '+l.pattern.split(' ').slice(1).join(' ');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(x=>x.id===id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const current=a.lessons.find(x=>x.id===id);assert.equal(current.contentKind,'piece');assert.equal(current.guide.setup,saved.guide.setup);assert.deepEqual(copy(current.steps),saved.steps);assert.equal(a.lessons.filter(x=>x.id===id).length,1);
});
test('canonical registry preserves479 full editions and assigns one independent functional goal beyond I-IV common-bass practice and same-chord inversions',()=>{
 const l=lesson(),course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,counts.implementedLearningLessons);for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);const row=course.lessons.find(x=>x.id===id);assert.equal(row.goalKey,id);assert.equal(row.gradeFingerprint,A.pianoSignature(l));assert.deepEqual(row.requires,requires);assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.goalCounting,undefined);
 const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build();for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(report.counts.goalGroupUpperBound-coverage.goalAccounting(report.lessons.filter(x=>x.id!==id)).goalGroupUpperBound,1);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});
