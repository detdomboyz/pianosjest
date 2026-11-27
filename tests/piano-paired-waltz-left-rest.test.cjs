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
const before = require('./fixtures/piano-before-paired-waltz-left-rest-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-paired-waltz-left-rest-01';
const prior = 'detail-p-paired-waltz-right-rest-01';
const prerequisites = ['course04-07', 'detail-p-relocate-02', 'course01-07'];
const sourceId = 'brahms-op39-waltz9-left-rest-2026-11-27';
const starts = [0, 1, 2, 3, 4, 5];
const midis = [[48, 60], [48, 62], [64], [53, 62], [53, 64], [53, 65]];
const pinky = { hand: 'left', num: 5 };
const rightFingers = [1, 2, 3, 2, 3, 4].map(num => ({ hand: 'right', num }));
const fingers = rightFingers.map((digit, i) => i === 2 ? [digit] : [pinky, digit]);
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

test('only the right hand plays beat three while the left prepares the new downbeat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the lesson with the left-hand rest');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, prior);
  assert.equal(lesson.learning.branch, 'paired-waltz-left-rest');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(notesWithTiming(lesson), midis.map((p, i) => [p, fingers[i], starts[i], 1]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0]]);
  const contrast = notesWithTiming(find(prior));
  const skipThirdBeat = frames => frames.filter(([, , at]) => at !== 2);
  assert.deepEqual(skipThirdBeat(notesWithTiming(lesson)), skipThirdBeat(contrast));
  assert.deepEqual(contrast[2], [[48], [pinky], 2, 1]);
  assert.deepEqual(skipThirdBeat(notesWithTiming(lesson)), notesWithTiming(find('detail-p-paired-waltz-shared-rest-01')));
  const right = notesWithTiming(find(prerequisites[0]));
  const preparationPitches = [60, 62, 64, 62, 64, 65, 64, 65, 67, 65, 64, 62];
  const preparationDigits = [1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 3, 2];
  assert.deepEqual(right, preparationPitches.map((pitch, i) => [
    [pitch], [{ hand: 'right', num: preparationDigits[i] }], i, 1
  ]));
  assert.deepEqual(right.slice(0, 6), notesWithTiming(lesson).map(([pitches, digits, start, duration]) => [
    [pitches.at(-1)], [digits.at(-1)], start, duration
  ]));
  assert.deepEqual(notesWithTiming(find(prerequisites[1])).slice(0, 2),
    [[[48], [pinky], 0, 0.85], [[53], [pinky], 2, 0.85]]);
  assert.deepEqual(notesWithTiming(find(prerequisites[2]))[0].slice(0, 2), [midis[0], fingers[0]]);
  const n = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
    assert.equal(plan.piano[at].branch, 'common');
  }
  assert.ok(plan.piano.findIndex(row => row.id === prior) < n);
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(next(plan, 'piano', learning, prior), null);
});

test('client and server graders require the right beat, left release and the new paired attack', () => {
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
    'the right hand skips the third beat': expected.filter(event => !(event.midi === 64 &&
      ((event.type === 'on' && event.at === at(2)) || (event.type === 'off' && event.at === at(3))))),
    'the right hand delays the single quarter': delay('on', 64, 2, 2.34),
    'the left C3 remains held on the third beat': delay('off', 48, 2, 2.64),
    'the left hand reattacks C3 over the melody': [
      ...expected,
      { type: 'on', midi: 48, at: at(2), source: 'midi' },
      { type: 'off', midi: 48, at: at(3), source: 'midi' }
    ],
    'the new left bass enters before the next bar': delay('on', 53, 3, 2.62),
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

test('inserting the right-only third beat preserves previous lessons, routes and evidence', () => {
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

test('the score documents a rest in one hand and the project defines its own exercise', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceId);
  const application = source?.applications.find(row => row.batch === '2026-11-27-32' && row.lessonIds.includes(id));
  assert.ok(application);
  assert.deepEqual(application.notatedExample, {
    pdfPage: 8, waltz: 9, meter: '3/4', measure: 1,
    leftRestBeat: 3, rightSoundingBeat: 3, nextMeasure: 2, pairedDownbeat: true
  });
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, starts);
  assert.deepEqual(application.projectLeftRestBeats, [2, 3]);
  assert.deepEqual(application.sourceSoloQuarter, { midi: 77, startBeatInMeasure: 3, durationBeats: 1 });
  assert.deepEqual(application.sourceBassDownbeats, [38, 40]);
  assert.deepEqual(application.projectGlobalRestBeats, []);
});

test('a personal edit and the right-only third beat survive review and catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const last = tokens.length - 1;
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 67);
  tokens[last] = '[' + tokens[last].slice(1, 2) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[5])), [53, 67]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[5][1].num = 5;
  lesson.guide.setup = 'Моя подготовка переноса баса под мелодию';
  lesson.learning.practiceSteps[0] = 'Мой счёт в две руки';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  assert.equal(restored.rhythm.steps[2].restBeforeBeats, 0);
  assert.deepEqual(plain(editor.stepMidiList(restored.steps[2])), [64]);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
