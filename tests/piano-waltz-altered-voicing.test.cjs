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
const before = require('./fixtures/piano-before-waltz-altered-voicing-v1.json');

const id = 'detail-p-paired-waltz-altered-voicing-01';
const voicingPrep = 'detail-p-paired-waltz-common-bass-01';
const requires = [before.lastPriorId, voicingPrep];
const sourceId = 'fitch-waltz-chord-position-preparation-2026-11-28';
const startNotes = [48, 52, 55, 60];
const targetNotes = [53, 57, 65];
const midis = [startNotes, [43], [60], targetNotes];
const starts = [0, 3, 4, 6];
const durations = [2.5, 1, 1, 1];
const steps = midis.map((notes, index) => ({ midis: notes, startBeat: starts[index], durationBeats: durations[index] }));
const left = num => ({ hand: 'left', num });
const right = num => ({ hand: 'right', num });
const fingers = [[left(5),left(3),left(1),right(1)],[left(5)],[right(1)],[left(2),left(1),right(4)]];
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const app = loadApp({ events: true });
app.setContentSection('learning');
const learning = app.sectionLessons();
const plan = vm.runInNewContext(fs.readFileSync(require.resolve('../curriculum-plan.js'),'utf8') + ';MUSIC_CURRICULUM_PLAN');
const earlier = rows => rows.filter(row => row.id !== id);
const target = () => learning.find(row => row.id === id);

test('inserting the new voicing preserves every previous record, musical edition and Next destination', () => {
  const oldLearning = earlier(learning);
  assert.equal(earlier(app.lessons).length,before.catalog);
  assert.equal(oldLearning.length,before.learning);
  assert.equal(earlier(registry.lessons).length,before.learning);
  assert.equal(app.themes.length,before.themes);
  assert.equal(hash(earlier(app.lessons)),before.catalogSha);
  assert.equal(hash(app.themes),before.themesSha);
  assert.equal(hash(earlier(plan.piano)),before.pianoPlanSha);
  assert.equal(hash(plan.guitar),before.guitarPlanSha);
  assert.equal(hash(earlier(registry.lessons)),before.canonicalSha);
  assert.equal(hash(registry.route),before.routeSha);
  assert.equal(hash(sources.entries.slice(0,before.sourceEntries)),before.sourcesSha);
  assert.equal(hash(oldLearning.map(row => [row.id,next(plan,'piano',learning,row.id)?.id ?? null])),before.nextSha);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))),before.baselineSha);
});

test('a full third beat prepares the distinct F3–A3–F4 voicing in the same pulse', () => {
  const lesson = target();
  assert.ok(lesson,'Missing the waltz chord change after the quiet third beat');
  assert.equal(lesson.contentKind,'exercise');
  assert.equal(lesson.themeId,'detail-p-hands');
  assert.equal(lesson.handMode,'split');
  assert.equal(lesson.learning.stage,'p7');
  assert.equal(lesson.learning.after,before.lastPriorId);
  assert.equal(lesson.learning.branch,'paired-waltz-altered-voicing');
  assert.deepEqual(plain(lesson.learning.requires),requires);
  assert.equal(lesson.learning.sameGoalAs,undefined);
  assert.equal(lesson.learning.goalCounting,undefined);
  assert.deepEqual(plain(lesson.steps.map(app.stepMidiList)),midis);
  assert.deepEqual(plain(lesson.fingeringSpec.steps),fingers);
  assert.deepEqual(plain(lesson.rhythm.timeSignature),{numerator:3,denominator:4});
  assert.equal(lesson.rhythm.practiceBpm,48);
  assert.deepEqual(plain(lesson.rhythm.steps.map(x => [x.startBeat,x.durationBeats,x.restBeforeBeats,x.measure,x.beatInMeasure])),
    [[0,2.5,0,1,0],[3,1,0.5,2,0],[4,1,0,2,1],[6,1,1,3,0]]);

  const returnLesson = learning.find(row => row.id === before.lastPriorId);
  const commonBassLesson = learning.find(row => row.id === voicingPrep);
  assert.deepEqual(plain(returnLesson.steps.slice(0,3).map(app.stepMidiList)),midis.slice(0,3));
  assert.deepEqual(plain(app.stepMidiList(returnLesson.steps[3])),startNotes);
  assert.deepEqual(plain(app.stepMidiList(commonBassLesson.steps[4])),targetNotes);
  assert.deepEqual(plain(commonBassLesson.fingeringSpec.steps[4]),fingers[3]);
  const index = plan.piano.findIndex(row => row.id === id);
  for (const prerequisite of requires) {
    const position = plan.piano.findIndex(row => row.id === prerequisite);
    assert.ok(position >= 0 && position < index,prerequisite);
  }
  app.setTestLesson(lesson);
  assert.equal(app.challengeEligible(),true);
});

