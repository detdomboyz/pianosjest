'use strict';

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
const before = require('./fixtures/piano-before-bflat-major-paired-full-ascent-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-bflat-major-prepared-paired-full-ascent-01';
const leftAscent = 'detail-p-bflat-major-ascent-left-01';
const rightAscent = 'detail-p-bflat-major-ascent-right-01';
const lower = 'detail-p-bflat-major-prepared-paired-joined-ascent-01';
const upper = 'detail-p-bflat-major-prepared-paired-upper-ascent-01';
const prerequisites = [lower, upper];
const pairs = [[46, 58], [48, 60], [50, 62], [51, 63], [53, 65], [55, 67], [57, 69], [58, 70]];
const fingers = [[3, 2], [2, 1], [1, 2], [4, 3], [3, 1], [2, 2], [1, 3], [2, 4]];
const beats = [1, 1, 1, 1, 1, 1, 1, 1];
const sourceIds = [
  'pff-bflat-major-ascending-contacts-left-2026-11-15',
  'pff-bflat-major-ascending-contacts-right-2026-11-15',
  'chang-continuity-overlapping-segments-2026-11-27'
];
const batch = '2026-11-27-14';
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [app.stepMidiList(step), lesson.fingeringSpec.steps[i]]));

test('the full B-flat ascent joins on one F pair and changes hands on middle B-flat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the full two-hand B-flat major ascent');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.after, upper);
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  const played = frames(lesson);
  assert.deepEqual(played, pairs.map((midis, i) => [midis, [
    { hand: 'left', num: fingers[i][0] }, { hand: 'right', num: fingers[i][1] }
  ]]));
  assert.deepEqual(played.slice(0, 5), frames(find(lower)));
  assert.deepEqual(played.slice(4), frames(find(upper)));
  assert.equal(played.filter(([midis]) => midis[0] === 53).length, 1);
  assert.deepEqual(played.flatMap(([midis, fingers], i) => {
    const note = midis.indexOf(58);
    return note < 0 ? [] : [[i, fingers[note]]];
  }), [[0, { hand: 'right', num: 2 }], [7, { hand: 'left', num: 2 }]]);
  for (const [hand, preparation] of [leftAscent, rightAscent].entries()) {
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

test('both assessors require one F pair, a released middle B-flat and a fresh attack at the end', () => {
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
  const repeatedF = pairs[4].flatMap(midi => [
    { type: 'off', midi, at: start + 4 * beat + 350, source: 'midi' },
    { type: 'on', midi, at: start + 4 * beat + 650, source: 'midi' }
  ]);
  const variants = {
    correct: events,
    'both F notes are attacked again': events.concat(repeatedF),
    'middle B-flat is held from the opening to the end': events.filter(e => e.midi !== 58 ||
      ![1, 7].includes((e.at - start) / beat)),
    'middle B-flat is missing in the last pair': events.filter(e => e.midi !== 58 ||
      ![7, 8].includes((e.at - start) / beat)),
    'left G arrives half a beat late': events.map(e => e.midi === 55 && e.type === 'on' ? { ...e, at: e.at + beat / 2 } : e),
    'left final B-flat releases early': events.map(e => e.midi === 58 && e.at === end ? { ...e, at: e.at - 1000 } : e)
  };
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

test('adding the full B-flat ascent preserves the previous lessons, editions, order and source rules', () => {
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
  const sources = plain(ledger.entries.slice(0, before.sourceEntries));
  for (const source of sources) {
    if (!source.applications) continue;
    source.applications = source.applications.filter(row => row.batch < batch);
    if (!source.applications.length) delete source.applications;
  }
  assert.equal(hash(sources), before.sourceHash);
});

test('the source ledger records the original eighth notes and the project ending', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою восходящую фразу/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const applied = ledger.entries.flatMap(source => (source.applications || []).filter(row => row.batch === batch &&
    row.lessonIds.includes(id)).map(row => [source.id, row]));
  assert.deepEqual(applied.map(([sourceId]) => sourceId).sort(), [...sourceIds].sort());
  for (const [sourceId, row] of applied) {
    assert.equal(row.sourceRuleReused, true);
    const hand = sourceIds.indexOf(sourceId);
    if (hand === 2) continue;
    assert.deepEqual(row.printedNotes, ['B♭', 'C', 'D', 'E♭', 'F', 'G', 'A', 'B♭']);
    assert.deepEqual(row.printedFingers, fingers.map(pair => pair[hand]));
    assert.deepEqual(row.sourceStartsBeats, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    assert.deepEqual(row.sourceDurationsBeats, Array(8).fill(0.5));
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
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[7])), [58, 71]);
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
