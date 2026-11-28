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
const registry = require('../service/course-registry.json');
const ledger = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-waltz-right-after-bass-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');
const { extraCatalogIds } = require('./fixtures/piano-before-paired-waltz-chord-to-bass-v1.json');

const id = 'detail-p-paired-waltz-right-after-bass-01';
const opening = before.previousAddedId;
const previousIds = new Set([...catalogIds, ...catalogIdsAdded, ...extraCatalogIds, opening]);
const delayed = 'detail-p-paired-waltz-delayed-melody-01';
const handoff = 'detail-p-paired-waltz-eighth-handoff-01';
const requires = [opening, delayed, handoff];
const sourceId = 'zac-country-waltz-left-right-2026-11-28';
const midis = [[48, 52, 55, 60], [43], [60]];
const starts = [0, 3, 4], durations = [2.5, 1, 1];
const left = num => ({ hand: 'left', num });
const right = num => ({ hand: 'right', num });
const fingers = [[left(5), left(3), left(1), right(1)], [left(5)], [right(1)]];
const steps = midis.map((notes, i) => ({ midis: notes, startBeat: starts[i], durationBeats: durations[i] }));
const plain = x => JSON.parse(JSON.stringify(x));
const sha = x => createHash('sha256').update(x).digest('hex');
const hash = x => sha(JSON.stringify(x));
const app = loadApp({ events: true });
app.setContentSection('learning');
const learning = app.sectionLessons();
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN');

test('adding the right-hand reply preserves earlier full records, editions, sources and route', () => {
  const old = previousIds;
  const priorLearning = learning.filter(l => old.has(l.id));
  const priorCanonical = registry.lessons.filter(l => old.has(l.id));
  assert.equal(old.size, before.catalogRecords);
  assert.equal(priorLearning.length, before.learningRecords);
  assert.equal(priorCanonical.length, before.canonicalCount);
  assert.equal(app.themes.length, before.themes);
  assert.equal(hash(app.lessons.filter(l => old.has(l.id))), before.catalogHash);
  assert.equal(hash(app.themes), before.themeHash);
  assert.equal(hash(plan.piano.filter(row => old.has(row.id))), before.pianoPlanHash);
  assert.equal(hash(plan.guitar), before.guitarPlanHash);
  assert.equal(hash(priorCanonical), before.canonicalHash);
  assert.equal(hash(registry.route), before.canonicalRouteHash);
  assert.equal(hash(priorLearning.map(l => [l.id, next(plan, 'piano', learning, l.id)?.id ?? null])), before.nextHash);
  assert.equal(hash(ledger.entries.slice(0, before.sourceEntries)), before.sourceHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.reviewBaseline);
});

test('the prepared pickup returns the right hand alone on beat two at the bass release', () => {
  const lesson = learning.find(row => row.id === id);
  assert.ok(lesson, 'Missing the right-hand reply after the waltz bass');
  assert.equal(lesson.contentKind, 'exercise');
  assert.equal(lesson.themeId, 'detail-p-hands');
  assert.equal(lesson.handMode, 'split');
  assert.equal(lesson.learning.stage, 'p7');
  assert.equal(lesson.learning.branch, 'paired-waltz-right-after-bass');
  assert.equal(lesson.learning.after, opening);
  assert.deepEqual(plain(lesson.learning.requires), requires);
  assert.deepEqual(plain(lesson.rhythm.timeSignature), { numerator: 3, denominator: 4 });
  assert.equal(lesson.rhythm.practiceBpm, 48);
  assert.deepEqual(plain(lesson.steps.map(app.stepMidiList)), midis);
  assert.deepEqual(plain(lesson.fingeringSpec.steps), fingers);
  assert.deepEqual(plain(lesson.rhythm.steps.map(s => [s.startBeat,s.durationBeats,s.restBeforeBeats,s.measure,s.beatInMeasure])),
    [[0,2.5,0,1,0],[3,1,0.5,2,0],[4,1,0,2,1]]);
  const delayedEntry = learning.find(r => r.id === delayed);
  assert.deepEqual(plain(app.stepMidiList(delayedEntry.steps.at(-1))), [48,60]);
  assert.equal(delayedEntry.rhythm.steps.at(-1).startBeat, lesson.rhythm.steps.at(-1).startBeat);
  assert.equal(lesson.learning.sameGoalAs, undefined);
  assert.equal(lesson.learning.goalCounting, undefined);
  const index = plan.piano.findIndex(row => row.id === id);
  assert.ok(index >= 0);
  for (const key of requires) {
    const prerequisite = plan.piano.findIndex(row => row.id === key);
    assert.ok(prerequisite >= 0 && prerequisite < index, key);
  }
  assert.equal(learning.filter(row => previousIds.has(row.id) || row.id === id).length, before.learningRecords + 1);
  app.setTestLesson(lesson);
  assert.equal(app.challengeEligible(), true);
});

