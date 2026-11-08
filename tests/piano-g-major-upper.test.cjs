'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),A=require('../practice-assessment.js'),fixture=require('./fixtures/piano-before-g-major-upper-v1.json');
const app=loadApp(),copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ids=['detail-p-g-major-upper-right-01','detail-p-g-major-upper-left-01'],units=ids.map(id=>app.lessons.find(l=>l.id===id));
function events(l,mode='clean'){
 const beat=60000/l.rhythm.practiceBpm,out=[];
 l.rhythm.steps.forEach((s,i)=>{const midi=app.stepMidiList(l.steps[i])[0]+(i===1?(mode==='natural-f'?-1:mode==='wrong-register'?12:0):0),duration=mode==='short-last'&&i===4?.1:mode==='gap'?.3:mode==='overlap'?1.8:s.durationBeats;out.push({type:'on',source:'midi',midi,at:1000+s.startBeat*beat},{type:'off',midi,at:1000+(s.startBeat+duration)*beat});});
 if(mode==='repeat-top'){const midi=app.stepMidiList(l.steps[2])[0];out.push({type:'on',source:'midi',midi,at:1000+2.3*beat},{type:'off',midi,at:1000+2.6*beat});}
 return out.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));
}

test('two new upper groups preserve all578 complete records, musical grades, order, themes, baseline and guitar',()=>{
 const oldIds=new Set(fixture.catalog.map(l=>l.id)),cohort=app.lessons.filter(l=>oldIds.has(l.id)||ids.includes(l.id));assert.equal(cohort.length,fixture.catalog.length+ids.length);assert.equal(app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);assert.deepEqual(copy(cohort.filter(l=>!oldIds.has(l.id)).map(l=>l.id)),ids);assert.deepEqual(copy(app.lessons.filter(l=>oldIds.has(l.id)).map(l=>l.id)),fixture.catalog.map(l=>l.id));
 for(const old of fixture.catalog){const l=app.lessons.find(x=>x.id===old.id);assert.equal(hash(l),old.fullRecordSha256,old.id);assert.equal(hash({steps:l.steps,rhythm:l.rhythm,fingeringSpec:l.fingeringSpec,contentKind:l.contentKind}),old.musicSha256);assert.equal(A.pianoSignature(l),old.grade);assert.equal(l.order,old.order);assert.equal(l.themeId,old.themeId);}
 assert.deepEqual(copy(app.themes.filter(t=>fixture.themes.some(x=>x.id===t.id))),fixture.themes);assert.equal(app.themes.length,require('./fixtures/piano-curriculum-counts.json').themes);assert.equal(crypto.createHash('sha256').update(fs.readFileSync('lesson-review-baseline.js')).digest('hex'),fixture.protectedBaselineSha256);const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);assert.equal(hash(c.MUSIC_CURRICULUM_PLAN.guitar),fixture.guitarRouteSha256);
});

test('exact upper-group pitches, hand-specific fingers and five legato quarters match teaching intent',()=>{
 for(const[i,l]of units.entries()){assert.deepEqual(copy(l.steps.map(app.stepMidiList)),(i?[52,54,55,54,52]:[64,66,67,66,64]).map(m=>[m]));assert.deepEqual(copy(l.fingeringSpec.steps.map(s=>s.map(x=>[x.hand,x.num]))),(i?[3,2,1,2,3]:[3,4,5,4,3]).map(n=>[[i?'left':'right',n]]));assert.equal(l.handMode,i?'left':'right');assert.equal(l.contentKind,'exercise');assert.equal(l.learning.articulation,'legato');assert.equal(l.rhythm.practiceBpm,48);assert.deepEqual(copy(l.rhythm.steps.map(s=>[s.startBeat,s.durationBeats,s.restBeforeBeats])),Array.from({length:5},(_,n)=>[n,1,0]));assert.equal(app.challengeEligible(l),true);assert.ok(A.pianoSignature(l));}
 const d=app.lessons.find(l=>l.id==='detail-p-black-position-left-02');assert.deepEqual(copy(d.steps.slice(0,5).map(app.stepMidiList)),copy(units[1].steps.map(app.stepMidiList)));assert.notDeepEqual(copy(d.fingeringSpec.steps.slice(0,5)),copy(units[1].fingeringSpec.steps));assert.notEqual(A.pianoSignature(d),A.pianoSignature(units[1]));
});

test('actual assessment rejects natural F, wrong octave, cut ending, gaps, overlaps and repeated peak',()=>{
 for(const l of units){const score={steps:l.rhythm.steps.map((s,i)=>({...s,midis:app.stepMidiList(l.steps[i])})),bpm:48,targetBpm:48,profile:'legato'};assert.equal(A.assessPiano({...score,events:events(l)}).clean,true);for(const mode of ['natural-f','wrong-register','short-last','gap','overlap','repeat-top'])assert.equal(A.assessPiano({...score,events:events(l,mode)}).clean,false,l.id+' '+mode);}
});

