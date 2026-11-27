'use strict';
const { assertPreservedThemes } = require('./helpers/assert-preserved-themes.cjs');
const preWaltzThemes = require('./fixtures/piano-before-csharp-major-prepared-paired-roundtrip-v1.json').themes;

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const before = require('./fixtures/piano-before-e-major-paired-roundtrip-v1.json');
const curriculum = require('../curriculum.js');
const assessment = require('../practice-assessment.js');
const game = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');

const id = 'detail-p-e-major-prepared-roundtrip-paired-01';
const requires = [
  'detail-p-e-major-connected-paired-ascent-01',
  'detail-p-e-major-connected-paired-descent-01',
  'detail-p-e-major-prepared-roundtrip-left-01',
  'detail-p-e-major-prepared-roundtrip-right-01'
];
const leftPitches = [52, 54, 56, 57, 59, 61, 63, 64, 63, 61, 59, 57, 56, 54, 52];
const leftFingers = [5, 4, 3, 2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 4, 5];
const rightFingers = [1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1];
const steps = leftPitches.map((midi, startBeat) => ({
  midis: [midi, midi + 12], startBeat, durationBeats: startBeat === 14 ? 2 : 1
}));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = lessonId => learning.find(lesson => lesson.id === lessonId);
const plan = vm.runInNewContext(
  fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {}
);
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const frames = lesson => plain(lesson.steps.map((step, i) => [
  app.stepMidiList(step), lesson.fingeringSpec.steps[i]
]));

test('paired E-major turn joins both prepared directions with one apex', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing paired E-major roundtrip');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.articulation, 'standard');
  assert.equal(lesson.learning.timingPrecision, 'beat-boundary-v2');
  assert.deepEqual(plain(lesson.learning.requires), requires);
  const sequence = frames(lesson);
  assert.deepEqual(sequence, steps.map(({ midis }, i) => [midis, [
    { hand: 'left', num: leftFingers[i] }, { hand: 'right', num: rightFingers[i] }
  ]]));
  const [ascent, descent, left, right] = requires.map(find);
  assert.deepEqual(sequence, [...frames(ascent), ...frames(descent).slice(1)]);
  for (const [index, hand] of [left, right].entries()) {
    assert.deepEqual(sequence.map(([midis, fingers]) => [[midis[index]], [fingers[index]]]), frames(hand));
  }
  assert.equal(sequence.filter(([[lowest]]) => lowest === 64).length, 1);
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats])),
    steps.map(s => [s.startBeat, s.durationBeats, 0]));
  const index = plan.piano.findIndex(row => row.id === id);
  assert.ok(index > 0 && requires.every(prep => plan.piano.findIndex(row => row.id === prep) < index));
  assert.equal(curriculum.next(plan, 'piano', learning, id), null);
});

test('paired E-major client and server agree on attack, release and timing failures', () => {
  const lesson = find(id);
  const row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.deepEqual(row.requires, requires);
  assert.deepEqual(row.steps, steps);
  const events = steps.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: 1000 + startBeat * 1500, source: 'midi' },
    { type: 'off', midi, at: 1000 + (startBeat + durationBeats) * 1500, source: 'midi' }
  ]));
  const lastRelease = 25000;
  const samples = {
    aligned: events,
    'missing right apex': events.filter((_, i) => i !== 30 && i !== 31),
    'rolled turn': events.map((event, i) => i === 34 || i === 35 ? { ...event, at: event.at + 180 } : event),
    'extra apex': [...events, { ...events[28], at: 12250 }, { ...events[29], at: 12500 }],
    'wrong left crossing': events.map((event, i) => i === 20 || i === 21 ? { ...event, midi: 60 } : event),
    'short final left tonic': events.map((event, i) => i === 57 ? { ...event, at: lastRelease - 900 } : event),
    'right tonic kept down': events.slice(0, -1)
  };
  for (const [name, sample] of Object.entries(samples)) {
    const ordered = [...sample].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const client = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, i) => ({ ...step, midis: app.stepMidiList(lesson.steps[i]) })),
      events: ordered, bpm: 40, targetBpm: 40, profile: 'standard', timingPrecision: 'beat-boundary-v2'
    });
    const server = game.grade(row, game.eventsInput(ordered, lastRelease), 'challenge', lastRelease, false);
    assert.equal(client.clean, name === 'aligned', name);
    assert.equal(server.assessment.clean, client.clean, name);
  }
});

test('paired addition preserves all earlier records, routes and canonical editions', () => {
  const oldIds = new Set(before.catalogIds);
  const priorLearning = learning.filter(lesson => oldIds.has(lesson.id));
  assert.equal(oldIds.size, before.catalogRecords);
  assert.ok(!oldIds.has(id));
  assert.equal(priorLearning.length, before.learningRecords);
  assert.equal(app.lessons.length, require('./fixtures/piano-curriculum-counts.json').catalogRecords);
  assert.equal(hash(app.lessons.filter(lesson => oldIds.has(lesson.id))), before.catalogHash);
  const historical = assertPreservedThemes(app.themes, preWaltzThemes);
  assert.equal(historical.length, before.themes);
  assert.equal(hash(historical), before.themeHash);
  assert.equal(hash(plan.piano.filter(lesson => oldIds.has(lesson.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(lesson => oldIds.has(lesson.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(lessonId => oldIds.has(lessonId))), before.canonicalRouteHash);
  assert.equal(hash(priorLearning.map(lesson => [lesson.id, curriculum.next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))).digest('hex'), before.reviewBaseline);
});

test('paired lesson connects verified fingering and coordination sources without changing old evidence', () => {
  const lesson = find(id);
  assert.ok(lesson);
  const batch = '2026-11-20-02';
  const ledger = require('../docs/piano-curriculum-sources.json');
  const earlier = ledger.entries.slice(0, before.sourceEntries).map(entry => {
    const result = plain(entry);
    if (result.applications) {
      result.applications = result.applications.filter(application => application.batch < batch);
      if (!result.applications.length) delete result.applications;
    }
    return result;
  });
  assert.equal(hash(earlier), before.sourceHash);
  const sourceIds = [
    'potsdam-e-major-left-map-2026-11-13',
    'potsdam-e-major-right-map-2026-11-13',
    'und-one-octave-major-paired-2026-11-20'
  ];
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  for (const sourceId of sourceIds) {
    assert.ok(ledger.entries.find(entry => entry.id === sourceId)?.applications.some(
      application => application.batch === batch && application.lessonIds.includes(id)
    ), sourceId);
  }
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай.{1,120}5–7/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
});
