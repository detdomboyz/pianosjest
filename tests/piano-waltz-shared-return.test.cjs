'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const test = require('node:test');
const vm = require('node:vm');
const { loadApp } = require('./helpers/load-app.cjs');
const { createMemoryStorage } = require('./helpers/memory-storage.cjs');
const { next } = require('../curriculum.js');
const assessment = require('../practice-assessment.js');
const { eventsInput, grade } = require('../service/game-grade.cjs');
const registry = require('../service/course-registry.json');
const sources = require('../docs/piano-curriculum-sources.json');
const before = require('./fixtures/piano-before-waltz-shared-return-v1.json');
const { catalogIds } = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');
const { catalogIdsAdded } = require('./fixtures/piano-before-paired-waltz-eighth-bass-shift-v1.json');
const { extraCatalogIds } = require('./fixtures/piano-before-paired-waltz-chord-to-bass-v1.json');

const id = 'detail-p-paired-waltz-shared-return-01';
const prefix = before.lastPriorId;
const restPrep = 'detail-p-paired-waltz-shared-rest-01';
const chordPrep = 'detail-p-paired-waltz-shared-cadence-01';
const requires = [prefix, restPrep, chordPrep];
const prior = new Set([...catalogIds, ...catalogIdsAdded, ...extraCatalogIds, 'detail-p-paired-waltz-chord-to-bass-01', prefix]);
const sourceId = 'huang-pressure-release-before-chord-2026-11-28';
const chord = [48, 52, 55, 60];
const notes = [chord, [43], [60], chord];
const starts = [0, 3, 4, 6];
const durations = [2.5, 1, 1, 1];
const expectedSteps = notes.map((midis, i) => ({ midis, startBeat: starts[i], durationBeats: durations[i] }));
const left = num => ({ hand: 'left', num });
const right = num => ({ hand: 'right', num });
const chordFingers = [left(5), left(3), left(1), right(1)];
const fingers = [chordFingers, [left(5)], [right(1)], chordFingers];
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp({ events: true });
app.setContentSection('learning');
const learning = app.sectionLessons();
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'), 'utf8') + ';MUSIC_CURRICULUM_PLAN');

test('the chord return preserves all previous piano records, sources, canonical editions and navigation', () => {
  const oldLearning = learning.filter(row => prior.has(row.id));
  const oldCanonical = registry.lessons.filter(row => prior.has(row.id));
  assert.equal(prior.size, before.catalog);
  assert.equal(oldLearning.length, before.learning);
  assert.equal(oldCanonical.length, before.learning);
  assert.equal(app.themes.length, before.themes);
  assert.equal(hash(app.lessons.filter(row => prior.has(row.id))), before.catalogSha);
  assert.equal(hash(app.themes), before.themesSha);
  assert.equal(hash(plan.piano.filter(row => prior.has(row.id))), before.pianoPlanSha);
  assert.equal(hash(plan.guitar), before.guitarPlanSha);
  assert.equal(hash(oldCanonical), before.canonicalSha);
  assert.equal(hash(registry.route), before.routeSha);
  assert.equal(hash(sources.entries.slice(0,before.sourceEntries)), before.sourcesSha);
  assert.equal(hash(oldLearning.map(row => [row.id,next(plan,'piano',learning,row.id)?.id ?? null])), before.nextSha);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))), before.baselineSha);
});

test('a complete silent third beat prepares a new coordinated chord at the next bar', () => {
  const lesson = learning.find(row => row.id === id);
  assert.ok(lesson, 'Missing the shared waltz chord return after a full beat of silence');
  assert.equal(lesson.themeId,'detail-p-hands');
  assert.equal(lesson.contentKind,'exercise');
  assert.equal(lesson.handMode,'split');
  assert.equal(lesson.learning.stage,'p7');
  assert.equal(lesson.learning.after,prefix);
  assert.equal(lesson.learning.branch,'paired-waltz-shared-return');
  assert.deepEqual(plain(lesson.learning.requires),requires);
  assert.deepEqual(plain(lesson.rhythm.timeSignature),{ numerator:3, denominator:4 });
  assert.equal(lesson.rhythm.practiceBpm,48);
  assert.deepEqual(plain(lesson.steps.map(app.stepMidiList)),notes);
  assert.deepEqual(plain(lesson.fingeringSpec.steps),fingers);
  assert.deepEqual(plain(lesson.rhythm.steps.map(x=>[x.startBeat,x.durationBeats,x.restBeforeBeats,x.measure,x.beatInMeasure])),
    [[0,2.5,0,1,0],[3,1,0.5,2,0],[4,1,0,2,1],[6,1,1,3,0]]);
  assert.equal(lesson.learning.sameGoalAs,undefined);
  assert.equal(lesson.learning.goalCounting,undefined);
  assert.equal(learning.filter(row => prior.has(row.id) || row.id === id).length,before.learning+1);
  const index = plan.piano.findIndex(row => row.id === id);
  assert.ok(index >= 0);
  for (const key of requires) {
    const prerequisite = plan.piano.findIndex(row => row.id === key);
    assert.ok(prerequisite >= 0 && prerequisite < index,key);
  }
  app.setTestLesson(lesson);
  assert.equal(app.challengeEligible(),true);
});

