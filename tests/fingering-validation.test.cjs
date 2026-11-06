'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const app=loadApp();

test('simultaneous layout checks every finger pair, direction and range',()=>{
  assert.equal(app.fingerLayoutReachCost('right',[60,64],[3,4]),Infinity);
  assert.equal(app.fingerLayoutReachCost('right',[60,64,67],[5,3,1]),Infinity);
  assert.equal(app.fingerLayoutReachCost('left',[60,64,67],[1,3,5]),Infinity);
  assert.equal(app.fingerLayoutReachCost('right',[60,76],[1,5]),Infinity);
  assert.equal(app.fingerLayoutReachCost('right',[60,60],[1,2]),Infinity);
  assert.equal(app.fingerLayoutReachCost('right',[60],[NaN]),Infinity);
  assert.ok(Number.isFinite(app.fingerLayoutReachCost('right',[60,64,67],[1,3,5])));
});

test('unsupported action is isolated and does not remove later valid hints',()=>{
  const l=app.makeLesson('unsafe','','Правая рука','','t [1m] y');
  const p=app.buildFingeringPlan(l);
  assert.deepEqual(plain(p.issues.map(i=>i.stepIndex)),[1]);
  assert.equal(p.steps[1].length,0);
  assert.equal(p.steps[0].length,1);
  assert.equal(p.steps[2].length,1);
  assert.equal(app.fingerHint(36,l,1),null);
  assert.equal(app.serializeFingeringPlan(p),null);
});

test('more than ten simultaneous notes cannot turn into thumb placeholders',()=>{
  const l=app.makeLesson('eleven','','','','[1234567890q]');
  const p=app.buildFingeringPlan(l);
  assert.equal(p.steps[0].length,0);
  assert.equal(p.issues.length,1);
});

test('overlapping durations are explicitly unsupported instead of reusing a held finger',()=>{
  const l=app.makeLesson('held','','Правая рука','','t y u');
  l.rhythm={steps:[{startBeat:0,durationBeats:3},{startBeat:1,durationBeats:.5},{startBeat:3,durationBeats:1}]};
  const p=app.buildFingeringPlan(l);
  assert.equal(p.issues[0].code,'held-voices');
  assert.equal(p.steps[1].length,0);
  assert.equal(p.steps[2].length,1);
});

test('changing rhythm, hand mode or teaching intent invalidates saved plans',()=>{
  const l=plain(app.lessons.find(l=>l.id==='course02-03'));
  const p=app.buildFingeringPlan(l);
  assert.ok(app.normalizeStoredFingeringPlan(plain(p),l));
  for(const mutate of [x=>{x.rhythm.steps[0].durationBeats=4;},x=>{x.handMode='left';},x=>{x.fingeringSpec.steps[0][0].num=2;}]){
    const changed=plain(l);mutate(changed);
    assert.notEqual(app.fingeringSignature(changed),p.signature);
    assert.equal(app.normalizeStoredFingeringPlan(p,changed),null);
  }
});

test('legacy automatic plans are rejected without changing the music',()=>{
  const l=app.makeLesson('legacy','','Правая','','t y u');
  const before=plain(l);
  const p=plain(app.buildFingeringPlan(l));p.version=3;
  assert.equal(app.normalizeStoredFingeringPlan(p,l),null);
  assert.deepEqual(plain(l),before);
});

test('malformed or stale teaching constraints fail visibly',()=>{
  for(const value of [0,6,1.5,NaN]){
    const l=app.makeLesson('invalid','','','','t');
    l.fingeringSpec={version:1,pattern:'t',steps:[[{hand:'right',num:value}]]};
    assert.equal(app.buildFingeringPlan(l).issues[0].code,'invalid-spec');
  }
});

test('catalog round-trip retains rhythm, intent, hand mode and a valid saved plan',()=>{
  const isolated=loadApp();
  const l=isolated.lessons.find(l=>l.id==='course06-08');
  l.handMode='split';l.fingeringPlan=isolated.buildFingeringPlan(l);
  const snapshot=plain(isolated.catalogSnapshot());
  assert.equal(isolated.applyCatalogSnapshot(snapshot),true);
  const after=isolated.lessons.find(item=>item.id===l.id);
  assert.deepEqual(plain(after.rhythm),plain(l.rhythm));
  assert.deepEqual(plain(after.fingeringSpec),plain(l.fingeringSpec));
  assert.equal(after.handMode,'split');
  assert.ok(after.fingeringPlan);
  assert.deepEqual(plain(after.fingeringPlan.steps),plain(l.fingeringPlan.steps));
});

test('loading an old catalog adds intent only for unchanged built-in exercises',()=>{
  const isolated=loadApp(),snapshot=plain(isolated.catalogSnapshot());
  for(const l of snapshot.lessons){delete l.fingeringSpec;l.fingeringPlan=null;}
  snapshot.lessons.find(l=>l.id==='course03-01').pattern='8 0 w';
  assert.equal(isolated.applyCatalogSnapshot(snapshot),true);
  assert.ok(isolated.lessons.find(l=>l.id==='course02-01').fingeringSpec);
  const edited=isolated.lessons.find(l=>l.id==='course03-01');
  assert.equal(Boolean(edited.fingeringSpec),false,'edited music must not inherit built-in finger assignments');
  isolated.state.lesson=edited;
  assert.equal(isolated.challengeEligible(),false,'edited music must not inherit the original MIDI contract');
});
