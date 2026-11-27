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
const before = require('./fixtures/piano-before-paired-waltz-dyad-entry-v1.json');
const { themes } = require('./fixtures/piano-before-paired-waltz-bass-upbeat-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');

const id = 'detail-p-paired-waltz-dyad-entry-01';
const leftWaltz = 'detail-p-left-waltz-c-f-01';
const delayed = 'detail-p-paired-waltz-delayed-melody-01';
const rightEighth = 'course04-06';
const required = [leftWaltz, delayed, rightEighth];
const sourceId = 'tchaikovsky-waltz-dyad-entry-2026-11-28';
const starts = [0, 1, 2];
const durations = [1, 0.5, 0.5];
const midis = [[48], [52, 55, 60], [52, 55]];
const left = num => ({ hand: 'left', num });
const right = num => ({ hand: 'right', num });
const fingers = [[left(5)], [left(3), left(1), right(1)], [left(3), left(1)]];
const steps = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp({ events: true });
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN');
const frames = lesson => plain(lesson.steps.map((step, i) => [
  app.stepMidiList(step), lesson.fingeringSpec.steps[i], lesson.rhythm.steps[i].startBeat, lesson.rhythm.steps[i].durationBeats
]));

test('one bass, two prepared left fingers and one right finger share the second beat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the waltz dyad entry lesson');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.branch, 'paired-waltz-dyad-entry');
  assert.equal(lesson.learning.after, delayed);
  assert.deepEqual(plain(lesson.learning.requires), required);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  const actual = frames(lesson);
  assert.deepEqual(actual, midis.map((pitch, i) => [pitch, fingers[i], starts[i], durations[i]]));
  const [notes, digits, start, duration] = actual[1];
  assert.deepEqual([actual[0], [notes.slice(0, 2), digits.slice(0, 2), start, duration], actual[2]],
    frames(find(leftWaltz)).slice(0, 3));
  assert.deepEqual([notes.slice(2), digits.slice(2), duration], frames(find(rightEighth))[0].filter((_, i) => i !== 2));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2, 0.5]]);
  const at = plan.piano.findIndex(row => row.id === id);
  for (const key of required) {
    const earlier = plan.piano.findIndex(row => row.id === key);
    assert.ok(earlier >= 0 && earlier < at, key);
  }
  app.setTestLesson(lesson);
  assert.equal(app.challengeEligible(), true);
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both graders require all three attacks and releases together and keep the following rest', () => {
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
    'a left chord tone is missing': expected.filter(e => !(e.midi === 55 && e.at <= at(1.5))),
    'right C enters on beat one': move('on', 60, 1, 0),
    'one left note of the three arrives late': move('on', 55, 1, 1.16),
    'one note of the three releases late': move('off', 60, 1.5, 1.66),
    'the bass continues below the chord': move('off', 48, 1, 1.36),
    'right C overlaps the third beat': move('off', 60, 1.5, 2.2),
    'third beat repeats right C': [...expected, event('on',60,2), event('off',60,2.5)],
    'the last left dyad arrives during the rest': move('on', 55, 2, 1.6)
  };
  for (const [name, events] of Object.entries(cases)) {
    const ordered = [...events].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({ steps, events: ordered, bpm: 48, targetBpm: 48,
      profile: row.profile, timingPrecision: row.timingPrecision });
    assert.equal(local.clean, name === 'correct', name);
    const finish = Math.max(at(2.5), ordered.at(-1).at);
    assert.equal(grade(row, eventsInput(ordered, finish), 'challenge', finish, false).assessment.clean, local.clean, name);
  }
});

test('existing learning records, versions, routes, themes, guitar and source entries stay exact', () => {
  const old = new Set([...catalogIds, ...catalogIdsAdded, 'detail-p-paired-waltz-eighth-bass-shift-01',
    'detail-p-paired-waltz-upbeat-01', 'detail-p-paired-waltz-bass-upbeat-01', 'detail-p-paired-waltz-barline-handoff-01',
    'detail-p-paired-waltz-bass-handoff-01', 'detail-p-paired-waltz-delayed-melody-01']);
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

test('the source application distinguishes the three bass-staff notes from the two-note project pattern', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const reference = ledger.entries.find(e => e.id === sourceId);
  const use = reference?.applications.find(a => a.batch === '2026-11-28-10' && a.lessonIds.includes(id));
  assert.ok(use);
  assert.deepEqual(use.notatedExample, {
    pdfPage:1, system:1, meter:'3/4', measure:6, firstBeatLeftMidi:48, firstBeatLeftDuration:1,
    firstBeatRightRestBeats:1, leftSecondBeatChord:[55,60,64], leftSecondBeatDuration:1,
    rightEntryBeatZeroBased:1, rightEntryMidi:72, rightEntryDuration:1.5
  });
  assert.deepEqual(use.projectMidis, midis);
  assert.deepEqual(use.projectStartBeats, starts);
  assert.deepEqual(use.projectDurationsBeats, durations);
  assert.deepEqual(use.projectGlobalRestBeats, [[1.5,2]]);
  assert.equal(use.bothStavesVisuallyRead, true);
  assert.equal(use.pitchAndTimingCrossCheckedWithMusicXml, true);
  assert.equal(use.sourceScoreReproduced, false);
});

test('a personal upper note and the two-note left part survive catalog export and import', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 65);
  tokens[1] = '[' + tokens[1].slice(1,3) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[1])), [52,55,65]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[1][2].num = 4;
  lesson.guide.setup = 'Моя подготовка к двухзвучию левой';
  lesson.learning.practiceSteps[0] = 'Мой разбор мелодии над ми–соль';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  assert.deepEqual(plain(editor.stepMidiList(restored.steps[1])), [52,55,65]);
  assert.equal(restored.rhythm.steps[1].durationBeats, 0.5);
  assert.deepEqual(plain(editor.stepMidiList(restored.steps[2])), [52,55]);
  assert.equal(restored.rhythm.steps[2].restBeforeBeats, 0.5);
  for (const field of ['pattern','handMode','contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec','rhythm','guide','learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
