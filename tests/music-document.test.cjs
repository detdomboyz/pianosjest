'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),A=require('../practice-assessment.js'),Music=require('../music-document.js'),Adapter=require('../piano-catalog-adapter.js'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp();
const basic=()=>({schemaVersion:1,id:'score',revision:'r1',timeUnit:'quarter',bpm:60,parts:[{id:'p'}],notes:[{id:'n1',partId:'p',pitch:{kind:'midi',value:48},span:{kind:'known',start:0,duration:4}},{id:'n2',partId:'p',pitch:{kind:'midi',value:64},span:{kind:'known',start:1/3,duration:1/3}}]});

test('shipped parser preserves chord order, quick attacks, unknown symbols and independent keyboard pitches',()=>{
 const parsed=Adapter.parsePattern('8  [80w]\n{ty} ~');assert.deepEqual(parsed.steps.map(s=>s.keys.map(k=>Adapter.KEY_MAP[k])),[[48],[48,52,55],[60],[62]]);assert.deepEqual(parsed.steps.map(s=>s.displayIndex),[0,3,5,6]);assert.deepEqual(parsed.steps.map(s=>!!s.quick),[false,false,true,true]);assert.deepEqual(parsed.display.filter(x=>x.kind==='unknown').map(x=>x.raw),['\n','~']);assert.deepEqual(Adapter.parsePattern('[tt]').steps[0].keys,['t','t']);assert.equal(Adapter.parsePattern('[t').steps[0].raw,'[t]');assert.deepEqual(Adapter.parsePattern('{t').steps[0].keys,['t']);assert.equal(Adapter.KEY_MAP.T,61);assert.equal(Adapter.KEY_MAP.E,58);assert.ok(Object.isFrozen(Adapter.KEY_MAP));assert.deepEqual(copy(app.parsePattern('8  [80w]\n{ty} ~')),parsed);
});

test('every current catalog entry roundtrips exact JSON with all source instructions, plans, rhythm and order',()=>{
 const snapshot=copy(app.catalogSnapshot()),before=copy(snapshot),roundtrip=Adapter.roundTripCatalog(snapshot);assert.deepEqual(roundtrip,before);assert.deepEqual(snapshot,before);assert.equal(roundtrip.lessons.length,570);assert.notEqual(roundtrip,snapshot);for(const entry of snapshot.lessons){const doc=Adapter.project(entry);assert.equal(Music.validate(doc.music).valid,true);assert.equal(doc.music.revision,'piano-catalog-v7:'+A.pianoSignature(entry));assert.equal(doc.music.notes.length,app.parsePattern(entry.pattern).steps.reduce((n,s)=>n+s.keys.length,0));}roundtrip.lessons[0].title='Личная правка';assert.notEqual(snapshot.lessons[0].title,'Личная правка');
});

test('common document retains simultaneous independent releases and unquantized triplet values',()=>{
 const doc=basic(),before=copy(doc);assert.equal(Music.assertValid(doc),doc);assert.deepEqual(doc,before);assert.equal(doc.notes[0].span.duration,4);assert.equal(doc.notes[1].span.start,1/3);assert.equal(doc.notes[1].span.duration,1/3);doc.notes[1].span.start=0;doc.notes[1].span.duration=1;assert.equal(Music.validate(doc).valid,true);assert.notEqual(doc.notes[0].span.duration,doc.notes[1].span.duration);
});

test('common pitch contract distinguishes MIDI, natural frequency and unpitched events without rounding',()=>{
 const doc=basic();doc.notes[0].pitch={kind:'frequency',hz:440*3/2};doc.notes[1].pitch={kind:'unpitched',key:'snare'};assert.equal(Music.validate(doc).valid,true);assert.equal(doc.notes[0].pitch.hz,660);assert.deepEqual(doc.notes[1].pitch,{kind:'unpitched',key:'snare'});
});

