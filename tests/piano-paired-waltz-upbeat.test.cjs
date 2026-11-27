'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const { assertPreservedThemes } = require('./helpers/assert-preserved-themes.cjs');
const { next } = require('../curriculum.js');
const assessment = require('../practice-assessment.js');
const { eventsInput, grade } = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-paired-waltz-upbeat-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');

const id = 'detail-p-paired-waltz-upbeat-01';
const handoffId = 'detail-p-paired-waltz-eighth-handoff-01';
const pulseId = 'detail-p-paired-waltz-pulse-01';
const required = [handoffId, pulseId];
const sourceId = 'schubert-d365-no19-eighth-upbeat-2026-11-28';
const starts = [0, 1, 2.5, 3, 4, 5];
const durations = [1, 1, 0.5, 1, 1, 1];
const midis = [[48, 60], [48, 62], [64], [48, 60], [48, 62], [48, 64]];
const left = { hand: 'left', num: 5 };
const right = [1, 2, 3].map(num => ({ hand: 'right', num }));
const fingers = [[left, right[0]], [left, right[1]], [right[2]], [left, right[0]], [left, right[1]], [left, right[2]]];
const events = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const frames = lesson => plain(lesson.steps.map((step, i) => [
  app.stepMidiList(step), lesson.fingeringSpec.steps[i], lesson.rhythm.steps[i].startBeat, lesson.rhythm.steps[i].durationBeats
]));
const shift = (sequence, delta) => sequence.map(([pitches, digits, start, duration]) => [pitches, digits, start + delta, duration]);

test('the right-hand eighth follows a shared rest and leads into the next downbeat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the waltz upbeat lesson');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, handoffId);
  assert.equal(lesson.learning.branch, 'paired-waltz-upbeat');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.deepEqual(plain(lesson.learning.requires), required);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  const actual = frames(lesson);
  assert.deepEqual(actual, midis.map((pitches, i) => [pitches, fingers[i], starts[i], durations[i]]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2.5, 0.5], [2, 0, 0], [2, 1, 0], [2, 2, 0]]);
  const pulse = frames(find(pulseId));
  assert.deepEqual(actual.slice(0, 2), pulse.slice(0, 2));
  assert.deepEqual(actual.slice(3), shift(pulse.slice(0, 3), 3));
  assert.deepEqual(actual.slice(2, 4), shift(frames(find(handoffId)).slice(2, 4), 1));
  assert.equal(indexOf(id) > indexOf(handoffId), true);
  assert.equal(indexOf(id) > indexOf(pulseId), true);
  for (const key of [...required, id]) assert.equal(next(plan, 'piano', learning, key), null);
});

function indexOf(lessonId) {
  const index = plan.piano.findIndex(row => row.id === lessonId);
  assert.ok(index >= 0, lessonId);
  return index;
}

test('both MIDI graders enforce the silence, eighth and simultaneous arrival', () => {
  const lesson = find(id), row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, events);
  assert.deepEqual(row.requires, required);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));

  const at = beat => 1000 + beat * 1250;
  const end = at(6);
  const expected = events.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: at(startBeat), source: 'midi' },
    { type: 'off', midi, at: at(startBeat + durationBeats), source: 'midi' }
  ]));
  const move = (type, midi, beat, target) => expected.map(event =>
    event.type === type && event.midi === midi && event.at === at(beat) ? { ...event, at: at(target) } : event);
  const upbeat = event => event.midi === 64 && event.at <= at(3);
  const inputs = {
    correct: expected,
    'the upbeat is missing': expected.filter(event => !upbeat(event)),
    'the upbeat fills the whole third beat': move('on', 64, 2.5, 2),
    'the silence ends too late': move('on', 64, 2.5, 2.83),
    'the preceding bass overlaps the shared silence': move('off', 48, 2, 2.35),
    'the previous right note overlaps the silence': move('off', 62, 2, 2.35),
    'the upbeat holds into the next bar': move('off', 64, 3, 3.36),
    'the new downbeat is split': move('on', 48, 3, 3.16),
    'the left joins on the upbeat': [
      ...expected, { type: 'on', midi: 48, at: at(2.5), source: 'midi' },
      { type: 'off', midi: 48, at: at(3), source: 'midi' }
    ],
    'a key sounds during the shared rest': [
      ...expected, { type: 'on', midi: 65, at: at(2.1), source: 'midi' },
      { type: 'off', midi: 65, at: at(2.4), source: 'midi' }
    ]
  };
  for (const [name, input] of Object.entries(inputs)) {
    const ordered = [...input].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, i) => ({ ...step, midis: midis[i] })),
      events: ordered, bpm: 48, targetBpm: 48, profile: row.profile, timingPrecision: row.timingPrecision
    });
    assert.equal(local.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(ordered, end), 'challenge', end, false).assessment.clean, local.clean, name);
  }
});

test('previous records, routes, sources, guitar and original review baseline are preserved', () => {
  const old = new Set([...catalogIds, ...catalogIdsAdded, 'detail-p-paired-waltz-eighth-bass-shift-01']);
  const prior = learning.filter(lesson => old.has(lesson.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(prior.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(l => old.has(l.id))), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes, before.themes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(row => old.has(row.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => old.has(key))), before.canonicalRouteHash);
  assert.equal(hash(prior.map(lesson => [lesson.id, next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the musical example documents the last eighth of the two-note Schubert upbeat', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceId);
  const application = source?.applications.find(row => row.batch === '2026-11-28-05' && row.lessonIds.includes(id));
  assert.ok(application);
  assert.deepEqual(application.notatedExample, {
    pdfPage: 7, system: 1, dance: 19, meter: '3/4',
    rightPickupMidis: [74, 79], rightPickupDurations: [0.5, 0.5], leftPickupRestBeats: 1,
    firstFullBarDownbeat: [43, 62], downbeatDurations: [1, 1], printedFingerNumbers: []
  });
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, starts);
  assert.deepEqual(application.projectDurationsBeats, durations);
  assert.deepEqual(application.projectGlobalRestBeats, [2, 2.5]);
  assert.deepEqual(application.projectLeftRestBeats, [2, 3]);
  assert.equal(application.bothStavesVisuallyRead, true);
  assert.equal(application.sourceScoreReproduced, false);
});

test('a personal note edit retains the upbeat and silence through catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const last = tokens.length - 1;
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 65);
  tokens[last] = '[' + tokens[last].slice(1, 2) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[last])), [48, 65]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[last][1].num = 4;
  lesson.guide.setup = 'Моя подготовка вальсового затакта';
  lesson.learning.practiceSteps[0] = 'Мой счёт перед вступлением';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(candidate => candidate.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(lesson => lesson.id === id);
  assert.deepEqual(plain(editor.stepMidiList(restored.steps[2])), [64]);
  assert.equal(restored.rhythm.steps[2].restBeforeBeats, 0.5);
  assert.equal(restored.rhythm.steps[2].durationBeats, 0.5);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
