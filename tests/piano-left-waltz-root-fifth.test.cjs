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
const before = require('./fixtures/piano-before-left-waltz-root-fifth-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-left-waltz-root-fifth-01';
const prior = 'detail-p-left-waltz-common-bass-01';
const prerequisites = ['detail-p-triads-02', 'detail-p-g-major-split-left-01', prior];
const sourceIds = ['chord-rhythms-waltz-root-fifth-2026-11-27', 'kohler-op249-waltz-no69-2026-11-27'];
const midis = [[48], [52, 55], [52, 55], [43], [52, 55], [52, 55]];
const digits = [[5], [3, 1], [3, 1], [5], [3, 1], [3, 1]];
const durations = [1, 0.5, 0.5, 1, 0.5, 1];
const events = midis.map((pitches, i) => ({ midis: pitches, startBeat: i, durationBeats: durations[i] }));
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

test('the waltz changes from C3 to G2 and repeats the same prepared dyad', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the left-hand root-to-fifth waltz');
  assert.equal(lesson.themeId, 'detail-p-left-waltz');
  assert.equal(lesson.handMode, 'left');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, 'detail-p-left-waltz-cadence-01');
  assert.equal(lesson.learning.coverageDomain, 'arpeggios');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(plain(lesson.steps.map(s => app.stepMidiList(s))), midis);
  assert.deepEqual(plain(lesson.fingeringSpec.steps), digits.map(group => group.map(num => ({ hand: 'left', num }))));
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats, s.measure, s.beatInMeasure])),
    [[0, 1, 0, 1, 0], [1, 0.5, 0, 1, 1], [2, 0.5, 0.5, 1, 2], [3, 1, 0.5, 2, 0], [4, 0.5, 0, 2, 1], [5, 1, 0.5, 2, 2]]);
  assert.deepEqual(frame(find(prerequisites[0]), 3).slice(0, 2), [[48, 52, 55], [5, 3, 1]]);
  assert.deepEqual(frame(find(prerequisites[1]), 0), [[43], [5], 1]);
  assert.deepEqual([0, 1, 2].map(i => frame(lesson, i)), [0, 1, 2].map(i => frame(find(prior), i)));
  const n = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(next(plan, 'piano', learning, prior), null);
});

test('both graders require the lower G on the next downbeat and the same upper dyads', () => {
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
    'the first bass is reused in the second bar': expected.map(e => e.midi === 43 ? { ...e, midi: 48 } : e),
    'the G bass is an octave high': expected.map(e => e.midi === 43 ? { ...e, midi: 55 } : e),
    'the lower G arrives during the rest': expected.map(e => e.midi === 43 && e.type === 'on' ?
      { ...e, at: at(2.5) } : e),
    'the old upper G is held into the new bass': expected.map(e => e.midi === 55 && e.type === 'off' && e.at === at(2.5) ?
      { ...e, at: at(3.3) } : e),
    'the upper harmony changes on the second measure': expected.map(e => e.midi === 52 && e.at >= at(4) ?
      { ...e, midi: 53 } : e),
    'the final dyad is held through the expected repeat': expected.filter(e =>
      !((e.at === at(4.5) && e.type === 'off') || (e.at === at(5) && e.type === 'on')))
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

test('adding the root-to-fifth waltz preserves prior lessons, themes, editions, routes and source rules', () => {
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

test('the sources specify root-fifth alternation and a separately documented historical example', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const selected = sourceIds.map(sourceId => ledger.entries.find(row => row.id === sourceId));
  const [model, edition] = selected.map(source =>
    source?.applications.find(row => row.batch === '2026-11-27-25' && row.lessonIds.includes(id)));
  assert.ok(model && edition);
  assert.deepEqual(model.sourceBassDegrees, [1, 5]);
  assert.deepEqual(model.projectMidis, midis);
  assert.deepEqual(model.projectDurationsBeats, durations);
  assert.deepEqual(model.projectRestIntervals, [[1.5, 2], [2.5, 3], [4.5, 5]]);
  assert.equal(edition.printedPage, 26);
  assert.deepEqual(edition.sourceMidis, [[50], [54, 57], [54, 57], [48], [54, 57], [54, 57]]);
  assert.deepEqual(edition.sourcePrintedLeftDigits, [[4], [2, 1], null, null, null, null]);
  assert.deepEqual(edition.sourceDurationsBeats, [1, 1, 1, 1, 1, 1]);
  assert.match(edition.sourcePagePngSha256, /^[a-f0-9]{64}$/);
});

test('review and catalog exchange preserve a personal revision of the root-to-fifth waltz', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 57);
  tokens[5] = '[' + tokens[5][1] + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[5])), [52, 57]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка пауз';
  lesson.learning.practiceSteps[0] = 'Мой счёт перед басом';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
