'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const { next } = require('../curriculum.js');
const assessment = require('../practice-assessment.js');
const { eventsInput, grade } = require('../service/game-grade.cjs');
const registry = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-paired-waltz-chord-to-bass-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');

const id = 'detail-p-paired-waltz-chord-to-bass-01';
const previousIds = new Set([...catalogIds, ...catalogIdsAdded, ...before.extraCatalogIds]);
const cadence = 'detail-p-paired-waltz-shared-cadence-01';
const sharedRest = 'detail-p-paired-waltz-shared-rest-01';
const bassPreparation = 'detail-p-paired-waltz-bass-upbeat-01';
const requires = [cadence, sharedRest, bassPreparation];
const sourceId = 'van-dillen-eighth-rest-values-2026-11-28';
const midis = [[48, 52, 55, 60], [43]];
const left = num => ({ hand: 'left', num });
const right = num => ({ hand: 'right', num });
const fingers = [[left(5), left(3), left(1), right(1)], [left(5)]];
const starts = [0, 3];
const durations = [2.5, 1];
const steps = midis.map((notes, i) => ({ midis: notes, startBeat: starts[i], durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = data => createHash('sha256').update(data).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp({ events: true });
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN');

test('the new transition keeps every prior record, route callback, theme and source exact', () => {
  const old = previousIds;
  const oldLearning = learning.filter(lesson => old.has(lesson.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(oldLearning.length, before.learningRecords);
  assert.equal(app.themes.length, before.themes);
  assert.equal(hash(app.lessons.filter(lesson => old.has(lesson.id))), before.catalogHash);
  assert.equal(hash(app.themes), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(registry.lessons.filter(row => old.has(row.id)).length, before.canonicalCount);
  assert.equal(hash(registry.lessons.filter(row => old.has(row.id))), before.canonicalHash);
  assert.equal(hash(registry.route.filter(key => old.has(key))), before.canonicalRouteHash);
  assert.equal(hash(oldLearning.map(lesson => [lesson.id, next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
});

test('the prepared common chord releases on the offbeat before a left-only downbeat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the common chord to left bass lesson');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.branch, 'paired-waltz-chord-to-bass');
  assert.equal(lesson.learning.after, cadence);
  assert.deepEqual(plain(lesson.learning.requires), requires);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(plain(lesson.steps.map(app.stepMidiList)), midis);
  assert.deepEqual(plain(lesson.fingeringSpec.steps), fingers);
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats, s.measure, s.beatInMeasure])),
    [[0, 2.5, 0, 1, 0], [3, 1, 0.5, 2, 0]]);
  assert.deepEqual(plain(lesson.steps.map(app.stepMidiList)[0]), plain(app.stepMidiList(find(cadence).steps.at(-1))));
  assert.deepEqual(plain(lesson.fingeringSpec.steps[0]), plain(find(cadence).fingeringSpec.steps.at(-1)));
  assert.deepEqual(plain(app.stepMidiList(find(bassPreparation).steps[0])), [43]);
  assert.equal(lesson.learning.sameGoalAs, undefined);
  assert.equal(lesson.learning.goalCounting, undefined);
  const index = plan.piano.findIndex(row => row.id === id);
  assert.ok(index >= 0);
  for (const key of requires) {
    const earlier = plan.piano.findIndex(row => row.id === key);
    assert.ok(earlier >= 0 && earlier < index, key);
  }
  app.setTestLesson(lesson);
  assert.equal(app.challengeEligible(), true);
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(learning.filter(row => previousIds.has(row.id) || row.id === id).length, before.learningRecords + 1);
});

test('the browser and account graders distinguish common release, unbroken silence and a single bass', () => {
  const lesson = find(id), row = registry.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, requires);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));

  const at = beat => 1000 + beat * 1250;
  const event = (type, midi, beat) => ({ type, midi, at: at(beat), source: 'midi' });
  const expected = steps.flatMap(s => s.midis.flatMap(midi => [
    event('on', midi, s.startBeat), event('off', midi, s.startBeat + s.durationBeats)
  ]));
  const move = (type, midi, beat, targetBeat) => expected.map(e =>
    e.type === type && e.midi === midi && e.at === at(beat) ? event(type, midi, targetBeat) : e);
  const cases = [
    ['prepared transition', expected],
    ['one left tone is omitted', expected.filter(e => e.midi !== 55)],
    ['right releases before the others', move('off', 60, 2.5, 2)],
    ['left thumb fills the silence', move('off', 55, 2.5, 3)],
    ['right echoes in the written silence', [...expected, event('on', 60, 2.7), event('off', 60, 2.85)]],
    ['bass enters without silence', move('on', 43, 3, 2.5)],
    ['bass waits until beat two', move('on', 43, 3, 4)],
    ['right joins the new bass', [...expected, event('on', 60, 3), event('off', 60, 4)]],
    ['left substitutes the octave', expected.map(e => e.midi === 43 ? { ...e, midi: 55 } : e)]
  ];
  for (const [i, [name, events]] of cases.entries()) {
    const ordered = [...events].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({ steps, events: ordered, bpm: 48, targetBpm: 48,
      profile: row.profile, timingPrecision: row.timingPrecision });
    const finish = Math.max(at(4), ordered.at(-1).at);
    assert.equal(local.clean, i === 0, name);
    assert.equal(grade(row, eventsInput(ordered, finish), 'challenge', finish, false).assessment.clean, local.clean, name);
  }
});

