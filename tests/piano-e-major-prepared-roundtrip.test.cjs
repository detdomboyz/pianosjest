'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const before = require('./fixtures/piano-before-e-major-prepared-roundtrip-v1.json');
const beforePaired = require('./fixtures/piano-before-csharp-major-prepared-paired-roundtrip-v1.json');
const curriculum = require('../curriculum.js');
const assessment = require('../practice-assessment.js');
const game = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');

const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const plan = vm.runInNewContext(
  fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {}
);
const plain = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const examples = [
  {
    hand: 'left',
    midis: [52, 54, 56, 57, 59, 61, 63, 64, 63, 61, 59, 57, 56, 54, 52],
    fingers: [5, 4, 3, 2, 1, 3, 2, 1, 2, 3, 1, 2, 3, 4, 5]
  },
  {
    hand: 'right',
    midis: [64, 66, 68, 69, 71, 73, 75, 76, 75, 73, 71, 69, 68, 66, 64],
    fingers: [1, 2, 3, 1, 2, 3, 4, 5, 4, 3, 2, 1, 3, 2, 1]
  }
];

function frames(lesson) {
  return plain(lesson.steps.map((step, i) => [
    app.stepMidiList(step), lesson.fingeringSpec.steps[i]
  ]));
}

for (const { hand, midis, fingers } of examples) {
  const id = 'detail-p-e-major-prepared-roundtrip-' + hand + '-01';
  const requires = [
    'detail-p-e-major-ascent-' + hand + '-01',
    'detail-p-e-major-descent-' + hand + '-01',
    'detail-p-g-major-upper-' + hand + '-01'
  ];

  test('E major ' + hand + ' integrates both prepared octaves with a single apex', () => {
    const lesson = learning.find(l => l.id === id);
    assert.ok(lesson, 'Missing E-major roundtrip');
    assert.equal(lesson.handMode, hand);
    assert.equal(lesson.contentKind, 'exercise');
    assert.equal(lesson.themeId, 'detail-p-major-scales');
    assert.equal(lesson.learning.stage, 'p7');
    assert.equal(lesson.learning.articulation, 'legato');
    assert.equal(lesson.learning.timingPrecision, 'beat-boundary-v2');
    assert.deepEqual(plain(lesson.learning.requires), requires);
    const sequence = frames(lesson);
    assert.deepEqual(sequence, midis.map((midi, i) => [[midi], [{ hand, num: fingers[i] }]]));
    assert.equal(sequence.filter(([m]) => m[0] === midis[7]).length, 1);
    const [ascent, descent, upper] = requires.map(i => learning.find(l => l.id === i));
    assert.deepEqual(sequence, [...frames(ascent), ...frames(descent).slice(1)]);
    assert.deepEqual(frames(upper).slice(1, 4).map(([[midi], f]) => [[midi + 9], f]), sequence.slice(6, 9));
    assert.ok(requires.every(i => plan.piano.findIndex(e => e.id === i) < plan.piano.findIndex(e => e.id === id)));
    assert.equal(curriculum.next(plan, 'piano', learning, id), null);
    assert.equal(lesson.rhythm.practiceBpm, 40);
    assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
    assert.deepEqual(
      plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats])),
      midis.map((_, i) => [i, i === 14 ? 2 : 1, 0])
    );
  });

  test('E major ' + hand + ' client and canonical grading require a continuous turn and final release', () => {
    const lesson = learning.find(l => l.id === id);
    const canonical = course.lessons.find(l => l.id === id);
    assert.ok(lesson && canonical?.challengeReady);
    assert.deepEqual(canonical.requires, requires);
    assert.equal(canonical.timingPrecision, 'beat-boundary-v2');
    assert.equal(canonical.gradeFingerprint, assessment.pianoSignature(lesson));
    const steps = midis.map((midi, i) => ({ midis: [midi], startBeat: i, durationBeats: i === 14 ? 2 : 1 }));
    assert.deepEqual(canonical.steps, steps);
    const events = midis.flatMap((midi, i) => [
      { type: 'on', midi, at: 1000 + i * 1500, source: 'midi' },
      { type: 'off', midi, at: 1000 + (i + steps[i].durationBeats) * 1500, source: 'midi' }
    ]);
    const release = 25000;
    const reattack = events.flatMap((event, i) => i === 14 ? [
      event,
      { ...event, at: event.at + 750, type: 'off' },
      { ...event, at: event.at + 750 }
    ] : [event]);
    const gap = events.map((event, i) => i === 15 ? { ...event, at: event.at - 500 } : event);
    const wrong = events.map((event, i) => i === 16 || i === 17 ? { ...event, midi: event.midi - 1 } : event);
    const shortTonic = [...events.slice(0, -1), { ...events.at(-1), at: release - 1500 }];
    const withoutRelease = events.slice(0, -1);
    const verify = (sample, expected) => {
      const client = assessment.assessPiano({
        steps: lesson.rhythm.steps.map((step, i) => ({ ...step, midis: app.stepMidiList(lesson.steps[i]) })),
        events: sample, bpm: 40, targetBpm: lesson.rhythm.practiceBpm,
        profile: lesson.learning.articulation, timingPrecision: lesson.learning.timingPrecision
      });
      const server = game.grade(canonical, game.eventsInput(sample, release), 'challenge', release, false);
      assert.equal(client.clean, expected);
      assert.equal(server.assessment.clean, expected);
    };
    verify(events, true);
    for (const sample of [reattack, gap, wrong, shortTonic, withoutRelease]) verify(sample, false);
  });
}

