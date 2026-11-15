'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),G=require('../service/game-grade.cjs');
const before=require('./fixtures/piano-before-left-barline-hold-v1.json'),id='detail-p-barline-hold-left-01',copy=x=>JSON.parse(JSON.stringify(x));
const hash=x=>crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:JSON.stringify(x)).digest('hex');
const app=loadApp(),lesson=app.lessons.find(l=>l.id===id),notes=[48,50,52,50,52,50,48],fingers=[5,4,3,4,3,4,5],starts=[0,1,2,3.5,4.5,5,6],durations=[1,1,1,1,.5,1,2];
function score(l){app.state.lesson=l;app.state.mode='score';app.state.attemptMode='practice';app.state.playbackBpm=48;return app.scoreViewHtml();}
function events(mode='clean'){
 return notes.flatMap((midi,i)=>{
  let s=starts[i],e=s+durations[i];if(mode==='filled-rest'&&i===2)e=3.5;if(mode==='release-on-bar'&&i===3)e=4;if(mode==='early-next'&&i===4)s=4;
  if(mode==='missing'&&i===3)return[];if(mode==='wrong-pitch'&&i===3)midi++;if(mode==='short-final'&&i===6)e=6.5;
  const source=mode==='keyboard'?'keyboard':'midi',on=t=>({type:'on',midi,at:1000+t*1250,source}),off=t=>({type:'off',midi,at:1000+t*1250,source});
  if(mode==='reattack-on-bar'&&i===3)return[on(s),off(4),on(4),off(e)];return[on(s),off(e)];
 }).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}
function assess(es){return A.assessPiano({steps:lesson.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(lesson.steps[i])})),events:es,bpm:48,targetBpm:48,profile:lesson.learning.articulation,timingPrecision:lesson.learning.timingPrecision});}

test('one new barline goal preserves all603 complete records,themes,versions and existing routes',()=>{
 assert.ok(lesson);const old=new Set(before.catalog.map(l=>l.id)),cohort=app.lessons.filter(l=>old.has(l.id)||l.id===id);assert.deepEqual(copy(cohort.filter(l=>!old.has(l.id)).map(l=>l.id)),[id]);
 for(const row of before.catalog){const l=app.lessons.find(l=>l.id===row.id);assert.equal(hash(l),row.fullRecordSha256,row.id);assert.equal(A.pianoSignature(l),row.grade,row.id);assert.equal(l.order,row.order);assert.equal(l.themeId,row.themeId);}
 assertPreservedThemes(app.themes,before.themes);assert.equal(hash(fs.readFileSync('lesson-review-baseline.js')),before.protectedBaselineSha256);assert.equal(hash(fs.readFileSync('service/schema.pg.sql')),before.server.schemaSha256);
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),before.guitarRouteSha256);assert.deepEqual(copy(c.MUSIC_CURRICULUM_PLAN.piano.filter(l=>old.has(l.id)).map(l=>l.id)),before.pianoRoute);
});

test('left ring4 crosses the downbeat from four-and to next one-and with one true rest and seven attacks',()=>{
 app.state.lesson=lesson;assert.equal(app.challengeEligible(),true);assert.equal(lesson.handMode,'left');assert.deepEqual(copy(lesson.steps.map(app.stepMidiList)),notes.map(n=>[n]));assert.deepEqual(copy(lesson.fingeringSpec.steps.map(s=>s.map(n=>[n.hand,n.num]))),fingers.map(n=>[['left',n]]));
 assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.startBeat)),starts);assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.durationBeats)),durations);assert.deepEqual(copy(lesson.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,0,.5,0,0,0]);assert.equal(lesson.rhythm.steps.at(-1).startBeat+lesson.rhythm.steps.at(-1).durationBeats,8);
 assert.equal(lesson.rhythm.steps.some(s=>s.startBeat===4),false);assert.equal(lesson.rhythm.practiceBpm,48);assert.deepEqual(copy(lesson.rhythm.timeSignature),{numerator:4,denominator:4});assert.equal(lesson.learning.articulation,'standard');assert.equal(lesson.learning.timingPrecision,'beat-boundary-v2');assert.equal(lesson.learning.sameGoalAs,undefined);
});

test('real client and server distinguish one continuous note from a reattack or release at the barline',()=>{
 const row=require('../service/course-registry.json').lessons.find(l=>l.id===id);assert.ok(row);
 for(const mode of ['clean','reattack-on-bar','release-on-bar','early-next','filled-rest','missing','wrong-pitch','short-final','keyboard']){const es=events(mode),end=es.at(-1).at;assert.equal(assess(es).clean,mode==='clean','client '+mode);assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,mode==='clean','server '+mode);}
 const prep=app.lessons.find(l=>l.id==='detail-p-syncopation-hold-left-01');assert.notEqual(A.pianoSignature(lesson),A.pianoSignature(prep));
});

test('actual MIDI handlers retain D3 across the first beat and require the full final release',async()=>{
 const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(l=>l.id===id));a.state.attemptMode='challenge';const es=events();
 for(const[i,e]of es.entries()){clock.now=5000+e.at-1000;if(i===es.length-1)assert.equal(a.state.completed,false);if(e.type==='on')a.handleNoteOn(e.midi,'midi');else a.handleNoteOff(e.midi);if(e.type==='on'&&e.at===1000+3.5*1250){clock.now=5000+4*1250;assert.equal(a.state.active.has(50),true);assert.equal(a.state.completed,false);}}
 assert.equal(a.state.passed,true);assert.equal(a.state.learningProgress[id].fingerprint,A.pianoSignature(lesson));for(const req of lesson.learning.requires)assert.equal(Object.hasOwn(a.state.learningProgress,req),false);await a.legacyProgressStore.settled();a.resetLessonState();
});

