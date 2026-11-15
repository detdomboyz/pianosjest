'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-a-natural-minor-right-v1.json'),counts=require('./fixtures/piano-curriculum-counts.json'),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex'),app=loadApp();
const ids=['detail-p-a-minor-third-thumb-prep-right-01','detail-p-a-natural-minor-ascent-right-01'];
const ns=[[57,59,60,62,64,59,60,62,64],[57,59,60,62,64,65,67,69]],digits=[[1,2,3,1,2,2,3,1,2],[1,2,3,1,2,3,4,5]],starts=[[0,1,2,3,4,8,9,10,11],[0,1,2,3,4,5,6,7]],durations=[[1,1,1,1,2,1,1,1,1],[1,1,1,1,1,1,1,1]],rests=[[0,0,0,0,0,2,0,0,0],[0,0,0,0,0,0,0,0]];
const preparations=[['detail-p-relocate-01','detail-p-cross-01','course02-08'],[ids[0],'detail-p-scale-02','detail-p-minor-triads-01']];
function lesson(i){const l=app.lessons.find(x=>x.id===ids[i]);assert.ok(l,'Missing prepared A-minor lesson '+ids[i]);return l;}
function events(i,mode='clean'){
 const out=[],beat=60000/44;
 for(let j=0;j<ns[i].length;j++){
  let midi=ns[i][j],start=starts[i][j],end=start+durations[i][j];
  if(mode==='wrong-third'&&midi===60)midi=61;
  if(mode==='wrong-octave')midi+=12;
  if(mode==='harmonic-seventh'&&i===1&&midi===67)midi=68;
  if(mode==='raised-sixth'&&i===1&&midi===65)midi=66;
  if(mode==='gap-cross'&&ns[i][j]===60)end-=.5;
  if(mode==='held-cross'&&ns[i][j]===60)end+=.6;
  if(mode==='missing-tone'&&j===3)continue;
  if(mode==='short-last'&&j===ns[i].length-1)end=start+.1;
  if(mode==='short-half'&&i===0&&j===4)end=start+.2;
  if(mode==='held-rest'&&i===0&&j===4)end=8.2;
  if(mode==='early-restart'&&i===0&&j===5)start-=.5;
  const source=mode==='keyboard'?'keyboard':'midi';out.push({type:'on',source,midi,at:1000+start*beat},{type:'off',source,midi,at:1000+end*beat});
 }
 if(mode==='extra-black')out.push({type:'on',source:'midi',midi:61,at:1000+2.5*beat},{type:'off',source:'midi',midi:61,at:1000+2.7*beat});
 if(mode==='filled-rest'&&i===0)out.push({type:'on',source:'midi',midi:57,at:1000+6.5*beat},{type:'off',source:'midi',midi:57,at:1000+6.8*beat});
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,j)=>({...s,midis:app.stepMidiList(l.steps[j])})),events:es,bpm:44,targetBpm:44,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}

