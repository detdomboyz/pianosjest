'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app.cjs');
const app = loadApp();
const plain = value => JSON.parse(JSON.stringify(value));
const lesson = id => app.lessons.find(item => item.id === id);
const fingers = id => plain(app.buildFingeringPlan(lesson(id)).steps.map(step => step.map(n => n.num)));

test('first left-hand C lesson teaches the promised little finger', () => {
  assert.deepEqual(fingers('course01-02'), Array.from({ length: 8 }, () => [5]));
});

test('left C-D exercise stays in its taught 5-4 position', () => {
  assert.deepEqual(fingers('course03-01'), [5,4,5,4,4,5,4,5].map(n => [n]));
});

test('right 4-5 exercise does not turn into a thumb exercise', () => {
  assert.deepEqual(fingers('course06-01'), [4,5,4,5,4,5,5,4,5,4].map(n => [n]));
});

test('mixed scale exam respects the hand specified for each phrase', () => {
  const plan = app.buildFingeringPlan(lesson('course06-08'));
  assert.deepEqual(plain(plan.steps.map(s => s[0].hand)), [
    ...Array(8).fill('right'), ...Array(8).fill('left'), ...Array(4).fill('right')
  ]);
});

test('stored fingering rejects NaN, fractions and unknown hands', () => {
  const l = app.makeLesson('validation', '', 'Правая рука', '', 't');
  for (const patch of [{ num: 'bad' }, { num: 1.3 }, { hand: 'other' }]) {
    const plan = plain(app.buildFingeringPlan(l));
    Object.assign(plan.steps[0][0], patch);
    assert.equal(app.normalizeStoredFingeringPlan(plan, l), null, JSON.stringify(patch));
  }
});

test('stored chord cannot use the same finger for distinct simultaneous notes', () => {
  const l = app.makeLesson('validation-chord', '', 'Правая рука', '', '[tuo]');
  const plan = plain(app.buildFingeringPlan(l));
  plan.steps[0].forEach(note => { note.num = 1; });
  assert.equal(app.normalizeStoredFingeringPlan(plan, l), null);
});

test('unplayable single-hand chord never silently borrows the other hand', () => {
  const l = app.makeLesson('wide', '', 'Правая рука', '', '[1m]');
  const plan = app.buildFingeringPlan(l);
  assert.ok(plan.issues?.length > 0, 'must expose an unsupported fingering');
  assert.equal(plan.steps[0].length, 0, 'must not display fabricated fingers');
});
