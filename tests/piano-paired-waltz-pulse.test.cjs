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
const before = require('./fixtures/piano-before-paired-waltz-pulse-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-paired-waltz-pulse-01';
const prerequisites = ['course01-02', 'course04-07', 'course01-07'];
const sourceId = 'zac-waltz-paired-pulse-2026-11-27';
const right = [60, 62, 64, 62, 64, 65];
const rightDigits = [1, 2, 3, 2, 3, 4];
const midis = right.map(midi => [48, midi]);
const fingers = rightDigits.map(num => [{ hand: 'left', num: 5 }, { hand: 'right', num }]);
const events = midis.map((pitches, i) => ({ midis: pitches, startBeat: i, durationBeats: 1 }));
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

test('the waltz uses a prepared melody and six renewed left C3 pulses in two three-beat bars', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the paired waltz pulse');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, 'course10-08');
  assert.equal(lesson.learning.branch, 'paired-waltz-pulse');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(notesWithTiming(lesson), midis.map((p, i) => [p, fingers[i], i, 1]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0]]);
  assert.deepEqual(notesWithTiming(find(prerequisites[0])).slice(0, 4),
    Array.from({ length: 4 }, (_, i) => [[48], [fingers[0][0]], i, 1]));
  assert.deepEqual(notesWithTiming(find(prerequisites[1])).slice(0, 6), right.map((m, i) => [[m], [fingers[i][1]], i, 1]));
  assert.deepEqual(notesWithTiming(find(prerequisites[2]))[0].slice(0, 2), [midis[0], fingers[0]]);
  const n = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both graders require the renewed bass, coordinated attacks, and paired releases at the barline', () => {
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
  const changes = {
    correct: expected,
    'the left hand is omitted': expected.filter(e => e.midi !== 48),
    'left C3 is held through the new downbeat': expected.filter(e => !(e.midi === 48 && e.at === at(3))),
    'the right downbeat arrives separately': expected.map(e => e.midi === 62 && e.type === 'on' && e.at === at(3) ?
      { ...e, at: at(3.12) } : e),
    'both notes arrive late on the new downbeat': expected.map(e => e.type === 'on' && e.at === at(3) ?
      { ...e, at: at(3.25) } : e),
    'E4 is released ahead of C3 before the barline': expected.map(e => e.midi === 64 && e.type === 'off' && e.at === at(3) ?
      { ...e, at: at(2.88) } : e),
    'the right downbeat is the wrong pitch': expected.map(e => e.midi === 62 &&
      ((e.type === 'on' && e.at === at(3)) || (e.type === 'off' && e.at === at(4))) ? { ...e, midi: 59 } : e)
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

test('adding a paired waltz preserves earlier full lessons, themes, versions, routes and source rules', () => {
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

test('the author supplies the one-note-per-beat accompaniment and the project supplies the exact paired phrase', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceId);
  const application = source?.applications.find(row => row.batch === '2026-11-27-28' && row.lessonIds.includes(id));
  assert.ok(application);
  assert.deepEqual(application.sourceLeftPitchClasses, ['G', 'D', 'G']);
  assert.deepEqual(application.sourceLeftStartBeats, [0, 1, 2]);
  assert.equal(application.sourceRightPhrase, null);
  assert.equal(application.sourceVideoObserved, false);
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(application.projectDurationsBeats, [1, 1, 1, 1, 1, 1]);
});

test('a personal paired melody and its teaching survive review and catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 67);
  tokens[5] = '[' + tokens[5].slice(1, 2) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[5])), [48, 67]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[5][1].num = 5;
  lesson.guide.setup = 'Моя подготовка вальсового пульса';
  lesson.learning.practiceSteps[0] = 'Мой счёт в две руки';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
