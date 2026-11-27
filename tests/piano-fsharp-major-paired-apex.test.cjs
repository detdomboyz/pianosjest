'use strict';
const { assertPreservedThemes } = require('./helpers/assert-preserved-themes.cjs');
const preWaltzThemes = require('./fixtures/piano-before-csharp-major-prepared-paired-roundtrip-v1.json').themes;

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const before = require('./fixtures/piano-before-fsharp-major-paired-apex-v1.json');
const assessment = require('../practice-assessment.js');
const curriculum = require('../curriculum.js');
const game = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');

const id = 'detail-p-fsharp-major-prepared-paired-apex-01';
const soloId = hand => 'detail-p-fsharp-major-prepared-roundtrip-' + hand + '-01';
const requires = [
  soloId('left'), soloId('right'),
  'detail-p-fsharp-major-upper-three-paired-ascent-01',
  'detail-p-fsharp-major-upper-three-paired-descent-01'
];
const midis = [[63, 75], [65, 77], [66, 78], [65, 77], [63, 75]];
const fingers = [[2, 3], [1, 1], [2, 2], [1, 1], [2, 3]];
const steps = midis.map((pair, i) => ({ midis: pair, startBeat: i, durationBeats: i === 4 ? 2 : 1 }));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {});
const plain = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('F-sharp apex joins the prepared dyads through one black-key turn', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing F-sharp paired apex');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.coverageDomain, 'coordination');
  assert.equal(lesson.learning.articulation, 'standard');
  assert.equal(lesson.learning.timingPrecision, 'beat-boundary-v2');
  assert.deepEqual(plain(lesson.learning.requires), requires);
  const frames = row => plain(row.steps.map((step, i) => [app.stepMidiList(step), row.fingeringSpec.steps[i]]));
  const expected = midis.map((pair, i) => [pair, [
    { hand: 'left', num: fingers[i][0] }, { hand: 'right', num: fingers[i][1] }
  ]]);
  assert.deepEqual(frames(lesson), expected);
  assert.deepEqual([...frames(find(requires[2])), ...frames(find(requires[3])).slice(1)], expected);
  for (const [index, hand] of ['left', 'right'].entries()) {
    assert.deepEqual(frames(find(soloId(hand))).slice(5, 10), expected.map(([notes, digits]) => [[notes[index]], [digits[index]]]));
  }
  assert.equal(lesson.rhythm.practiceBpm, 40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats])),
    steps.map(s => [s.startBeat, s.durationBeats, 0]));
  const index = plan.piano.findIndex(row => row.id === id);
  assert.ok(index > 0 && requires.every(key => plan.piano.findIndex(row => row.id === key) < index));
  assert.equal(curriculum.next(plan, 'piano', learning, id), null);
});

test('F-sharp paired turn grades separate common attacks and both final releases', () => {
  const lesson = find(id);
  const canonical = course.lessons.find(row => row.id === id);
  assert.ok(lesson && canonical?.challengeReady);
  assert.equal(canonical.profile, 'standard');
  assert.equal(canonical.timingPrecision, 'beat-boundary-v2');
  assert.equal(canonical.gradeFingerprint, assessment.pianoSignature(lesson));
  assert.deepEqual(canonical.requires, requires);
  assert.deepEqual(canonical.steps, steps);
  const events = steps.flatMap(({ midis, startBeat, durationBeats }) => midis.flatMap(midi => [
    { type: 'on', midi, at: 1000 + startBeat * 1500, source: 'midi' },
    { type: 'off', midi, at: 1000 + (startBeat + durationBeats) * 1500, source: 'midi' }
  ]));
  const end = 10000;
  const samples = {
    aligned: events,
    'right apex late': events.map((event, i) => i === 10 || i === 11 ? { ...event, at: event.at + 180 } : event),
    'repeated apex': [...events, { ...events[8], at: 4750 }, { ...events[9], at: 5000 }],
    'wrong leading tone': events.map((event, i) => i === 4 || i === 5 ? { ...event, midi: 64 } : event),
    'missing right return': events.slice(0, -2),
    'short final left note': events.map((event, i) => i === 17 ? { ...event, at: end - 750 } : event),
    'final right kept down': events.slice(0, -1)
  };
  for (const [name, input] of Object.entries(samples)) {
    const ordered = [...input].sort((a, b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on') || a.midi - b.midi);
    const client = assessment.assessPiano({
      steps: lesson.rhythm.steps.map((step, i) => ({ ...step, midis: app.stepMidiList(lesson.steps[i]) })),
      events: ordered, bpm: 40, targetBpm: 40, profile: 'standard', timingPrecision: 'beat-boundary-v2'
    });
    const server = game.grade(canonical, game.eventsInput(ordered, end), 'challenge', end, false);
    assert.equal(client.clean, name === 'aligned', name);
    assert.equal(server.assessment.clean, client.clean, name);
  }
});

test('F-sharp addition preserves prior editions, progress fingerprints, and navigation', () => {
  const knownIds = new Set(before.catalogIds);
  assert.equal(knownIds.size, before.catalogRecords);
  assert.ok([id, soloId('left'), soloId('right')].every(key => !knownIds.has(key)));
  const past = learning.filter(lesson => knownIds.has(lesson.id));
  assert.equal(past.length, before.learningRecords);
  assert.equal(app.lessons.length, require('./fixtures/piano-curriculum-counts.json').catalogRecords);
  assert.equal(digest(app.lessons.filter(lesson => knownIds.has(lesson.id))), before.catalogHash);
  const historical = assertPreservedThemes(app.themes, preWaltzThemes);
  assert.equal(historical.length, before.themes);
  assert.equal(digest(historical), before.themeHash);
  assert.equal(digest(plan.piano.filter(lesson => knownIds.has(lesson.id))), before.pianoPlanHash);
  assert.equal(digest(plan.guitar), before.guitarPlanHash);
  assert.equal(digest(course.lessons.filter(lesson => knownIds.has(lesson.id))), before.canonicalHash);
  assert.equal(digest(course.route.filter(key => knownIds.has(key))), before.canonicalRouteHash);
  assert.equal(digest(past.map(lesson => [lesson.id, curriculum.next(plan, 'piano', learning, lesson.id)?.id ?? null])), before.nextHash);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))).digest('hex'), before.reviewBaseline);
});

