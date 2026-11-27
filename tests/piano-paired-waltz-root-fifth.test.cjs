'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { assertPreservedThemes } = require('./helpers/assert-preserved-themes.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const { next } = require('../curriculum.js');
const assessment = require('../practice-assessment.js');
const { eventsInput, grade } = require('../service/game-grade.cjs');
const registry = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-paired-waltz-root-fifth-v1.json');
const { themes } = require('./fixtures/piano-before-paired-waltz-bass-upbeat-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');

const id = 'detail-p-paired-waltz-root-fifth-01';
const leftBars = 'detail-p-left-waltz-root-fifth-01';
const firstBar = 'detail-p-paired-waltz-common-bass-01';
const required = [leftBars, firstBar];
const sourceId = 'kohler-op249-waltz-bass-shift-paired-2026-11-28';
const starts = [0, 1, 2, 3, 4, 5];
const durations = [1, 0.5, 0.5, 1, 0.5, 1];
const midis = [[48], [52, 55, 60], [52, 55], [43], [52, 55, 60], [52, 55]];
const left = num => ({ hand: 'left', num });
const right = num => ({ hand: 'right', num });
const fingers = [[left(5)], [left(3), left(1), right(1)], [left(3), left(1)],
  [left(5)], [left(3), left(1), right(1)], [left(3), left(1)]];
const steps = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp({ events: true });
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN');

function frames(lesson, hand) {
  return plain(lesson.steps.map((step, i) => {
    const notes = app.stepMidiList(step);
    const selected = Array.from(lesson.fingeringSpec.steps[i], (finger, j) => [notes[j], finger])
      .filter(([, finger]) => !hand || finger.hand === hand);
    const timing = lesson.rhythm.steps[i];
    return [selected.map(([midi]) => midi), selected.map(([, finger]) => finger), timing.startBeat, timing.durationBeats];
  }));
}

test('the second bar moves to G2 and repeats both the left dyad and the right eighth', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the alternating-bass waltz lesson');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.branch, 'paired-waltz-root-fifth');
  assert.equal(lesson.learning.after, firstBar);
  assert.deepEqual(plain(lesson.learning.requires), required);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  const actual = frames(lesson);
  assert.deepEqual(actual, midis.map((pitches, i) => [pitches, fingers[i], starts[i], durations[i]]));
  assert.deepEqual(actual.slice(0, 3), frames(find(firstBar)).slice(0, 3));
  assert.deepEqual(frames(lesson, 'left'), frames(find(leftBars)));
  const rightAttacks = frames(lesson, 'right').filter(([notes]) => notes.length);
  assert.deepEqual(rightAttacks, [[[60], [right(1)], 1, 0.5], [[60], [right(1)], 4, 0.5]]);
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2, 0.5], [2, 0, 0.5], [2, 1, 0], [2, 2, 0.5]]);
  const at = plan.piano.findIndex(row => row.id === id);
  for (const key of required) {
    const earlier = plan.piano.findIndex(row => row.id === key);
    assert.ok(earlier >= 0 && earlier < at, key);
  }
  app.setTestLesson(lesson);
  assert.equal(app.challengeEligible(), true);
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('the graders require the lower G2, a free transfer and the repeated synchronized chord', () => {
  const lesson = find(id), row = registry.lessons.find(l => l.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, required);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));

  const at = beat => 1000 + beat * 1250;
  const event = (type, midi, beat) => ({ type, midi, at: at(beat), source: 'midi' });
  const expected = steps.flatMap(s => s.midis.flatMap(midi => [
    event('on', midi, s.startBeat), event('off', midi, s.startBeat + s.durationBeats)
  ]));
  const move = (type, midi, beat, movedTo) => expected.map(e =>
    e.midi === midi && e.type === type && e.at === at(beat) ? event(type, midi, movedTo) : e);
  const cases = {
    correct: expected,
    'second bass stays on C3': expected.map(e => e.midi === 43 ? { ...e, midi: 48 } : e),
    'G2 is played an octave high': expected.map(e => e.midi === 43 ? { ...e, midi: 55 } : e),
    'the second bass starts during the rest': move('on', 43, 3, 2.58),
    'the first bar chord carries over': move('off', 55, 2.5, 3.12),
    'the new bass holds into the dyad': move('off', 43, 4, 4.43),
    'the second left pair shifts instead of staying': expected.map(e => e.midi === 52 && e.at >= at(4) ? { ...e, midi: 53 } : e),
    'right comes in with the lower bass': move('on', 60, 4, 3),
    'the right eighth is omitted in bar two': expected.filter(e => !(e.midi === 60 && e.at >= at(4))),
    'the left thumb joins late': move('on', 55, 4, 4.19),
    'the right eighth holds through the rest': move('off', 60, 4.5, 5.18)
  };
  for (const [name, events] of Object.entries(cases)) {
    const ordered = [...events].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({ steps, events: ordered, bpm: 48, targetBpm: 48,
      profile: row.profile, timingPrecision: row.timingPrecision });
    assert.equal(local.clean, name === 'correct', name);
    const finish = Math.max(at(6), ordered.at(-1).at);
    assert.equal(grade(row, eventsInput(ordered, finish), 'challenge', finish, false).assessment.clean, local.clean, name);
  }
});