test('both assessors require new right-hand onset and exact left release without a repeated bass', () => {
  const lesson = learning.find(x => x.id === id);
  const row = registry.lessons.find(x => x.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps, steps);
  assert.deepEqual(row.requires, requires);
  assert.equal(row.profile, 'standard');
  assert.equal(row.timingPrecision, 'beat-boundary-v2');
  assert.equal(row.gradeFingerprint, assessment.pianoSignature(lesson));
  const at = beat => 1000 + 1250 * beat;
  const event = (type,midi,beat) => ({type,midi,at:at(beat),source:'midi'});
  const expected = steps.flatMap(s => s.midis.flatMap(m => [
    event('on',m,s.startBeat), event('off',m,s.startBeat+s.durationBeats)
  ]));
  const move = (type,midi,beat,to) => expected.map(e =>
    e.type === type && e.midi === midi && e.at === at(beat) ? event(type,midi,to) : e);
  const cases = [
    ['exact handoff',expected,true],
    ['omitted response',expected.filter(e => e.midi !== 60 || e.at < at(4)),false],
    ['right joins the bass one beat early',move('on',60,4,3),false],
    ['right enters half a beat late',move('on',60,4,4.5),false],
    ['held bass overlaps the response',move('off',43,4,4.5),false],
    ['left repeats with the right', [...expected,event('on',43,4),event('off',43,5)],false],
    ['left stops too soon',move('off',43,4,3.5),false],
    ['right does not release at beat three',move('off',60,5,5.5),false],
    ['right bridges the measured silence',move('off',60,2.5,3),false]
  ];
  for (const [name, events, clean] of cases) {
    const ordered = [...events].sort((a,b) => a.at-b.at || Number(a.type==='on')-Number(b.type==='on') || a.midi-b.midi);
    const finish = Math.max(at(5), ordered.at(-1).at);
    const local = assessment.assessPiano({ steps, events: ordered, bpm:48, targetBpm:48,
      profile:row.profile,timingPrecision:row.timingPrecision });
    assert.equal(local.clean, clean, name);
    assert.equal(grade(row,eventsInput(ordered,finish),'challenge',finish,false).assessment.clean, clean, name);
  }
});

test('the lesson links the first two waltz attacks, renders the pause and hides material in memory', () => {
  const lesson = learning.find(r => r.id === id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type, 'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds), [sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '), /Придумай свой ответ/);
  assert.match(lesson.learning.practiceSteps.join(' '), /на следующий день/);
  const source = ledger.entries.find(e => e.id === sourceId);
  const use = source?.applications.find(x => x.batch === '2026-11-28-16' && x.lessonIds.includes(id));
  assert.ok(use);
  assert.equal(use.location,'Pattern 1: The traditional waltz (key of A)');
  assert.deepEqual(use.sourceHandOrder,['left','right','right']);
  assert.equal(use.sourceScoreReproduced,false);
  assert.deepEqual(use.projectMidis,midis);
  assert.deepEqual(use.projectStartBeats,starts);
  assert.deepEqual(use.projectDurationsBeats,durations);
  assert.deepEqual(use.projectGlobalRestBeats,[[2.5,3]]);
  app.setTestLesson(lesson);
  app.state.mode = 'score';
  const score = app.scoreViewHtml();
  assert.match(score,/Такт 1[\s\S]*Пауза перед этой нотой: 625 мс[\s\S]*Такт 2/);
  assert.match(score,/G2[^"]*начало 0 доли[^"]*1250 мс/);
  assert.match(score,/C4 · [^"]*начало 1 доли[^"]*1250 мс/);
  app.state.attemptMode = 'memory';
  try {
    assert.equal(app.learningMaterialHtml(), '');
    assert.doesNotMatch(app.scoreViewHtml(), /rhythm-rest|data-score-step/);
  } finally {
    app.state.attemptMode = 'practice';
  }
});

test('a personal revision of the right-hand reply survives reinstallation and export', async () => {
  const editor = loadApp({ web:true,events:true,storage:createMemoryStorage() });
  const lesson = editor.lessons.find(row => row.id === id);
  assert.ok(lesson);
  const key = Object.entries(editor.KEY_MAP).find(([k,m]) => k.length === 1 && m === 62)[0];
  lesson.pattern = [...lesson.pattern.split(' ').slice(0,-1),key].join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps.at(-1)[0].num = 2;
  lesson.learning.practiceSteps[0] = 'Мой ответ на ре';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(x => x.id === id)),saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(),() => true),true);
  const restored = editor.lessons.find(x => x.id === id);
  assert.deepEqual(plain(restored.steps.map(editor.stepMidiList)),[midis[0],midis[1],[62]]);
  for (const field of ['contentKind','pattern','handMode','fingeringSpec','rhythm','guide','learning']) {
    assert.deepEqual(plain(restored[field]),saved[field],field);
  }
});
