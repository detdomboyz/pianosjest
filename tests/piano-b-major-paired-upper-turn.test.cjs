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
const before = require('./fixtures/piano-before-b-major-paired-upper-turn-v1.json');

const id = 'detail-p-b-major-prepared-paired-upper-turn-01';
const prerequisites = [
  'detail-p-b-major-prepared-roundtrip-left-01',
  'detail-p-b-major-prepared-roundtrip-right-01',
  'detail-p-fsharp-major-lower-three-paired-ascent-01'
];
const sourceIds = [
  'pff-b-major-ascending-thumb-fourth-left-2026-11-15',
  'pff-b-major-descending-thumb-white-left-2026-11-15',
  'pff-b-major-ascending-prepared-right-2026-11-15',
  'pff-b-major-descending-prepared-right-2026-11-18'
];
const midiPairs = [[54,66],[56,68],[58,70],[59,71],[58,70],[56,68],[54,66]];
const fingers = [[4,2],[3,3],[2,4],[1,5],[2,4],[3,3],[4,2]];
const batch = '2026-11-21-02';
const steps = midiPairs.map((midis,startBeat) => ({ midis,startBeat,durationBeats:startBeat === 6 ? 2 : 1 }));
const app = loadApp();
app.setContentSection('learning');
const learning = app.sectionLessons();
const find = key => learning.find(lesson => lesson.id === key);
const plan = vm.runInNewContext(
  fs.readFileSync(require.resolve('../curriculum-plan.js'),'utf8') + ';MUSIC_CURRICULUM_PLAN', {}
);
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const frames = lesson => plain(lesson.steps.map((step,i) => [app.stepMidiList(step),lesson.fingeringSpec.steps[i]]));

test('paired B major combines an exact three-pair opening with the longer prepared turn', () => {
  const lesson = find(id);
  assert.ok(lesson, 'Missing B-major upper turn');
  assert.equal(lesson.handMode,'split');
  assert.equal(lesson.themeId,'detail-p-hands');
  assert.equal(lesson.contentKind,'exercise');
  assert.equal(lesson.learning.stage,'p7');
  assert.equal(lesson.learning.coverageDomain,'coordination');
  assert.equal(lesson.learning.articulation,'standard');
  assert.equal(lesson.learning.timingPrecision,'beat-boundary-v2');
  assert.deepEqual(plain(lesson.learning.requires),prerequisites);
  const both = frames(lesson);
  assert.deepEqual(both,midiPairs.map((pair,i) => [pair,[
    { hand:'left',num:fingers[i][0] },{ hand:'right',num:fingers[i][1] }
  ]]));
  const [left,right,opening] = prerequisites.map(find);
  assert.deepEqual(frames(opening),both.slice(0,3));
  for (const [i,solo] of [left,right].entries()) {
    assert.deepEqual(both.map(([pair,digits])=>[[pair[i]],[digits[i]]]),frames(solo).slice(4,11));
  }
  assert.equal(both.filter(([[midi]]) => midi === 59).length,1);
  assert.equal(lesson.rhythm.practiceBpm,40);
  assert.deepEqual(plain(lesson.rhythm.timeSignature),{ numerator:4,denominator:4 });
  assert.deepEqual(plain(lesson.rhythm.steps.map(s=>[s.startBeat,s.durationBeats,s.restBeforeBeats])),
    steps.map(s=>[s.startBeat,s.durationBeats,0]));
  const index = plan.piano.findIndex(row=>row.id===id);
  assert.ok(index > 0 && prerequisites.every(key=>plan.piano.findIndex(row=>row.id===key)<index));
  assert.equal(curriculum.next(plan,'piano',learning,id),null);
});

test('paired B major client and server check synchrony, exactly one upper pair and both releases', () => {
  const lesson = find(id);
  const row = course.lessons.find(item=>item.id===id);
  assert.ok(lesson && row?.challengeReady);
  assert.equal(row.profile,'standard');
  assert.equal(row.timingPrecision,'beat-boundary-v2');
  assert.equal(row.gradeFingerprint,assessment.pianoSignature(lesson));
  assert.deepEqual(row.requires,prerequisites);
  assert.deepEqual(row.steps,steps);
  const start=1000;
  const beat=1500;
  const end=start+8*beat;
  const events=steps.flatMap(({midis,startBeat,durationBeats})=>midis.flatMap(midi=>[
    {type:'on',midi,at:start+startBeat*beat,source:'midi'},
    {type:'off',midi,at:start+(startBeat+durationBeats)*beat,source:'midi'}
  ]));
  const returnAt=start+4*beat;
  const samples={
    exact:events,
    'right hand late':events.map(e=>e.type==='on' && e.midi===70 && e.at===returnAt ? {...e,at:e.at+180}:e),
    'apex repeated':[...events,{type:'on',midi:71,at:start+3.5*beat,source:'midi'}],
    'wrong right apex':events.map(e=>e.midi===71?{...e,midi:72}:e),
    'left final note short':events.map(e=>e.midi===54 && e.at===end?{...e,at:end-900}:e),
    'right final note held':events.slice(0,-1)
  };
  for (const [name,input] of Object.entries(samples)) {
    const ordered=[...input].sort((a,b)=>a.at-b.at || Number(a.type==='on')-Number(b.type==='on') || a.midi-b.midi);
    const result=assessment.assessPiano({
      steps:lesson.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(lesson.steps[i])})),
      events:ordered,bpm:40,targetBpm:40,profile:'standard',timingPrecision:'beat-boundary-v2'
    });
    const server=game.grade(row,game.eventsInput(ordered,end),'challenge',end,false);
    assert.equal(result.clean,name==='exact',name);
    assert.equal(server.assessment.clean,result.clean,name);
  }
});

