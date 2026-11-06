'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Staff=require('../piano-staff-view.js'),Adapter=require('../piano-catalog-adapter.js'),{examples}=require('../web-reader/tools/fixtures.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(clef='treble'){const midis=clef==='treble'?[60,62,64]:[48,50,52],steps=['C','D','E'],music={schemaVersion:1,id:'independent-notes',revision:'r1',timeUnit:'quarter',bpm:56,parts:[{id:'melody'},{id:'other'}],notes:midis.map((value,i)=>({id:'n'+i,partId:'melody',pitch:{kind:'midi',value},span:{kind:'known',start:i*2,duration:.85}}))};return {music,notation:{documentRevision:'r1',partId:'melody',clef,spelling:steps.map((step,i)=>({noteId:'n'+i,step,octave:clef==='treble'?4:3,alter:0}))}};}
function deepFreeze(x){if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(deepFreeze);}return x;}

test('read-only staff positions follow six independent natural-pitch landmarks in two explicit clefs',()=>{
 for(const [clef,positions]of [['treble',[-2,-1,0]],['bass',[3,4,5]]]){const f=fixture(clef),v=Staff.project(f.music,f.notation);assert.equal(v.status,'ready');assert.deepEqual(v.notes.map(n=>n.staffPosition),positions);assert.deepEqual(v.notes.map(n=>n.ledgerPositions),clef==='treble'?[[-2],[],[]]:[[],[],[]]);assert.deepEqual(v.notes.map(n=>n.noteId),['n0','n1','n2']);assert.deepEqual(v.notes.map(n=>[n.startBeat,n.durationBeats]),[[0,.85],[2,.85],[4,.85]]);assert.deepEqual(v.notes.map(n=>n.midi),clef==='treble'?[60,62,64]:[48,50,52]);}
});

test('frozen documents and explicit notation are unchanged and returned note spans are detached copies',()=>{
 const f=fixture(),before=copy(f),v=Staff.project(deepFreeze(f.music),deepFreeze(f.notation));assert.deepEqual(copy(f),before);v.notes[0].midi=1;v.notes[0].ledgerPositions.push(100);assert.deepEqual(copy(f),before);assert.equal(Staff.project(f.music,f.notation).notes[0].midi,60);
});

test('notation is bound to the selected part and musical revision, never guessed from MIDI or a default hand',()=>{
 const f=fixture();for(const change of [n=>n.documentRevision='old',n=>n.partId='unknown',n=>n.clef='alto',n=>delete n.spelling]){const n=copy(f.notation);change(n);const v=Staff.project(f.music,n);assert.equal(v.status,'unsupported');assert.equal(v.notes.length,0);assert.ok(v.warnings.length);}
 const v=Staff.project(f.music,f.notation);assert.equal(v.partId,'melody');assert.equal(v.documentRevision,'r1');assert.ok(v.notes.every(n=>!Object.hasOwn(n,'hand')&&!Object.hasOwn(n,'finger')));
});

test('a missing, conflicting or unsupported spelling cannot turn the phrase into fewer or shifted notes',()=>{
 const f=fixture();for(const change of [n=>n.spelling.pop(),n=>n.spelling[0].alter=1,n=>n.spelling[0].step='D',n=>n.spelling[0].octave=3,n=>n.spelling[0].step='F',n=>n.spelling.push(copy(n.spelling[0]))]){const n=copy(f.notation);change(n);const v=Staff.project(f.music,n);assert.equal(v.status,'unsupported');assert.deepEqual(v.notes,[]);assert.ok(v.warnings.length);assert.deepEqual(f,fixture());}
 const bass=fixture('bass');bass.notation.clef='treble';assert.ok(Staff.project(bass.music,bass.notation).warnings.some(w=>w.code==='REGISTER_UNSUPPORTED'));
});

test('frequency, percussion and unknown timing stay unsupported rather than being rounded or invented',()=>{
 for(const change of [m=>m.notes[0].pitch={kind:'frequency',hz:261.7},m=>m.notes[0].pitch={kind:'unpitched',key:'snare'},m=>m.notes[0].span={kind:'unknown'}]){const f=fixture();change(f.music);const before=copy(f.music),v=Staff.project(f.music,f.notation);assert.equal(v.status,'unsupported');assert.deepEqual(v.notes,[]);assert.deepEqual(f.music,before);}
});

test('simultaneous tones and held voices are explicit unsupported cases, while exact adjacent releases stay valid',()=>{
 for(const start of [0,.5]){const f=fixture();f.music.notes[1].span.start=start;const v=Staff.project(f.music,f.notation);assert.equal(v.status,'unsupported');assert.deepEqual(v.notes,[]);assert.equal(v.warnings[0].code,'POLYPHONY_UNSUPPORTED');}
 const f=fixture();f.music.notes[1].span.start=.85;assert.equal(Staff.project(f.music,f.notation).status,'ready');
});

test('malformed documents, empty parts and oversized phrases produce bounded diagnostic views',()=>{
 const f=fixture();for(const music of [null,{}, {...f.music,notes:[...f.music.notes,f.music.notes[0]]}, {...f.music,notes:[]}, {...f.music,notes:Array.from({length:9},(_,i)=>({...f.music.notes[0],id:'note'+i,span:{kind:'known',start:i,duration:1}}))}]){const v=Staff.project(music,f.notation);assert.equal(v.status,'unsupported');assert.equal(v.notes.length,0);assert.ok(v.warnings.length);assert.ok(v.documentId===null||typeof v.documentId==='string');}assert.equal(Staff.project({id:42},f.notation).documentId,null);
});

test('real catalog adapter examples keep source notes, explicit hands, note IDs and original musical versions',()=>{
 const samples=examples();for(const key of ['treble','bass']){const s=samples[key],before=copy(s.projection),v=Staff.project(s.music,s.notation);assert.equal(v.status,'ready');assert.deepEqual(v.notes.map(n=>n.noteId),s.music.notes.map(n=>n.id));assert.deepEqual(v.notes.map(n=>[n.midi,n.startBeat,n.durationBeats]),s.music.notes.map(n=>[n.pitch.value,n.span.start,n.span.duration]));assert.deepEqual(Adapter.restore(s.projection),s.entry);assert.deepEqual(s.projection,before);assert.ok(s.projection.execution.assignments.every(a=>a.hand===(key==='treble'?'right':'left')));}
 assert.equal(samples.unsupported.view.status,'unsupported');assert.equal(samples.unsupported.music.notes[0].pitch.value,61);
});
