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
const before = require('./fixtures/piano-before-paired-waltz-barline-handoff-v1.json');
const { themes } = require('./fixtures/piano-before-paired-waltz-bass-upbeat-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');

const id = 'detail-p-paired-waltz-barline-handoff-01';
const upbeat = 'detail-p-paired-waltz-upbeat-01';
const handoff = 'detail-p-paired-waltz-eighth-handoff-01';
const required = [upbeat, handoff];
const sourceId = 'burgmuller-hoffman-waltz-barline-handoff-2026-11-28';
const starts = [0, 1, 2, 2.5, 3, 4, 5];
const durations = [1, 1, 0.5, 0.5, 1, 1, 1];
const midis = [[48, 60], [48, 62], [48], [64], [48, 60], [48, 62], [48, 64]];
const left = { hand: 'left', num: 5 };
const [thumb, index, middle] = [1, 2, 3].map(num => ({ hand: 'right', num }));
const fingers = [[left, thumb], [left, index], [left], [middle], [left, thumb], [left, index], [left, middle]];
const steps = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(l => l.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN');
const frames = lesson => plain(lesson.steps.map((step, i) => [
  app.stepMidiList(step), lesson.fingeringSpec.steps[i], lesson.rhythm.steps[i].startBeat, lesson.rhythm.steps[i].durationBeats
]));

test('two separate eighths finish beat three and lead to both hands on the next downbeat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the barline handoff lesson');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.branch, 'paired-waltz-barline-handoff');
  assert.equal(lesson.learning.after, upbeat);
  assert.deepEqual(plain(lesson.learning.requires), required);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  const actual = frames(lesson);
  assert.deepEqual(actual, midis.map((m, i) => [m, fingers[i], starts[i], durations[i]]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2, 0], [1, 2.5, 0], [2, 0, 0], [2, 1, 0], [2, 2, 0]]);
  assert.deepEqual(actual.filter((_, i) => i !== 2), frames(find(upbeat)));
  assert.deepEqual(actual.slice(2, 5), frames(find(handoff)).slice(1, 4)
    .map(([pitches, digits, start, duration]) => [pitches, digits, start + 1, duration]));
  const at = plan.piano.findIndex(row => row.id === id);
  for (const key of required) {
    const prep = plan.piano.findIndex(row => row.id === key);
    assert.ok(prep >= 0 && prep < at, key);
    assert.equal(plan.piano[prep].stage, 'p7');
    assert.notEqual(plan.piano[prep].branch, lesson.learning.branch);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both graders require the new bass strike, releases and the paired barline attack', () => {
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
  const onlyAt = (e, midi, from, end) => e.midi === midi &&
    (e.type === 'on' && e.at === at(from) || e.type === 'off' && e.at === at(end));
  const cases = {
    correct: expected,
    'the old pause still replaces the bass': expected.filter(e => !onlyAt(e, 48, 2, 2.5)),
    'the previous bass is tied into beat three': expected.filter(e =>
      !(e.midi === 48 && e.at === at(2))),
    'D continues into the first eighth': move('off', 62, 2, 2.35),
    'the short C continues through the right eighth': move('off', 48, 2.5, 2.84),
    'the right eighth is omitted': expected.filter(e => !onlyAt(e, 64, 2.5, 3)),
    'the right note is early': move('on', 64, 2.5, 2.12),
    'the right note holds into the first beat': move('off', 64, 3, 3.38),
    'the hands play beat three in reverse order': expected.map(e => {
      if (onlyAt(e, 48, 2, 2.5)) return event(e.type, 64, e.type === 'on' ? 2 : 2.5);
      if (onlyAt(e, 64, 2.5, 3)) return event(e.type, 48, e.type === 'on' ? 2.5 : 3);
      return e;
    }),
    'the shared attack is split': move('on', 60, 3, 3.16),
    'the bass first beat arrives too soon': move('on', 48, 3, 2.64)
  };
  for (const [name, events] of Object.entries(cases)) {
    const ordered = [...events].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({steps, events:ordered, bpm:48, targetBpm:48,
      profile:row.profile, timingPrecision:row.timingPrecision});
    assert.equal(local.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(ordered, at(6)), 'challenge', at(6), false).assessment.clean, local.clean, name);
  }
});

test('existing records, revisions, lesson routes, references and original baseline remain exact', () => {
  const old = new Set([...catalogIds, ...catalogIdsAdded, 'detail-p-paired-waltz-eighth-bass-shift-01',
    'detail-p-paired-waltz-upbeat-01', 'detail-p-paired-waltz-bass-upbeat-01']);
  const prior = learning.filter(l => old.has(l.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(prior.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(l => old.has(l.id))), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes, themes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(registry.lessons.filter(l => old.has(l.id))), before.canonicalHash);
  assert.equal(hash(registry.route.filter(l => old.has(l))), before.canonicalRouteHash);
  assert.equal(hash(prior.map(l => [l.id, next(plan, 'piano', learning, l.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the source application records Burgmüller’s held note and Hoffman’s alternating eighths separately', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const reference = ledger.entries.find(e => e.id === sourceId);
  const use = reference?.applications.find(a => a.batch === '2026-11-28-07' && a.lessonIds.includes(id));
  assert.ok(use);
  assert.deepEqual(use.notatedExample, {
    pdfPage:1, system:2, meter:'2/4', measure:12, heldUpperMidi:76, heldUpperDurationBeats:1.5,
    lowerEighthMidi:56, lowerEighthStartBeat:1, newUpperEighthMidi:71, upperEighthStartBeat:1.5,
    lowerRestBeats:[1.5,2], nextMeasure:13, nextDownbeatMidis:[57,72]
  });
  assert.equal(use.hoffmanLessonNumber, 99);
  assert.deepEqual(use.projectMidis, midis);
  assert.deepEqual(use.projectStartBeats, starts);
  assert.deepEqual(use.projectDurationsBeats, durations);
  assert.deepEqual(use.projectLeftRestBeats, [2.5,3]);
  assert.deepEqual(use.projectRightRestBeats, [2,2.5]);
  assert.deepEqual(use.projectGlobalRestBeats, []);
  assert.equal(use.bothStavesVisuallyRead, true);
  assert.equal(use.sourceScoreReproduced, false);
});

test('personal edits and both eighths survive catalog export and import', async () => {
  const editor = loadApp({web:true, events:true, storage:createMemoryStorage()});
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const last = tokens.length - 1;
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 65);
  tokens[last] = '[' + tokens[last].slice(1, 2) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[last])), [48,65]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[last][1].num = 4;
  lesson.guide.setup = 'Моя подготовка к тактовой черте';
  lesson.learning.practiceSteps[0] = 'Мой разбор вальсовой связки';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const i of [2, 3]) {
    assert.deepEqual(plain(editor.stepMidiList(restored.steps[i])), midis[i]);
    assert.equal(restored.rhythm.steps[i].restBeforeBeats, 0);
    assert.equal(restored.rhythm.steps[i].durationBeats, 0.5);
  }
  for (const field of ['pattern','handMode','contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec','rhythm','guide','learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
