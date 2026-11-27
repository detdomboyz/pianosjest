'use strict';
const { assertPreservedThemes } = require('./helpers/assert-preserved-themes.cjs');
const preWaltzThemes = require('./fixtures/piano-before-csharp-major-prepared-paired-roundtrip-v1.json').themes;

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const assessment = require('../practice-assessment.js');
const curriculum = require('../curriculum.js');
const game = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-fsharp-major-paired-roundtrip-v1.json');

const id = 'detail-p-fsharp-major-prepared-roundtrip-paired-01';
const requires = [
  'detail-p-fsharp-major-connected-paired-ascent-01',
  'detail-p-fsharp-major-connected-paired-descent-01',
  'detail-p-fsharp-major-prepared-roundtrip-left-01',
  'detail-p-fsharp-major-prepared-roundtrip-right-01',
  'detail-p-fsharp-major-prepared-paired-apex-01'
];
const sources = [
  'pff-fsharp-major-upper-212-left-2026-11-18',
  'pff-fsharp-major-upper-212-descent-left-2026-11-18',
  'pff-fsharp-major-upper-prepared-right-2026-11-18',
  'pff-fsharp-major-thumb-fourth-down-right-2026-11-18'
];
const pitches = [54, 56, 58, 59, 61, 63, 65, 66, 65, 63, 61, 59, 58, 56, 54];
const leftFingers = [4, 3, 2, 1, 3, 2, 1, 2, 1, 2, 3, 1, 2, 3, 4];
const rightFingers = [2, 3, 4, 1, 2, 3, 1, 2, 1, 3, 2, 1, 4, 3, 2];
const steps = pitches.map((midi, startBeat) => ({
  midis: [midi, midi + 12], startBeat, durationBeats: startBeat === 14 ? 2 : 1
}));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(
  fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {}
);
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [
  app.stepMidiList(step), lesson.fingeringSpec.steps[i]
]));

test('full F-sharp paired turn uses both complete directions through one upper pair', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing full paired F-sharp roundtrip');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.articulation, 'standard');
  assert.equal(lesson.learning.timingPrecision, 'beat-boundary-v2');
  assert.deepEqual(plain(lesson.learning.requires), requires);
  const sequence = frames(lesson);
  const [up, down, left, right, apex] = requires.map(find);
  assert.deepEqual(sequence, steps.map(({ midis }, i) => [midis, [
    { hand: 'left', num: leftFingers[i] }, { hand: 'right', num: rightFingers[i] }
  ]]));
  assert.deepEqual(frames(up).at(-1), frames(down)[0]);
  assert.deepEqual(sequence, [...frames(up), ...frames(down).slice(1)]);
  for (const [i, solo] of [left, right].entries()) {
    assert.deepEqual(sequence.map(([midis, fingers]) => [[midis[i]], [fingers[i]]]), frames(solo));
  }
  assert.deepEqual(sequence.slice(5, 10), frames(apex));
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  assert.deepEqual(plain(lesson.rhythm.steps.map(step => [step.startBeat, step.durationBeats, step.restBeforeBeats])),
    steps.map(step => [step.startBeat, step.durationBeats, 0]));
  const index = plan.piano.findIndex(row => row.id === id);
  assert.ok(index > 0 && requires.every(key => plan.piano.findIndex(row => row.id === key) < index));
  assert.equal(curriculum.next(plan, 'piano', learning, id), null);
});

test('full F-sharp paired grader checks synchrony, fresh attacks and both final releases', () => {
  const lesson = find(id);
  const canonical = course.lessons.find(row => row.id === id);
  assert.ok(lesson && canonical?.challengeReady);
  assert.equal(canonical.profile, 'standard');
  assert.equal(canonical.timingPrecision, 'beat-boundary-v2');
  assert.equal(canonical.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.deepEqual(canonical.requires, requires);
  assert.deepEqual(canonical.steps, steps);
  const start = 1000;
  const beatMs = 1500;
  const end = start + 16 * beatMs;
  const events = steps.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: start + startBeat * beatMs, source: 'midi' },
    { type: 'off', midi, at: start + (startBeat + durationBeats) * beatMs, source: 'midi' }
  ]));
  const rightFirstDescent = event => event.midi === 77 &&
    [start + 8 * beatMs, start + 9 * beatMs].includes(event.at) &&
    (event.at === start + 8 * beatMs ? event.type === 'on' : event.type === 'off');
  const samples = {
    aligned: events,
    'right hand lags after the turn': events.map(event => rightFirstDescent(event) ? { ...event, at: event.at + 180 } : event),
    'apex struck again': [...events, { type: 'on', midi: 78, at: start + 7.5 * beatMs, source: 'midi' }],
    'wrong leading tone': events.map(event => rightFirstDescent(event) ? { ...event, midi: 76 } : event),
    'left tonic released early': events.map(event => event.midi === 54 && event.at === end ? { ...event, at: end - 900 } : event),
    'right tonic held after the end': events.filter(event => event.midi !== 66 || event.at !== end)
  };
  for (const [name, sample] of Object.entries(samples)) {
    const ordered = [...sample].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const client = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, i) => ({ ...step, midis: app.stepMidiList(lesson.steps[i]) })),
      events: ordered, bpm: 40, targetBpm: 40, profile: 'standard', timingPrecision: 'beat-boundary-v2'
    });
    const server = game.grade(canonical, game.eventsInput(ordered, end), 'challenge', end, false);
    assert.equal(client.clean, name === 'aligned', name);
    assert.equal(server.assessment.clean, client.clean, name);
  }
});

