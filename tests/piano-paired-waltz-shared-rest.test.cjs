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
const before = require('./fixtures/piano-before-paired-waltz-shared-rest-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-paired-waltz-shared-rest-01';
const prior = 'detail-p-paired-waltz-bass-shift-01';
const prerequisites = ['detail-p-left-triple-pulse-01', 'detail-p-relocate-02', 'course01-07'];
const sourceId = 'kohler-op249-waltz-no24-rest-2026-11-27';
const starts = [0, 1, 3, 4, 5];
const midis = [[48, 60], [48, 62], [53, 62], [53, 64], [53, 65]];
const fingers = [1, 2, 2, 3, 4].map(num => [{ hand: 'left', num: 5 }, { hand: 'right', num }]);
const events = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: 1 }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const notesWithTiming = lesson => plain(lesson.steps.map((step, i) => [
  app.stepMidiList(step), lesson.fingeringSpec.steps[i], lesson.rhythm.steps[i].startBeat, lesson.rhythm.steps[i].durationBeats
]));

test('both hands release before the third beat and attack together on the next downbeat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the shared rest lesson');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, prior);
  assert.equal(lesson.learning.branch, 'paired-waltz-shared-rest');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(notesWithTiming(lesson), midis.map((p, i) => [p, fingers[i], starts[i], 1]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [2, 0, 1], [2, 1, 0], [2, 2, 0]]);
  const contrast = notesWithTiming(find(prior));
  assert.deepEqual(notesWithTiming(lesson), contrast.filter(([, , at]) => at !== 2));
  assert.deepEqual(contrast[2].slice(0, 3), [[48, 64], [{ hand: 'left', num: 5 }, { hand: 'right', num: 3 }], 2]);
  const left = notesWithTiming(find(prerequisites[0]));
  assert.deepEqual(left.slice(0, 2), [[[48], [fingers[0][0]], 0, 2], [[48], [fingers[0][0]], 3, 2]]);
  const transfer = notesWithTiming(find(prerequisites[1])).slice(0, 2);
  assert.deepEqual(transfer, [[[48], [fingers[0][0]], 0, 0.85], [[53], [fingers[0][0]], 2, 0.85]]);
  assert.deepEqual(notesWithTiming(find(prerequisites[2]))[0].slice(0, 2), [midis[0], fingers[0]]);
  const n = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
    assert.equal(plan.piano[at].branch, 'common');
  }
  const contrastIndex = plan.piano.findIndex(row => row.id === prior);
  assert.ok(contrastIndex >= 0 && contrastIndex < n);
  assert.notEqual(plan.piano[contrastIndex].branch, plan.piano[n].branch);
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(next(plan, 'piano', learning, prior), null);
});

test('client and server graders require a whole silent beat and the new paired attack', () => {
  const lesson = find(id), row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, events);
  assert.deepEqual(row.requires, prerequisites);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  const at = beat => 1000 + beat * 1250, end = at(6);
  const expected = events.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: at(startBeat), source: 'midi' },
    { type: 'off', midi, at: at(startBeat + durationBeats), source: 'midi' }
  ]));
  const delay = (type, pitch, beat, until) => expected.map(event =>
    event.type === type && event.midi === pitch && event.at === at(beat) ? { ...event, at: at(until) } : event);
  const changes = {
    correct: expected,
    'the old left bass remains held during the rest': delay('off', 48, 2, 2.64),
    'the repeated right D4 remains held during the rest': delay('off', 62, 2, 2.64),
    'the previous C3 and E4 pair fills the rest': [
      ...expected,
      ...[48, 64].flatMap(midi => [
        { type: 'on', midi, at: at(2), source: 'midi' },
        { type: 'off', midi, at: at(3), source: 'midi' }
      ])
    ],
    'both hands cut the rest short': expected.map(event =>
      event.type === 'on' && event.at === at(3) ? { ...event, at: at(2.62) } : event),
    'the left hand enters separately': delay('on', 53, 3, 3.13),
    'the old bass returns after the rest': expected.map(event => event.midi === 53 ? { ...event, midi: 48 } : event)
  };
  for (const [name, input] of Object.entries(changes)) {
    const ordered = [...input].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, index) => ({ ...step, midis: midis[index] })),
      events: ordered, bpm: 48, targetBpm: 48, profile: row.profile, timingPrecision: row.timingPrecision
    });
    assert.equal(local.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(ordered, end), 'challenge', end, false).assessment.clean, local.clean, name);
  }
});

test('inserting the shared rest exercise preserves previous lessons, routes and evidence', () => {
  const old = new Set([...earlierIds, ...before.catalogIdsAdded]);
  const earlier = learning.filter(lesson => old.has(lesson.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(earlier.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(lesson => old.has(lesson.id))), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes, before.themes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(row => old.has(row.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => old.has(key))), before.canonicalRouteHash);
  assert.equal(hash(earlier.map(lesson => [lesson.id, next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the score documents a shared rest while the project defines the new notes and movement', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceId);
  const application = source?.applications.find(row => row.batch === '2026-11-27-30' && row.lessonIds.includes(id));
  assert.ok(application);
  assert.deepEqual(application.notatedExample, {
    printedPage: 8, pdfPage: 10, exercise: 24, meter: '3/4', measure: 8,
    restBeatInMeasure: 3, durationBeats: 1, restsInBothStaves: true, repeatToMeasure: 1
  });
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, starts);
  assert.deepEqual(application.projectRestBeats, [2, 3]);
});

test('a personal score edit and the common rest survive review and catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const last = tokens.length - 1;
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 67);
  tokens[last] = '[' + tokens[last].slice(1, 2) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[4])), [53, 67]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[4][1].num = 5;
  lesson.guide.setup = 'Моя подготовка общей паузы';
  lesson.learning.practiceSteps[0] = 'Мой счёт в две руки';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  assert.equal(restored.rhythm.steps[2].restBeforeBeats, 1);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
