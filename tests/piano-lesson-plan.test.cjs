'use strict';
const catalogCounts=require('./fixtures/piano-curriculum-counts.json');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validatePlannedLessons}=require('../tools/piano-lesson-plan.cjs'),Coverage=require('../tools/piano-skill-coverage.cjs'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),backlog=JSON.parse(fs.readFileSync('docs/piano-lesson-backlog.json','utf8')),ledger=JSON.parse(fs.readFileSync('docs/piano-curriculum-sources.json','utf8')),app=loadApp(),plans=backlog.lessons,ids=['detail-p-ear-direction-01','detail-p-ear-echo-01','detail-p-read-treble-01','detail-p-read-bass-01'];
const options={implementedLessonIds:Array.from(app.lessons,l=>l.id),implementedLessonLengths:Object.fromEntries(app.lessons.map(l=>[l.id,l.steps.length])),domainIds:['coordination','ear-transfer'],sourceEvidenceIds:ledger.entries.map(e=>e.id)};
function fixture(id,overrides={}){return {...copy(plans.find(l=>l.id==='detail-p-read-treble-01')),id,goalKey:'fixture.'+id,requires:['course02-03'],after:'course02-03',...overrides};}

test('reading preparations use three-note positions and explicitly gated repeated D/E fragments',()=>{
 for(const [id,prep,fragment,midis,fingers]of [['detail-p-read-treble-01','course02-02','course02-06',[60,62,62,64,64],[1,2,2,3,3]],['detail-p-read-bass-01','course03-02','course03-06',[48,50,50,52,52],[5,4,4,3,3]]]){const plan=plans.find(l=>l.id===id),f=plan.preparationFragments[0],source=app.lessons.find(l=>l.id===fragment);assert.ok(plan.requires.includes(prep));assert.equal(plan.after,prep);assert.equal(f.lessonId,fragment);assert.equal(f.firstStep,0);assert.equal(f.lastStep,4);assert.deepEqual(copy(source.steps.slice(0,5).map(s=>app.stepMidiList(s)[0])),midis);assert.deepEqual(copy(source.fingeringSpec.steps.slice(0,5).map(s=>s[0].num)),fingers);assert.equal(plan.assessmentStatus,'not-implemented');assert.equal(plan.assessmentProtocol.excludePublishedCatalogWindows,true);}
 for(const mutate of [l=>l.preparationFragments=[],l=>l.preparationFragments[0].lessonId='unknown',l=>l.preparationFragments[0].firstStep=-1,l=>l.preparationFragments[0].lastStep=10000,l=>l.preparationFragments[0].lastStep=1.5,l=>l.preparationFragments[0].goal='',l=>l.preparationFragments[0].requiredBeforeAssessment=false,l=>l.requiresModel=l.requiresModel.filter(x=>x!=='preparation-fragment-completion')]){const row=fixture('bad-fragment');mutate(row);assert.throws(()=>validatePlannedLessons([row],options),/preparation fragment/);}
 assert.throws(()=>validatePlannedLessons([fixture('missing-source-length')],{...options,implementedLessonLengths:{}}),/out-of-range preparation fragment/);
});

test('coverage consumes six future plans without registering them or increasing implementation/review counters',()=>{
 const r=Coverage.build();assert.equal(r.counts.plannedFutureLessons,catalogCounts.plannedFutureLessons);assert.equal(r.counts.implementedLearningLessons,catalogCounts.implementedLearningLessons);assert.equal(r.counts.checkedMidiRouteLessons,catalogCounts.checkedMidiRouteLessons);assert.equal(r.counts.withStructuredProvenance,catalogCounts.withStructuredProvenance);assert.equal(r.counts.independentTeacherReviewed,catalogCounts.independentTeacherReviewed);assert.equal(r.counts.verifiedDistinctGoalCount,null);assert.deepEqual(r.domains.find(d=>d.id==='ear-transfer').plannedLessonIds,ids);assert.ok(ids.every(id=>!app.lessons.some(l=>l.id===id)));assert.ok(plans.every(l=>!app.lessons.some(row=>row.id===l.id)));
});

