'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const assessment = require('../practice-assessment.js');
const { next } = require('../curriculum.js');
const game = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-b-major-paired-middle-v1.json');
const previous = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');

const id = 'detail-p-b-major-prepared-paired-middle-01';
const upperTurn = 'detail-p-b-major-prepared-paired-upper-turn-01';
const preparation = [
  'detail-p-b-major-prepared-roundtrip-left-01',
  'detail-p-b-major-prepared-roundtrip-right-01',
  'detail-p-fsharp-major-middle-three-paired-ascent-01'
];
const sourceIds = [
  'pff-b-major-ascending-thumb-fourth-left-2026-11-15',
  'pff-b-major-ascending-prepared-right-2026-11-15'
];
const pairs = [[51, 63], [52, 64], [54, 66]];
const digits = [[2, 3], [1, 1], [4, 2]];
const steps = pairs.map((midis, startBeat) => ({ midis, startBeat, durationBeats: startBeat === 2 ? 2 : 1 }));
const batch = '2026-11-27-01';
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(l => l.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [app.stepMidiList(step), lesson.fingeringSpec.steps[i]]));

test('the middle of B major uses both thumbs and the prepared unequal fingers', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the B-major paired crossing');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.stage, 'p7');
  assert.deepEqual(plain(lesson.learning.requires), preparation);
  const combined = frames(lesson);
  assert.deepEqual(combined, pairs.map((midis, i) => [midis, [
    { hand: 'left', num: digits[i][0] }, { hand: 'right', num: digits[i][1] }
  ]]));
  for (const [hand, index] of preparation.slice(0, 2).entries()) {
    assert.deepEqual(combined.map(([midis, fingers]) => [[midis[hand]], [fingers[hand]]]), frames(find(index)).slice(2, 5));
  }
  assert.deepEqual(combined[2], frames(find(upperTurn))[0]);
  assert.notDeepEqual(frames(find(preparation[2])).map(([,fingers]) => fingers.map(f => f.num)), digits);
  const position = plan.piano.findIndex(l => l.id === id);
  assert.ok(preparation.every(key => plan.piano.findIndex(l => l.id === key) >= 0 &&
    plan.piano.findIndex(l => l.id === key) < position));
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('the three pairs share attacks and the final pair lasts two beats in both assessors', () => {
  const lesson = find(id);
  const stored = course.lessons.find(l => l.id === id);
  assert.ok(lesson && stored?.challengeReady);
  assert.deepEqual(stored.steps, steps);
  assert.equal(stored.profile, 'standard');
  assert.equal(stored.timingPrecision, 'beat-boundary-v2');
  assert.equal(stored.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  const beat = 1500, start = 1000, end = start + 4 * beat;
  const events = steps.flatMap(({midis, startBeat, durationBeats}) => midis.flatMap(midi => [
    {type: 'on', midi, at: start + startBeat * beat, source: 'midi'},
    {type: 'off', midi, at: start + (startBeat + durationBeats) * beat, source: 'midi'}
  ]));
  const probes = {
    correct: events,
    'late right thumb': events.map(e => e.type === 'on' && e.midi === 64 ? {...e, at: e.at + 220} : e),
    'F natural': events.map(e => e.midi === 54 ? {...e, midi: 53} : e),
    'short final left note': events.map(e => e.type === 'off' && e.midi === 54 ? {...e, at: e.at - 1100} : e),
    'final right key still held': events.filter(e => !(e.type === 'off' && e.midi === 66))
  };
  for (const [caseName, sample] of Object.entries(probes)) {
    const sorted = [...sample].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const result = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((s, i) => ({...s, midis: app.stepMidiList(lesson.steps[i])})),
      events: sorted, bpm: 40, targetBpm: 40, profile: stored.profile, timingPrecision: stored.timingPrecision
    });
    assert.equal(result.clean, caseName === 'correct', caseName);
    assert.equal(game.grade(stored, game.eventsInput(sorted, end), 'challenge', end, false).assessment.clean, result.clean, caseName);
  }
});

test('all previous records, editions, routes and source applications retain their fingerprints', () => {
  const ids = new Set([...previous.catalogIds, upperTurn]);
  const earlier = learning.filter(l => ids.has(l.id));
  assert.equal(ids.size, before.catalogRecords);
  assert.equal(earlier.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(l => ids.has(l.id))), before.catalogHash);
  assert.equal(hash(app.themes), before.themeHash);
  assert.equal(hash(plan.piano.filter(l => ids.has(l.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(l => ids.has(l.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => ids.has(key))), before.canonicalRouteHash);
  assert.equal(hash(earlier.map(l => [l.id, next(plan, 'piano', learning, l.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  const earlierSources = ledger.entries.slice(0,before.sourceEntries).map(source => {
    const row = plain(source);
    if (row.applications) {
      row.applications = row.applications.filter(application => application.batch < batch);
      if (!row.applications.length) delete row.applications;
    }
    return row;
  });
  assert.equal(hash(earlierSources), before.sourceHash);
});

test('the card credits the source for each hand and offers an open transfer', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай фразу из 4–6 пар/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const applied = ledger.entries.flatMap(source => (source.applications || [])
    .filter(a => a.batch === batch && a.lessonIds.includes(id)).map(a => [source.id, a]));
  assert.deepEqual(applied.map(([key]) => key).sort(), [...sourceIds].sort());
  for (const [, application] of applied) {
    assert.ok(application.sourceRuleReused);
    assert.match(application.sourceImageSha256, /^[a-f0-9]{64}$/);
  }
});

test('the lesson can be edited and exchanged without resetting the personal notes or teaching text', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const [first, ...tail] = lesson.pattern.split(' ');
  const [changedKey] = Object.entries(editor.KEY_MAP).find(([key, midi]) => key.length === 1 && midi === 65);
  lesson.pattern = ['[' + first[1] + changedKey + ']', ...tail].join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[0])), [51, 65]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка';
  lesson.learning.practiceSteps[0] = 'Мой счёт';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const key of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[key], saved[key]);
  for (const key of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[key]), saved[key]);
});
