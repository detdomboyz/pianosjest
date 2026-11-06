'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),D=require('../lesson-development.js'),A=require('../practice-assessment.js');
const app=loadApp(),copy=v=>JSON.parse(JSON.stringify(v)),ids=['detail-p-legato-pairs-01','detail-p-legato-pairs-03','detail-p-legato-pairs-02','detail-p-legato-pairs-04'];
const adapter={makeLesson:app.makeLesson,keyMap:app.KEY_MAP,normalizeRhythm:app.normalizeLessonRhythm,normalizeGuide:app.normalizeLessonGuide,parsePattern:app.parsePattern,midis:app.stepMidiList,spacesBefore:app.lessonSpacesBefore};
function oldReleases(){const lessons=[],themes=[];D.registerPiano(lessons,themes,adapter,D.piano.filter(s=>s.group==='release'));P.reviewEarlyRelease(lessons,adapter);return lessons.filter(l=>/0[34]$/.test(l.id));}
test('position pairs retain the conventional C-position fingers and differ from thumb crossings',()=>{
  for(const [id,notes,digits,hand] of [[ids[0],[64,65,64,65],[3,4,3,4],'right'],[ids[1],[52,53,52,53],[3,2,3,2],'left'],[ids[2],[65,67,65,67],[4,5,4,5],'right'],[ids[3],[53,55,53,55],[2,1,2,1],'left']]){
    const l=app.lessons.find(l=>l.id===id);assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),notes);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),digits);
    assert.equal(l.handMode,hand);assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand===hand));assert.equal(l.learning.articulation,'legato');assert.ok(l.rhythm.steps.every((s,i)=>s.startBeat===i&&s.durationBeats===1));
    assert.ok(app.ensureFingeringPlan(l).steps.every(s=>s.length));app.state.lesson=l;assert.equal(app.challengeEligible(),true);assert.equal(l.learning.provenance.type,'project-technical-drill');
  }
  const crossing=app.lessons.find(l=>l.id==='detail-p-cross-01');assert.deepEqual(Array.from(crossing.fingeringSpec.steps,s=>s[0].num),[3,1,3,1]);
});
test('upper-position materials describe F–G and final G, while the earlier E–F explanations stay correct',()=>{
  for(const id of ids){const l=app.lessons.find(l=>l.id===id),upper=id.endsWith('02')||id.endsWith('04');
    assert.match(l.learning.practiceSteps[0],upper?/пропой F–G/:/пропой E–F/);
    assert.match(l.learning.practiceSteps[1],upper?/Последнюю G удержи/:/Последнюю F удержи/);
    assert.equal(l.learning.sourceEvidenceIds.includes('kovarsky-fingering-context-2026-11-05'),upper);
    if(upper){assert.ok(l.learning.selfCheck.some(s=>s.includes('F♯')));assert.ok(!l.learning.selfCheck.some(s=>s.includes('Между E и F')));}
  }
});
test('new MIDI examples require the checked pitches and a connected line',()=>{
  for(const id of ids){const l=app.lessons.find(l=>l.id===id),bpm=52,beat=60000/bpm,steps=l.rhythm.steps.map((s,i)=>({...s,midis:Array.from(app.stepMidiList(l.steps[i]))}));
    const events=steps.flatMap(s=>[{type:'on',midi:s.midis[0],at:1000+s.startBeat*beat,source:'midi'},{type:'off',midi:s.midis[0],at:1000+(s.startBeat+1)*beat}]);
    assert.equal(A.assessPiano({steps,events,bpm,targetBpm:bpm,profile:'legato'}).clean,true);
    const wrong=events.map(e=>({...e,midi:e.midi===steps[1].midis[0]?e.midi+1:e.midi}));assert.equal(A.assessPiano({steps,events:wrong,bpm,targetBpm:bpm,profile:'legato'}).clean,false);
    const gap=events.map((e,i)=>e.type==='off'&&i<events.length-1?{...e,at:e.at-160}:e);assert.equal(A.assessPiano({steps,events:gap,bpm,targetBpm:bpm,profile:'legato'}).clean,false);
  }
});
test('v1 description upgrade keeps music and prior review evidence, and removes visible internal IDs once',()=>{
  const lessons=oldReleases(),before=copy(lessons);assert.equal(P.upgradeReleaseLabels(lessons),2);
  lessons.forEach((l,i)=>{assert.equal(A.pianoSignature(l),A.pianoSignature(before[i]));assert.deepEqual(copy(l.learning.contentReview.previous),before[i].learning.contentReview);assert.equal(l.learning.contentReview.id,'early-release-v2');assert.doesNotMatch(D.materialHtml(l,'piano',String),/(?:course\d\d-|detail-p-)/);assert.doesNotMatch(l.guide.setup,/course\d\d-/);});
  const saved=copy(lessons);assert.equal(P.upgradeReleaseLabels(lessons),0);assert.deepEqual(copy(lessons),saved);
});
test('a matching old tag cannot authorize overwriting personal descriptions, rhythm or classification',()=>{
  const edits=[l=>l.guide.setup+=' Моя посадка',l=>l.learning.practiceSteps[0]='Мой разбор',l=>l.description='Моя цель',l=>l.rhythm.steps[0].durationBeats=.5,l=>l.contentKind='piece',l=>l.learning.contentReview.reviewedFingerprint='stale'];
  for(const original of oldReleases())for(const edit of edits){const l=copy(original);edit(l);const before=copy(l);assert.equal(P.upgradeReleaseLabels([l]),0);assert.deepEqual(l,before);}
});
test('the actual app preserves edited new lessons and review history through export/reload',()=>{
  const a=loadApp(),snapshot=a.catalogSnapshot(),l=snapshot.lessons.find(l=>l.id===ids[0]);l.title='Моя пара';l.learning.practiceSteps[0]='Моя подготовка';const count=a.lessons.length;
  a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.length,count);assert.equal(a.lessons.find(l=>l.id===ids[0]).title,'Моя пара');assert.equal(a.lessons.find(l=>l.id===ids[0]).learning.practiceSteps[0],'Моя подготовка');assert.equal(a.installReviewedLessons(),false);
  assert.equal(a.lessons.find(l=>l.id==='detail-p-release-04').learning.contentReview.previous.id,'early-release-v1');
});