test('the source application and score describe a measured eighth rest and an open transfer', () => {
  const lesson = find(id);
  assert.ok(lesson);
  const info = lesson.learning;
  assert.equal(info.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(info.sourceEvidenceIds), [sourceId]);
  assert.match(info.practiceSteps.join(' '), /Выбери знакомый аккорд/);
  assert.match(info.practiceSteps.join(' '), /на следующий день/);
  const ref = ledger.entries.find(entry => entry.id === sourceId);
  const use = ref?.applications.find(entry => entry.batch === '2026-11-28-15' && entry.lessonIds.includes(id));
  assert.ok(use);
  assert.equal(use.restValue, 0.5);
  assert.equal(use.accompanimentModel.section, 'Steps 1–2');
  assert.equal(use.accompanimentModel.sourceLowBassPitchClass, 'G');
  assert.equal(use.sourceScoreReproduced, false);
  assert.deepEqual(use.projectMidis, midis);
  assert.deepEqual(use.projectStartBeats, starts);
  assert.deepEqual(use.projectDurationsBeats, durations);
  assert.deepEqual(use.projectGlobalRestBeats, [[2.5, 3]]);
  app.setTestLesson(lesson);
  app.state.mode = 'score';
  const score = app.scoreViewHtml();
  assert.match(score, /Такт 1[\s\S]*Пауза перед этой нотой: 625 мс[\s\S]*Такт 2/);
  assert.match(score, /G2[^"]*начало 0 доли[^"]*1250 мс[^"]*пауза до: 625 мс/);
  app.state.attemptMode = 'memory';
  try {
    assert.equal(app.learningMaterialHtml(), '');
    assert.doesNotMatch(app.scoreViewHtml(), /rhythm-rest|data-score-step/);
  } finally {
    app.state.attemptMode = 'practice';
  }
});

test('a personally revised bass preserves the chord, pause, fingers and instructions on export and import', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(entry => entry.id === id);
  assert.ok(lesson);
  const bassKey = Object.entries(editor.KEY_MAP).find(([key, midi]) => key.length === 1 && midi === 45)[0];
  lesson.pattern = [lesson.pattern.split(' ')[0], bassKey].join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[1][0].num = 4;
  lesson.learning.practiceSteps[0] = 'Моя подготовка к басу ля';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(entry => entry.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(entry => entry.id === id);
  assert.deepEqual(plain(restored.steps.map(editor.stepMidiList)), [midis[0], [45]]);
  for (const field of ['contentKind', 'pattern', 'handMode', 'fingeringSpec', 'rhythm', 'guide', 'learning']) {
    assert.deepEqual(plain(restored[field]), saved[field]);
  }
});
