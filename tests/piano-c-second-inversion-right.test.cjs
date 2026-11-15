'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs'),before=require('./fixtures/piano-before-c-second-inversion-right-v1.json'),counts=require('./fixtures/piano-curriculum-counts.json');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const shapeId='detail-p-c-second-inversion-shape-right-01',blockId='detail-p-c-second-inversion-block-right-01',app=loadApp();
const cases=[{id:shapeId,notes:[[67],[72],[76],[72]],digits:[[1],[3],[5],[3]],starts:[0,1,2,3],durations:[1,1,1,1],rests:[0,0,0,0],end:4,requires:['detail-p-c-first-inversion-block-right-01','detail-p-relocate-03'],after:'detail-p-c-first-inversion-block-right-01'},{id:blockId,notes:Array.from({length:4},()=>[67,72,76]),digits:Array.from({length:4},()=>[1,3,5]),starts:[0,4,8,12],durations:[2,2,2,2],rests:[0,2,2,2],end:14,requires:[shapeId,'detail-p-c-first-inversion-block-right-01'],after:shapeId}];
const lesson=c=>{const l=app.lessons.find(l=>l.id===c.id);assert.ok(l,'Missing C second inversion '+c.id);return l;};
function events(c,mode='clean'){
 const beat=60000/44,out=[];for(let i=0;i<c.notes.length;i++)for(let j=0;j<c.notes[i].length;j++){
  let midi=c.notes[i][j],start=c.starts[i],end=start+c.durations[i];
  if(mode==='root-position')midi=({67:60,72:64,76:67})[midi];
  if(mode==='first-inversion')midi=({67:64,72:67,76:72})[midi];
  if(mode==='g-major')midi=({67:67,72:71,76:74})[midi];
  if(mode==='e-minor'&&midi===72)midi=71;
  if(mode==='wrong-octave'&&midi===76)midi=64;
  if(mode==='g-sharp'&&midi===67)midi=68;
  if(mode==='short-final'&&i===3)end=start+.1;
  if(mode==='short-first'&&i===0)end=start+.1;
  if(mode==='missing-top'&&midi===76)continue;
  if(mode==='missing-middle'&&midi===72)continue;
  if(mode==='rolled')start+=j*.35;
  if(mode==='one-early-off'&&i===0&&j===2)end=.2;
  if(mode==='held-through-rest'&&i===0)end=c.starts[1]+1;
  const source=mode==='keyboard'?'keyboard':'midi';out.push({type:'on',midi,source,at:1000+start*beat},{type:'off',midi,source,at:1000+end*beat});
 }
 if(mode==='filled-rest')out.push({type:'on',midi:60,source:'midi',at:1000+3*beat},{type:'off',midi:60,source:'midi',at:1000+3.3*beat});return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,c,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),events:es,bpm:44,targetBpm:44,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}
