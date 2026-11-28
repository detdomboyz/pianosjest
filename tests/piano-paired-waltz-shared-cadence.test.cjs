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
const before = require('./fixtures/piano-before-paired-waltz-shared-cadence-v1.json');
const { themes } = require('./fixtures/piano-before-paired-waltz-bass-upbeat-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');

const id = 'detail-p-paired-waltz-shared-cadence-01';
const after = 'detail-p-paired-waltz-pickup-dyad-01';
const leftPreparation = 'detail-p-left-waltz-approach-chord-01';
const pairedPreparation = 'detail-p-paired-waltz-bass-upbeat-01';
const requires = [leftPreparation, pairedPreparation];
const sourceId = 'tchaikovsky-waltz-shared-cadence-2026-11-28';
const midis = [[43], [50], [43], [47], [48, 52, 55, 60]];
const left = num => ({ hand: 'left', num });
const right = num => ({ hand: 'right', num });
const fingers = [[left(5)], [left(1)], [left(5)], [left(3)], [left(5), left(3), left(1), right(1)]];
const starts = [0, 1, 2, 2.5, 3];
const durations = [1, 1, 0.5, 0.25, 3];
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
  return plain(lesson.steps.map((step, index) => {
    const pitches = app.stepMidiList(step);
    const notes = Array.from(lesson.fingeringSpec.steps[index], (finger, i) => [pitches[i], finger])
      .filter(([, finger]) => !hand || finger.hand === hand);
    const timing = lesson.rhythm.steps[index];
    return [notes.map(([midi]) => midi), notes.map(([, finger]) => finger), timing.startBeat, timing.durationBeats];
  }));
}

test('the prepared left cadence gains a simultaneous right C4 on the new downbeat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the shared waltz cadence');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.branch, 'paired-waltz-shared-cadence');
  assert.equal(lesson.learning.after, after);
  assert.deepEqual(plain(lesson.learning.requires), requires);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(frames(lesson), midis.map((pitches, i) => [pitches, fingers[i], starts[i], durations[i]]));
  assert.deepEqual(frames(lesson, 'left'), frames(find(leftPreparation)));
  assert.deepEqual(frames(lesson, 'right').at(-1).slice(0, 3), frames(find(pairedPreparation), 'right').at(-1).slice(0, 3));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2, 0], [1, 2.5, 0], [2, 0, 0.25]]);
  const at = plan.piano.findIndex(row => row.id === id);
  for (const key of [...requires, after]) {
    const earlier = plan.piano.findIndex(row => row.id === key);
    assert.ok(earlier >= 0 && earlier < at, key);
  }
  app.setTestLesson(lesson);
  assert.equal(app.challengeEligible(), true);
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both graders check the quiet sixteenth, four-note attack and three-beat common release', () => {
  const lesson = find(id), row = registry.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, requires);
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
    'the pickup is omitted': expected.filter(e => e.midi !== 47),
    'B2 keeps sounding during the written rest': move('off', 47, 2.75, 3),
    'the right hand interrupts the rest': move('on', 60, 3, 2.8),
    'the lower fifth is omitted': expected.filter(e => e.midi !== 55),
    'the upper tonic is omitted': expected.filter(e => e.midi !== 60),
    'the middle note arrives after the chord': move('on', 52, 3, 3.2),
    'the melody enters on beat two': move('on', 60, 3, 4),
    'the right hand lets go after two beats': move('off', 60, 6, 5),
    'the left thumb holds through the next downbeat': move('off', 55, 6, 6.5)
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

test('the shared cadence preserves prior full records, callbacks, themes, revisions and sources', () => {
  const old = new Set([...catalogIds, ...catalogIdsAdded, ...before.extraCatalogIds]);
  const preserved = app.lessons.filter(lesson => old.has(lesson.id));
  const prior = learning.filter(lesson => old.has(lesson.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(preserved.length, before.catalogRecords);
  assert.equal(prior.length, before.learningRecords);
  assert.equal(hash(preserved), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes, themes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(registry.lessons.filter(row => old.has(row.id))), before.canonicalHash);
  assert.equal(hash(registry.route.filter(key => old.has(key))), before.canonicalRouteHash);
  assert.equal(hash(prior.map(lesson => [lesson.id, next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the source records distinguish the shared eighth in the score from the three-beat exercise', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свой/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const ref = ledger.entries.find(entry => entry.id === sourceId);
  const use = ref?.applications.find(entry => entry.batch === '2026-11-28-14' && entry.lessonIds.includes(id));
  assert.ok(use);
  assert.deepEqual(use.notatedExample, {
    pdfPage: 2, system: 5, measure: 85, meter: '3/4', entryBeat: 0, leftMidi: [51, 55, 58],
    rightMidi: 75, commonDuration: 0.5, bothRestsFrom: 0.5, fermataOnRest: true
  });
  assert.equal(use.leftSustainModel.id, 'clark-baylor-waltz-cadence-2026-11-27');
  assert.deepEqual(use.leftSustainModel.finalChord, [48, 52, 55]);
  assert.equal(use.leftSustainModel.duration, 3);
  assert.equal(use.passingBassModel.id, 'zac-waltz-approach-tonic-2026-11-27');
  assert.deepEqual(use.passingBassModel.pitchClasses, ['G','D','G','B','C','E','G']);
  assert.equal(use.passingBassModel.exactPickupTimingSpecified, false);
  assert.deepEqual(use.projectStartBeats, starts);
  assert.deepEqual(use.projectDurationsBeats, durations);
  assert.deepEqual(use.projectGlobalRestBeats, [[2.75, 3]]);
  assert.equal(use.bothStavesVisuallyRead, true);
  assert.equal(use.pitchAndTimingCrossCheckedWithMusicXml, true);
  assert.equal(use.sourceScoreReproduced, false);
});

test('a personal pickup edit survives export and import with the quarter-beat rest and four-note ending', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(entry => entry.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 45);
  tokens[3] = key;
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[3])), [45]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[3][0].num = 4;
  lesson.learning.practiceSteps[0] = 'Моя подводящая ля перед общей паузой';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(entry => entry.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(entry => entry.id === id);
  assert.deepEqual(plain(restored.steps.map(step => editor.stepMidiList(step))), [...midis.slice(0, 3), [45], midis[4]]);
  assert.equal(restored.rhythm.steps[3].durationBeats, 0.25);
  assert.equal(restored.rhythm.steps[4].restBeforeBeats, 0.25);
  assert.equal(restored.rhythm.steps[4].durationBeats, 3);
  for (const field of ['pattern','handMode','contentKind','fingeringSpec','rhythm','guide','learning']) {
    assert.deepEqual(plain(restored[field]), saved[field]);
  }
});