test('the new lesson preserves prior full lessons, route callbacks, themes, server revisions and sources', () => {
  const old = new Set([...catalogIds, ...catalogIdsAdded, 'detail-p-paired-waltz-eighth-bass-shift-01',
    'detail-p-paired-waltz-upbeat-01', 'detail-p-paired-waltz-bass-upbeat-01', 'detail-p-paired-waltz-barline-handoff-01',
    'detail-p-paired-waltz-bass-handoff-01', 'detail-p-paired-waltz-delayed-melody-01',
    'detail-p-paired-waltz-dyad-entry-01', firstBar]);
  const preserved = app.lessons.filter(l => old.has(l.id));
  const prior = learning.filter(l => old.has(l.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(preserved.length, before.catalogRecords);
  assert.equal(prior.length, before.learningRecords);
  assert.equal(hash(preserved), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes, themes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(registry.lessons.filter(l => old.has(l.id))), before.canonicalHash);
  assert.equal(hash(registry.route.filter(l => old.has(l))), before.canonicalRouteHash);
  assert.equal(hash(prior.map(l => [l.id, next(plan, 'piano', learning, l.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the score reference separates the printed bass shift and one right entry from the project phrase', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свой/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const ref = ledger.entries.find(e => e.id === sourceId);
  const use = ref?.applications.find(a => a.batch === '2026-11-28-12' && a.lessonIds.includes(id));
  assert.ok(use);
  assert.deepEqual(use.notatedExample, {
    pdfPage:28, printedPage:26, exercise:69, system:3, meter:'3/4', completeBarsAfterPickup:[1,2],
    firstBeatLeftMidi:[50,48], leftDyadMidi:[54,57], leftDurationBeats:1,
    firstBarRightMidi:[74,null,69], secondBarRightMidi:[null,69,76], rightDurationBeats:1,
    printedFirstBassFinger:4, printedFirstDyadFingers:[2,1]
  });
  assert.deepEqual(use.projectMidis, midis);
  assert.deepEqual(use.projectStartBeats, starts);
  assert.deepEqual(use.projectDurationsBeats, durations);
  assert.deepEqual(use.projectGlobalRestBeats, [[1.5,2],[2.5,3],[4.5,5]]);
  assert.equal(use.bothStavesVisuallyRead, true);
  assert.equal(use.editionImageReadBackVerified, true);
  assert.equal(use.sourceScoreReproduced, false);
});

test('a personal replacement bass keeps the old dyad, rhythm and right entrance through export and import', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 45);
  tokens[3] = key;
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[3])), [45]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка двух тактов вальса';
  lesson.learning.practiceSteps[0] = 'Мой бас ля на первом ударе второго такта';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  const edited = [...midis.slice(0,3), [45], ...midis.slice(4)];
  assert.deepEqual(plain(restored.steps.map(s => editor.stepMidiList(s))), edited);
  assert.equal(restored.rhythm.steps[3].restBeforeBeats, 0.5);
  assert.equal(restored.rhythm.steps[5].durationBeats, 1);
  for (const field of ['pattern','handMode','contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec','rhythm','guide','learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