test('paired B major keeps prior records, routes, edits and scoring editions byte-equivalent in data', () => {
  const oldIds = new Set(before.catalogIds);
  const oldLearning = learning.filter(lesson=>oldIds.has(lesson.id));
  assert.equal(oldIds.size,before.catalogRecords);
  assert.equal(oldLearning.length,before.learningRecords);
  assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);
  assert.equal(hash(app.lessons.filter(lesson=>oldIds.has(lesson.id))),before.catalogHash);
  assert.equal(hash(app.themes),before.themeHash);
  assert.equal(hash(plan.piano.filter(row=>oldIds.has(row.id))),before.pianoPlanHash);
  assert.equal(hash(plan.guitar),before.guitarPlanHash);
  assert.equal(hash(course.lessons.filter(row=>oldIds.has(row.id))),before.canonicalHash);
  assert.equal(hash(course.route.filter(key=>oldIds.has(key))),before.canonicalRouteHash);
  assert.equal(hash(oldLearning.map(l=>[l.id,curriculum.next(plan,'piano',learning,l.id)?.id??null])),before.nextHash);
  assert.equal(sha(fs.readFileSync(require.resolve('../lesson-review-baseline.js'))),before.reviewBaseline);
  const oldSources=ledger.entries.slice(0,before.sourceEntries).map(row=>{
    const record=plain(row);
    if(record.applications) {
      record.applications=record.applications.filter(a=>a.batch<batch);
      if(!record.applications.length) delete record.applications;
    }
    return record;
  });
  assert.equal(hash(oldSources),before.sourceHash);
});

test('paired B major card gives auditable sources, fixed fingers and open transfer', () => {
  const lesson = find(id);
  assert.ok(lesson);
  assert.equal(lesson.learning.provenance.type,'project-technical-drill');
  assert.deepEqual(plain(lesson.learning.sourceEvidenceIds),sourceIds);
  const applications=ledger.entries.flatMap(entry=>(entry.applications||[])
    .filter(row=>row.batch===batch).map(row=>[entry.id,row]));
  assert.deepEqual(applications.map(([key])=>key).sort(),[...sourceIds].sort());
  for (const [,row] of applications) {
    assert.deepEqual(row.lessonIds,[id]);
    assert.ok(row.sourceRuleReused && row.sourceImageSha256.length===64);
  }
  const text=lesson.learning.practiceSteps.join(' ');
  assert.match(text,/левый большой.{1,95}правый мизинец/);
  assert.match(text,/Придумай ответ из 6–8 пар/);
  assert.match(text,/на следующий день/);
});

test('paired B major personal pitches, hands and practice text survive reinstall and exchange', async () => {
  const editable = loadApp({ web:true,events:true,storage:createMemoryStorage() });
  const row = editable.lessons.find(lesson=>lesson.id===id);
  assert.ok(row);
  const [first,...tail]=row.pattern.split(' ');
  const leftKey=first.slice(1,-1)[0];
  const [changedKey]=Object.entries(editable.KEY_MAP).find(([key,midi])=>key.length===1 && midi===65);
  row.pattern=['['+leftKey+changedKey+']',...tail].join(' ');
  row.steps=editable.parsePattern(row.pattern).steps;
  assert.deepEqual(plain(editable.stepMidiList(row.steps[0])),[54,65]);
  row.fingeringSpec.pattern=row.pattern;
  row.contentKind='piece';
  row.guide.setup='Мой разбор вступления';
  row.learning.practiceSteps[0]='Моя считалка';
  const saved=plain(row);
  editable.installReviewedLessons();
  assert.deepEqual(plain(editable.lessons.find(lesson=>lesson.id===id)),saved);
  assert.equal(await editable.importCatalogText(editable.catalogExportText(),()=>true),true);
  const result=editable.lessons.find(lesson=>lesson.id===id);
  for(const key of ['pattern','handMode','contentKind'])assert.equal(result[key],saved[key]);
  assert.deepEqual(plain(result.steps),saved.steps);
  assert.deepEqual(plain(result.fingeringSpec),saved.fingeringSpec);
  assert.equal(result.learning.practiceSteps[0],saved.learning.practiceSteps[0]);
  assert.equal(result.guide.setup,saved.guide.setup);
  assert.equal(editable.lessons.filter(lesson=>lesson.id===id).length,1);
});