test('document validator rejects ambiguous unknown time, corrupt pitches, identities, references and versions',()=>{
 for(const edit of [d=>d.schemaVersion=2,d=>d.parts.push({id:'p'}),d=>d.notes[1].id='n1',d=>d.notes[0].partId='missing',d=>d.notes[0].pitch.value=60.5,d=>d.notes[0].pitch.value=128,d=>d.notes[0].pitch={kind:'frequency',hz:0},d=>d.notes[0].span.duration=0,d=>d.notes[0].span.start=-1,d=>d.notes[0].span.duration=NaN,d=>d.notes[0].span={kind:'unknown',duration:1},d=>d.bpm=Infinity,d=>d.notes=null]){const doc=basic();edit(doc);assert.equal(Music.validate(doc).valid,false);assert.throws(()=>Music.assertValid(doc));}assert.equal(Music.validate(null).valid,false);
});

test('legacy missing or broken timing stays unknown and never becomes guessed quarter notes',()=>{
 for(const rhythm of [undefined,null,{bpm:88,steps:[]},{bpm:88,steps:[{startBeat:0,durationBeats:0},{startBeat:1,durationBeats:-1}]}]){const entry={id:'untimed',pattern:'t  y',rhythm},doc=Adapter.project(entry);assert.ok(doc.music.notes.every(n=>n.span.kind==='unknown'));assert.ok(doc.warnings.length);assert.deepEqual(Adapter.restore(doc),copy(entry));}const source={id:'thirds',pattern:'ty',rhythm:{bpm:56,steps:[{startBeat:0,durationBeats:1/3},{startBeat:1/3,durationBeats:2/3}]}};const doc=Adapter.project(source);assert.equal(doc.music.notes[1].span.start,1/3);assert.equal(doc.music.notes[1].span.duration,2/3);assert.deepEqual(Adapter.restore(doc),source);
});

test('explicit piano hands and fingers map to note IDs while raw unmapped assignments survive',()=>{
 const entry={id:'manual',pattern:'8 t',handMode:'auto',fingeringSpec:{version:1,pattern:'8 t',steps:[[{hand:'right',num:5}],[{hand:'left',num:1}]]}},doc=Adapter.project(entry);assert.deepEqual(doc.execution.assignments.map(x=>[x.hand,x.finger]),[['right',5],['left',1]]);assert.deepEqual(doc.execution.assignments.map(x=>x.noteId),doc.music.notes.map(x=>x.id));assert.equal(doc.music.notes[0].pitch.value,48);entry.fingeringSpec.steps[0][0].num=0;const bad=Adapter.project(entry);assert.equal(bad.execution.assignments.length,1);assert.ok(bad.warnings.some(x=>x.code==='FINGERING_ASSIGNMENT_UNMAPPED'));assert.deepEqual(Adapter.restore(bad),entry);
});

test('legacy chord projection admits its shared-time limitation rather than recovering discarded voices',()=>{
 const entry={id:'chord',pattern:'[80w]',rhythm:{bpm:60,steps:[{startBeat:0,durationBeats:2}]}},doc=Adapter.project(entry);assert.deepEqual(doc.music.notes.map(x=>x.pitch.value),[48,52,55]);assert.ok(doc.warnings.some(x=>x.code==='LEGACY_SHARED_CHORD_TIME'));assert.deepEqual(doc.music.notes.map(x=>x.span.duration),[2,2,2]);doc.music.notes[1].span.duration=1;assert.throws(()=>Adapter.restore(doc),/обратное редактирование/);assert.equal(entry.rhythm.steps[0].durationBeats,2);
});

test('projection rejects changed graphs, assignments, source music and unsupported fields instead of losing edits',()=>{
 const entry=copy(app.catalogSnapshot().lessons.find(l=>l.id==='detail-p-black-04')),original=Adapter.project(entry);for(const edit of [d=>d.music.notes[0].pitch.value++,d=>d.music.notes[0].span.duration=.5,d=>d.music.notes.reverse(),d=>d.execution.assignments[0].finger=5,d=>d.execution.documentRevision='other',d=>d.compatibility.entry.pattern='t',d=>d.extra='unsaved',d=>d.schemaVersion=2]){const doc=copy(original);edit(doc);assert.throws(()=>Adapter.restore(doc));assert.deepEqual(original,Adapter.project(entry));}
});

