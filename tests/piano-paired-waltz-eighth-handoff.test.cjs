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
const before = require('./fixtures/piano-before-paired-waltz-eighth-handoff-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-paired-waltz-eighth-handoff-01';
const prior = 'detail-p-paired-waltz-handoff-01';
const prerequisites = ['detail-p-left-eighth-pairs-01', 'detail-p-eighth-rest-offbeat-right-01', 'course04-07', 'course01-07'];
const sourceId = 'hoffman-la-cinquantaine-eighth-handoff-2026-11-28';
const starts = [0, 1, 1.5, 2, 3, 4, 5];
const durations = [1, 0.5, 0.5, 1, 1, 1, 1];
const midis = [[48, 60], [48], [64], [48, 60], [48, 62], [48, 64], [48, 65]];
const pinky = { hand: 'left', num: 5 };
const rightFingers = [1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 3, 2].map(num => ({ hand: 'right', num }));
const fingers = [
  [pinky, rightFingers[0]], [pinky], [rightFingers[2]],
  [pinky, rightFingers[0]], [pinky, rightFingers[3]], [pinky, rightFingers[4]], [pinky, rightFingers[5]]
];
const events = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: durations[i] }));
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

test('two solo eighths fill one beat and both hands return on beat three', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the waltz eighth-note handoff lesson');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, prior);
  assert.equal(lesson.learning.branch, 'paired-waltz-eighth-handoff');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(notesWithTiming(lesson), midis.map((p, i) => [p, fingers[i], starts[i], durations[i]]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 1.5, 0], [1, 2, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0]]);
  const frames = notesWithTiming(lesson);
  const priorFrames = notesWithTiming(find(prior));
  assert.deepEqual(frames[0], priorFrames[0]);
  assert.deepEqual(frames[1], [[48], [pinky], 1, 0.5]);
  assert.deepEqual(frames[2], [[64], [rightFingers[2]], 1.5, 0.5]);
  assert.deepEqual(priorFrames.slice(1, 3), [[[48], [pinky], 1, 1], [[64], [rightFingers[2]], 2, 1]]);
  const stableBass = notesWithTiming(find('detail-p-paired-waltz-pulse-01'));
  assert.deepEqual(frames[3].slice(0, 2), stableBass[0].slice(0, 2));
  assert.deepEqual(frames.slice(4), stableBass.slice(3));
  const leftPrep = notesWithTiming(find(prerequisites[0]));
  assert.deepEqual(leftPrep.slice(0, 4), [
    [[48], [pinky], 0, 1], [[50], [{ hand: 'left', num: 4 }], 1, 0.5],
    [[52], [{ hand: 'left', num: 3 }], 1.5, 0.5], [[50], [{ hand: 'left', num: 4 }], 2, 1]
  ]);
  const rightPrep = find(prerequisites[1]);
  assert.deepEqual(notesWithTiming(rightPrep).slice(0, 3),
    [[[60], [rightFingers[0]], 0, 1], [[62], [rightFingers[1]], 1.5, 0.5], [[64], [rightFingers[2]], 2, 1]]);
  assert.equal(rightPrep.rhythm.steps[1].restBeforeBeats, 0.5);
  assert.deepEqual(notesWithTiming(find(prerequisites[2])),
    [60, 62, 64, 62, 64, 65, 64, 65, 67, 65, 64, 62].map((pitch, i) => [[pitch], [rightFingers[i]], i, 1]));
  assert.deepEqual(notesWithTiming(find(prerequisites[3]))[0].slice(0, 2), [midis[0], fingers[0]]);
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

test('client and server graders require releases on the halves and the paired return on beat three', () => {
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
    'the first solo eighth is missing': expected.filter(event => !(event.midi === 48 &&
      ((event.type === 'on' && event.at === at(1)) || (event.type === 'off' && event.at === at(1.5))))),
    'the second solo eighth is missing': expected.filter(event => !(event.midi === 64 &&
      ((event.type === 'on' && event.at === at(1.5)) || (event.type === 'off' && event.at === at(2))))),
    'the right hand starts on the full beat': delay('on', 64, 1.5, 1),
    'the right hand delays the offbeat': delay('on', 64, 1.5, 1.82),
    'the right C4 holds into the left half': delay('off', 60, 1, 1.39),
    'the left C3 holds into the right half': delay('off', 48, 1.5, 1.84),
    'the right E4 holds into the pair': delay('off', 64, 2, 2.46),
    'the left hand attacks over the right eighth': [
      ...expected,
      { type: 'on', midi: 48, at: at(1.5), source: 'midi' },
      { type: 'off', midi: 48, at: at(2), source: 'midi' }
    ],
    'the return lands in two attacks': delay('on', 48, 2, 2.13),
    'the bass jumps instead of returning to C3': expected.map(event => event.midi === 48 &&
      ((event.type === 'on' && event.at === at(2)) || (event.type === 'off' && event.at === at(3))) ? { ...event, midi: 53 } : event)
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

test('the new eighth-note handoff preserves prior lessons, routes and evidence', () => {
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

test('the primary lesson explains complementary eighth rests in its score discussion', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceId);
  const application = source?.applications.find(row => row.batch === '2026-11-28-02' && row.lessonIds.includes(id));
  assert.ok(application);
  assert.deepEqual(application.notatedExample, {
    lessonNumber: 99, unit: 5, meter: '2/4', part: 'melody part of a student duet',
    leftSoundingHalf: 1, rightSoundingHalf: 2, leftRestingHalf: 2, rightRestingHalf: 1, durationBeats: 0.5
  });
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, starts);
  assert.deepEqual(application.projectDurationsBeats, durations);
  assert.deepEqual(application.projectLeftRestBeats, [1.5, 2]);
  assert.deepEqual(application.projectRightRestBeats, [1, 1.5]);
  assert.equal(application.projectMeter, '3/4');
  assert.deepEqual(application.projectGlobalRestBeats, []);
  assert.equal(application.visibleScoreObserved, false);
  assert.equal(application.publicAuthoredTranscriptRead, true);
  assert.equal(application.notationCopied, false);
});

test('a personal edit and both solo eighths survive review and catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const last = tokens.length - 1;
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 67);
  tokens[last] = '[' + tokens[last].slice(1, 2) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[6])), [48, 67]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[6][1].num = 5;
  lesson.guide.setup = 'Моя подготовка переноса баса под мелодию';
  lesson.learning.practiceSteps[0] = 'Мой счёт в две руки';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const i of [1, 2]) {
    assert.equal(restored.rhythm.steps[i].restBeforeBeats, 0);
    assert.equal(restored.rhythm.steps[i].durationBeats, 0.5);
    assert.deepEqual(plain(editor.stepMidiList(restored.steps[i])), midis[i]);
  }
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
