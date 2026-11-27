'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const { next } = require('../curriculum.js');
const assessment = require('../practice-assessment.js');
const { eventsInput, grade } = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-left-waltz-passing-bass-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-left-waltz-passing-bass-01';
const prior = 'detail-p-left-waltz-root-fifth-01';
const prerequisites = ['detail-p-left-triple-pulse-01', 'detail-p-g-major-split-left-01', 'detail-p-eighth-rest-offbeat-left-01'];
const sourceId = 'zac-waltz-passing-bass-2026-11-27';
const midis = [[43], [50], [43], [47], [48]];
const digits = [[5], [1], [5], [3], [2]];
const starts = [0, 1, 2, 2.5, 3];
const durations = [1, 1, 0.5, 0.5, 3];
const events = midis.map((pitches, i) => ({ midis: pitches, startBeat: starts[i], durationBeats: durations[i] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const frame = (lesson, i) => plain([
  app.stepMidiList(lesson.steps[i]), lesson.fingeringSpec.steps[i].map(f => f.num), lesson.rhythm.steps[i].durationBeats
]);

test('the approach B2 arrives on the last eighth of 3/4 and resolves to a new C3 attack', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the left-hand waltz approach note');
  assert.equal(lesson.themeId, 'detail-p-left-waltz');
  assert.equal(lesson.handMode, 'left');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, prior);
  assert.equal(lesson.learning.coverageDomain, 'arpeggios');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(plain(lesson.steps.map(s => app.stepMidiList(s))), midis);
  assert.deepEqual(plain(lesson.fingeringSpec.steps), digits.map(group => group.map(num => ({ hand: 'left', num }))));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats, s.measure, s.beatInMeasure])),
    [[0, 1, 0, 1, 0], [1, 1, 0, 1, 1], [2, 0.5, 0, 1, 2], [2.5, 0.5, 0, 1, 2.5], [3, 3, 0, 2, 0]]);
  assert.deepEqual(plain(find(prerequisites[0]).rhythm.timeSignature), { numerator: 3, denominator: 4 });
  const scale = find(prerequisites[1]);
  assert.deepEqual([0, 4, 2, 3].map(i => frame(scale, i).slice(0, 2)), [
    [[43], [5]], [[50], [1]], [[47], [3]], [[48], [2]]
  ]);
  assert.ok(find(prerequisites[2]).rhythm.steps.some(s => s.beatInMeasure === 2.5 && s.durationBeats === 0.5));
  const n = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(next(plan, 'piano', learning, prior), null);
});

test('both graders check the short approach, its release, and the distinct new downbeat', () => {
  const lesson = find(id), row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, events);
  assert.deepEqual(row.requires, prerequisites);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  const at = beat => 1000 + beat * 1250, end = at(6);
  const expected = events.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: at(startBeat), source: 'midi' },
    { type: 'off', midi, at: at(startBeat + durationBeats), source: 'midi' }
  ]));
  const changes = {
    correct: expected,
    'the approach note is omitted': expected.filter(e => e.midi !== 47),
    'the approach note starts on beat three': expected.map(e => e.midi === 47 && e.type === 'on' ?
      { ...e, at: at(2) } : e),
    'the approach arrives on the new downbeat': expected.map(e => e.midi === 47 && e.type === 'on' ?
      { ...e, at: at(3) } : e),
    'B2 rings into the new bass': expected.map(e => e.midi === 47 && e.type === 'off' ?
      { ...e, at: at(3.4) } : e),
    'the third G is in the higher octave': expected.map(e => e.midi === 43 && e.at >= at(2) ? { ...e, midi: 55 } : e),
    'C3 releases before the third beat of its bar': expected.map(e => e.midi === 48 && e.type === 'off' ?
      { ...e, at: at(5) } : e)
  };
  for (const [name, input] of Object.entries(changes)) {
    const ordered = [...input].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, index) => ({ ...step, midis: midis[index] })),
      events: ordered, bpm: 48, targetBpm: 48, profile: row.profile, timingPrecision: row.timingPrecision
    });
    assert.equal(local.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(ordered, end), 'challenge', end, false).assessment.clean, local.clean, name);
  }
});

test('adding the waltz approach note preserves prior lessons, themes, editions, routes and source rules', () => {
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
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the source supports the B-to-C movement while the project specifies its counted eighth', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceId);
  const application = source?.applications.find(row => row.batch === '2026-11-27-26' && row.lessonIds.includes(id));
  assert.ok(application);
  assert.deepEqual(application.sourcePitchClasses, ['G', 'D', 'G', 'B', 'C', 'E', 'G']);
  assert.equal(application.sourceBeatOfB, null);
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, starts);
  assert.deepEqual(application.projectDurationsBeats, durations);
  assert.deepEqual(application.projectRestIntervals, []);
});

test('review and catalog exchange preserve a personal revision of the waltz approach exercise', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 52);
  tokens[4] = key;
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[4])), [52]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка подводящей ноты';
  lesson.learning.practiceSteps[0] = 'Мой счёт перед басом';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
