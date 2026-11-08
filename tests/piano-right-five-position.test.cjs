'use strict';
const {expectedGrade}=require('./helpers/piano-assessment-revisions.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js');
const originals=require('./fixtures/piano-right-five-position-v1.json'),published=require('./fixtures/piano-before-right-five-position-v1.json');
const app=loadApp(),copy=value=>JSON.parse(JSON.stringify(value)),bridge='detail-p-right-upper-position-01';
const adapter={normalizeGuide:app.normalizeLessonGuide};

test('right upper preparation has independent E4-F4-G4 pitches, 3-4-5 fingers, quarter values and one phrase rest',()=>{
  const l=app.lessons.find(l=>l.id===bridge),notes=[64,65,67,65,64];
  assert.deepEqual(copy(l.steps.map(app.stepMidiList)),[...notes,...notes].map(m=>[m]));
  assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s[0].num)),[3,4,5,4,3,3,4,5,4,3]);
  assert.ok(l.fingeringSpec.steps.every(s=>s.length===1&&s[0].hand==='right'));
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.startBeat)),[0,1,2,3,4,6,7,8,9,10]);
  assert.deepEqual(copy(l.rhythm.steps.map(s=>s.restBeforeBeats)),[0,0,0,0,0,1,0,0,0,0]);
  assert.ok(l.rhythm.steps.every(s=>s.durationBeats===1));
  assert.equal(l.rhythm.practiceBpm,52);assert.deepEqual(copy(l.rhythm.timeSignature),{numerator:4,denominator:4});
  assert.equal(l.learning.articulation,'standard');assert.equal(l.learning.machineCheck,'piano-midi');
  assert.equal(l.contentKind,'exercise');assert.equal(l.handMode,'right');assert.equal(l.learning.ending,undefined);
  assert.equal(l.learning.provenance.type,'project-technical-drill');
});

test('all 571 published musical payloads, assessment versions, classification and original order survive the teaching changes',()=>{
  assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);
  const oldIds=new Set(published.lessons.map(l=>l.id));
  assert.deepEqual(copy(app.lessons.filter(l=>oldIds.has(l.id)).map(l=>l.id)),published.lessons.map(l=>l.id));
  for(const old of published.lessons){
    const l=app.lessons.find(l=>l.id===old.id);
    assert.equal(A.pianoSignature(l),expectedGrade(old),old.id);
    const payload=JSON.stringify(require('./helpers/piano-assessment-revisions.cjs').historicalMusic(l,old));
    assert.equal(crypto.createHash('sha256').update(payload).digest('hex'),old.musicSha256,old.id);
    assert.equal(l.contentKind,old.kind);assert.equal(l.themeId,old.themeId);assert.equal(l.order,old.order);
  }
});

test('right-hand review is guarded, idempotent and retains both prior instructions and the older three-finger review',()=>{
  const lessons=originals.map(r=>copy(r.lesson));
  assert.equal(P.reviewRightFiveFingerPreparation(lessons,adapter),3);
  for(const original of originals){
    const l=lessons.find(l=>l.id===original.id),review=l.learning.contentReview;
    assert.equal(A.pianoSignature(l),original.assessmentFingerprint);
    assert.equal(review.sourceFingerprint,original.instructionFingerprint);
    assert.equal(review.previousAssessmentFingerprint,original.assessmentFingerprint);
    assert.deepEqual(review.previousInstruction,{description:original.lesson.description,guide:original.lesson.guide,learning:original.lesson.learning});
  }
  assert.equal(lessons[0].learning.contentReview.previousInstruction.learning.contentReview.id,'three-finger-reading-preparation-v1');
  assert.equal(P.reviewRightFiveFingerPreparation(lessons,adapter),0);
});

test('personal text, music, fingers, review and piece classification are not replaced by the guarded right-hand correction',()=>{
  for(const original of originals)for(const edit of [
    l=>{l.title+=' — моя редакция';},l=>{l.description+=' Мой разбор.';},
    l=>{l.learning.practiceSteps[0]='Мой способ разбора';},l=>{l.learning.requires=['my-preparation'];},
    l=>{l.rhythm.steps[0].durationBeats=0.5;},l=>{l.fingeringSpec.steps[0][0].num=2;},
    l=>{l.learning.contentReview={id:'personal-review'};},l=>{l.contentKind='piece';}
  ]){
    const l=copy(original.lesson);edit(l);const before=copy(l);
    assert.equal(P.reviewRightFiveFingerPreparation([l],adapter),0,original.id);
    assert.deepEqual(l,before);
  }
  const l=copy(originals[1].lesson);l.order=987;
  assert.equal(P.reviewRightFiveFingerPreparation([l],adapter),1);assert.equal(l.order,987);
});

test('route prepares upper right fingers without depending on later legato lessons or creating a cycle',()=>{
  const route=require('../tools/build-curriculum-plan.cjs').build().piano;
  const index=id=>route.findIndex(l=>l.id===id);
  for(const id of ['course02-02',bridge,'course02-03','course02-04','course02-05'])assert.ok(index(id)>=0,id);
  assert.ok(index('course02-02')<index(bridge));assert.ok(index(bridge)<index('course02-03'));
  assert.ok(index('course02-03')<index('course02-04'));assert.ok(index('course02-04')<index('course02-05'));
  for(const id of [bridge,'course02-03','course02-04']){
    const l=app.lessons.find(l=>l.id===id);
    assert.ok(!l.learning.requires.some(id=>id.startsWith('detail-p-legato')));
    for(const parent of l.learning.requires)assert.ok(index(parent)<index(id),parent+' before '+id);
  }
  const expected={'course02-02':bridge,[bridge]:'course02-03','course02-03':'course02-04','course02-04':'course02-05'};
  for(const [id,next]of Object.entries(expected))assert.equal(app.lessons.find(l=>l.id===id).learning.nextLessonId,next);
});

test('new and corrected cards retain source boundaries and hide all material in memory mode',()=>{
  const a=loadApp();
  for(const id of [bridge,'course02-03','course02-04']){
    const l=a.lessons.find(l=>l.id===id);a.state.lesson=l;a.state.stepIndex=0;
    a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';
    const html=a.learningMaterialHtml();
    assert.match(html,/Техническое упражнение проекта/);assert.match(html,/3–5 минут/);
    assert.ok(l.learning.requires.every(id=>html.includes(id)));
    for(const mode of ['compact','expanded','hidden']){
      a.state.attemptMode='memory';a.state.learningMaterialMode=mode;
      assert.equal(a.learningMaterialHtml(),'');assert.doesNotMatch(a.currentNoteHtml(),/E4|F4|G4|3–4–5/);
    }
  }
});