test('E major addition preserves the 776 existing records, canon, themes, navigation and baseline', () => {
  const oldIds = new Set([
    ...beforePaired.catalog.map(l => l.id),
    'detail-p-csharp-major-apex-turn-paired-01',
    'detail-p-csharp-major-prepared-roundtrip-paired-01'
  ]);
  assert.equal(oldIds.size, before.catalogRecords);
  assert.equal(digest(app.lessons.filter(l => oldIds.has(l.id))), before.catalogHash);
  assert.equal(digest(app.themes.slice(0, before.themes)), before.themeHash);
  assert.equal(digest(plan.piano.filter(l => oldIds.has(l.id))), before.pianoPlanHash);
  assert.equal(digest(plan.guitar), before.guitarPlanHash);
  assert.equal(digest(course.lessons.filter(l => oldIds.has(l.id))), before.canonicalHash);
  assert.equal(digest(course.route.filter(id => oldIds.has(id))), before.canonicalRouteHash);
  const prevLearning = learning.filter(l => oldIds.has(l.id));
  assert.equal(prevLearning.length, before.learningRecords);
  const next = prevLearning.map(l => [l.id, curriculum.next(plan, 'piano', learning, l.id)?.id ?? null]);
  assert.equal(digest(next), before.nextHash);
  const actualBaseline = crypto.createHash('sha256').update(
    fs.readFileSync(require.resolve('../lesson-review-baseline.js'))
  ).digest('hex');
  assert.equal(actualBaseline, before.reviewBaseline);
});

test('E major source applications leave older evidence intact and explain the project rhythm', () => {
  const batch = '2026-11-20-01';
  const source = require('../docs/piano-curriculum-sources.json');
  const oldEntries = source.entries.slice(0, before.sourceEntries).map(e => {
    const record = plain(e);
    if (record.applications) {
      record.applications = record.applications.filter(a => a.batch < batch);
      if (!record.applications.length) delete record.applications;
    }
    return record;
  });
  assert.equal(digest(oldEntries), before.sourceHash);
  const applications = source.entries.flatMap(e => (e.applications || [])
    .filter(a => a.batch === batch).map(application => [e, application]));
  assert.equal(applications.length, 8);
  for (const { hand } of examples) {
    const id = 'detail-p-e-major-prepared-roundtrip-' + hand + '-01';
    const rows = applications.filter(([, a]) => a.lessonIds.includes(id));
    const lesson = learning.find(l => l.id === id);
    assert.equal(rows.length, 4);
    const fresh = rows.filter(([, a]) => a.freshReadInCurrentBatch);
    assert.equal(fresh.length, 1);
    assert.equal(fresh[0][0].id, 'potsdam-e-major-' + hand + '-map-2026-11-13');
    assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
    assert.match(lesson.learning.provenance.sourceNote, /таблица/i);
    assert.match(lesson.learning.provenance.sourceNote, /40 BPM/);
    assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  }
});
