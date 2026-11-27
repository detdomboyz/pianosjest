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
const before = require('./fixtures/piano-before-left-waltz-bass-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-left-waltz-bass-01';
const theme = 'detail-p-left-waltz';
const prior = 'detail-p-left-position-triad-01';
const prerequisites = ['course04-07', 'detail-p-left-triple-pulse-01', prior];
const sourceIds = ['clark-baylor-waltz-bass-2026-11-27', 'winn-left-hand-waltz-preparation-2026-11-27'];
const midis = [[53], [57, 60], [57, 60], [53], [57, 60], [57, 60]];
const digits = [[5], [3, 1], [3, 1], [5], [3, 1], [3, 1]];
const durations = [1, 0.5, 1, 1, 0.5, 1];
const rhythm = durations.map((durationBeats, startBeat) => ({ startBeat, durationBeats, midis: midis[startBeat] }));
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});

test('left waltz bass keeps the prepared F-major fingers and two measured reattacks', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the left-hand waltz bass');
  assert.equal(lesson.themeId, theme);
  assert.equal(lesson.handMode, 'left');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.after, 'course10-08');
  assert.equal(lesson.learning.coverageDomain, 'arpeggios');
  assert.deepEqual(plain(lesson.learning.requires), prerequisites);
  const prepared = find(prior), preparedNotes = app.stepMidiList(prepared.steps[3]);
  assert.deepEqual(plain(preparedNotes), [53, 57, 60]);
  assert.deepEqual(plain(prepared.fingeringSpec.steps[3].map(f => f.num)), [5, 3, 1]);
  assert.deepEqual(plain(lesson.steps.map(s => app.stepMidiList(s))), midis);
  assert.deepEqual(plain(lesson.fingeringSpec.steps), digits.map(row => row.map(num => ({ hand: 'left', num }))));
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats, s.measure, s.beatInMeasure])),
    [[0, 1, 0, 1, 0], [1, 0.5, 0, 1, 1], [2, 1, 0.5, 1, 2], [3, 1, 0, 2, 0], [4, 0.5, 0, 2, 1], [5, 1, 0.5, 2, 2]]);
  const index = plan.piano.findIndex(row => row.id === id);
  assert.ok(index > plan.piano.findIndex(row => row.id === 'course10-08'));
  for (const preparation of prerequisites) {
    const indexBefore = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(indexBefore >= 0 && indexBefore < index, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
});

test('both graders require the released bass, half-beat silence, two separate dyad attacks and final release', () => {
  const lesson = find(id), row = course.lessons.find(entry => entry.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, rhythm);
  assert.deepEqual(row.requires, prerequisites);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  const ms = 1250, start = 1000, end = start + 6 * ms;
  const at = beat => start + beat * ms;
  const expected = rhythm.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: at(startBeat), source: 'midi' },
    { type: 'off', midi, at: at(startBeat + durationBeats), source: 'midi' }
  ]));
  const changes = {
    correct: expected,
    'bass overlaps the first dyad': expected.map(event => event.midi === 53 && event.type === 'off' && event.at === at(1) ?
      { ...event, at: at(1.5) } : event),
    'single held dyad through the silence and reattack': expected.filter(event =>
      !((event.at === at(1.5) && event.type === 'off') || (event.at === at(2) && event.type === 'on'))),
    'one note rings into the silent half-beat': expected.map(event => event.midi === 60 && event.type === 'off' && event.at === at(1.5) ?
      { ...event, at: at(1.9) } : event),
    'both notes start on the wrong subdivision': expected.map(event => event.type === 'on' && event.at === at(2) ?
      { ...event, at: at(1.5) } : event),
    'one note of the final dyad never enters': expected.filter(event => event.midi !== 60 || event.at < at(5)),
    'short final release': expected.map(event => event.midi === 57 && event.type === 'off' && event.at === end ?
      { ...event, at: at(5.5) } : event)
  };
  for (const [name, events] of Object.entries(changes)) {
    const sorted = [...events].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const check = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, index) => ({ ...step, midis: midis[index] })),
      events: sorted, bpm: 48, targetBpm: 48, profile: row.profile, timingPrecision: row.timingPrecision
    });
    assert.equal(check.clean, name === 'correct', name);
    assert.equal(grade(row, eventsInput(sorted, end), 'challenge', end, false).assessment.clean, check.clean, name);
  }
});

test('adding the left waltz preserves the previous lessons, editions, order and source rules', () => {
  const old = new Set([...earlierIds, ...before.catalogIdsAdded]);
  const existing = learning.filter(lesson => old.has(lesson.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(existing.length, before.learningRecords);
  assert.equal(hash(app.lessons.filter(lesson => old.has(lesson.id))), before.catalogHash);
  assert.equal(hash(app.themes.filter(row => row.id !== theme)), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(row => old.has(row.id))), before.canonicalHash);
  assert.equal(hash(course.route.filter(key => old.has(key))), before.canonicalRouteHash);
  assert.equal(hash(existing.map(lesson => [lesson.id, next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
});

test('the lesson records the source meter, original notes and project silence and includes an open transfer', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свой/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const sources = sourceIds.map(sourceId => ledger.entries.find(source => source.id === sourceId));
  const [clark, winn] = sources.map(source => {
    assert.ok(source);
    return source.applications.find(row => row.batch === '2026-11-27-21' && row.lessonIds.includes(id));
  });
  assert.deepEqual(clark.sourceMidis, [[48], [52, 55], [52, 55], [48], [52, 55], [52, 55]]);
  assert.deepEqual(clark.sourceDurationsBeats, [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(clark.sourceSlurGroups, [[0, 1], [3, 4]]);
  assert.equal(clark.sourceFingeringPrinted, false);
  assert.deepEqual(clark.projectMidis, midis);
  assert.deepEqual(clark.projectDurationsBeats, durations);
  assert.deepEqual(clark.projectRestIntervals, [[1.5, 2], [4.5, 5]]);
  assert.match(clark.sourceImageSha256, /^[a-f0-9]{64}$/);
  assert.match(winn.location, /Left Hand Alone/);
});

test('review and catalog exchange preserve an edited waltz with the original left-hand assignment', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 62);
  tokens[5] = '[' + tokens[5][1] + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[5])), [57, 62]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя новая позиция';
  lesson.learning.practiceSteps[0] = 'Мой счёт в 3/4';
  const snapshot = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), snapshot);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], snapshot[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), snapshot[field]);
});
