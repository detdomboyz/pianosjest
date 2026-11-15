'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs'),before=require('./fixtures/piano-before-offbeat-rhythm-v1.json');
const ids=['detail-p-eighth-rest-offbeat-right-01','detail-p-syncopation-hold-right-01'],notes=[60,62,64,62,60,62,64,60],digits=[1,2,3,2,1,2,3,1],a=loadApp(),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const units=ids.map(id=>a.lessons.find(l=>l.id===id));
function events(l,mode='clean'){
 const beat=60000/48,sync=l.id===ids[1];
 return l.rhythm.steps.flatMap((s,i)=>{let start=s.startBeat,end=start+s.durationBeats,midi=notes[i];
  if(mode==='early-entry'&&(i===1||i===5)){start-=.5;end-=.5;}
  if(mode==='long-rest'&&i>=1){start+=.5;end+=.5;}
  if(mode==='filled-rest'&&(i===0||i===4))end+=.5;
  if(mode==='other-rhythm'&&(i===1||i===5))end+=sync?-.5:.5;
  if(mode==='other-rhythm'&&(i===2||i===6))start+=sync?-.5:.5;
  if(mode==='short-final'&&i===7)end=start+.1;
  if(mode==='wrong-pitch'&&i===2)midi++;
  return [{type:'on',midi,source:mode==='keyboard'?'keyboard':'midi',at:1000+start*beat},{type:'off',midi,source:'midi',at:1000+end*beat}];
 }).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(l,es){return A.assessPiano({steps:l.rhythm.steps.map((s,i)=>({...s,midis:[notes[i]]})),events:es,bpm:48,targetBpm:48,profile:l.learning.articulation,timingPrecision:l.learning.timingPrecision});}

test('two new rhythm goals preserve every old complete record,grade,order,theme,route and protected schema',()=>{
 const old=new Set(before.catalog.map(x=>x.id));assert.deepEqual(copy(a.lessons.filter(x=>!old.has(x.id)&&ids.includes(x.id)).map(x=>x.id)),ids);
 assert.deepEqual(copy(a.lessons.filter(x=>old.has(x.id)).map(x=>x.id)),before.catalog.map(x=>x.id));
 for(const row of before.catalog){const l=a.lessons.find(x=>x.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
 assert.deepEqual(copy(a.themes.filter(x=>before.themes.some(y=>x.id===y.id))),before.themes);assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.filter(x=>before.pianoRoute.includes(x.id)).map(x=>x.id)),before.pianoRoute);
});

test('entry and held syncopation have different exact timing,real half-beat rests and own right fingers',()=>{
 for(const [i,l]of units.entries()){assert.ok(l);assert.equal(a.challengeEligible(l),true);assert.equal(l.handMode,'right');assert.deepEqual(copy(l.steps.map(a.stepMidiList)),notes.map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s.map(n=>[n.hand,n.num]))),digits.map(n=>[['right',n]]));assert.equal(l.rhythm.practiceBpm,48);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),i?[0,1.5,2.5,3,4,5.5,6.5,7]:[0,1.5,2,3,4,5.5,6,7]);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.durationBeats)),i?[1,1,.5,1,1,1,.5,1]:[1,.5,1,1,1,.5,1,1]);assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),[0,.5,0,0,0,.5,0,0]);assert.equal(l.rhythm.steps.at(-1).startBeat+l.rhythm.steps.at(-1).durationBeats,8);assert.equal(l.learning.ending,undefined);assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.timingPrecision,'beat-boundary-v2');assert.equal(l.learning.sameGoalAs,undefined);assert.equal(l.learning.goalCounting,undefined);}
 assert.notEqual(A.pianoSignature(units[0]),A.pianoSignature(units[1]));
});

test('actual client and server reject exchanged rhythms,filled or lengthened rests,early entry,taps and keyboard',()=>{
 const course=require('../service/course-registry.json');
 for(const l of units){const row=course.lessons.find(x=>x.id===l.id);assert.ok(row);for(const mode of ['clean','early-entry','long-rest','filled-rest','other-rhythm','short-final','wrong-pitch','keyboard']){const es=events(l,mode),end=es.at(-1).at;assert.equal(assess(l,es).clean,mode==='clean',l.id+' '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean',l.id+' server '+mode);}assert.equal(assess(l,events(units.find(x=>x!==l))).clean,false);}
 const l=units[1],es=events(l);es.push({type:'off',midi:62,source:'midi',at:1000+2*1250},{type:'on',midi:62,source:'midi',at:1000+2*1250});es.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));assert.equal(assess(l,es).clean,false,'reattack at three must fail');
});

test('real MIDI path waits for final release and awards only the played edition',async()=>{
 for(const l of units){const clock={now:5000},app=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});app.setTestLesson(app.lessons.find(x=>x.id===l.id));app.state.attemptMode='challenge';const es=events(l);for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(app.state.completed,false);if(e.type==='on')app.handleNoteOn(e.midi,'midi');else app.handleNoteOff(e.midi);}assert.equal(app.state.passed,true,l.id);assert.equal(app.state.learningProgress[l.id].fingerprint,A.pianoSignature(l));for(const other of [...l.learning.requires,...ids.filter(id=>id!==l.id)])assert.equal(Object.hasOwn(app.state.learningProgress,other),false);await app.legacyProgressStore.settled();app.resetLessonState();}
});

