'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs');
const A=require('../practice-assessment.js'),fixture=require('./fixtures/piano-opposite-black-position-v1.json');
const app=loadApp(),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const expected=[
 {id:'detail-p-black-position-right-02',hand:'right',notes:[69,70,72,70,69,65,67,69,70,72,70,69,67,65],fingers:[3,4,5,4,3,1,2,3,4,5,4,3,2,1],black:70,wrong:71,grade:'fdfbe901'},
 {id:'detail-p-black-position-left-02',hand:'left',notes:[52,54,55,54,52,50,52,54,55,57,55,54,52,50],fingers:[4,3,2,3,4,5,4,3,2,1,2,3,4,5],black:54,wrong:53,grade:'93d7e76f'}
];
const starts=[0,1,2,3,4,7,8,9,10,11,12,13,14,15],units=expected.map(e=>app.lessons.find(l=>l.id===e.id));
function events(i,mode='clean'){
 const e=expected[i],beat=60000/52,out=[];
 e.notes.forEach((m,n)=>{if(mode==='omit-black'&&n===1)return;const midi=mode==='wrong-black'&&m===e.black?e.wrong:mode==='wrong-register'&&n===5?m+12:m,start=starts[n]-(mode==='skip-rest'&&n>=5?2:0),duration=mode==='short-last'&&n===13?.2:mode==='hold-rest'&&n===4?3:1;out.push({type:'on',midi,source:'midi',at:1000+start*beat},{type:'off',midi,at:1000+(start+duration)*beat});});
 if(mode==='rest-note')out.push({type:'on',midi:e.black,source:'midi',at:1000+5.5*beat},{type:'off',midi:e.black,at:1000+5.7*beat});
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
test('actual expanded card resolves the verified UMTA source without rewriting saved references',()=>{
 const a=loadApp(),bad='https://www.usu.edu/ycpiano/files/Level 1.pdf',good='https://www.usu.edu/ycpiano/files/Level1.pdf';
 for(const id of ['detail-p-black-position-right-01','detail-p-black-position-left-01']){
  a.state.lesson=a.lessons.find(l=>l.id===id);a.state.learningMaterialMode='expanded';
  const references=JSON.stringify(a.state.lesson.learning.references),html=a.learningMaterialHtml();
  assert.ok(html.includes('href="'+good+'"'));assert.ok(!html.includes('href="'+bad+'"'));
  assert.equal(JSON.stringify(a.state.lesson.learning.references),references);
 }
});

test('opposite hands use independent white/black neighbors and the project fingers in the correct registers',()=>{
 for(const[i,e]of expected.entries()){
  const l=units[i];assert.ok(l);assert.deepEqual(copy(l.steps.map(app.stepMidiList)),e.notes.map(n=>[n]));assert.deepEqual(copy(l.fingeringSpec.steps),e.fingers.map(num=>[{hand:e.hand,num}]));assert.equal(l.handMode,e.hand);assert.equal(A.pianoSignature(l),e.grade);
  assert.equal(l.learning.provenance.type,'project-technical-drill');assert.equal(l.contentKind,'exercise');assert.ok(!e.notes.includes(e.wrong));
 }
 assert.deepEqual([67-65,69-67,70-69,72-70],[2,2,1,2]);assert.deepEqual([52-50,54-52,55-54,57-55],[2,2,1,2]);
 assert.ok(units[0].guide.setup.includes('A♯4'));assert.ok(units[1].guide.setup.includes('под средним 3'));
});

test('real assessment requires both directions, fourteen quarter attacks, two silent beats and final release',()=>{
 for(let i=0;i<2;i++){
  const l=units[i],score={steps:l.rhythm.steps.map((s,n)=>({...s,midis:[expected[i].notes[n]]})),bpm:52,targetBpm:52,articulation:'legato'};
  assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(l.rhythm.practiceBpm,52);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),starts);assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));assert.equal(l.learning.articulation,'legato');assert.equal(starts.at(-1)+1,16);
  assert.equal(A.assessPiano({...score,events:events(i)}).clean,true);
  for(const mode of ['omit-black','wrong-black','wrong-register','skip-rest','hold-rest','rest-note','short-last'])assert.equal(A.assessPiano({...score,events:events(i,mode)}).clean,false,expected[i].id+' '+mode);
 }
});

test('actual MIDI handlers keep a new attempt open until the final note-off',()=>{
 for(let i=0;i<2;i++){
  const clock={now:10000},a=loadApp({events:true,clock});a.setTestLesson(a.lessons.find(l=>l.id===expected[i].id));a.state.attemptMode='challenge';
  const take=events(i);for(const[n,e]of take.entries()){clock.now=10000+e.at-1000;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(n===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}
  assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[expected[i].id].fingerprint,expected[i].grade);a.resetLessonState();
 }
});

