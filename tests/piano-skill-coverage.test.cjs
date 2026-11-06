'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Coverage=require('../tools/piano-skill-coverage.cjs');
test('explicit same-goal chains form one group and cannot hide missing targets or cycles',()=>{
 assert.deepEqual(Coverage.sameGoalGroups([{id:'a'},{id:'b',sameGoalAs:'a'},{id:'c',sameGoalAs:'b'},{id:'d'}]),[{primaryId:'a',lessonIds:['a','b','c']}]);
 for(const rows of [[{id:'a',sameGoalAs:'missing'}],[{id:'a',sameGoalAs:42}],[{id:'a',sameGoalAs:'a'}],[{id:'a',sameGoalAs:'b'},{id:'b',sameGoalAs:'a'}],[{id:'a'},{id:'a'}]])assert.throws(()=>Coverage.sameGoalGroups(rows),/same-goal|goal relations/);
});
test('the actual cadence repetitions reduce only a documented upper bound, never certify distinct goals',()=>{
 const report=Coverage.build();assert.deepEqual(report.sameGoalGroups.find(g=>g.primaryId==='course08-05'),{primaryId:'course08-05',lessonIds:['course08-05','course10-06','detail-p-chordmove-04']});assert.ok(report.counts.explicitSameGoalVariants>=2);assert.equal(report.counts.goalGroupUpperBound,report.counts.implementedLearningLessons-report.counts.explicitSameGoalVariants-report.counts.explicitCheckpoints);assert.equal(report.counts.verifiedDistinctGoalCount,null);
 for(const id of ['detail-p-chordmove-04','course10-06'])assert.equal(report.lessons.find(l=>l.id===id).sameGoalAs,'course08-05');
});

test('every counted implemented skill appears in one real domain of the actual coverage map',()=>{
  const report=Coverage.build(),mapped=report.lessons.filter(l=>l.coverageDomain),members=report.domains.flatMap(d=>d.lessonIds);
  assert.equal(members.length,report.counts.individuallyMappedToDomain);assert.deepEqual(new Set(members),new Set(mapped.map(l=>l.id)));assert.equal(new Set(members).size,members.length);
  assert.ok(report.domains.find(d=>d.id==='ear-transfer').lessonIds.includes('detail-p-hearing-01'));
});

test('an unknown implemented domain cannot inflate the coverage counter while disappearing from the map',()=>{
  assert.throws(()=>Coverage.validateMappedLessons([{id:'bad-domain',coverageDomain:'hearing'}]),/Unknown implemented coverage domain: bad-domain \/ hearing/);
  assert.doesNotThrow(()=>Coverage.validateMappedLessons([{id:'known',coverageDomain:'ear-transfer'},{id:'legacy',coverageDomain:null}]));
});

test('explicit checkpoints have known preparation and are excluded once without being aliases',()=>{
 const rows=[{id:'a'},{id:'b',sameGoalAs:'a'},{id:'check',goalCounting:'checkpoint-only',requires:['a']}],r=Coverage.goalAccounting(rows);
 assert.equal(r.explicitSameGoalVariants,1);assert.equal(r.explicitCheckpoints,1);assert.equal(r.goalGroupUpperBound,1);assert.deepEqual(r.checkpointLessonIds,['check']);
 for(const malformed of [
  [{id:'a',goalCounting:'unknown'}],
  [{id:'a'},{id:'check',goalCounting:'checkpoint-only',requires:[]}],
  [{id:'a'},{id:'check',goalCounting:'checkpoint-only',requires:['missing']}],
  [{id:'a'},{id:'check',goalCounting:'checkpoint-only',requires:['check']}],
  [{id:'a'},{id:'check',goalCounting:'checkpoint-only',requires:['a','a']}],
  [{id:'a'},{id:'check',goalCounting:'checkpoint-only',requires:['a'],sameGoalAs:'a'}],
  [{id:'a'},{id:'check',goalCounting:'checkpoint-only',requires:['a']},{id:'copy',sameGoalAs:'check'}]
 ])assert.throws(()=>Coverage.goalAccounting(malformed),/Checkpoint|checkpoint|goal counting/);
});

test('actual final exam is a distinct control record, not an independent new goal or a one-component alias',()=>{
 const r=Coverage.build(),l=r.lessons.find(l=>l.id==='course10-08');assert.equal(l.goalCounting,'checkpoint-only');assert.equal(l.sameGoalAs,null);assert.deepEqual(r.checkpointLessonIds,['course10-08']);assert.equal(r.counts.explicitCheckpoints,1);assert.equal(r.counts.goalGroupUpperBound,r.counts.implementedLearningLessons-r.counts.explicitSameGoalVariants-r.counts.explicitCheckpoints);
});

test('future held-voice plans keep each hand and finger distinct in the coverage table',()=>{
 const plans=Coverage.build().plannedLessons;
 const left=plans.find(l=>l.id==='detail-p-held-voice-01'),right=plans.find(l=>l.id==='detail-p-held-voice-02');
 assert.equal(Coverage.plannedFingering(left),'левая C3/5; правая E4/3; правая D4/2');
 assert.equal(Coverage.plannedFingering(right),'правая E4/3; левая C3/5; левая D3/4');
 assert.equal(plans.some(l=>l.id==='detail-p-rhythm-final-rest-01'),false,'Implemented final-rest lesson must not remain a future plan');
 assert.throws(()=>Coverage.plannedFingering({id:'invalid',hand:'both',targetNotes:[{midi:60,hand:'left',finger:0}]}),/Invalid planned two-hand fingering/);
});
