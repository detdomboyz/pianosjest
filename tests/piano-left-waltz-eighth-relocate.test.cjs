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
const before = require('./fixtures/piano-before-left-waltz-eighth-relocate-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-left-waltz-eighth-relocate-01';
const prior = 'detail-p-relocate-02';
const prerequisites = [prior, 'detail-p-left-eighth-pairs-01', 'detail-p-eighth-rest-repeat-left-01', 'course04-07'];
const scoreId = 'burgmuller-arabesque-eighth-rest-landing-2026-11-28';
const techniqueId = 'belkin-shifts-and-leaps-eighth-preparation-2026-11-28';
const starts = [0, 1, 2, 3, 4, 5];
const durations = [1, 0.5, 1, 1, 1, 1];
const midis = [[48], [48], [53], [53], [53], [53]];
const pinky = { hand: 'left', num: 5 };
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

test('the left hand moves during the exact eighth rest before beat three', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the left-hand eighth-rest transfer');
  assert.equal(lesson.themeId, 'detail-p-left-waltz');
  assert.equal(lesson.handMode, 'left');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, 'detail-p-paired-waltz-eighth-handoff-01');
  assert.equal(lesson.learning.branch, 'waltz-eighth-bass-shift');
  assert.equal(lesson.learning.coverageDomain, 'positions');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(notesWithTiming(lesson), midis.map((p, i) => [p, [pinky], starts[i], durations[i]]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2, 0.5], [2, 0, 0], [2, 1, 0], [2, 2, 0]]);
  assert.deepEqual(notesWithTiming(find(prior)).slice(0, 2),
    [[[48], [pinky], 0, 0.85], [[53], [pinky], 2, 0.85]]);
  const leftPairs = notesWithTiming(find(prerequisites[1]));
  assert.deepEqual(leftPairs.slice(1, 3),
    [[[50], [{ hand: 'left', num: 4 }], 1, 0.5], [[52], [{ hand: 'left', num: 3 }], 1.5, 0.5]]);
  const repeated = find(prerequisites[2]);
  assert.equal(repeated.rhythm.steps[2].restBeforeBeats, 0.5);
  assert.deepEqual(notesWithTiming(repeated).slice(1, 3),
    [[[50], [{ hand: 'left', num: 4 }], 1, 1], [[50], [{ hand: 'left', num: 4 }], 2.5, 0.5]]);
  const waltz = find(prerequisites[3]);
  assert.deepEqual(plain(waltz.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(waltz.steps.length, 12);
  assert.ok(waltz.rhythm.steps.every((s, i) => s.startBeat === i && s.durationBeats === 1));
  const n = plan.piano.findIndex(row => row.id === id);
  assert.ok(plan.piano.findIndex(row => row.id === lesson.learning.after) < n);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
    assert.equal(plan.piano[at].branch, 'common');
  }
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(next(plan, 'piano', learning, prior)?.id, 'detail-p-relocate-03');
});

test('client and server grade an independent release, silent eighth and on-time F3', () => {
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
    'second C3 is missing': expected.filter(event => !(event.midi === 48 &&
      ((event.type === 'on' && event.at === at(1)) || (event.type === 'off' && event.at === at(1.5))))),
    'C3 is held through the eighth rest': delay('off', 48, 1.5, 2),
    'F3 sounds at the start of the silence': delay('on', 53, 2, 1.5),
    'F3 is delayed past beat three': delay('on', 53, 2, 2.36),
    'the landing misses F3 and repeats C3': expected.map(event => event.midi === 53 &&
      ((event.type === 'on' && event.at === at(2)) || (event.type === 'off' && event.at === at(3))) ? { ...event, midi: 48 } : event),
    'an extra right-hand note fills the written silence': [
      ...expected,
      { type: 'on', midi: 64, at: at(1.5), source: 'midi' },
      { type: 'off', midi: 64, at: at(2), source: 'midi' }
    ],
    'the final F3 is cut short': delay('off', 53, 6, 5.29)
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

test('the eighth-rest bass transfer preserves prior lessons, routes and evidence', () => {
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

test('the score and movement method support a smaller project transfer', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [scoreId, techniqueId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === scoreId);
  const method = ledger.entries.find(row => row.id === techniqueId);
  const application = source?.applications.find(row => row.batch === '2026-11-28-03' && row.lessonIds.includes(id));
  assert.ok(method?.applications.some(row => row.batch === '2026-11-28-03' && row.lessonIds.includes(id)));
  assert.ok(application);
  assert.deepEqual(application.notatedExample, {
    pdfPage: 1, system: 4, meter: '2/4', location: 'final two bars', leftLastEighth: 45, leftRestStartBeatInBar: 1.5,
    restDurationBeats: 0.5, leftLandingMidis: [57, 64], pairedFinalAttack: true, rightEighthRestAtSameTime: true
  });
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, starts);
  assert.deepEqual(application.projectDurationsBeats, durations);
  assert.deepEqual(application.projectGlobalRestBeats, [1.5, 2]);
  assert.equal(application.projectMeter, '3/4');
  assert.equal(application.bothStavesVisuallyRead, true);
  assert.equal(application.sourceScoreReproduced, false);
});

test('a personal final note and the earlier eighth rest survive catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 55);
  tokens[tokens.length - 1] = key;
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[5])), [55]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[5][0].num = 4;
  lesson.guide.setup = 'Моя подготовка переноса на фа';
  lesson.learning.practiceSteps[0] = 'Мой счёт перед коротким переносом';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  assert.equal(restored.rhythm.steps[1].durationBeats, 0.5);
  assert.equal(restored.rhythm.steps[2].restBeforeBeats, 0.5);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