test('all576 existing complete editions, grades, positions, baseline and guitar route remain unchanged',()=>{
 assert.deepEqual(require('./helpers/catalog-cohort.cjs').ids(app.lessons,fixture.catalog),fixture.catalog.map(l=>l.id));assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);
 for(const old of fixture.catalog){const l=app.lessons.find(x=>x.id===old.id);assert.equal(hash(require('./helpers/piano-assessment-revisions.cjs').atHistoricalGrade(l,old)),old.fullRecordSha256,old.id);assert.equal(hash({steps:l.steps,rhythm:l.rhythm,fingeringSpec:l.fingeringSpec,contentKind:l.contentKind}),old.musicSha256,old.id);assert.equal(A.pianoSignature(l),old.grade,old.id);assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);}
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync('lesson-review-baseline.js')).digest('hex'),fixture.protectedBaselineSha256);
 const context={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),context);assert.equal(hash(context.MUSIC_CURRICULUM_PLAN.guitar),fixture.guitarRouteSha256);
});

test('the real route inserts both distinct hand goals after three explicit preparations',()=>{
 const context={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),context);const route=context.MUSIC_CURRICULUM_PLAN.piano;
 for(const l of units){const index=route.findIndex(e=>e.id===l.id);assert.ok(index>=0);assert.equal(route[index].stage,'p3');assert.equal(route[index].challenge,true);assert.equal(l.learning.requires.length,3);for(const id of l.learning.requires)assert.ok(route.findIndex(e=>e.id===id)>=0&&route.findIndex(e=>e.id===id)<index,id);}
 assert.deepEqual(copy(units[0].learning.requires),['detail-p-black-position-right-01','detail-p-right-upper-position-01','detail-p-black-03']);
 assert.deepEqual(copy(units[1].learning.requires),['detail-p-black-position-left-01','detail-p-left-upper-position-01','detail-p-black-04']);
});

test('each card explains movement, count, transfer, project provenance and a dated primary-source application',()=>{
 const ledger=require('../docs/piano-curriculum-sources.json');
 for(const l of units){const x=l.learning;assert.equal(x.coverageDomain,'positions');assert.equal(x.practiceSteps.length,5);assert.equal(x.selfCheck.length,5);assert.ok(x.provenance.purpose.length>60);assert.ok(x.practiceSteps.some(s=>s.includes('не полная гамма')));assert.ok(x.practiceSteps.some(s=>s.includes('Отдельная открытая проба')));assert.ok(x.practiceSteps.some(s=>s.includes('на следующий день')));assert.ok(x.provenance.sourceNote.includes('авторы не утверждали'));for(const id of x.sourceEvidenceIds){const entry=ledger.entries.find(e=>e.id===id);assert.ok(entry,id);assert.ok(entry.applications.some(v=>v.batch==='2026-11-08-05'&&v.verifiedOn==='2026-11-08'&&v.lessonIds.includes(l.id)),id);}}
 assert.ok(units[1].learning.provenance.sourceNote.includes('Пальцевых цифр в пятизвучном примере нет'));
});

test('compact/expanded/hidden preferences keep all study notes and sources absent from memory DOM',()=>{
 const a=loadApp();for(const e of expected){a.state.lesson=a.lessons.find(l=>l.id===e.id);a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';assert.ok(a.learningMaterialHtml().includes('Отдельная открытая проба'));for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');}}
});

test('reinstall and catalog transfer retain personal new editions, all music, classifications and order',async()=>{
 const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()});
 // Model a valid reordered four-record group, without duplicate numeric slots.
 for(const[i,id]of ['detail-p-black-position-right-01','detail-p-black-position-left-01'].entries())a.lessons.find(l=>l.id===id).order=3+i;
 for(const[i,e]of expected.entries()){const l=a.lessons.find(l=>l.id===e.id);l.title+=' personal';l.guide.setup='personal setup';l.contentKind='piece';l.order=2-i;l.learning.practiceSteps[0]='personal preparation';}
 const selected=()=>expected.map(e=>copy(a.lessons.find(l=>l.id===e.id))),before=selected();a.installReviewedLessons();assert.deepEqual(selected(),before);const grades=selected().map(l=>A.pianoSignature(l));assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);assert.deepEqual(selected().map(l=>A.pianoSignature(l)),grades);for(const[i,l]of selected().entries()){assert.equal(l.contentKind,'piece');assert.equal(l.guide.setup,'personal setup');assert.equal(l.learning.practiceSteps[0],'personal preparation');assert.deepEqual(l.learning.provenance,before[i].learning.provenance);assert.equal(a.lessons.filter(x=>x.id===l.id).length,1);}
});