test('preparation precedes both lessons and no piece or unsupported model is required',()=>{
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id);
 for(const l of units){assert.equal(l.learning.stage,'p3');for(const req of l.learning.requires)assert.ok(route.indexOf(req)>=0&&route.indexOf(req)<route.indexOf(l.id),req);assert.ok(!l.learning.requires.some(id=>id.includes('piece')));assert.equal(l.learning.coverageDomain,'rhythm');}assert.equal(units[0].learning.nextLessonId,ids[1]);
});

test('primary evidence supports concepts while card keeps project decisions and transfer limits explicit',()=>{
 const ledger=require('../docs/piano-curriculum-sources.json');for(const l of units){for(const id of l.learning.sourceEvidenceIds)assert.ok(ledger.entries.find(x=>x.id===id)?.applications.some(x=>x.batch==='2026-11-11-01'&&x.lessonIds.includes(l.id)),id);assert.equal(l.learning.practiceSteps.length,5);assert.equal(l.learning.selfCheck.length,5);assert.equal(l.learning.provenance.type,'project-technical-drill');a.state.lesson=l;a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();for(const phrase of ['48 BPM','8 долей','не являются независимым тестом слуха','на следующий день','пальцы','переноса'])assert.ok(html.includes(phrase),phrase);for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';assert.equal(a.learningMaterialHtml(),'');}}
});

test('preview preserves exact silences and durations at different playback tempos',()=>{
 for(const l of units){a.state.lesson=l;for(const bpm of [36,48,60])for(const[i,s]of l.rhythm.steps.entries())assert.ok(Math.abs(a.previewSoundDurationMs(l,i,bpm,60000/bpm)-s.durationBeats*60000/bpm)<1e-6);}
});

test('reinstall and catalog exchange preserve user notation,classification,instructions and order',async()=>{
 const app=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),x=app.lessons.find(x=>x.id===ids[0]);x.contentKind='piece';x.order=2;app.lessons.find(x=>x.id===ids[1]).order=1;x.guide.setup='personal';x.learning.practiceSteps[0]='personal';x.pattern=x.pattern.replace(/^\S+/,'y');x.steps=app.parsePattern(x.pattern).steps;const saved=copy(x);app.installReviewedLessons();assert.deepEqual(copy(app.lessons.find(x=>x.id===ids[0])),saved);assert.equal(await app.importCatalogText(app.catalogExportText(),()=>true),true);const now=app.lessons.find(x=>x.id===ids[0]);assert.equal(now.contentKind,'piece');assert.equal(now.order,2);assert.equal(app.lessons.find(x=>x.id===ids[1]).order,1);assert.equal(now.guide.setup,'personal');assert.deepEqual(copy(now.steps),saved.steps);assert.equal(app.lessons.filter(x=>x.id===ids[0]).length,1);
});

test('canonical server keeps450 previous editions and adds two independently keyed goals',()=>{
 const course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(x=>x.id===row.id)),row.fullRecordSha256,row.id);assert.deepEqual(course.route.filter(x=>before.server.route.includes(x)),before.server.route);for(const l of units){const row=course.lessons.find(x=>x.id===l.id);assert.equal(row.goalKey,l.id);assert.equal(row.gradeFingerprint,A.pianoSignature(l));assert.deepEqual(row.requires,copy(l.learning.requires));}
 const r=require('../tools/piano-skill-coverage.cjs').build(),counts=require('./fixtures/piano-curriculum-counts.json');for(const key of Object.keys(r.counts))assert.deepEqual(r.counts[key],counts[key],key);assert.equal(r.counts.verifiedDistinctGoalCount,null);assert.equal(r.counts.independentTeacherReviewed,0);const without=r.lessons.filter(l=>!ids.includes(l.id));assert.equal(r.counts.goalGroupUpperBound-require('../tools/piano-skill-coverage.cjs').goalAccounting(without).goalGroupUpperBound,2);
});