test('both graders distinguish a new aligned attack from a repeated chord, silence errors and staggered hands', () => {
  const lesson = target();
  const row = registry.lessons.find(candidate => candidate.id === id);
  assert.ok(lesson && row?.challengeReady);
  assert.deepEqual(row.steps,steps);
  assert.deepEqual(row.requires,requires);
  assert.equal(row.profile,'standard');
  assert.equal(row.timingPrecision,'beat-boundary-v2');
  assert.equal(row.gradeFingerprint,assessment.pianoSignature(lesson));

  const time = beat => 1000 + beat * 1250;
  const event = (type,midi,beat) => ({type,midi,at:time(beat),source:'midi'});
  const events = steps.flatMap(step => step.midis.flatMap(midi => [
    event('on',midi,step.startBeat),event('off',midi,step.startBeat+step.durationBeats)
  ]));
  const shift = (type,midi,beat,replacement) => events.map(item =>
    item.type===type && item.midi===midi && item.at===time(beat) ? event(type,midi,replacement) : item);
  const replaceEnding = notes => [
    ...events.filter(item => item.at < time(6)),
    ...notes.flatMap(midi => [event('on',midi,6),event('off',midi,7)])
  ];
  const cases = [
    ['correct new voicing',events,true],
    ['repeated opening chord',replaceEnding(startNotes),false],
    ['right hand remains on C4',replaceEnding([53,57,60]),false],
    ['left hand omits A3',replaceEnding([53,65]),false],
    ['note inside the full silent beat',[...events,event('on',62,5.25),event('off',62,5.5)],false],
    ['C4 sustains into the quiet beat',shift('off',60,5,5.5),false],
    ['new right-hand key starts before the downbeat',shift('on',65,6,5.5),false],
    ['new right-hand key starts separately',shift('on',65,6,6.35),false],
    ['left hand releases late',shift('off',57,7,7.5),false],
    ['bass cuts off the eighth rest',shift('on',43,3,2.5),false]
  ];
  for (const [name,data,expected] of cases) {
    const ordered = [...data].sort((a,b) => a.at-b.at || Number(a.type==='on')-Number(b.type==='on') || a.midi-b.midi);
    const finish = Math.max(time(7),ordered.at(-1).at);
    const result = assessment.assessPiano({steps,events:ordered,bpm:48,targetBpm:48,
      profile:row.profile,timingPrecision:row.timingPrecision});
    assert.equal(result.clean,expected,name);
    assert.equal(grade(row,eventsInput(ordered,finish),'challenge',finish,false).assessment.clean,expected,name);
  }
});

test('the study card has a sourced silent placement, exact pause blocks and an open transfer', () => {
  const lesson = target();
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type,'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds),[sourceId]);
  assert.match(lesson.learning.practiceSteps.join(' '),/На тихом «три»/);
  assert.match(lesson.learning.practiceSteps.join(' '),/Придумай свою короткую фразу/);
  const source = sources.entries.find(candidate => candidate.id === sourceId);
  const application = source?.applications.find(item => item.batch==='2026-11-28-18' && item.lessonIds.includes(id));
  assert.ok(application);
  assert.equal(application.location,'Quick Cover, preparation at the next keys before the attack');
  assert.equal(application.sourceScoreReproduced,false);
  assert.deepEqual(application.projectMidis,midis);
  assert.deepEqual(application.projectStartBeats,starts);
  assert.deepEqual(application.projectDurationsBeats,durations);
  assert.deepEqual(application.projectGlobalRestBeats,[[2.5,3],[5,6]]);
  app.setTestLesson(lesson);
  app.state.mode = 'score';
  const score = app.scoreViewHtml();
  assert.match(score,/Такт 1[\s\S]*Пауза перед этой нотой: 625 мс[\s\S]*Такт 2[\s\S]*Пауза перед этой нотой: 1250 мс[\s\S]*Такт 3/);
  assert.match(score,/F3 \+ A3 \+ F4[^"]*1250 мс[^"]*пауза до: 1250 мс/);
  app.state.attemptMode = 'memory';
  try {
    assert.equal(app.learningMaterialHtml(),'');
    assert.doesNotMatch(app.scoreViewHtml(),/rhythm-rest|data-score-step/);
  } finally {
    app.state.attemptMode = 'practice';
  }
});

test('reinstall and catalogue import preserve the learner’s final voicing and fingering edits', async () => {
  const editor = loadApp({web:true,events:true,storage:createMemoryStorage()});
  const lesson = editor.lessons.find(row => row.id === id);
  assert.ok(lesson);
  const edited = [53,57,64];
  const keys = edited.map(midi => Object.entries(editor.KEY_MAP).find(([key,value]) => key.length===1 && value===midi)[0]);
  lesson.pattern = [...lesson.pattern.split(' ').slice(0,-1),'['+keys.join('')+']'].join(' ');
  lesson.steps = editor.parsePattern(lesson.pattern).steps;
  lesson.fingeringSpec.pattern = lesson.pattern;
  lesson.fingeringSpec.steps.at(-1)[2].num = 3;
  lesson.learning.practiceSteps[0] = 'Мой вариант нового созвучия';
  const saved = plain(lesson);
  editor.installReviewedLessons();
  assert.deepEqual(plain(editor.lessons.find(row => row.id === id)),saved);
  assert.equal(await editor.importCatalogText(editor.catalogExportText(),() => true),true);
  const restored = editor.lessons.find(row => row.id === id);
  assert.deepEqual(plain(restored.steps.map(editor.stepMidiList)),[startNotes,[43],[60],edited]);
  for (const key of ['contentKind','pattern','handMode','fingeringSpec','rhythm','guide','learning']) {
    assert.deepEqual(plain(restored[key]),saved[key],key);
  }
});