test('real MIDI handler waits for complete last note-off and keeps independent lesson progress',async()=>{
 for(const l of units){const clock={now:5000},a=loadApp({events:true,clock,storage:require('./helpers/memory-storage.cjs').createMemoryStorage(),locks:{request:async(n,o,fn)=>fn({name:n})}});a.setTestLesson(a.lessons.find(x=>x.id===l.id));a.state.attemptMode='challenge';const take=events(l);for(const[i,e]of take.entries()){clock.now=5000+e.at-1000;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,true,l.id);assert.equal(a.state.learningProgress[l.id].fingerprint,A.pianoSignature(l));assert.equal(Object.hasOwn(a.state.learningProgress,ids.find(id=>id!==l.id)),false);await a.legacyProgressStore.settled();a.resetLessonState();}
});

test('both new lessons have ordered own-hand preparation chains without opposite-hand gates',()=>{
 const c={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),c);const route=c.MUSIC_CURRICULUM_PLAN.piano.map(x=>x.id);
 for(const[i,l]of units.entries()){assert.equal(l.learning.stage,'p3');assert.equal(l.learning.coverageDomain,'major-scales');const visited=new Set(),walk=id=>{if(visited.has(id))return;visited.add(id);const p=app.lessons.find(x=>x.id===id);assert.ok(p,id);for(const r of p.learning?.requires||[])walk(r);};assert.deepEqual(copy(l.learning.requires),i?['detail-p-left-upper-position-01','detail-p-black-04']:['detail-p-right-upper-position-01','detail-p-black-03']);for(const r of l.learning.requires){assert.ok(route.indexOf(r)<route.indexOf(l.id));walk(r);}for(const id of visited)assert.ok(!(i?/^(course02-|detail-p-right-|detail-p-release-0[13]|detail-p-black-0[13])/:/^(course03-|detail-p-left-|detail-p-release-0[24]|detail-p-black-0[24])/).test(id),l.id+' requires other hand '+id);assert.equal(route.filter(id=>id===l.id).length,1);}
});

test('full cards retain exact count, adaptation, transfer, dated sources and no memory hints',()=>{
 const ledger=require('../docs/piano-curriculum-sources.json');for(const[i,l]of units.entries()){assert.equal(l.learning.practiceSteps.length,5);assert.equal(l.learning.selfCheck.length,5);assert.equal(l.learning.provenance.type,'project-technical-drill');for(const id of l.learning.sourceEvidenceIds){const e=ledger.entries.find(e=>e.id===id);assert.ok(e?.applications.some(x=>x.batch==='2026-11-08-08'&&x.verifiedOn==='2026-11-08'&&x.lessonIds.includes(l.id)),id);}app.state.lesson=l;app.state.attemptMode='practice';app.state.learningMaterialMode='expanded';const html=app.learningMaterialHtml();for(const text of ['Faber','0, 1, 2, 3, 4','у 5','Открытая проба','на следующий день','MIDI',i?'регистр сохранён':'на октаву ниже'])assert.ok(html.includes(text),l.id+' '+text);for(const mode of ['compact','expanded','hidden']){app.state.attemptMode='memory';app.state.learningMaterialMode=mode;assert.equal(app.learningMaterialHtml(),'');}}
});

test('registration and catalog exchange preserve user notes, order, kind and edited teaching',async()=>{
 const a=loadApp({web:true,events:true,storage:require('./helpers/memory-storage.cjs').createMemoryStorage()});for(const id of ids){const l=a.lessons.find(x=>x.id===id);l.title+=' personal';l.contentKind='piece';l.order=id===ids[0]?2:1;l.learning.practiceSteps[0]='personal';l.guide.setup='personal';l.pattern=l.pattern.replace(/^\S+/,'y');l.steps=a.parsePattern(l.pattern).steps;}const selected=()=>ids.map(id=>copy(a.lessons.find(x=>x.id===id))),before=selected();a.installReviewedLessons();assert.deepEqual(selected(),before);assert.equal(await a.importCatalogText(a.catalogExportText(),()=>true),true);for(const[i,l]of selected().entries()){assert.equal(l.contentKind,'piece');assert.equal(l.order,i===0?2:1);assert.equal(l.guide.setup,'personal');assert.equal(l.learning.practiceSteps[0],'personal');assert.deepEqual(l.steps,before[i].steps);assert.equal(a.lessons.filter(x=>x.id===l.id).length,1);}
});

test('current counts distinguish implemented, MIDI-checkable, sourced and teacher-reviewed',()=>{
 const c=require('../tools/piano-skill-coverage.cjs').build().counts;for(const[k,n]of Object.entries(require('./fixtures/piano-curriculum-counts.json')).filter(([k])=>Object.hasOwn(c,k)))assert.equal(c[k],n,k);assert.equal(c.verifiedDistinctGoalCount,null);
});
