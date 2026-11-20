'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const assessment = require('../practice-assessment.js');
const curriculum = require('../curriculum.js');
const game = require('../service/game-grade.cjs');
const course = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-b-major-prepared-roundtrip-v1.json');

const exercises = [
  {
    "hand": "left",
    "id": "detail-p-b-major-prepared-roundtrip-left-01",
    "midis": [
      47,
      49,
      51,
      52,
      54,
      56,
      58,
      59,
      58,
      56,
      54,
      52,
      51,
      49,
      47
    ],
    "fingers": [
      4,
      3,
      2,
      1,
      4,
      3,
      2,
      1,
      2,
      3,
      4,
      1,
      2,
      3,
      4
    ],
    "requires": [
      "detail-p-b-major-ascent-left-01",
      "detail-p-b-major-descent-left-01"
    ],
    "sources": [
      "pff-b-major-ascending-thumb-fourth-left-2026-11-15",
      "pff-b-major-descending-thumb-white-left-2026-11-15"
    ]
  },
  {
    "hand": "right",
    "id": "detail-p-b-major-prepared-roundtrip-right-01",
    "midis": [
      59,
      61,
      63,
      64,
      66,
      68,
      70,
      71,
      70,
      68,
      66,
      64,
      63,
      61,
      59
    ],
    "fingers": [
      1,
      2,
      3,
      1,
      2,
      3,
      4,
      5,
      4,
      3,
      2,
      1,
      3,
      2,
      1
    ],
    "requires": [
      "detail-p-b-major-ascent-right-01",
      "detail-p-b-major-descent-right-01"
    ],
    "sources": [
      "pff-b-major-ascending-prepared-right-2026-11-15",
      "pff-b-major-descending-prepared-right-2026-11-18"
    ]
  }
];
const batch = '2026-11-21-01';
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = id => learning.find(lesson => lesson.id === id);
const plan = vm.runInNewContext(
  fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN', {}
);
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step, i) => [
  app.stepMidiList(step), lesson.fingeringSpec.steps[i]
]));

