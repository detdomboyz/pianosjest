'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const reference = require('./fixtures/fingering-reference.json');
const app = loadApp();
const plain = value => JSON.parse(JSON.stringify(value));
const keyFor = midi => Object.keys(app.KEY_MAP).find(key => app.KEY_MAP[key] === midi);
function make(notes, hand) {
  const pattern = notes.map(m => Array.isArray(m) ? '['+m.map(keyFor).join('')+']' : keyFor(m)).join(' ');
  const lesson = app.makeLesson('musical-reference', '', '', '', pattern);
  lesson.handMode = hand;
  return lesson;
}
function expectFingers(notes, hand, expected) {
  const plan = app.buildFingeringPlan(make(notes, hand));
  assert.deepEqual(plain(plan.issues), []);
  assert.deepEqual(plain(plan.steps.map(step => step.map(n => n.num))), expected.map(n => Array.isArray(n) ? n : [n]));
  assert.ok(plan.steps.every(step => step.every(n => n.hand === hand)));
}

for (const scale of reference.majorScales) {
  for (const hand of ['right', 'left']) {
    test(`Hanon crossings: ${scale.key} major ${hand} ascending`, () => expectFingers(scale.notes, hand, scale[hand]));
    test(`Hanon crossings: ${scale.key} major ${hand} descending`, () => expectFingers(scale.notes.slice().reverse(), hand, scale[hand].slice().reverse()));
  }
}

// Independent harmonic-minor examples on Hanon pp.50, 51, 53.
for(const [key,notes] of [['A',[69,71,72,74,76,77,80,81]],['D',[62,64,65,67,69,70,73,74]],['C',[60,62,63,65,67,68,71,72]]]){
  for(const hand of ['right','left']){
    test(`harmonic ${key} minor ${hand}: ascending and descending`,()=>{
      const expected=hand==='right'?[1,2,3,1,2,3,4,5]:[5,4,3,2,1,3,2,1];
      expectFingers(notes,hand,expected);
      expectFingers(notes.slice().reverse(),hand,expected.slice().reverse());
    });
  }
}

for (const hand of ['right', 'left']) {
  test(`two octaves C major ${hand}: no terminal little finger in the middle`, () => {
    const notes = [60,62,64,65,67,69,71,72,74,76,77,79,81,83,84];
    const expected = hand==='right' ? [1,2,3,1,2,3,4,1,2,3,1,2,3,4,5] : [5,4,3,2,1,3,2,1,4,3,2,1,3,2,1];
    expectFingers(notes,hand,expected);
    expectFingers(notes.slice().reverse(),hand,expected.slice().reverse());
  });
  test(`chromatic C-C ${hand}: third fingers play black keys`, () => {
    const notes=Array.from({length:13},(_,i)=>60+i);
    const expected=hand==='right'?[1,3,1,3,1,2,3,1,3,1,3,1,2]:[1,3,1,3,2,1,3,1,3,1,3,2,1];
    expectFingers(notes,hand,expected);
    expectFingers(notes.slice().reverse(),hand,expected.slice().reverse());
  });
  test(`C major arpeggio ${hand}: conventional one and two octave crossings`, () => {
    expectFingers([60,64,67,72],hand,hand==='right'?[1,2,3,5]:[5,4,2,1]);
    expectFingers([72,67,64,60],hand,hand==='right'?[5,3,2,1]:[1,2,4,5]);
    expectFingers([60,64,67,72,76,79,84],hand,hand==='right'?[1,2,3,1,2,3,5]:[5,4,2,1,4,2,1]);
  });
  test(`root triad and octave ${hand}`, () => {
    expectFingers([[60,64,67]],hand,[hand==='right'?[1,3,5]:[5,3,1]]);
    expectFingers([[60,72]],hand,[hand==='right'?[1,5]:[5,1]]);
  });
}

test('black-key chord can legitimately use the thumb', () => {
  const plan=app.buildFingeringPlan(make([[61,65,68]],'right'));
  assert.equal(plan.steps[0][0].num,1);
  assert.equal(plan.issues.length,0);
});

test('do not force scale templates across a written rest', () => {
  const l=make([60,62,64,65,67,69,71,72],'right');
  l.rhythm={steps:l.steps.map((_,i)=>({startBeat:i+(i>=4?2:0),durationBeats:1}))};
  assert.equal(app.phraseGap(l,3,4),.15);
  assert.equal(app.buildFingeringPlan(l).issues.length,0);
});

test('right-hand exercise stays right even below middle C', () => {
  const p=app.buildFingeringPlan(make([48,50,52,53,55],'right'));
  assert.ok(p.steps.flat().every(n=>n.hand==='right'));
});

test('two-hand wide chord splits at the large gap', () => {
  const p=app.buildFingeringPlan(make([[60,64,67,76]],'auto'));
  assert.deepEqual(plain(p.steps[0].map(n=>n.hand)),['left','left','left','right']);
});

test('beginner course: all 80 exercises and 1036 assignments meet declared constraints', () => {
  const audit=app.auditBeginnerCurriculum(true);
  assert.equal(audit.ok,true,JSON.stringify(audit.issues));
  assert.equal(audit.lessonsChecked,80);
  assert.equal(audit.fingeringNotesChecked,1036);
  for(const lesson of app.lessons.filter(l=>l.curriculumStage)){
    assert.ok(lesson.fingeringSpec,lesson.id);
    const p=app.buildFingeringPlan(lesson);
    lesson.fingeringSpec.steps.forEach((step,i)=>step.forEach((fixed,j)=>{
      assert.equal(p.steps[i][j].hand,fixed.hand,lesson.id);
      assert.equal(p.steps[i][j].num,fixed.num,lesson.id);
    }));
  }
});

test('authored transfer exercises change fingers at the intended new positions', () => {
  const l=app.lessons.find(l=>l.id==='course10-03');
  const p=app.buildFingeringPlan(l);
  assert.deepEqual(plain(p.steps.map(s=>s[0].num)),[1,2,3,4,5,1,2,3,4,5,5,4,3,2,1,5,4,3,2,1]);
});