test('F-sharp card cites both directions of each hand and teaches a new phrase', () => {
  const lesson = find(id);
  assert.ok(lesson);
  const batch = '2026-11-20-03';
  const ledger = require('../docs/piano-curriculum-sources.json');
  const earlier = ledger.entries.slice(0, before.sourceEntries).map(row => {
    const copy = plain(row);
    if (copy.applications) {
      copy.applications = copy.applications.filter(application => application.batch < batch);
      if (!copy.applications.length) delete copy.applications;
    }
    return copy;
  });
  assert.equal(digest(earlier), before.sourceHash);
  const sourceIds = [
    'pff-fsharp-major-upper-212-left-2026-11-18', 'pff-fsharp-major-upper-212-descent-left-2026-11-18',
    'pff-fsharp-major-upper-prepared-right-2026-11-18', 'pff-fsharp-major-thumb-fourth-down-right-2026-11-18'
  ];
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sourceIds);
  const applications = ledger.entries.flatMap(row => (row.applications || []).filter(a => a.batch === batch).map(a => [row.id, a]));
  assert.equal(applications.length, 4);
  for (const [index, hand] of ['left', 'right'].entries()) {
    const relatedSources = sourceIds.slice(2 * index, 2 * index + 2);
    assert.deepEqual(plain(find(soloId(hand)).learning.sourceEvidenceIds), relatedSources);
    for (const key of relatedSources) {
      const app = applications.find(([source]) => source === key)?.[1];
      assert.ok(app?.sourceRuleReused && app.lessonIds.includes(id) && app.lessonIds.includes(soloId(hand)), key);
    }
  }
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.match(lesson.learning.practiceSteps.join(' '), /E♯4.*бел.*F4/);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай.{1,120}6–8/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
});

const octaveLeft = [54, 56, 58, 59, 61, 63, 65, 66, 65, 63, 61, 59, 58, 56, 54];
for (const { hand, offset, digits } of [
  { hand: 'left', offset: 0, digits: [4, 3, 2, 1, 3, 2, 1, 2, 1, 2, 3, 1, 2, 3, 4] },
  { hand: 'right', offset: 12, digits: [2, 3, 4, 1, 2, 3, 1, 2, 1, 3, 2, 1, 4, 3, 2] }
]) {
  test('F-sharp preparation for ' + hand + ' covers the full octave and the exact apex sequence', () => {
    const lesson = find(soloId(hand));
    const row = course.lessons.find(entry => entry.id === soloId(hand));
    assert.ok(lesson && row?.challengeReady);
    assert.equal(lesson.handMode, hand);
    assert.equal(lesson.themeId, 'detail-p-major-scales');
    assert.equal(lesson.learning.stage, 'p7');
    assert.equal(lesson.learning.articulation, 'legato');
    assert.equal(lesson.learning.timingPrecision, 'beat-boundary-v2');
    assert.deepEqual(plain(lesson.learning.requires), ['ascent', 'descent'].map(direction => 'detail-p-fsharp-major-' + direction + '-' + hand + '-01'));
    const expectedNotes = octaveLeft.map(note => [note + offset]);
    assert.deepEqual(plain(lesson.steps.map(step => app.stepMidiList(step))), expectedNotes);
    assert.deepEqual(plain(lesson.fingeringSpec.steps), digits.map(num => [{ hand, num }]));
    assert.equal(lesson.rhythm.practiceBpm, 40);
    assert.deepEqual(row.steps, expectedNotes.map((midis, i) => ({ midis, startBeat: i, durationBeats: i === 14 ? 2 : 1 })));
    assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
    assert.equal(curriculum.next(plan, 'piano', learning, soloId(hand)), null);
    assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  });
}
