'use strict';
const { assertPreservedThemes } = require('./helpers/assert-preserved-themes.cjs');
const preWaltzThemes = require('./fixtures/piano-before-csharp-major-prepared-paired-roundtrip-v1.json').themes;

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const assessment = require('../practice-assessment.js');
const { next } = require('../curriculum.js');
const game = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-b-major-paired-joined-ascent-v1.json');
const oldest = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');

const id = 'detail-p-b-major-prepared-paired-joined-ascent-01';
const middle = 'detail-p-b-major-prepared-paired-middle-01';
const upper = 'detail-p-b-major-prepared-paired-upper-turn-01';
const left = 'detail-p-b-major-prepared-roundtrip-left-01';
const right = 'detail-p-b-major-prepared-roundtrip-right-01';
const sourceIds = [
  'pff-b-major-ascending-thumb-fourth-left-2026-11-15',
  'pff-b-major-ascending-prepared-right-2026-11-15',
  'chang-continuity-overlapping-segments-2026-11-27'
];
const batch = '2026-11-27-02';
const pairs = [[51, 63], [52, 64], [54, 66], [56, 68], [58, 70]];
const digits = [[2, 3], [1, 1], [4, 2], [3, 3], [2, 4]];
const steps = pairs.map((midis, startBeat) => ({ midis, startBeat, durationBeats: startBeat === 4 ? 2 : 1 }));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(l => l.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [app.stepMidiList(step), lesson.fingeringSpec.steps[i]]));

test('the prepared B-major groups overlap at one F-sharp pair with the source fingerings', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the joined B-major ascent');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.stage, 'p7');
  assert.deepEqual(plain(lesson.learning.requires), [middle, upper, left, right]);
  const joined = frames(lesson);
  assert.deepEqual(joined, pairs.map((midis, i) => [midis, [
    { hand: 'left', num: digits[i][0] }, { hand: 'right', num: digits[i][1] }
  ]]));
  assert.deepEqual(joined.slice(0, 3), frames(find(middle)));
  assert.deepEqual(joined.slice(2), frames(find(upper)).slice(0, 3));
  for (const [i, source] of [left, right].entries()) {
    assert.deepEqual(joined.map(([midis, fingers]) => [[midis[i]], [fingers[i]]]),
      frames(find(source)).slice(2, 7));
  }
  assert.equal(joined.filter(([midis]) => midis[0] === 54 && midis[1] === 66).length, 1);
  const position = plan.piano.findIndex(row => row.id === id);
  for (const key of [middle, upper, left, right]) {
    const preparationPosition = plan.piano.findIndex(row => row.id === key);
    assert.ok(preparationPosition >= 0 && preparationPosition < position);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both assessors require one beat at the junction and a two-beat final pair', () => {
  const lesson = find(id);
  const stored = course.lessons.find(l => l.id === id);
  assert.ok(lesson && stored?.challengeReady);
  assert.deepEqual(stored.steps, steps);
  assert.equal(stored.profile, 'standard');
  assert.equal(stored.timingPrecision, 'beat-boundary-v2');
  assert.equal(stored.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  const beat = 1500, start = 1000, end = start + 6 * beat;
  const notes = steps.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: start + startBeat * beat, source: 'midi' },
    { type: 'off', midi, at: start + (startBeat + durationBeats) * beat, source: 'midi' }
  ]));
  const extraPair = [54, 66].flatMap(midi => [
    { type: 'off', midi, at: start + 2 * beat + 600, source: 'midi' },
    { type: 'on', midi, at: start + 2 * beat + 750, source: 'midi' }
  ]);
  const probes = {
    correct: notes,
    'F-sharp repeated at the join': [...notes, ...extraPair],
    'old hold overlaps G-sharp': notes.map(e => e.type === 'off' && [54, 66].includes(e.midi) ?
      { ...e, at: e.at + 650 } : e),
    'late right G-sharp': notes.map(e => e.type === 'on' && e.midi === 68 ? { ...e, at: e.at + 220 } : e),
    'short final left note': notes.map(e => e.type === 'off' && e.midi === 58 ? { ...e, at: e.at - 1100 } : e)
  };
  for (const [caseName, sample] of Object.entries(probes)) {
    const sorted = [...sample].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const result = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((s, i) => ({ ...s, midis: app.stepMidiList(lesson.steps[i]) })),
      events: sorted, bpm: 40, targetBpm: 40, profile: stored.profile, timingPrecision: stored.timingPrecision
    });
    assert.equal(result.clean, caseName === 'correct', caseName);
    assert.equal(game.grade(stored, game.eventsInput(sorted, end), 'challenge', end, false).assessment.clean, result.clean, caseName);
  }
});

test('all previously published and local records, editions, routes and sources keep their fingerprints', () => {
  const ids = new Set([...oldest.catalogIds, upper, middle]);
  const earlier = learning.filter(l => ids.has(l.id));
  assert.equal(ids.size, before.catalogRecords);
  assert.equal(earlier.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(l => ids.has(l.id))), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes, preWaltzThemes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(l => ids.has(l.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(l => ids.has(l.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => ids.has(key))), before.canonicalRouteHash);
  assert.equal(hash(earlier.map(l => [l.id, next(plan, 'piano', learning, l.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  const earlierSources = ledger.entries.slice(0, before.sourceEntries).map(source => {
    const row = plain(source);
    if (row.applications) {
      row.applications = row.applications.filter(application => application.batch < batch);
      if (!row.applications.length) delete row.applications;
    }
    return row;
  });
  assert.equal(hash(earlierSources), before.sourceHash);
});

test('the lesson cites each hand and the overlap method and asks for a new application', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /один раз/i);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай новую фразу/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const applied = ledger.entries.flatMap(source => (source.applications || [])
    .filter(a => a.batch === batch && a.lessonIds.includes(id)).map(a => [source.id, a]));
  assert.deepEqual(applied.map(([key]) => key).sort(), [...sourceIds].sort());
  for (const [key, application] of applied) {
    if (key.startsWith('pff-')) {
      assert.ok(application.sourceRuleReused);
      assert.match(application.sourceImageSha256, /^[a-f0-9]{64}$/);
    }
  }
});

test('exchanging a personal edition of the joined exercise preserves the changed note and guide', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const [first, ...tail] = lesson.pattern.split(' ');
  const [changedKey] = Object.entries(editor.KEY_MAP).find(([key, midi]) => key.length === 1 && midi === 65);
  lesson.pattern = ['[' + first[1] + changedKey + ']', ...tail].join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[0])), [51, 65]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка';
  lesson.learning.practiceSteps[0] = 'Мой счёт';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const key of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[key], saved[key]);
  for (const key of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[key]), saved[key]);
});
