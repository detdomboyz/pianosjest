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
const before = require('./fixtures/piano-before-b-major-paired-roundtrip-v1.json');
const priorIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-b-major-prepared-roundtrip-paired-01';
const fullDescent = 'detail-p-b-major-prepared-paired-full-descent-01';
const joinedDescent = 'detail-p-b-major-prepared-paired-joined-descent-01';
const lowerDescent = 'detail-p-b-major-prepared-paired-lower-descent-01';
const middle = 'detail-p-b-major-prepared-paired-middle-descent-01';
const lower = 'detail-p-b-major-prepared-paired-lower-ascent-01';
const joined = 'detail-p-b-major-prepared-paired-joined-ascent-01';
const upper = 'detail-p-b-major-prepared-paired-upper-turn-01';
const left = 'detail-p-b-major-prepared-roundtrip-left-01';
const right = 'detail-p-b-major-prepared-roundtrip-right-01';
const previousFullAscent = 'detail-p-b-major-prepared-paired-full-ascent-01';
const prerequisites = [previousFullAscent, fullDescent, upper, left, right];
const pairs = [[47, 59], [49, 61], [51, 63], [52, 64], [54, 66], [56, 68], [58, 70], [59, 71], [58, 70], [56, 68], [54, 66], [52, 64], [51, 63], [49, 61], [47, 59]];
const digits = [[4, 1], [3, 2], [2, 3], [1, 1], [4, 2], [3, 3], [2, 4], [1, 5], [2, 4], [3, 3], [4, 2], [1, 1], [2, 3], [3, 2], [4, 1]];
const sourceIds = [
  'pff-b-major-ascending-thumb-fourth-left-2026-11-15',
  'pff-b-major-descending-thumb-white-left-2026-11-15',
  'pff-b-major-ascending-prepared-right-2026-11-15',
  'pff-b-major-descending-prepared-right-2026-11-18',
  'chang-continuity-overlapping-segments-2026-11-27'
];
const batch = '2026-11-27-09';
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [app.stepMidiList(step), lesson.fingeringSpec.steps[i]]));

test('the B-major round trip uses one upper pair and three independent articulations of middle B', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the full two-hand B-major round trip');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.after, fullDescent);
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  const played = frames(lesson);
  assert.deepEqual(played, pairs.map((midis, i) => [midis, [
    { hand: 'left', num: digits[i][0] }, { hand: 'right', num: digits[i][1] }
  ]]));
  assert.deepEqual(played.slice(0, 8), frames(find(previousFullAscent)));
  assert.deepEqual(played.slice(7), frames(find(fullDescent)));
  assert.deepEqual(played.slice(4, 11), frames(find(upper)));
  assert.equal(played.filter(([pitches]) => pitches.includes(71)).length, 1);
  assert.deepEqual(played.flatMap(([pitches, fingers], i) => {
    const at = pitches.indexOf(59);
    return at < 0 ? [] : [[i, fingers[at]]];
  }), [[0, { hand: 'right', num: 1 }], [7, { hand: 'left', num: 1 }], [14, { hand: 'right', num: 1 }]]);
  for (const [i, preparation] of [left, right].entries()) {
    assert.deepEqual(played.map(([pitches, fingers]) => [[pitches[i]], [fingers[i]]]), frames(find(preparation)));
  }
  const position = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < position, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both assessors reject an added apex, a held middle B, and a shortened final pair', () => {
  const lesson = find(id), row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  const steps = pairs.map((midis, startBeat) => ({ midis, startBeat, durationBeats: startBeat === 14 ? 2 : 1 }));
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, prerequisites);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  const beat = 1500, start = 1000, end = start + 16 * beat;
  const events = steps.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: start + startBeat * beat, source: 'midi' },
    { type: 'off', midi, at: start + (startBeat + durationBeats) * beat, source: 'midi' }
  ]));
  const twiceAtSummit = pairs[7].flatMap(midi => [
    { type: 'off', midi, at: start + 7 * beat + 450, source: 'midi' },
    { type: 'on', midi, at: start + 7 * beat + 660, source: 'midi' }
  ]);
  const variants = {
    correct: events,
    'middle B held from opening to apex': events.filter(e => e.midi !== 59 || ![1, 7].includes((e.at - start) / beat)),
    'middle B held from apex to final pair': events.filter(e => e.midi !== 59 || ![8, 14].includes((e.at - start) / beat)),
    'middle B absent at the apex': events.filter(e => e.midi !== 59 || ![7, 8].includes((e.at - start) / beat)),
    'middle B absent at the end': events.filter(e => e.midi !== 59 || ![14, 16].includes((e.at - start) / beat)),
    'both notes at the summit are attacked again': events.concat(twiceAtSummit),
    'descent starts after a pause': events.map(e => e.type === 'on' && e.at === start + 8 * beat ? { ...e, at: e.at + 750 } : e),
    'left final B lasts one beat': events.map(e => e.midi === 47 && e.at === end ? { ...e, at: e.at - beat } : e)
  };
  for (const [name, sample] of Object.entries(variants)) {
    const sorted = [...sample].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const result = assessment.assessPiano({ steps: lesson.rhythm.steps.map((s, i) => ({ ...s, midis: app.stepMidiList(lesson.steps[i]) })),
      events: sorted, bpm: 40, targetBpm: 40, profile: row.profile, timingPrecision: row.timingPrecision });
    assert.equal(result.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(sorted, end), 'challenge', end, false).assessment.clean, result.clean, name);
  }
});

test('joining the ascent and descent preserves earlier records, editions, routes and sources', () => {
  const old = new Set([...priorIds, upper, joined, lower, previousFullAscent, middle, lowerDescent, joinedDescent, fullDescent, 'detail-p-b-major-prepared-paired-middle-01']);
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

test('both directions cite the exact primary figures and the learner can vary a phrase around its summit', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою фразу с поворотом/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const applied = ledger.entries.flatMap(source => (source.applications || []).filter(row => row.batch === batch &&
    row.lessonIds.includes(id)).map(row => [source.id, row]));
  assert.deepEqual(applied.map(([key]) => key).sort(), [...sourceIds].sort());
  for (const [sourceId, row] of applied) {
    assert.equal(row.sourceRuleReused, true);
    const position = sourceIds.indexOf(sourceId);
    if (position === 4) continue;
    const descending = position % 2 === 1;
    const start = descending ? 7 : 0;
    const hand = Math.floor(position / 2);
    assert.deepEqual(row.printedNotes, descending
      ? ['B', 'A#', 'G#', 'F#', 'E', 'D#', 'C#', 'B']
      : ['B', 'C#', 'D#', 'E', 'F#', 'G#', 'A#', 'B']);
    assert.deepEqual(row.printedFingers, digits.slice(start, start + 8).map(pair => pair[hand]));
    assert.deepEqual(row.sourceStartsBeats, Array.from({ length: 8 }, (_, i) => (start + i) / 2));
    assert.deepEqual(row.sourceDurationsBeats, Array(8).fill(0.5));
    assert.match(row.sourceImageSha256, /^[a-f0-9]{64}$/);
  }
});

test('a locally edited note and guide survive review and catalog exchange', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 60);
  tokens[14] = '[' + tokens[14][1] + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[14])), [47, 60]);
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