test('future reading fragments keep their explicit 56 BPM adaptation and cannot fall back silently to parent tempo',()=>{
 for(const plan of plans.filter(p=>p.assessmentProtocol?.kind==='notation-to-key')){assert.ok(plan.requiresModel.includes('preparation-fragment-tempo-adaptation-v1'));assert.equal(plan.preparationFragments[0].adaptation.targetBpm,56);assert.equal(plan.preparationFragments[0].adaptation.version,1);}
 for(const change of [p=>delete p.preparationFragments[0].adaptation,p=>p.preparationFragments[0].adaptation.version=2,p=>p.preparationFragments[0].adaptation.kind='original-score',p=>p.preparationFragments[0].adaptation.targetBpm=55,p=>p.preparationFragments[0].adaptation.rationale='']){const plan=fixture('bad-adaptation');change(plan);assert.throws(()=>validatePlannedLessons([plan],options),/preparation fragment/);}
});

test('dependency order includes prerequisite and display anchors without mutating the requested plan order',()=>{
 const rows=[fixture('future-b',{requires:['future-a']}),fixture('future-c',{after:'future-b'}),fixture('future-a')],before=copy(rows),r=validatePlannedLessons(rows,options);assert.equal(r.planCount,3);assert.deepEqual(r.dependencyOrder,['future-a','future-b','future-c']);assert.deepEqual(rows,before);assert.doesNotThrow(()=>validatePlannedLessons(plans,options));
});

test('previously accepted self preparation, mutual cycles and self anchors fail with a useful plan identity',()=>{
 assert.throws(()=>validatePlannedLessons([fixture('future-self',{requires:['future-self']})],options),/future-self:.*self preparation/);
 assert.throws(()=>validatePlannedLessons([fixture('future-a',{requires:['future-b']}),fixture('future-b',{requires:['future-a']})],options),/cycle: future-a -> future-b -> future-a/);
 assert.throws(()=>validatePlannedLessons([fixture('future-anchor',{after:'future-anchor'})],options),/future-anchor:.*self display anchor/);
 assert.throws(()=>validatePlannedLessons([fixture('future-a',{after:'future-b'}),fixture('future-b',{requires:['future-a']})],options),/preparation\/anchor cycle/);
});

test('unknown preparation, sources, domains and duplicate/promoted identities cannot inflate the future map',()=>{
 for(const [change,pattern]of [[l=>l.requires=['unknown'],/preparation/],[l=>l.requires=['course02-03','course02-03'],/preparation/],[l=>l.after='unknown',/anchor/],[l=>l.candidateEvidenceIds=['unknown'],/source evidence/],[l=>l.coverageDomain='not-a-domain',/domain/],[l=>l.reviewStatus='implemented-and-tested',/remain planned/]]){const l=fixture('invalid');change(l);assert.throws(()=>validatePlannedLessons([l],options),pattern);}
 assert.throws(()=>validatePlannedLessons([fixture('course02-03')],options),/already implemented/);assert.throws(()=>validatePlannedLessons([fixture('same'),fixture('same')],options),/duplicated/);assert.throws(()=>validatePlannedLessons([fixture('a',{goalKey:'same'}),fixture('b',{goalKey:'same'})],options),/goal identity/);
});

test('planned piano fingers, pitches, timing and hand-specific sequences reject malformed specifications',()=>{
 for(const change of [l=>l.targetNotes[0].finger=0,l=>l.targetNotes[0].finger=6,l=>l.targetNotes[0].finger=1.5,l=>l.targetNotes[0].midi=128,l=>l.targetNotes[0].midi=60.1,l=>l.targetNotes[0].hand='left',l=>l.targetNotes[0].startBeat=-1,l=>l.targetNotes[0].durationBeats=0,l=>l.targetNotes[0].durationBeats=Infinity,l=>l.targetNotes[0].startBeat=5,l=>l.targetMidis[0]=61,l=>l.targetFingers[0]=2]){const l=fixture('bad-notes');change(l);assert.throws(()=>validatePlannedLessons([l],options),/pitch|finger|hand|timing|onset order/);}
 const held=copy(plans.find(l=>l.id==='detail-p-held-voice-01'));assert.doesNotThrow(()=>validatePlannedLessons([held],options));assert.equal(held.targetNotes[0].durationBeats,2);assert.deepEqual(held.targetNotes.slice(1).map(n=>n.startBeat),[0,1]);const wrong=copy(held);wrong.targetNotes.forEach(n=>n.hand='left');assert.throws(()=>validatePlannedLessons([wrong],options),/notes for each hand/);
});

