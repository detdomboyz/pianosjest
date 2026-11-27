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
const before = require('./fixtures/piano-before-left-waltz-approach-chord-v1.json');
const earlierIds = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json').catalogIds;

const id = 'detail-p-left-waltz-approach-chord-01';
const prior = 'detail-p-left-waltz-passing-bass-01';
const prerequisites = ['detail-p-triads-02', prior, 'detail-p-left-waltz-cadence-01'];
const sourceId = 'zac-waltz-approach-tonic-2026-11-27';
const scoreId = 'clark-baylor-waltz-cadence-2026-11-27';
const midis = [[43], [50], [43], [47], [48, 52, 55]];
const digits = [[5], [1], [5], [3], [5, 3, 1]];
const starts = [0, 1, 2, 2.5, 3];
const durations = [1, 1, 0.5, 0.25, 3];
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
  app.stepMidiList(lesson.steps[i]), lesson.fingeringSpec.steps[i].map(f => f.num),
  lesson.rhythm.steps[i].startBeat, lesson.rhythm.steps[i].durationBeats
]);

test('a short B2 leaves room before the prepared left-hand triad on the next downbeat', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing the left-hand waltz approach chord');
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
    [[0, 1, 0, 1, 0], [1, 1, 0, 1, 1], [2, 0.5, 0, 1, 2], [2.5, 0.25, 0, 1, 2.5], [3, 3, 0.25, 2, 0]]);
  const pickup = find(prior);
  assert.deepEqual([0, 1, 2].map(i => frame(lesson, i)), [0, 1, 2].map(i => frame(pickup, i)));
  assert.deepEqual(frame(lesson, 3).slice(0, 3), frame(pickup, 3).slice(0, 3));
  assert.equal(pickup.rhythm.steps[3].durationBeats, 0.5);
  assert.deepEqual(frame(lesson, 4), frame(find(prerequisites[2]), 3));
  assert.deepEqual(frame(lesson, 4).slice(0, 2), frame(find(prerequisites[0]), 3).slice(0, 2));
  const n = plan.piano.findIndex(row => row.id === id);
  for (const preparation of prerequisites) {
    const at = plan.piano.findIndex(row => row.id === preparation);
    assert.ok(at >= 0 && at < n, preparation);
  }
  assert.equal(next(plan, 'piano', learning, id), null);
  assert.equal(next(plan, 'piano', learning, prior), null);
});

test('both graders check the approach, silence, simultaneous triad and release', () => {
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
  const moveFinalChord = beatOffset => expected.map(e => e.at >= at(3) ? { ...e, at: e.at + beatOffset * 1250 } : e);
  const changes = {
    correct: expected,
    'the approach note is omitted': expected.filter(e => e.midi !== 47),
    'B2 fills the silence': expected.map(e => e.midi === 47 && e.type === 'off' ? { ...e, at: at(3) } : e),
    'the original early onset is inside the timing tolerance': expected.map(e => e.at === at(3) && e.type === 'on' ?
      { ...e, at: at(2.8) } : e),
    'the entire chord enters at the start of the rest': moveFinalChord(-0.25),
    'the upper G is missing': expected.filter(e => e.midi !== 55),
    'E3 enters after the rest of the chord': expected.map(e => e.midi === 52 && e.type === 'on' ?
      { ...e, at: at(3.12) } : e),
    'G3 releases separately from the rest of the chord': expected.map(e => e.midi === 55 && e.type === 'off' ?
      { ...e, at: at(5.88) } : e),
    'G3 releases before the third beat of its bar': expected.map(e => e.midi === 55 && e.type === 'off' ?
      { ...e, at: at(5) } : e)
  };
  for (const [name, input] of Object.entries(changes)) {
    const ordered = [...input].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const local = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, index) => ({ ...step, midis: midis[index] })),
      events: ordered, bpm: 48, targetBpm: 48, profile: row.profile, timingPrecision: row.timingPrecision
    });
    const accepted = name === 'correct' || name === 'the original early onset is inside the timing tolerance';
    assert.equal(local.clean, accepted, name);
    assert.equal(grade(row, eventsInput(ordered, end), 'challenge', end, false).assessment.clean, local.clean, name);
  }
});

test('adding the waltz approach chord preserves prior lessons, themes, editions, routes and source rules', () => {
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

test('the sources document the move toward C major and the project specifies the release', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId, scoreId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свою/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(row => row.id === sourceId);
  const application = source?.applications.find(row => row.batch === '2026-11-27-27' && row.lessonIds.includes(id));
  assert.ok(application);
  assert.deepEqual(application.sourcePitchClasses, ['G', 'D', 'G', 'B', 'C', 'E', 'G']);
  assert.equal(application.sourceBeatOfB, null);
  assert.equal(application.sourceVideoObserved, false);
  assert.equal(application.relatedScore.id, scoreId);
  assert.equal(application.relatedScore.location, '§90.1, тт. 4–5');
  assert.deepEqual(application.relatedScore.midis, [[47], [53, 55], [53, 55], [48, 52, 55]]);
  assert.deepEqual(application.relatedScore.durationsBeats, [1, 1, 1, 3]);
  assert.deepEqual(application.projectMidis, midis);
  assert.deepEqual(application.projectStartBeats, starts);
  assert.deepEqual(application.projectDurationsBeats, durations);
  assert.deepEqual(application.projectRestIntervals, [[2.75, 3]]);
});

test('review and catalog exchange preserve a personal revision of the waltz approach exercise', async () => {
  const editor = loadApp({ web: true, events: true, storage: createMemoryStorage() });
  const lesson = editor.lessons.find(lesson => lesson.id === id);
  assert.ok(lesson);
  const tokens = lesson.pattern.split(' ');
  const [key] = Object.entries(editor.KEY_MAP).find(([label, midi]) => label.length === 1 && midi === 57);
  tokens[4] = '[' + tokens[4].slice(1, 3) + key + ']';
  lesson.pattern = tokens.join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  assert.deepEqual(plain(editor.stepMidiList(lesson.steps[4])), [48, 52, 57]);
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.guide.setup = 'Моя подготовка трезвучия';
  lesson.learning.practiceSteps[0] = 'Мой счёт перед трезвучием';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(l => l.id === id)), saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(), () => true), true);
  const restored = editor.lessons.find(l => l.id === id);
  for (const field of ['pattern', 'handMode', 'contentKind']) assert.equal(restored[field], saved[field]);
  for (const field of ['fingeringSpec', 'rhythm', 'guide', 'learning']) assert.deepEqual(plain(restored[field]), saved[field]);
});
