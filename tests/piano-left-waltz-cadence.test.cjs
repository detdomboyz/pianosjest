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
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-left-waltz-cadence-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-left-waltz-cadence-01';
const prior = 'detail-p-left-waltz-common-bass-01';
const prerequisites = ['detail-p-triads-02', 'detail-p-c-g7-common-tone-left-01', prior];
const sourceIds = ['clark-baylor-waltz-cadence-2026-11-27', 'czerny-letter3-release-2026-11-05'];
const midis = [[47], [53, 55], [53, 55], [48, 52, 55]];
const digits = [[5], [2, 1], [2, 1], [5, 3, 1]];
const durations = [1, 0.5, 0.5, 3];
const events = midis.map((pitches, i) => ({ midis: pitches, startBeat: i, durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const frame = (lesson, i) => plain([
  app.stepMidiList(lesson.steps[i]), lesson.fingeringSpec.steps[i].map(f => f.num), lesson.rhythm.steps[i].durationBeats
]);

test('the waltz moves from the inverted dominant to a tonic triad held for a complete bar', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the left-hand waltz cadence');
  assert.equal(lesson.themeId, 'detail-p-left-waltz');
  assert.equal(lesson.handMode, 'left');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, prior);
  assert.equal(lesson.learning.coverageDomain, 'arpeggios');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(plain(lesson.steps.map(s => app.stepMidiList(s))), midis);
  assert.deepEqual(plain(lesson.fingeringSpec.steps), digits.map(group => group.map(num => ({ hand: 'left', num }))));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats, s.measure, s.beatInMeasure])),
    [[0, 1, 0, 1, 0], [1, 0.5, 0, 1, 1], [2, 0.5, 0.5, 1, 2], [3, 3, 0.5, 2, 0]]);
  assert.deepEqual(frame(find(prerequisites[0]), 3).slice(0, 2), [[48, 52, 55], [5, 3, 1]]);
  assert.deepEqual(frame(find(prerequisites[1]), 0).slice(0, 2), [[48, 52, 55], [5, 3, 1]]);
  assert.deepEqual(frame(find(prerequisites[1]), 1).slice(0, 2), [[47, 53, 55], [5, 2, 1]]);
  assert.deepEqual(frame(lesson, 3).slice(0, 2), frame(find(prerequisites[1]), 0).slice(0, 2));
  assert.deepEqual([0, 1, 2].map(i => frame(lesson, i)[2]), [0, 1, 2].map(i => frame(find(prior), i)[2]));
  const n = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(next(plan, 'piano', learning, prior), null);
});

test('both graders require a fresh tonic attack and all three keys held through the third beat', () => {
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
    'C3 replaces the opening B2': expected.map(e => e.midi === 47 ? { ...e, midi: 48 } : e),
    'G3 is tied into the last chord from the dyad': expected.filter(e =>
      !(e.midi === 55 && ((e.at === at(2.5) && e.type === 'off') || (e.at === at(3) && e.type === 'on')))),
    'last G3 is missing': expected.filter(e => !(e.midi === 55 && e.at >= at(3))),
    'E3 enters after the other tonic notes': expected.map(e => e.midi === 52 && e.type === 'on' ?
      { ...e, at: at(3.4) } : e),
    'E3 ends a beat early': expected.map(e => e.midi === 52 && e.type === 'off' && e.at === end ?
      { ...e, at: at(5) } : e),
    'the tonic is played again during its hold': expected.concat([48, 52, 55].flatMap(midi => [
      { type: 'off', midi, at: at(4), source: 'midi' },
      { type: 'on', midi, at: at(4), source: 'midi' }
    ]))
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

test('adding the waltz cadence preserves prior lessons, themes, editions, routes and source rules', () => {
  const old = new Set([...earlierIds, ...before.catalogIdsAdded]);
  const earlier = learning.filter(lesson => old.has(lesson.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(earlier.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(lesson => old.has(lesson.id))), before.catalogHash);
  assert.equal(hash(app.themes), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(row => old.has(row.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => old.has(key))), before.canonicalRouteHash);
  assert.equal(hash(earlier.map(lesson => [lesson.id, next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the source ledger preserves the printed cadential pitches and distinguishes the added rests', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceIds[0]);
  assert.ok(source);
  const row = source.applications.find(row => row.batch === '2026-11-27-24' && row.lessonIds.includes(id));
  assert.ok(row);
  assert.deepEqual(row.sourceMidis, midis);
  assert.deepEqual(row.sourcePrintedLeftDigits, [[5], [2, 1], null, null]);
  assert.deepEqual(row.sourceDurationsBeats, [1, 1, 1, 3]);
  assert.deepEqual(row.sourceSlurGroups, [[0, 1]]);
  assert.deepEqual(row.projectMidis, midis);
  assert.deepEqual(row.projectDurationsBeats, durations);
  assert.deepEqual(row.projectRestIntervals, [[1.5, 2], [2.5, 3]]);
  assert.equal(row.relatedTimingEvidence.id, sourceIds[1]);
  assert.match(row.sourceImageSha256, /^[a-f0-9]{64}$/);
});

test('review and catalog exchange preserve a personal revision of the waltz cadence', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 57);
  tokens[3] = '[' + tokens[3].slice(1, 3) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[3])), [48, 52, 57]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка финала';
  lesson.learning.practiceSteps[0] = 'Мой счёт до отпускания';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
