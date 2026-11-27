'use strict';
const { assertPreservedThemes } = require('./helpers/assert-preserved-themes.cjs');
const preWaltzThemes = require('./fixtures/piano-before-csharp-major-prepared-paired-roundtrip-v1.json').themes;

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const assessment = require('../practice-assessment.js');
const { next } = require('../curriculum.js');
const { grade, eventsInput } = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-b-major-paired-joined-descent-v1.json');
const priorIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-b-major-prepared-paired-joined-descent-01';
const lowerDescent = 'detail-p-b-major-prepared-paired-lower-descent-01';
const middle = 'detail-p-b-major-prepared-paired-middle-descent-01';
const lower = 'detail-p-b-major-prepared-paired-lower-ascent-01';
const joined = 'detail-p-b-major-prepared-paired-joined-ascent-01';
const upper = 'detail-p-b-major-prepared-paired-upper-turn-01';
const left = 'detail-p-b-major-descent-left-01';
const right = 'detail-p-b-major-descent-right-01';
const previousFullAscent = 'detail-p-b-major-prepared-paired-full-ascent-01';
const prerequisites = [middle, lowerDescent, left, right];
const pairs = [[54, 66], [52, 64], [51, 63], [49, 61], [47, 59]];
const digits = [[4, 2], [1, 1], [2, 3], [3, 2], [4, 1]];
const sourceIds = [
  'pff-b-major-descending-thumb-white-left-2026-11-15',
  'pff-b-major-descending-prepared-right-2026-11-18',
  'chang-continuity-overlapping-segments-2026-11-27'
];
const batch = '2026-11-27-07';
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [app.stepMidiList(step), lesson.fingeringSpec.steps[i]]));

test('the joined descent preserves both groups and gives the shared D-sharp pair one beat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the joined five-pair descent in B major');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.after, lowerDescent);
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  const played = frames(lesson);
  assert.deepEqual(played, pairs.map((midis, i) => [midis, [
    { hand: 'left', num: digits[i][0] }, { hand: 'right', num: digits[i][1] }
  ]]));
  assert.deepEqual(played.slice(0, 3), frames(find(middle)));
  assert.deepEqual(played.slice(2), frames(find(lowerDescent)));
  assert.equal(played.filter(([pitches]) => pitches.includes(51) || pitches.includes(63)).length, 1);
  assert.equal(find(middle).rhythm.steps[2].durationBeats, 2);
  assert.equal(lesson.rhythm.steps[2].durationBeats, 1);
  for (const [i, preparation] of [left, right].entries()) {
    assert.deepEqual(played.map(([pitches, fingers]) => [[pitches[i]], [fingers[i]]]), frames(find(preparation)).slice(-5));
  }
  const position = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < position, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both assessors require the one-beat D-sharp join and the complete two-beat finish', () => {
  const lesson = find(id), row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  const steps = pairs.map((midis, startBeat) => ({ midis, startBeat, durationBeats: startBeat === 4 ? 2 : 1 }));
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, prerequisites);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  const beat = 1500, start = 1000, end = start + 6 * beat;
  const events = steps.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: start + startBeat * beat, source: 'midi' },
    { type: 'off', midi, at: start + (startBeat + durationBeats) * beat, source: 'midi' }
  ]));
  const doubleDSharp = pairs[2].flatMap(midi => [
    { type: 'off', midi, at: start + 2 * beat + 450, source: 'midi' },
    { type: 'on', midi, at: start + 2 * beat + 660, source: 'midi' }
  ]);
  const variants = {
    correct: events,
    'the D-sharps are held for two beats': events.map(e => pairs[2].includes(e.midi) && e.type === 'off' ? { ...e, at: e.at + beat } : e),
    'the D-sharps are played twice': events.concat(doubleDSharp),
    'a gap appears between D-sharp and C-sharp': events.map(e => pairs[3].includes(e.midi) && e.type === 'on' ? { ...e, at: e.at + 750 } : e),
    'F natural replaces the right E': events.map(e => e.midi === 64 ? { ...e, midi: 65 } : e),
    'left B releases after just one beat': events.map(e => e.midi === 47 && e.type === 'off' ? { ...e, at: e.at - beat } : e)
  };
  for (const [name, sample] of Object.entries(variants)) {
    const sorted = [...sample].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const result = assessment.assessPiano({ steps: lesson.rhythm.steps.map((s, i) => ({ ...s, midis: app.stepMidiList(lesson.steps[i]) })),
      events: sorted, bpm: 40, targetBpm: 40, profile: row.profile, timingPrecision: row.timingPrecision });
    assert.equal(result.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(sorted, end), 'challenge', end, false).assessment.clean, result.clean, name);
  }
});

test('joining the descending groups preserves earlier records, editions, routes and sources', () => {
  const old = new Set([...priorIds, upper, joined, lower, previousFullAscent, middle, lowerDescent, 'detail-p-b-major-prepared-paired-middle-01']);
  const earlier = learning.filter(lesson => old.has(lesson.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(earlier.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(lesson => old.has(lesson.id))), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes, preWaltzThemes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(row => old.has(row.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => old.has(key))), before.canonicalRouteHash);
  assert.equal(hash(earlier.map(lesson => [lesson.id, next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  const sources = plain(ledger.entries.slice(0, before.sourceEntries));
  for (const source of sources) {
    if (!source.applications) continue;
    source.applications = source.applications.filter(row => row.batch < batch);
    if (!source.applications.length) delete source.applications;
  }
  assert.equal(hash(sources), before.sourceHash);
});

test('the lesson attributes the descending source notes and includes a new phrase and later repetition', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою нисходящую фразу/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const applied = ledger.entries.flatMap(source => (source.applications || []).filter(row => row.batch === batch &&
    row.lessonIds.includes(id)).map(row => [source.id, row]));
  assert.deepEqual(applied.map(([key]) => key).sort(), [...sourceIds].sort());
  for (const [sourceId, row] of applied) {
    assert.equal(row.sourceRuleReused, true);
    const hand = sourceIds.indexOf(sourceId);
    if (hand < 2) {
      assert.deepEqual(row.printedNotes, ['F#', 'E', 'D#', 'C#', 'B']);
      assert.deepEqual(row.printedFingers, digits.map(pair => pair[hand]));
      assert.deepEqual(row.sourceStartsBeats, [5, 5.5, 6, 6.5, 7]);
      assert.deepEqual(row.sourceDurationsBeats, [0.5, 0.5, 0.5, 0.5, 0.5]);
      assert.match(row.sourceImageSha256, /^[a-f0-9]{64}$/);
    }
  }
});

test('a locally edited note and guide survive review and catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 64);
  tokens[2] = '[' + tokens[2][1] + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[2])), [51, 64]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка';
  lesson.learning.practiceSteps[0] = 'Мой счёт';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