test('two prepared records preserve631 full records,grades,order,108 themes and guitar while adding one minor-scale theme',()=>{
 ids.forEach((_,i)=>lesson(i));const old=new Set(before.catalog.map(x=>x.id)),cohort=app.lessons.filter(x=>old.has(x.id)||ids.includes(x.id));assert.equal(cohort.length,633);assert.deepEqual(copy(cohort.filter(x=>!old.has(x.id)).map(x=>x.id)),ids);assert.equal(app.lessons.length,counts.catalogRecords);assert.deepEqual(copy(app.lessons.filter(x=>old.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const row of before.catalog){const l=app.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
 const themeIds=new Set(before.themes.map(x=>x.id));assert.deepEqual(copy(app.themes.filter(x=>themeIds.has(x.id))),before.themes);assert.equal(app.themes.filter(x=>themeIds.has(x.id)||x.id==='detail-p-minor-scales').length,109);assert.equal(lesson(0).themeId,'detail-p-cross');assert.equal(lesson(1).themeId,'detail-p-minor-scales');
 assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);const route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);assert.equal(hash(route.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(route.MUSIC_CURRICULUM_PLAN.piano.filter(x=>old.has(x.id)).map(x=>x.id)),before.pianoRoute);
});
test('the whole-tone thumb preparation remains a same-goal application with two contexts and a full half-note release',()=>{
 const l=lesson(0);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),ns[0].map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps),digits[0].map(num=>[{hand:'right',num}]));assert.deepEqual(copy(l.rhythm.steps.map(x=>x.startBeat)),starts[0]);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.durationBeats)),durations[0]);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.restBeforeBeats)),rests[0]);assert.equal(l.learning.sameGoalAs,'detail-p-cross-01');assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,12);assert.equal(l.learning.stage,'p3');assert.equal(l.learning.coverageDomain,'crossings');
});
test('the natural-minor octave has A tonic,C natural,F natural,G natural and explicit12312345 without changing old profiles',()=>{
 const l=lesson(1);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),ns[1].map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps),digits[1].map(num=>[{hand:'right',num}]));assert.deepEqual(copy(l.rhythm.steps.map(x=>x.startBeat)),starts[1]);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.durationBeats)),durations[1]);assert.deepEqual(copy(l.rhythm.steps.map(x=>x.restBeforeBeats)),rests[1]);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,8);assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.stage,'p5');assert.equal(l.learning.coverageDomain,'minor-scales');
 for(let i=0;i<2;i++){const x=lesson(i);assert.equal(x.handMode,'right');assert.equal(app.challengeEligible(x),true);assert.equal(x.learning.articulation,'legato');assert.equal(x.learning.timingPrecision,'beat-boundary-v2');assert.equal(x.rhythm.bpm,44);}
});
test('real client and canonical graders reject altered minor degrees,black fillers,legato gaps,held notes and shortened final releases',()=>{
 const course=require('../service/course-registry.json');for(let i=0;i<2;i++){const l=lesson(i),row=course.lessons.find(x=>x.id===ids[i]);assert.ok(row);const modes=['clean','wrong-third','wrong-octave','gap-cross','held-cross','missing-tone','short-last','extra-black','keyboard',...(i===0?['short-half','held-rest','early-restart','filled-rest']:['harmonic-seventh','raised-sixth'])];for(const mode of modes){const es=events(i,mode),end=es.at(-1).at;if(mode!=='clean')assert.notDeepEqual(es,events(i));assert.equal(assess(l,es).clean,mode==='clean','client '+i+' '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','canonical '+i+' '+mode);}}
});
test('actual MIDI handlers require the final note-off and keep each music version separate from its preparations and counterpart',async()=>{
 for(let i=0;i<2;i++)for(const mode of ['clean','wrong-third','gap-cross','short-last']){lesson(i);const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(x=>x.id===ids[i]));a.state.attemptMode='challenge';const es=events(i,mode);for(const[j,e]of es.entries()){clock.now=5000+e.at-1000;if(j===es.length-1)assert.equal(a.state.completed,false,'last release required');if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);}assert.equal(a.state.passed,mode==='clean',i+' '+mode);assert.equal(a.state.learningProgress[ids[i]]?.cleanTakes??0,mode==='clean'?1:0);for(const other of [...preparations[i],ids[1-i]])if(other!==ids[i])assert.equal(Object.hasOwn(a.state.learningProgress,other),false);await a.legacyProgressStore.settled();a.resetLessonState();}
});
test('goal accounting adds one independent goal and one same-goal variant rather than counting both new records',()=>{
 lesson(0);lesson(1);const C=require('../tools/piano-skill-coverage.cjs'),r=C.build();for(const k of Object.keys(r.counts))assert.deepEqual(r.counts[k],counts[k],k);const base=C.goalAccounting(r.lessons.filter(x=>!ids.includes(x.id)));assert.equal(r.counts.goalGroupUpperBound-base.goalGroupUpperBound,1);assert.equal(C.goalAccounting(r.lessons.filter(x=>x.id!==ids[0])).goalGroupUpperBound,r.counts.goalGroupUpperBound);assert.equal(C.goalAccounting(r.lessons.filter(x=>x.id!==ids[1])).goalGroupUpperBound,base.goalGroupUpperBound);assert.equal(r.counts.explicitSameGoalVariants-base.explicitSameGoalVariants,1);assert.equal(r.counts.verifiedDistinctGoalCount,null);assert.equal(r.counts.independentTeacherReviewed,0);
});
test('route and dated primary applications prepare both records without claiming Alfred printed an A-natural-minor chart',()=>{
 const route={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),route);const order=route.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id),ledger=require('../docs/piano-curriculum-sources.json');for(let i=0;i<2;i++){const l=lesson(i);assert.deepEqual(copy(l.learning.requires),preparations[i]);assert.equal(l.learning.after,i===0?'detail-p-relocate-01':'detail-p-minor-triads-01');for(const id of preparations[i])assert.ok(order.indexOf(id)>=0&&order.indexOf(id)<order.indexOf(ids[i]),id);assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.learning.sourceEvidenceIds.length,5);for(const key of l.learning.sourceEvidenceIds)assert.ok(ledger.entries.find(e=>e.id===key)?.applications.some(a=>a.batch==='2026-11-13-03'&&ids.every(id=>a.lessonIds.includes(id))),key);}
 const alfred=ledger.entries.find(x=>x.id==='alfred-daily-warmups4-minor-thumb-2026-11-13'),scale=ledger.entries.find(x=>x.id==='pianoscales-a-natural-minor-fingering-2026-11-13');assert.ok(alfred?.applications.find(a=>a.batch==='2026-11-13-03')?.sourcePageVisuallyChecked);assert.ok(scale?.applications.find(a=>a.batch==='2026-11-13-03')?.sourceTextReadInCurrentBatch);assert.ok(alfred?.limits.includes('B harmonic minor'));assert.ok(scale?.limits.includes('individual byline'));
});
test('canonical registry preserves483 complete editions and XP contracts while sharing only the preparation goal key',()=>{
 lesson(0);lesson(1);const course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));assert.equal(course.lessons.length,counts.implementedLearningLessons);for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);assert.equal(course.lessons.find(x=>x.id===ids[0]).goalKey,'detail-p-cross-01');assert.equal(course.lessons.find(x=>x.id===ids[1]).goalKey,ids[1]);for(let i=0;i<2;i++)assert.equal(course.lessons.find(x=>x.id===ids[i]).gradeFingerprint,A.pianoSignature(lesson(i)));
});
test('complete cards preserve full sample durations and omit all hints in every memory preference',()=>{
 for(let i=0;i<2;i++){const l=lesson(i);app.state.lesson=l;for(const bpm of [32,40,44])for(let j=0;j<ns[i].length;j++)assert.ok(Math.abs(app.previewSoundDurationMs(l,j,bpm,durations[i][j]*60000/bpm)-durations[i][j]*60000/bpm)<1e-6);app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const t of ['C4','D4','вне MIDI-зачёта','на следующий день','не является независимым тестом слуха','MIDI не видит пальцы'])assert.ok(html.includes(t),ids[i]+' '+t);for(const mode of ['compact','expanded','hidden']){app.state.learningMaterialMode=mode;app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}}
});
test('reinstall and catalogue exchange retain personal music,classification and teaching without duplicate prepared IDs',async()=>{
 ids.forEach((_,i)=>lesson(i));const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),saved=[];for(const id of ids){const l=a.lessons.find(x=>x.id===id);l.contentKind='piece';l.guide.setup='personal-minor';l.learning.practiceSteps[0]='personal-practice';l.pattern='9 '+l.pattern.split(' ').slice(1).join(' ');l.steps=a.parsePattern(l.pattern).steps;saved.push(copy(l));}a.installReviewedLessons();for(const row of saved)assert.deepEqual(copy(a.lessons.find(x=>x.id===row.id)),row);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);for(const row of saved){const l=a.lessons.find(x=>x.id===row.id);assert.equal(l.contentKind,'piece');assert.equal(l.guide.setup,row.guide.setup);assert.deepEqual(copy(l.steps),row.steps);assert.equal(a.lessons.filter(x=>x.id===row.id).length,1);}
});