test('an unimplemented first-exposure plan cannot claim verification or drop response and assistance safeguards',()=>{
 for(const change of [l=>l.assessmentStatus='verified',l=>l.assessmentProtocol.kind='memory',l=>l.assessmentProtocol.response='direction-choice',l=>l.assessmentProtocol.firstExposureRequired=false,l=>l.assessmentProtocol.responseBeforeReveal=false,l=>l.assessmentProtocol.excludeDemonstrationsFromAssessment=false,l=>l.assessmentProtocol.trackExposure=false,l=>l.assessmentProtocol.assistedItemsPracticeOnly=false,l=>l.assessmentProtocol.repeatedItemsPracticeOnly=false,l=>l.requiresModel=[],l=>delete l.transfer]){const l=fixture('bad-protocol');change(l);assert.throws(()=>validatePlannedLessons([l],options),/protocol|assessment status|response type|first-exposure|transfer/);}
 for(const id of ids){const l=plans.find(l=>l.id===id);assert.equal(l.assessmentStatus,'not-implemented');assert.ok(l.requiresModel.includes('item-exposure-history'));assert.match(l.assessmentProtocol.freshnessLimit,/вне (приложения|сервиса) неизвестно/);assert.equal(l.itemPool.examplesArePracticeOnly,true);}
});

test('four goals have independent musical examples and the two clefs keep their own notes and hand preparations',()=>{
 const expected=[{midis:[60,64],fingers:[1,3],hand:'right'},{midis:[60,64,62,60],fingers:[1,3,2,1],hand:'right'},{midis:[60,62,62,64],fingers:[1,2,2,3],hand:'right'},{midis:[48,50,50,52],fingers:[5,4,4,3],hand:'left'}];
 for(const[i,id]of ids.entries()){const l=plans.find(l=>l.id===id),e=expected[i];assert.deepEqual(l.targetNotes.map(n=>n.midi),e.midis);assert.deepEqual(l.targetNotes.map(n=>n.finger),e.fingers);assert.ok(l.targetNotes.every(n=>n.hand===e.hand&&n.durationBeats===1));assert.deepEqual(l.targetNotes.map(n=>n.startBeat),i===0?[0,1]:[0,1,2,3]);assert.equal(l.targetBpm,56);assert.deepEqual(l.lessonBlockMinutes,[3,5]);assert.ok(l.candidateEvidenceIds.every(id=>ledger.entries.some(e=>e.id===id)));assert.match(l.provenance.sourceNote,/не предписаны RCM\/ABRSM/);}
 const right=plans.find(l=>l.id===ids[2]),left=plans.find(l=>l.id===ids[3]);assert.deepEqual(right.notation.pitchPositions,[{midi:60,position:-2,ledger:true},{midi:62,position:-1,ledger:false},{midi:64,position:0,ledger:false}]);assert.deepEqual(left.notation.pitchPositions,[{midi:48,position:3,ledger:false},{midi:50,position:4,ledger:false},{midi:52,position:5,ledger:false}]);assert.deepEqual(right.notation.anchor,{midi:67,position:2});assert.deepEqual(left.notation.anchor,{midi:53,position:6});assert.equal(right.notation.clefDoesNotAssignHand,true);assert.equal(left.notation.clefDoesNotAssignHand,true);for(const l of [right,left])for(const id of l.requires)assert.ok(app.lessons.find(p=>p.id===id).fingeringSpec.steps.every(s=>s.every(n=>n.hand===l.hand)));
});

test('direction, echo and reading plans distinguish evidence types, demonstrations, transfer and delayed return',()=>{
 const direction=plans.find(l=>l.id===ids[0]),echo=plans.find(l=>l.id===ids[1]);assert.deepEqual(direction.responseChoices.map(c=>c.id),['up','down','same']);assert.equal(direction.assessmentProtocol.response,'direction-choice');assert.equal(echo.itemPool.firstMidi,60);assert.equal(echo.assessmentProtocol.response,'midi-pitch-sequence');assert.match(echo.goal,/не проверка абсолютного слуха/);assert.match(echo.assessmentProtocol.scoring,/не оценивать пение/);assert.equal(direction.transfer.expectedDirection,'down');assert.deepEqual(direction.transfer.notes.map(n=>n.midi),[64,62]);
 for(const id of ids){const l=plans.find(l=>l.id===id);assert.match(l.nextDay,/на следующий день/);assert.match(l.transfer.goal,/опубликованн/);assert.ok(l.practiceSteps.length>=3);assert.ok(l.selfCheck.length>=3);assert.ok(l.typicalErrors.length>=2);assert.ok(l.distinctFrom.length>80);}
 for(const id of ids.slice(2)){const l=plans.find(l=>l.id===id);assert.match(l.assessmentProtocol.accessibleAlternative,/отдельная практика/);assert.match(l.goal,/не зачёт чтения целой пьесы/);}
});