for (const { hand, id, midis, fingers, requires, sources } of exercises) {
  const steps = midis.map((midi, startBeat) => ({ midis: [midi], startBeat, durationBeats: startBeat === 14 ? 2 : 1 }));
  test('B major ' + hand + ' joins an exact ascent and descent through one attack', () => {
    const lesson = find(id);
    assert.ok(lesson, 'Missing ' + id);
    assert.equal(lesson.handMode, hand);
    assert.equal(lesson.themeId, 'detail-p-major-scales');
    assert.equal(lesson.contentKind, 'exercise');
    assert.equal(lesson.learning.stage, 'p7');
    assert.equal(lesson.learning.coverageDomain, 'major-scales');
    assert.equal(lesson.learning.articulation, 'legato');
    assert.equal(lesson.learning.timingPrecision, 'beat-boundary-v2');
    assert.deepEqual(plain(lesson.learning.requires), requires);
    const [up, down] = requires.map(find);
    const ascent = frames(up);
    const descent = frames(down);
    assert.deepEqual(ascent.at(-1), descent[0]);
    const sequence = frames(lesson);
    assert.deepEqual(sequence, [...ascent, ...descent.slice(1)]);
    assert.deepEqual(sequence, steps.map(({ midis }, i) => [midis, [{ hand, num: fingers[i] }]]));
    assert.equal(sequence.filter(([[midi]]) => midi === midis[7]).length, 1);
    assert.equal(lesson.rhythm.practiceBpm, 40);
    assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 4, denominator: 4 });
    assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat, s.durationBeats, s.restBeforeBeats])),
      steps.map(s => [s.startBeat, s.durationBeats, 0]));
    const index = plan.piano.findIndex(row => row.id === id);
    assert.ok(index > 0 && requires.every(key => plan.piano.findIndex(row => row.id === key) < index));
    assert.equal(curriculum.next(plan, 'piano', learning, id), null);

    assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
    assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), sources);
    const applied = ledger.entries.flatMap(entry => (entry.applications || [])
      .filter(row => row.batch === batch && row.lessonIds.includes(id)).map(row => [entry.id,row]));
    assert.deepEqual(applied.map(([source]) => source).sort(), [...sources].sort());
    assert.ok(applied.every(([,row]) => row.sourceRuleReused && row.freshReadInCurrentBatch));
    assert.match(lesson.learning.practiceSteps.join(' '), /Придумай фразу из 7–9/);
    assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  });

  test('B major ' + hand + ' client and server agree on the turn and final release', () => {
    const lesson = find(id);
    const row = course.lessons.find(entry => entry.id === id);
    assert.ok(lesson && row?.challengeReady);
    assert.equal(row.profile, 'legato');
    assert.equal(row.timingPrecision, 'beat-boundary-v2');
    assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
    assert.deepEqual(row.steps, steps);
    assert.deepEqual(row.requires, requires);
    const start = 1000;
    const beat = 1500;
    const end = start + 16 * beat;
    const events = steps.flatMap(({ midis: [midi], startBeat, durationBeats }) => [
      { type: 'on', midi, at: start + startBeat * beat, source: 'midi' },
      { type: 'off', midi, at: start + (startBeat + durationBeats) * beat, source: 'midi' }
    ]);
    const afterTurn = start + 8 * beat;
    const samples = {
      exact: events,
      'repeated apex attack': [...events, { type:'on', midi:midis[7], at:start + 7.5 * beat, source:'midi' }],
      'late first descending note': events.map(event => event.type === 'on' && event.at === afterTurn ? { ...event, at: event.at + 350 } : event),
      'wrong descending pitch': events.map(event => event.midi === midis[8] && event.at >= afterTurn
        ? { ...event, midi: midis[8] - 1 } : event),
      'short final tone': events.map(event => event.at === end ? { ...event, at: end - 900 } : event),
      'missing final release': events.slice(0,-1)
    };
    for (const [name, input] of Object.entries(samples)) {
      const ordered = [...input].sort((a,b) => a.at - b.at || Number(a.type === 'on') - Number(b.type === 'on'));
      const client = assessment.assessPiano({
        steps: lesson.rhythm.steps.map((step,i) => ({...step,midis:app.stepMidiList(lesson.steps[i])})),
        events:ordered,bpm:40,targetBpm:40,profile:'legato',timingPrecision:'beat-boundary-v2'
      });
      const server = game.grade(row,game.eventsInput(ordered,end),'challenge',end,false);
      assert.equal(client.clean,name === 'exact',name);
      assert.equal(server.assessment.clean,client.clean,name);
    }
  });

  test('B major ' + hand + ' personal edition survives reinstall and exchange', async () => {
    const a = loadApp({ web:true,events:true,storage:createMemoryStorage() });
    const row = a.lessons.find(lesson => lesson.id === id);
    assert.ok(row);
    const [, ...tail] = row.pattern.split(' ');
    const [changedKey] = Object.entries(a.KEY_MAP).find(([key,midi]) => key.length === 1 && midi === midis[0] + 1);
    row.pattern = [changedKey,...tail].join(' ');
    row.steps = a.parsePattern(row.pattern).steps;
    assert.deepEqual(plain(a.stepMidiList(row.steps[0])),[midis[0]+1]);
    row.fingeringSpec.pattern = row.pattern;
    row.contentKind = 'piece';
    row.guide.setup = 'Личная подготовка к фразе';
    row.learning.practiceSteps[0] = 'Мой счёт и начало';
    const saved = plain(row);
    a.installReviewedLessons();
    assert.deepEqual(plain(a.lessons.find(lesson => lesson.id === id)),saved);
    assert.equal(await a.importCatalogText(a.catalogExportText(),() => true),true);
    const actual = a.lessons.find(lesson => lesson.id === id);
    for (const key of ['pattern','handMode','contentKind']) assert.equal(actual[key],saved[key]);
    assert.deepEqual(plain(actual.steps),saved.steps);
    assert.deepEqual(plain(actual.fingeringSpec),saved.fingeringSpec);
    assert.equal(actual.learning.practiceSteps[0],saved.learning.practiceSteps[0]);
    assert.equal(actual.guide.setup,saved.guide.setup);
    assert.equal(a.lessons.filter(lesson => lesson.id === id).length,1);
  });
}

test('B major additions preserve prior piano editions and all route contracts', () => {
  const known = new Set(before.catalogIds);
  const oldLearning = learning.filter(lesson => known.has(lesson.id));
  assert.equal(known.size,before.catalogRecords);
  assert.equal(oldLearning.length,before.learningRecords);
  assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);
  assert.equal(hash(app.lessons.filter(lesson => known.has(lesson.id))),before.catalogHash);
  assert.equal(app.themes.length,before.themes);
  assert.equal(hash(app.themes),before.themeHash);
  assert.equal(hash(plan.piano.filter(row => known.has(row.id))),before.pianoPlanHash);
  assert.equal(hash(plan.guitar),before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(row => known.has(row.id))),before.canonicalHash);
  assert.equal(hash(course.route.filter(id => known.has(id))),before.canonicalRouteHash);
  assert.equal(hash(oldLearning.map(lesson => [lesson.id,curriculum.next(plan,'piano',learning,lesson.id)?.id??null])),before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))),before.reviewBaseline);
  const oldSources=ledger.entries.slice(0,before.sourceEntries).map(entry => {
    const copy = plain(entry);
    if (copy.applications) {
      copy.applications = copy.applications.filter(row => row.batch < batch);
      if (!copy.applications.length) delete copy.applications;
    }
    return copy;
  });
  assert.equal(hash(oldSources),before.sourceHash);
});