test('preparations,count,fingers,source scope and transfer render while memory contains no continuation hints',()=>{
 assert.deepEqual(copy(lesson.learning.requires),['detail-p-syncopation-hold-left-01','detail-p-left-half-01']);const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(l=>l.id);for(const req of lesson.learning.requires)assert.ok(route.indexOf(req)>=0&&route.indexOf(req)<route.indexOf(id));
 const sources=require('../docs/piano-curriculum-sources.json');for(const sourceId of lesson.learning.sourceEvidenceIds)assert.ok(sources.entries.find(e=>e.id===sourceId)?.applications.some(a=>a.batch==='2026-11-11-05'&&a.freshReadInCurrentBatch&&a.lessonIds.includes(id)),sourceId);
 app.state.lesson=lesson;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['5–4–3–4–3–4–5','четыре-и','раз-и','3–3,5','8 долей','не новый урок','на следующий день','MIDI не видит'])assert.ok(html.includes(text),text);assert.equal(lesson.learning.provenance.type,'project-technical-drill');
 assert.match(score(lesson),/data-score-continuation="3"/);for(const mode of ['compact','expanded','hidden']){app.state.attemptMode='memory';app.state.learningMaterialMode=mode;assert.equal(app.learningMaterialHtml(),'');assert.doesNotMatch(app.scoreViewHtml(),/data-score-(?:step|continuation)|Держать|Продолжение|без нового нажатия/);}
});

test('preview duration and render scaling preserve one held event at each chosen tempo',()=>{
 for(const bpm of [36,48,60]){app.state.lesson=lesson;app.state.playbackBpm=bpm;app.state.attemptMode='practice';app.state.mode='score';for(const[i,d]of durations.entries())assert.ok(Math.abs(app.previewSoundDurationMs(lesson,i,bpm,60000/bpm)-d*60000/bpm)<1e-6);assert.match(app.scoreViewHtml(),/data-score-continuation="3"/);}
 assert.equal(events().filter(e=>e.type==='on'&&e.at>=1000+3.5*1250&&e.at<1000+4.5*1250).length,1);
});

test('server455 editions,personal catalogue roundtrip and counts stay independent of continuation display',async()=>{
 const course=require('../service/course-registry.json');assert.deepEqual(course,copy(require('../tools/build-service-curriculum.cjs').build()));for(const row of before.server.lessons)assert.equal(hash(course.lessons.find(l=>l.id===row.id)),row.fullRecordSha256,row.id);const old=new Set(before.server.lessons.map(l=>l.id));assert.deepEqual(course.route.filter(id=>old.has(id)),before.server.route);const row=course.lessons.find(l=>l.id===id);assert.equal(row.goalKey,id);assert.equal(row.gradeFingerprint,A.pianoSignature(lesson));
 const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()}),l=a.lessons.find(l=>l.id===id);l.contentKind='piece';l.guide.setup='personal-barline';l.learning.practiceSteps[0]='personal-step';l.pattern=l.pattern.replace(/^\S+/,'9');l.steps=a.parsePattern(l.pattern).steps;const saved=copy(l);a.installReviewedLessons();assert.deepEqual(copy(a.lessons.find(l=>l.id===id)),saved);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);const now=a.lessons.find(l=>l.id===id);assert.equal(now.contentKind,'piece');assert.equal(now.guide.setup,'personal-barline');assert.deepEqual(copy(now.steps),saved.steps);
 const coverage=require('../tools/piano-skill-coverage.cjs'),report=coverage.build(),counts=require('./fixtures/piano-curriculum-counts.json');for(const key of Object.keys(report.counts))assert.deepEqual(report.counts[key],counts[key],key);assert.equal(report.counts.verifiedDistinctGoalCount,null);assert.equal(report.counts.independentTeacherReviewed,0);
});

test('left barline and previous left syncopation reject each other without sharing a goal or edition',()=>{
 const previous=app.lessons.find(l=>l.id==='detail-p-syncopation-hold-left-01'),course=require('../service/course-registry.json');
 const oldRow=course.lessons.find(l=>l.id===previous.id),row=course.lessons.find(l=>l.id===id);
 const ns=[48,50,52,50,48,50,52,50],ss=[0,1,2.5,3.5,4,5,6.5,7.5],ds=[1,1,1,.5,1,1,1,.5];
 const previousEvents=ns.flatMap((midi,i)=>[{type:'on',midi,source:'midi',at:1000+ss[i]*1250},{type:'off',midi,source:'midi',at:1000+(ss[i]+ds[i])*1250}]).sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
 for(const[es,isNew]of [[events(),true],[previousEvents,false]]){
  const end=es.at(-1).at;
  assert.equal(assess(es).clean,isNew);
  assert.equal(A.assessPiano({steps:previous.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(previous.steps[i])})),events:es,bpm:48,targetBpm:48,profile:'standard',timingPrecision:'beat-boundary-v2'}).clean,!isNew);
  assert.equal(G.grade(row,G.eventsInput(es,end),'challenge',end,false).assessment.clean,isNew);
  assert.equal(G.grade(oldRow,G.eventsInput(es,end),'challenge',end,false).assessment.clean,!isNew);
 }
 assert.notEqual(row.goalKey,oldRow.goalKey);assert.notEqual(row.musicVersion,oldRow.musicVersion);
});
