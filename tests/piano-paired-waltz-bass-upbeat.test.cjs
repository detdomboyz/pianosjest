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
const before = require('./fixtures/piano-before-paired-waltz-bass-upbeat-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');

const id = 'detail-p-paired-waltz-bass-upbeat-01';
const bass = 'detail-p-left-waltz-passing-bass-01';
const landing = 'detail-p-bflat-major-prepared-paired-lower-ascent-01';
const sourceId = 'kohler-zac-waltz-bass-upbeat-2026-11-28';
const midis = [[43], [50], [47], [48, 60]];
const starts = [0, 1, 2.5, 3];
const durations = [1, 1, 0.5, 1];
const fingers = [5, 1, 3, 2].map(num => [{ hand: 'left', num }]);
fingers[3].push({ hand: 'right', num: 1 });
const steps = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(l => l.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN');
const frames = l => plain(l.steps.map((s, i) => [
  app.stepMidiList(s), l.fingeringSpec.steps[i], l.rhythm.steps[i].startBeat, l.rhythm.steps[i].durationBeats
]));

test('only the prepared bass sounds on the upbeat and both hands join on the next beat one', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the prepared bass upbeat');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.branch, 'paired-waltz-bass-upbeat');
  assert.equal(lesson.learning.after, bass);
  assert.deepEqual(plain(lesson.learning.requires), [bass, landing]);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  const actual = frames(lesson), earlierBass = frames(find(bass));
  assert.deepEqual(actual, midis.map((p, i) => [p, fingers[i], starts[i], durations[i]]));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.measure, s.beatInMeasure, s.restBeforeBeats])),
    [[1, 0, 0], [1, 1, 0], [1, 2.5, 0.5], [2, 0, 0]]);
  assert.deepEqual(earlierBass[2], [[43], [fingers[0][0]], 2, 0.5]);
  assert.deepEqual(actual.slice(0, 3), [earlierBass[0], earlierBass[1], earlierBass[3]]);
  assert.deepEqual(actual[3].slice(0, 2), frames(find(landing))[1].slice(0, 2));
  assert.equal(actual[3][3], frames(find(landing))[1][3]);
  assert.equal(earlierBass[4][0][0], actual[3][0][0]);
  assert.deepEqual(earlierBass[4][1][0], actual[3][1][0]);
  const at = plan.piano.findIndex(row => row.id === id);
  for (const key of [bass, landing]) {
    const prepare = plan.piano.findIndex(row => row.id === key);
    assert.ok(prepare >= 0 && prepare < at, key);
    assert.equal(plan.piano[prepare].stage, 'p7');
    assert.notEqual(plan.piano[prepare].branch, lesson.learning.branch);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('client and server reject a filled pause, an early right attack or a shifted landing', () => {
  const lesson = find(id), row = registry.lessons.find(l => l.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, [bass, landing]);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));

  const at = beat => 1000 + beat * 1250;
  const event = (type, midi, beat) => ({ type, midi, at:at(beat), source:'midi' });
  const expected = steps.flatMap(s => s.midis.flatMap(midi => [
    event('on', midi, s.startBeat), event('off', midi, s.startBeat + s.durationBeats)
  ]));
  const shift = (type, midi, beat, movedTo) => expected.map(e =>
    e.midi === midi && e.type === type && e.at === at(beat) ? event(type,midi,movedTo) : e);
  const input = {
    correct: expected,
    'left pickup omitted': expected.filter(e => e.midi !== 47),
    'B flat instead of B natural': expected.map(e => e.midi === 47 ? { ...e, midi:46 } : e),
    'left pickup too early': shift('on',47,2.5,2),
    'previous left note fills the rest': shift('off',50,2,2.35),
    'old G sounds during the rest': [...expected,event('on',43,2),event('off',43,2.5)],
    'B holds past the downbeat': shift('off',47,3,3.36),
    'right plays during bass pickup': [...expected,event('on',60,2.5),event('off',60,3)],
    'right misses the shared attack': expected.filter(e => e.midi !== 60),
    'right delays the shared attack': shift('on',60,3,3.17),
    'pair held too long': shift('off',48,4,4.34)
  };
  for (const [label, notes] of Object.entries(input)) {
    const ordered = [...notes].sort((a,b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({steps, events:ordered,bpm:48,targetBpm:48,profile:row.profile,timingPrecision:row.timingPrecision});
    assert.equal(local.clean, label === 'correct', label);
    const end = Math.max(at(4), ordered.at(-1).at);
    assert.equal(grade(row, eventsInput(ordered,end), 'challenge',end,false).assessment.clean, local.clean, label);
  }
});

test('all original lessons, routes, sources and the review baseline survive the addition', () => {
  const old = new Set([...catalogIds, ...catalogIdsAdded, 'detail-p-paired-waltz-eighth-bass-shift-01',
    'detail-p-paired-waltz-upbeat-01']);
  const prior = learning.filter(l => old.has(l.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(prior.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(l => old.has(l.id))), before.catalogHash);
  assert.equal(hash(assertPreservedThemes(app.themes,before.themes)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(registry.lessons.filter(l => old.has(l.id))), before.canonicalHash);
  assert.equal(hash(registry.route.filter(l => old.has(l))), before.canonicalRouteHash);
  assert.equal(hash(prior.map(l => [l.id,next(plan,'piano',learning,l.id)?.id??null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0,before.sourceEntries)), before.sourceHash);
});

test('the edition and method distinguish the source examples from project timing and fingers', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const rule = ledger.entries.find(e => e.id === sourceId);
  const use = rule?.applications.find(a => a.batch === '2026-11-28-06' && a.lessonIds.includes(id));
  assert.ok(use);
  assert.deepEqual(use.notatedExample, {
    printedPage:54, pdfPage:56, exercise:123, meter:'3/4', measure:4, rightRestBeat:3,
    leftThirdBeatMidi:67, leftThirdBeatDurationBeats:1, nextMeasure:5, pairedDownbeat:true
  });
  assert.equal(use.passingBassSourceId, 'zac-waltz-passing-bass-2026-11-27');
  assert.deepEqual(use.projectMidis, midis);
  assert.deepEqual(use.projectStartBeats, starts);
  assert.deepEqual(use.projectDurationsBeats, durations);
  assert.deepEqual(use.projectGlobalRestBeats, [2,2.5]);
  assert.deepEqual(use.projectRightRestBeats, [0,3]);
  assert.equal(use.bothStavesVisuallyRead, true);
  assert.equal(use.sourceScoreReproduced, false);
});

test('the catalog roundtrip preserves a personal edit, the isolated bass and its pause', async () => {
  const editor = loadApp({web:true, events:true, storage:createMemoryStorage()});
  const lesson = editor.lessons.find(l => l.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([name,midi]) => name.length === 1 && midi === 62);
  tokens[3] = '[' + tokens[3].slice(1,2) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[3])), [48,62]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps[3][1].num = 2;
  lesson.guide.setup = 'Моя подготовка басового затакта';
  lesson.learning.practiceSteps[0] = 'Мой разбор вступления';
  const edited = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), edited);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const saved = editor.lessons.find(l => l.id === id);
  assert.deepEqual(plain(editor.stepMidiList(saved.steps[2])), [47]);
  assert.equal(saved.rhythm.steps[2].restBeforeBeats, 0.5);
  assert.equal(saved.rhythm.steps[2].durationBeats, 0.5);
  for (const field of ['pattern','handMode','contentKind']) assert.equal(saved[field], edited[field]);
  for (const field of ['fingeringSpec','rhythm','guide','learning']) assert.deepEqual(plain(saved[field]), edited[field]);
});