test('the actual browser and server judges enforce silence, new common attack and final release', () => {
  const lesson = learning.find(row => row.id === id);
  const row = registry.lessons.find(row => row.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps,expectedSteps);
  assert.deepEqual(row.requires,requires);
  assert.equal(row.profile,'standard');
  assert.equal(row.timingPrecision,'beat-boundary-v2');
  assert.equal(row.gradeFingerprint,assessment.pianoSignature(lesson));
  const time = beat => 1000 + beat * 1250;
  const event = (type,midi,beat) => ({type,midi,at:time(beat),source:'midi'});
  const clean = expectedSteps.flatMap(x=>x.midis.flatMap(midi=>[
    event('on',midi,x.startBeat),event('off',midi,x.startBeat+x.durationBeats)
  ]));
  const shift = (type,note,beat,target) => clean.map(x=>
    x.type===type && x.midi===note && x.at===time(beat) ? event(type,note,target) : x);
  const examples = [
    ['clean',clean,true],
    ['extra key during silent beat',[...clean,event('on',62,5.25),event('off',62,5.5)],false],
    ['right key held into the silent beat',shift('off',60,5,5.5),false],
    ['chord cuts across the quiet beat',clean.map(x=>x.type==='on'&&x.at===time(6)?{...x,at:time(5.5)}:x),false],
    ['chord misses the downbeat',clean.map(x=>x.type==='on'&&x.at===time(6)?{...x,at:time(6.5)}:x),false],
    ['right hand arrives late to the chord',shift('on',60,6,6.35),false],
    ['a chord note is missing',clean.filter(x=>x.midi!==52||x.at<time(6)),false],
    ['bass returns before the eighth rest',shift('on',43,3,2.5),false],
    ['a final note is held beyond the release',shift('off',60,7,7.5),false]
  ];
  for (const [name,data,ok] of examples) {
    const ordered = [...data].sort((a,b)=>a.at-b.at || Number(a.type==='on')-Number(b.type==='on') || a.midi-b.midi);
    const finish = Math.max(time(7),ordered.at(-1).at);
    const verdict = assessment.assessPiano({steps:expectedSteps,events:ordered,bpm:48,targetBpm:48,
      profile:row.profile,timingPrecision:row.timingPrecision});
    assert.equal(verdict.clean,ok,name);
    assert.equal(grade(row,eventsInput(ordered,finish),'challenge',finish,false).assessment.clean,ok,name);
  }
});

test('the source application, two measured pauses and open transfer are visible only in study modes', () => {
  const lesson = learning.find(row => row.id === id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type,'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds),[sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '),/Придумай свою короткую фразу/);
  assert.match(lesson.learning.practiceSteps.join(' '),/на следующий день/);
  const source = sources.entries.find(x=>x.id===sourceId);
  const application = source?.applications.find(x=>x.batch==='2026-11-28-17'&&x.lessonIds.includes(id));
  assert.ok(application);
  assert.equal(application.location,'On Teaching Piano Technique - Part II, release of pressure before the next note or chord');
  assert.equal(application.sourceScoreReproduced,false);
  assert.deepEqual(application.projectMidis,notes);
  assert.deepEqual(application.projectStartBeats,starts);
  assert.deepEqual(application.projectDurationsBeats,durations);
  assert.deepEqual(application.projectGlobalRestBeats,[[2.5,3],[5,6]]);
  app.setTestLesson(lesson);
  app.state.mode = 'score';
  const score = app.scoreViewHtml();
  assert.match(score,/Такт 1[\s\S]*Пауза перед этой нотой: 625 мс[\s\S]*Такт 2[\s\S]*Пауза перед этой нотой: 1250 мс[\s\S]*Такт 3/);
  assert.match(score,/C3 \+ E3 \+ G3 \+ C4[^"]*1250 мс[^"]*пауза до: 1250 мс/);
  app.state.attemptMode = 'memory';
  try {
    assert.equal(app.learningMaterialHtml(),'');
    assert.doesNotMatch(app.scoreViewHtml(),/rhythm-rest|data-score-step/);
  } finally {
    app.state.attemptMode = 'practice';
  }
});

test('a personal revision of the returning chord survives reinstall and catalogue exchange', async () => {
  const editor = loadApp({web:true,events:true,storage:createMemoryStorage()});
  const lesson = editor.lessons.find(row=>row.id===id);
  assert.ok(lesson);
  const keys = [48,52,55,62].map(midi=>Object.entries(editor.KEY_MAP).find(([key,value])=>key.length===1&&value===midi)[0]);
  lesson.pattern = [...lesson.pattern.split(' ').slice(0,-1),'['+keys.join('')+']'].join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps.at(-1)[3].num = 2;
  lesson.learning.practiceSteps[0] = 'Мой новый последний аккорд';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(row=>row.id===id)),saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(),()=>true),true);
  const restored = editor.lessons.find(row=>row.id===id);
  assert.deepEqual(plain(restored.steps.map(editor.stepMidiList)),[chord,[43],[60],[48,52,55,62]]);
  for (const name of ['contentKind','pattern','handMode','fingeringSpec','rhythm','guide','learning']) {
    assert.deepEqual(plain(restored[name]),saved[name],name);
  }
});
