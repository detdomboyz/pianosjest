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
const before = require('./fixtures/piano-before-bflat-major-paired-full-descent-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-bflat-major-prepared-paired-full-descent-01';
const leftDescent = 'detail-p-bflat-major-descent-left-01';
const rightDescent = 'detail-p-bflat-major-descent-right-01';
const upperDescent = 'detail-p-bflat-major-prepared-paired-upper-descent-01';
const middleDescent = 'detail-p-bflat-major-prepared-paired-middle-descent-01';
const lowerDescent = 'detail-p-bflat-major-prepared-paired-lower-descent-01';
const fullAscent = 'detail-p-bflat-major-prepared-paired-full-ascent-01';
const prerequisites = [upperDescent, middleDescent, lowerDescent];
const pairs = [[58, 70], [57, 69], [55, 67], [53, 65], [51, 63], [50, 62], [48, 60], [46, 58]];
const fingers = [[2, 4], [1, 3], [2, 2], [3, 1], [4, 3], [1, 2], [2, 1], [3, 2]];
const beats = [1, 1, 1, 1, 1, 1, 1, 1];
const sourceIds = [
  'pff-bflat-major-descending-contacts-left-2026-11-15',
  'pff-bflat-major-descending-contacts-right-2026-11-15',
  'chang-continuity-overlapping-segments-2026-11-27'
];
const batch = '2026-11-27-18';
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [app.stepMidiList(step), lesson.fingeringSpec.steps[i]]));

test('the full B-flat descent joins the three fragments once and transfers middle B-flat to the right hand', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the two-hand full B-flat major descent');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.after, lowerDescent);
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  const played = frames(lesson);
  assert.deepEqual(played, pairs.map((midis, i) => [midis, [
    { hand: 'left', num: fingers[i][0] }, { hand: 'right', num: fingers[i][1] }
  ]]));
  assert.deepEqual(played.slice(0, 4), frames(find(upperDescent)));
  assert.deepEqual(played.slice(2, 6), frames(find(middleDescent)));
  assert.deepEqual(played.slice(4), frames(find(lowerDescent)));
  assert.deepEqual(played, frames(find(fullAscent)).reverse());
  for (const shared of pairs.slice(2, 6)) {
    assert.equal(played.filter(([midis]) => midis[0] === shared[0]).length, 1);
  }
  assert.deepEqual(played.flatMap(([midis, digits], i) => {
    const note = midis.indexOf(58);
    return note < 0 ? [] : [[i, digits[note]]];
  }), [[0, { hand: 'left', num: 2 }], [7, { hand: 'right', num: 2 }]]);
  for (const [hand, preparation] of [leftDescent, rightDescent].entries()) {
    const singleHand = played.map(([midis, digits]) => [[midis[hand]], [digits[hand]]]);
    assert.deepEqual(singleHand, frames(find(preparation)));
  }
  const position = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < position, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both assessors reject doubled inner pairs and require a fresh middle B-flat at the end', () => {
  const lesson = find(id), row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  const steps = pairs.map((midis, startBeat) => ({ midis, startBeat, durationBeats: beats[startBeat] }));
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, prerequisites);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  const beat = 1500, start = 1000, end = start + 8 * beat;
  const events = steps.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: start + startBeat * beat, source: 'midi' },
    { type: 'off', midi, at: start + (startBeat + durationBeats) * beat, source: 'midi' }
  ]));
  const variants = {
    correct: events,
    'middle B-flat is held from the first pair to the last': events.filter(event => event.midi !== 58 ||
      ![1, 7].includes((event.at - start) / beat)),
    'right middle B-flat is missing in the final pair': events.filter(event => event.midi !== 58 ||
      ![7, 8].includes((event.at - start) / beat)),
    'right B-flat releases early': events.map(event => event.midi === 58 && event.at === end ?
      { ...event, at: event.at - 1000 } : event)
  };
  for (const { midis, startBeat } of steps.slice(2, 6)) {
    const repeated = midis.flatMap(midi => [
      { type: 'off', midi, at: start + startBeat * beat + 350, source: 'midi' },
      { type: 'on', midi, at: start + startBeat * beat + 650, source: 'midi' }
    ]);
    variants[`a shared pair is repeated at beat ${startBeat}`] = events.concat(repeated);
  }
  for (const [name, sample] of Object.entries(variants)) {
    const sorted = [...sample].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const result = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((s, i) => ({ ...s, midis: app.stepMidiList(lesson.steps[i]) })),
      events: sorted, bpm: 40, targetBpm: 40, profile: row.profile, timingPrecision: row.timingPrecision
    });
    assert.equal(result.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(sorted, end), 'challenge', end, false).assessment.clean, result.clean, name);
  }
});

test('adding the full B-flat descent preserves the previous lessons, editions, order and source rules', () => {
  const old = new Set([...earlierIds, ...before.catalogIdsAdded]);
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

test('the ledger records the original eight-note descent across the barline and the following eighth rest', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою короткую нисходящую фразу/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const applied = ledger.entries.flatMap(source => (source.applications || []).filter(row => row.batch === batch &&
    row.lessonIds.includes(id)).map(row => [source.id, row]));
  assert.deepEqual(applied.map(([sourceId]) => sourceId).sort(), [...sourceIds].sort());
  for (const [sourceId, row] of applied) {
    if (!sourceId.startsWith('pff-')) continue;
    const hand = sourceId.includes('-left-') ? 0 : 1;
    assert.deepEqual(row.midi, pairs.map(pair => pair[hand]));
    assert.deepEqual(row.printedNotes, ['B♭', 'A', 'G', 'F', 'E♭', 'D', 'C', 'B♭']);
    assert.deepEqual(row.printedFingers, fingers.map(pair => pair[hand]));
    assert.deepEqual(row.sourceStartsBeats, [3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7]);
    assert.deepEqual(row.sourceDurationsBeats, Array(8).fill(0.5));
    assert.equal(row.sourceSelectionEndBeat, 7.5);
    assert.deepEqual(row.sourceFollowingRestBeats, [7.5, 8]);
    assert.deepEqual(row.projectDurationsBeats, beats);
    assert.match(row.sourceImageSha256, /^[a-f0-9]{64}$/);
  }
});

test('review and catalog exchange preserve edited music, fingers and learning text', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 71);
  tokens[7] = '[' + tokens[7][1] + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[7])), [46, 71]);
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