test('second inversion adds exactly two tasks in the old triad theme and preserves620 full records,grades,themes and routes',()=>{
 cases.forEach(lesson);assert.equal(app.lessons.length,counts.catalogRecords);const old=new Set(before.catalog.map(x=>x.id)),newIds=new Set(cases.map(x=>x.id)),cohort=app.lessons.filter(x=>old.has(x.id)||newIds.has(x.id));assert.equal(cohort.length,622);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),cases.map(x=>x.id));assert.deepEqual(copy(app.lessons.filter(x=>old.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}assertPreservedThemes(app.themes,before.themes);for(const c of cases)assert.equal(lesson(c).themeId,'detail-p-triads');
 assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);const route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);assert.equal(hash(route.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(route.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});
test('second inversion anchors G4thumb1,C5middle3,E5pinky5 within a comfortable nine-semitone span',()=>{
 const c=cases[0],l=lesson(c);assert.equal(l.handMode,'right');assert.equal(app.challengeEligible(l),true);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),c.notes);assert.deepEqual(copy(l.fingeringSpec.steps),c.digits.map(x=>x.map(num=>({hand:'right',num}))));assert.deepEqual(copy(l.rhythm.steps.map(x=>x.startBeat)),c.starts);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.durationBeats)),c.durations);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,4);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.notDeepEqual(c.digits.slice(0,3),[[2],[3],[5]]);assert.equal(76-67,9);
});
test('blocked inversion requires all three E4-G4-C5 tones and two beat holds separated by two quiet beats',()=>{
 const c=cases[1],l=lesson(c);assert.equal(l.handMode,'right');assert.equal(app.challengeEligible(l),true);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),c.notes);assert.deepEqual(copy(l.fingeringSpec.steps),c.digits.map(x=>x.map(num=>({hand:'right',num}))));assert.deepEqual(copy(l.rhythm.steps.map(x=>x.startBeat)),c.starts);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.durationBeats)),c.durations);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.restBeforeBeats)),c.rests);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,14);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');
});
test('real client and canonical grader reject old root shape,E minor,wrong register and missing notes in broken preparation',()=>{
 const c=cases[0],l=lesson(c),row=require('../service/course-registry.json').lessons.find(x=>x.id===c.id);assert.ok(row);for(const mode of ['clean','root-position','first-inversion','g-major','missing-middle','e-minor','wrong-octave','g-sharp','short-first','short-final','missing-top','keyboard']){const es=events(c,mode),end=es.at(-1).at;assert.equal(assess(l,c,es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);}
});
test('real client and canonical grader reject rolled,partial,short-held or pause-filled blocked chords',()=>{
 const c=cases[1],l=lesson(c),row=require('../service/course-registry.json').lessons.find(x=>x.id===c.id);assert.ok(row);for(const mode of ['clean','root-position','first-inversion','g-major','missing-middle','e-minor','wrong-octave','g-sharp','missing-top','rolled','one-early-off','held-through-rest','filled-rest','short-final','keyboard']){const es=events(c,mode),end=es.at(-1).at;if(mode!=='clean')assert.notDeepEqual(es,events(c));assert.equal(assess(l,c,es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);}
});
test('real MIDI handlers retain separate preparation and chord credit and require the final releases',async()=>{
 cases.forEach(lesson);for(const c of cases)for(const mode of ['clean','root-position','short-final']){const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(x=>x.id===c.id));a.state.attemptMode='challenge';const es=events(c,mode);
  for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false,'must wait for final key release '+c.id);if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}
  assert.equal(a.state.passed,mode==='clean',c.id+' '+mode);assert.equal(a.state.learningProgress[c.id]?.cleanTakes??0,mode==='clean'?1:0);for(const other of [...c.requires,cases.find(x=>x.id!==c.id).id])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);await a.legacyProgressStore.settled();a.resetLessonState();
 }
});
test('source Figure11,earlier prerequisites,comfort,open transfer and all memory modes belong to both new lessons',()=>{
 const route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);const ids=route.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),sources=require('../docs/piano-curriculum-sources.json');for(const c of cases){const l=lesson(c);assert.deepEqual(copy(l.learning.requires),c.requires);assert.equal(l.learning.after,c.after);for(const r of c.requires)assert.ok(ids.indexOf(r)>=0&&ids.indexOf(r)<ids.indexOf(c.id));assert.equal(l.learning.stage,'p5');assert.equal(l.learning.coverageDomain,'inversions');assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.sourceEvidenceIds.length,4);
  for(const key of l.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===key)?.applications.some(a=>a.batch==='2026-11-12-12'&&a.lessonIds.includes(c.id)),key);const primary=sources.entries.find(e=>e.id==='kovarsky-basic-triads-2026-11-05')?.applications.find(a=>a.batch==='2026-11-12-12');assert.ok(primary?.freshReadInCurrentBatch&&primary?.sourceFigureVisuallyChecked);
  app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['соль G4 под большим 1','не соль мажор','MIDI не видит пальцы','не новый урок','на следующий день','при напряжении'])assert.ok(html.includes(text),c.id+':'+text);for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
 }
 assert.equal(lesson(cases[0]).learning.nextLessonId,blockId);
});
test('sound sample preserves quarter preparation and all blocked two-beat tones at slow and target tempos',()=>{
 for(const c of cases){const l=lesson(c);app.state.lesson=l;for(const bpm of [32,40,44])for(let i=0;i<4;i++)assert.ok(Math.abs(app.previewSoundDurationMs(l,i,bpm,c.durations[i]*60000/bpm)-c.durations[i]*60000/bpm)<1e-6,c.id+':'+i);}
});
test('reinstall and catalogue exchange preserve personal notes,classification and instructions in both inversion lessons',async()=>{
 cases.forEach(lesson);const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),saved=[];for(const c of cases){const l=a.lessons.find(x=>x.id===c.id);l.contentKind='piece';l.guide.setup='personal-'+c.id;l.learning.practiceSteps[0]='personal-practice';l.pattern='9 '+l.pattern.split(' ').slice(1).join(' ');l.steps=a.parsePattern(l.pattern).steps;saved.push(copy(l));}a.installReviewedLessons();for(const l of saved)assert.deepEqual(copy(a.lessons.find(x=>x.id===l.id)),l);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);for(const l of saved){const current=a.lessons.find(x=>x.id===l.id);assert.equal(current.contentKind,'piece');assert.equal(current.guide.setup,l.guide.setup);assert.deepEqual(copy(current.steps),l.steps);assert.equal(a.lessons.filter(x=>x.id===l.id).length,1);}
});
test('canonical registry keeps472 full editions and assigns different goal keys to shape and blocked inversion',()=>{
 cases.forEach(lesson);const course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,counts.implementedLearningLessons);for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);for(const c of cases){const l=lesson(c),row=course.lessons.find(x=>x.id===c.id);assert.equal(row.goalKey,c.id);assert.equal(row.gradeFingerprint,A.pianoSignature(l));assert.deepEqual(row.requires,c.requires);assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.goalCounting,undefined);}
 const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build();for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(report.counts.goalGroupUpperBound-coverage.goalAccounting(report.lessons.filter(x=>!cases.some(c=>c.id===x.id))).goalGroupUpperBound,2);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});