test('revision-scoped note IDs survive metadata and auto-plan changes, while edited musical versions separate',()=>{
 const entry=copy(app.catalogSnapshot().lessons.find(l=>l.id==='detail-p-black-04')),first=Adapter.project(entry);entry.title='Мой заголовок';entry.order=900;entry.learning.goal='Моё объяснение';entry.fingeringPlan={version:500,myPlan:true};const second=Adapter.project(entry);assert.deepEqual(second.music.notes.map(x=>x.id),first.music.notes.map(x=>x.id));assert.deepEqual(Adapter.restore(second),entry);entry.rhythm.steps[0].durationBeats=.5;const edited=Adapter.project(entry);assert.notEqual(edited.music.revision,first.music.revision);assert.notEqual(edited.music.notes[0].id,first.music.notes[0].id);
});

test('catalog revision is distinct from runtime credit and isolated reload keeps the existing assessment version',()=>{
 const a=loadApp(),snapshot=copy(a.catalogSnapshot()),entry=snapshot.lessons.find(l=>l.id==='detail-p-black-04'),runtime=a.lessons.find(l=>l.id===entry.id),old=A.pianoSignature(runtime),doc=Adapter.project(entry);assert.equal(old,'ef39f991');assert.notEqual(A.pianoSignature(entry),old,'Runtime stepIndex is intentionally absent from serialized rhythm');assert.match(doc.music.revision,/^piano-catalog-v7:/);assert.notEqual(doc.music.revision,old);let progress=A.record(undefined,{instrument:'piano',lessonId:entry.id,fingerprint:old,mode:'memory',clean:true,now:1000});assert.equal(a.applyCatalogSnapshot(Adapter.roundTripCatalog(snapshot)),true);const reloaded=a.lessons.find(l=>l.id===entry.id);assert.equal(A.pianoSignature(reloaded),old);progress=A.record(progress,{instrument:'piano',lessonId:entry.id,fingerprint:A.pianoSignature(reloaded),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,true);
});

test('real guitar note data and progress remain independent of piano projection and finger numbering',()=>{
 const course=require('../tools/curriculum-inventory.cjs').loadGuitarCourse(),before=course.lessons.map(l=>A.guitarSignature(l)),lesson=course.lessons.find(l=>l.notes.some(n=>Number.isFinite(n.startBeat)&&Number.isFinite(n.durationBeats)&&n.durationBeats>0&&Number.isInteger(n.midi)));
 assert.ok(lesson);const note=lesson.notes.find(n=>Number.isFinite(n.startBeat)&&Number.isFinite(n.durationBeats)&&n.durationBeats>0&&Number.isInteger(n.midi)),doc=basic();doc.id=lesson.id;doc.revision=A.guitarSignature(lesson);doc.bpm=lesson.bpm;doc.notes=[{id:'guitar-note',partId:'p',pitch:{kind:'midi',value:note.midi},span:{kind:'known',start:note.startBeat,duration:note.durationBeats}}];assert.equal(Music.validate(doc).valid,true);Adapter.project(copy(app.catalogSnapshot().lessons[0]));assert.deepEqual(course.lessons.map(l=>A.guitarSignature(l)),before);assert.equal(doc.notes[0].span.duration,note.durationBeats);let progress=A.record(undefined,{instrument:'guitar',lessonId:lesson.id,fingerprint:doc.revision,mode:'challenge',clean:true,now:1000});const old=copy(progress);A.record(progress,{instrument:'piano',lessonId:lesson.id,fingerprint:'different',mode:'challenge',clean:true,now:2000});assert.deepEqual(progress,old);assert.ok(!Object.hasOwn(doc.notes[0],'finger'));
});