test('existing records, grading editions, and Next paths retain their prior values', () => {
  const oldIds = new Set(before.catalogIds);
  const priorLearning = learning.filter(lesson => oldIds.has(lesson.id));
  assert.equal(oldIds.size, before.catalogRecords);
  assert.equal(priorLearning.length, before.learningRecords);
  assert.equal(app.lessons.length, require('./fixtures/piano-curriculum-counts.json').catalogRecords);
  assert.equal(hash(app.lessons.filter(lesson => oldIds.has(lesson.id))), before.catalogHash);
  const historical = assertPreservedThemes(app.themes, preWaltzThemes);
  assert.equal(historical.length, before.themes);
  assert.equal(hash(historical), before.themeHash);
  assert.equal(hash(plan.piano.filter(lesson => oldIds.has(lesson.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(lesson => oldIds.has(lesson.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => oldIds.has(key))), before.canonicalRouteHash);
  assert.equal(hash(priorLearning.map(lesson => [lesson.id, curriculum.next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
});

test('full paired card attributes separate-hand figures and teaches phrase transfer', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sources);
  const batch = '2026-11-20-04';
  const ready = ledger.entries.slice(0, before.sourceEntries).map(entry => {
    const copy = plain(entry);
    if (copy.applications) {
      copy.applications = copy.applications.filter(application => application.batch < batch);
      if (!copy.applications.length) delete copy.applications;
    }
    return copy;
  });
  assert.equal(hash(ready), before.sourceHash);
  const applications = ledger.entries.flatMap(entry =>
    (entry.applications || []).filter(row => row.batch === batch).map(row => [entry.id, row])
  );
  assert.deepEqual(applications.map(([source]) => source).sort(), [...sources].sort());
  for (const [, application] of applications) {
    assert.deepEqual(application.lessonIds, [id]);
    assert.equal(application.sourceRuleReused, true);
  }
  const copy = lesson.learning.practiceSteps.join(' ');
  assert.match(copy, /E♯4 и E♯5.*F4 и F5/);
  assert.match(copy, /Придумай.{1,100}8–10/);
  assert.match(copy, /на следующий день/);
});

test('personalized pitches, hands and notes survive reinstall and catalogue exchange', async () => {
  const editable = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const row = editable.lessons.find(lesson => lesson.id === id);
  assert.ok(row);
  row.contentKind = 'piece';
  row.guide.setup = 'Личная подсказка к вступлению';
  row.learning.practiceSteps[0] = 'Личный счёт перед началом';
  const [first, ...tail] = row.pattern.split(' ');
  const leftKey = first.slice(1, -1)[0];
  const [editedRightKey] = Object.entries(editable.KEY_MAP).find(([, midi]) => midi === 65);
  assert.deepEqual(plain(editable.stepMidiList(row.steps[0])), [54, 66]);
  row.pattern = ['[' + leftKey + editedRightKey + ']', ...tail].join(' ');
  row.steps = editable.parsePattern(row.pattern).steps;
  assert.deepEqual(plain(editable.stepMidiList(row.steps[0])), [54, 65]);
  row.fingeringSpec.pattern = row.pattern;
  const saved = plain(row);
  editable.installReviewedLessons();
  assert.deepEqual(plain(editable.lessons.find(lesson => lesson.id === id)), saved);
  assert.equal(await editable.importCatalogText(editable.catalogExportText(), () => true), true);
  const actual = editable.lessons.find(lesson => lesson.id === id);
  for (const field of ['contentKind', 'pattern', 'handMode']) assert.equal(actual[field], saved[field]);
  assert.deepEqual(plain(actual.steps), saved.steps);
  assert.deepEqual(plain(actual.fingeringSpec), saved.fingeringSpec);
  assert.equal(actual.guide.setup, saved.guide.setup);
  assert.equal(actual.learning.practiceSteps[0], saved.learning.practiceSteps[0]);
  assert.equal(editable.lessons.filter(lesson => lesson.id === id).length, 1);
});
