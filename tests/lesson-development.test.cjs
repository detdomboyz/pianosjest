'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),{loadGuitarApp}=require('./helpers/load-guitar-app.cjs'),{loadGuitarCourse}=require('../tools/curriculum-inventory.cjs');
const Q=require('../lesson-quality.js'),D=require('../lesson-development.js'),B=require('../lesson-review-baseline.js'),A=require('../practice-assessment.js'),Catalog=require('../catalog-sections.js');
const guitarRoot=process.env.GUITAR_TEST_ROOT||path.resolve(__dirname,'../../guitarjest');
const P=require('../piano-lesson-development.js'),pianoCount=492+D.piano.length+P.piano.length,learningCount=344+D.piano.length+P.piano.length;
const app=loadApp(),guitar=loadGuitarCourse(),copy=v=>JSON.parse(JSON.stringify(v));
const adapter=a=>({normalizeRhythm:a.normalizeLessonRhythm,normalizeGuide:a.normalizeLessonGuide,parsePattern:a.parsePattern,midis:a.stepMidiList,spacesBefore:a.lessonSpacesBefore});
test('all learning lessons have a goal, preparation method, self-checks and primary references',()=>{
  const p=Catalog.available('piano','learning',app.lessons,app.themes),g=Catalog.available('guitar','learning',guitar.lessons,guitar.topics);assert.equal(p.length,learningCount);assert.equal(g.length,456);
  for(const l of [...p,...g]){assert.ok(l.learning?.goal,l.id);assert.ok(l.learning.practiceSteps.length>=3,l.id);assert.ok(l.learning.practiceSteps.every(step=>typeof step==='string'&&step.trim().length>0),l.id);assert.ok(l.learning.selfCheck.length>=3,l.id);assert.ok(l.learning.references.every(url=>url.startsWith('https://')),l.id);}
});
test('extension lessons are short focused exercises with explicit timing; pieces are not expanded',()=>{
  assert.equal(D.piano.length,56);assert.equal(D.guitar.length,36);
  const fresh=[...app.lessons,...guitar.lessons].filter(l=>l.id.startsWith('detail-'));assert.equal(fresh.length,D.piano.length+P.piano.length+D.guitar.length);
  for(const l of fresh){assert.equal(l.contentKind,'exercise');assert.ok(l.learning.requires.length);assert.ok((l.steps||l.notes).length<=24);}
  assert.equal(Catalog.available('piano','pieces',app.lessons,app.themes).length,148);assert.equal(Catalog.available('guitar','pieces',guitar.lessons,guitar.topics).length,257);
});
test('every new lesson preparation precedes it and each branch can be followed independently',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../curriculum-plan.js'),'utf8'),context);const plan=context.MUSIC_CURRICULUM_PLAN;
  for(const [instrument,ls] of [['piano',app.lessons],['guitar',guitar.lessons]])for(const l of ls.filter(l=>l.learning?.after)){
    const entries=plan[instrument],i=entries.findIndex(e=>e.id===l.id);for(const id of l.learning.requires){const j=entries.findIndex(e=>e.id===id);assert.ok(j>=0&&j<i,l.id+' needs '+id);const branch=entries[j].branch;assert.ok(branch==='common'||branch===entries[i].branch,l.id+' depends on other branch '+branch);}
  }
});
test('piano corrective migration fixes all old learning exercises, once, preserving original music',()=>{
  const a=loadApp({unreviewed:true}),old=new Map(a.lessons.map(l=>[l.id,l.pattern]));assert.equal(a.lessons.length,492);
  assert.equal(a.installReviewedLessons(),true);assert.equal(a.lessons.filter(l=>l.lessonReview).length,344);assert.equal(a.lessons.length,pianoCount);
  for(const l of a.lessons)if(old.has(l.id)&&!['chordx04','chordx05'].includes(l.id))assert.equal(l.pattern,old.get(l.id));const snapshot=JSON.stringify(a.catalogSnapshot());assert.equal(a.installReviewedLessons(),false);assert.equal(JSON.stringify(a.catalogSnapshot()).replace(/"savedAt":"[^"]+"/g,''),snapshot.replace(/"savedAt":"[^"]+"/g,''));
});
test('edited notes, instructions and timing are not overwritten by the corrective migration',()=>{
  const a=loadApp({unreviewed:true}),l=a.lessons.find(l=>l.id==='course02-01');l.description='Моя редакция';l.pattern+=' t';const before=JSON.stringify(l);assert.equal(Q.repairPiano(l,B,adapter(a)),false);assert.equal(JSON.stringify(l),before);
  const g=loadGuitarCourse(undefined,{correct:false}),unit=g.lessons.find(l=>l.id==='t10-l02');unit.notes[0].fret=6;const note=copy(unit.notes);Q.repairGuitar(g,B);assert.deepEqual(copy(unit.notes),note);
});
test('new lesson metadata and corrected plans survive piano export/reload and keep edits',()=>{
  const a=loadApp(),l=a.lessons.find(l=>l.id==='detail-p-legato-01');l.title='Мой заголовок';const before=A.pianoSignature(l),snapshot=a.catalogSnapshot();assert.ok(a.applyCatalogSnapshot(snapshot));const restored=a.lessons.find(n=>n.id===l.id);assert.equal(A.pianoSignature(restored),before);assert.equal(restored.title,'Мой заголовок');assert.equal(restored.learning.articulation,'legato');assert.equal(a.lessons.length,pianoCount);
});
test('an existing pre-review piano snapshot migrates matching lessons and preserves custom edits',()=>{
  const original=loadApp({unreviewed:true}),snapshot=original.catalogSnapshot();snapshot.lessons.find(l=>l.id==='course02-02').description='Моя инструкция';const a=loadApp();a.applyCatalogSnapshot(snapshot);assert.equal(a.lessons.find(l=>l.id==='course02-02').description,'Моя инструкция');assert.equal(a.lessons.find(l=>l.id==='course02-02').lessonReview,null);assert.ok(a.lessons.find(l=>l.id==='course01-01').lessonReview);assert.ok(a.lessons.find(l=>l.id==='chordx04').pattern.includes('[psf]'));assert.equal(a.lessons.length,pianoCount);
});
test('continuous exercises have no conflicting phrase rests; held notes and authored etude durations are explicit',()=>{
  for(const id of ['course02-05','course03-05'])assert.ok(app.lessons.find(l=>l.id===id).rhythm.steps.every(s=>s.restBeforeBeats===0));
  for(const l of Catalog.available('piano','learning',app.lessons,app.themes)){assert.equal(l.rhythm.steps.length,l.steps.length);assert.ok(l.rhythm.steps.every(s=>s.durationBeats>0));if(l.rhythm.source==='project-technical-etude-v1')assert.match(l.learning.rhythmNotice,/не ритм оригинального/);}
  assert.match(app.lessons.find(l=>l.id==='course09-08').description,/паузы/);
});
test('independent reference: C-major crossings 3–1 right and 1–3 left, correct pitch/register',()=>{
  for(const [id,expected,digits,hand] of [['detail-p-cross-01',[64,65,64,65],[3,1,3,1],'right'],['detail-p-cross-03',[55,57,55,57],[1,3,1,3],'left']]){
    const l=app.lessons.find(l=>l.id===id);assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),expected);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),digits);assert.ok(l.fingeringSpec.steps.every(s=>s[0].hand===hand));
  }
  for(const l of app.lessons.filter(l=>l.id.startsWith('detail-p-')))assert.ok(app.ensureFingeringPlan(l).steps.every(s=>s.length),l.id);
});
test('register labels match actual endpoints and incomplete scales are labelled seven degrees',()=>{
  const t=app.themes.find(t=>t.order===28);assert.match(t.name,/C2–C7/);assert.match(app.themes.find(t=>t.order===40).name,/C5–C♯6/);
  for(const order of [37,38,39]){const theme=app.themes.find(t=>t.order===order),l=app.lessons.find(l=>l.themeId===theme.id);assert.match(l.title,/Семь ступеней/);assert.equal(new Set(l.steps.flatMap(app.stepMidiList)).size,7);}
});
test('A-minor lesson and its follow-up cadence contain A–C–E, not A–C–D',()=>{
  const l=app.lessons.find(l=>l.id==='chordx04');for(const s of l.steps.filter(s=>s.type==='chord'))assert.deepEqual(Array.from(app.stepMidiList(s)),[69,72,76]);
  assert.ok(l.steps.some(s=>app.stepMidiList(s).includes(76)));assert.ok(!l.steps.some(s=>app.stepMidiList(s).includes(74)));
  assert.ok(app.lessons.find(l=>l.id==='chordx05').steps.some(s=>JSON.stringify(app.stepMidiList(s))==='[69,72,76]'));
});
test('a user moving an unchanged exercise into pieces keeps their musical data',()=>{
  const a=loadApp({unreviewed:true}),l=a.lessons.find(l=>l.id==='chordx04');l.contentKind='piece';const old=l.pattern;a.installReviewedLessons();assert.equal(l.pattern,old);assert.equal(l.learning,undefined);
});
function connectedEvents(gap=0){return [{type:'on',midi:60,at:1000,source:'midi'},{type:'off',midi:60,at:2000-gap},{type:'on',midi:62,at:2000,source:'midi'},{type:'off',midi:62,at:3000}];}
test('legato rejects a gap that generic duration tolerance accepts, also rejects excessive overlap',()=>{
  const base={steps:[{midis:[60],startBeat:0,durationBeats:1},{midis:[62],startBeat:1,durationBeats:1}],bpm:60,targetBpm:60};assert.equal(A.assessPiano({...base,events:connectedEvents(180)}).clean,true);
  assert.equal(A.assessPiano({...base,events:connectedEvents(180),profile:'legato'}).clean,false);assert.equal(A.assessPiano({...base,events:connectedEvents(-200),profile:'legato'}).clean,false);assert.equal(A.assessPiano({...base,events:connectedEvents(30),profile:'legato'}).clean,true);
});
test('legato respects explicit rests and repeated-note releases; staccato requires a short sound',()=>{
  const rest={steps:[{midis:[60],startBeat:0,durationBeats:1},{midis:[62],startBeat:2,durationBeats:1}],bpm:60,targetBpm:60,profile:'legato',events:connectedEvents().map((e,i)=>i>1?{...e,at:e.at+1000}:e)};assert.equal(A.assessPiano(rest).clean,true);
  const base={steps:[{midis:[60],startBeat:0,durationBeats:.3}],bpm:60,targetBpm:60,profile:'staccato',events:connectedEvents().slice(0,2)};base.events[1].at=1300;assert.equal(A.assessPiano(base).clean,true);base.events[1].at=1600;assert.equal(A.assessPiano(base).clean,false);
});
test('actual event handler applies legato criteria and new lessons are challenge eligible',()=>{
  const clock={now:1000},a=loadApp({events:true,clock,storage:{getItem:()=>null,setItem(){}}});a.setTestLesson(a.lessons.find(l=>l.id==='detail-p-legato-01'));a.state.attemptMode='challenge';assert.equal(a.challengeEligible(),true);const beat=60000/a.state.lesson.rhythm.practiceBpm;
  a.state.lesson.rhythm.steps.forEach((s,i)=>{clock.now=1000+s.startBeat*beat;a.handleNoteOn(a.stepMidiList(a.state.lesson.steps[i])[0],'midi');clock.now+=(s.durationBeats*beat)-200;a.handleNoteOff(a.stepMidiList(a.state.lesson.steps[i])[0]);});assert.equal(a.state.completed,true);assert.equal(a.state.passed,false);assert.ok(a.state.assessment.articulationErrors);
});
test('long piano exercises practise 16 actions, can advance or play whole, and never create mastery',()=>{
  const a=loadApp({events:true}),l=a.lessons.find(l=>l.steps.length>64&&l.learning);a.setTestLesson(l);assert.equal(a.practiceRange().end,16);assert.equal(a.practiceRange().partial,true);a.state.stepIndex=15;const st=l.steps[15];for(const m of a.stepMidiList(st))a.handleNoteOn(m,'manual');assert.equal(a.state.completed,true);assert.equal(a.state.passed,false);assert.match(a.state.message,/Фрагмент упражнения/);
  a.setPracticeRange(16);assert.equal(a.state.stepIndex,16);assert.equal(a.state.playbackIndex,16);assert.equal(a.practiceRange().end,32);a.setPracticeRange(0,true);assert.equal(a.practiceRange().end,l.steps.length);
});
test('slides keep one finger and all hammer/pull transitions have feasible ordered fingers',()=>{
  for(const l of Catalog.available('guitar','learning',guitar.lessons,guitar.topics))for(let i=1;i<l.notes.length;i++){const n=l.notes[i],p=l.notes[i-1];if(n.string!==p.string)continue;if(n.technique==='slide')assert.equal(n.finger,p.finger,l.id);if(n.pick==='none'&&/hammer-on/.test(n.technique))assert.ok(n.finger>p.finger&&n.fret>p.fret,l.id);if(n.pick==='none'&&/pull-off/.test(n.technique))assert.ok(n.finger<p.finger&&n.fret<p.fret,l.id);}
  const mixed=[{string:3,fret:3,finger:3},{string:3,fret:5,finger:1,technique:'slide',pick:'none'},{string:3,fret:7,finger:1,technique:'hammer-on',pick:'none'},{string:3,fret:5,finger:3,technique:'pull-off',pick:'none'}];Q.repairLegato(mixed);assert.equal(mixed[0].finger,mixed[1].finger);assert.ok(mixed[2].finger>mixed[1].finger);assert.ok(mixed[3].finger<mixed[2].finger);
});
test('independent bend reference: G string fret 7 finger 3 stays fixed while D4 rises to Eb4/E4',()=>{
  for(const [id,target] of [['t10-l01',63],['t10-l02',64],['detail-g-bend-02',63],['detail-g-bend-03',64]]){const l=guitar.lessons.find(l=>l.id===id),n=l.notes.find(n=>n.pitchEffect==='bend-target');assert.ok(n,id);assert.equal(n.string,3);assert.equal(n.fret,7);assert.equal(n.finger,3);assert.equal(n.bendFromMidi,62);assert.equal(n.midi,target);assert.equal(n.bendSemitones,target-62);}
});
test('bend audio rises and releases rather than jumping frets; vibrato is a bounded periodic variation',()=>{
  const l=guitar.lessons.find(l=>l.id==='detail-g-bend-04');for(const n of l.notes.filter(n=>n.bendStartMidi!==undefined)){const p=Q.pitchEnvelope(n,2);assert.equal(p[0].frequency,440*2**((n.bendStartMidi-69)/12));assert.equal(p.at(-1).frequency,n.frequency);assert.ok(p.every((v,i)=>i===0||v.at>=p[i-1].at));}
  const p=Q.pitchEnvelope({midi:64,vibratoCents:25,vibratoRateHz:4},1);assert.ok(new Set(p.map(v=>v.frequency)).size>4);assert.ok(p.every(v=>v.frequency>=329.62&&v.frequency<=329.63*2**(25/1200)));
});
test('adding expressive pitch preserves the non-tempered frequency of natural harmonics',()=>{
  const harmonic=guitar.lessons.find(l=>l.id==='t31-l03').notes[0];assert.equal(Q.pitchEnvelope(harmonic,1)[0].frequency,harmonic.frequency);assert.equal(Q.pitchEnvelope(harmonic,1).at(-1).frequency,harmonic.frequency);
});
test('text editor round-trip preserves bend effects and prevents broken physical constraints',()=>{
  const original=copy(guitar.lessons.find(l=>l.id==='detail-g-bend-02').notes),edited=original.map(n=>Object.fromEntries(Object.entries(n).filter(([k])=>!/^bend|^pitchEffect|^notatedTargetFret/.test(k))));const restored=Q.preserveTechniqueNotes(original,edited);assert.equal(restored[1].bendFromMidi,62);assert.equal(restored[1].pitchEffect,'bend-target');assert.equal(restored[1].fret,7);edited[1].fret=8;assert.throws(()=>Q.preserveTechniqueNotes(original,edited),/позиция/);
  const slide=copy(guitar.lessons.find(l=>l.id==='detail-g-legato-01').notes);slide[1].finger=3;assert.throws(()=>Q.preserveTechniqueNotes(guitar.lessons.find(l=>l.id==='detail-g-legato-01').notes,slide),/одним пальцем/);
});
test('the actual guitar synthesizer schedules the bend frequency envelope',()=>{
  const a=loadGuitarApp(guitarRoot),calls=[];const param={setValueAtTime:(v,t)=>calls.push(['set',v,t]),linearRampToValueAtTime:(v,t)=>calls.push(['ramp',v,t]),exponentialRampToValueAtTime(){}};const node=()=>({frequency:param,Q:param,gain:param,connect(){return this;},start(){},stop(){},disconnect(){}});a.state.player.audioContext={createOscillator:node,createGain:node,createBiquadFilter:node};a.scheduleSynthVoice(guitar.lessons.find(l=>l.id==='detail-g-bend-02').notes[1],10,2,null,false);assert.ok(calls.some(c=>c[0]==='set'&&Math.abs(c[1]-293.6648)<.01));assert.ok(calls.some(c=>c[0]==='ramp'&&Math.abs(c[1]-311.127)<.01&&c[2]>10));
});
test('bend pitch tolerance and technique metadata invalidate old evidence without claiming mastery',()=>{
  const note={midi:63},base={notes:[note],hits:1,errors:0,cents:[28]};assert.equal(A.assessGuitar(base).pitchClean,true);assert.equal(A.assessGuitar({...base,pitchToleranceCents:20}).pitchClean,false);assert.equal(A.assessGuitar({...base,cents:[5],pitchToleranceCents:20}).mastered,false);
  const l=guitar.lessons.find(l=>l.id==='detail-g-bend-02'),other=copy(l);other.notes[1].bendStartMidi=61;assert.notEqual(A.guitarSignature(l),A.guitarSignature(other));const p=app.lessons.find(l=>l.id==='detail-p-legato-01'),q=copy(p);q.learning.articulation='standard';assert.notEqual(A.pianoSignature(p),A.pianoSignature(q));
});
test('new guitar beats, seconds, names, frequencies and polyphonic groups agree',()=>{
  for(const l of guitar.lessons.filter(l=>l.id.startsWith('detail-g-')))for(const n of l.notes){assert.ok(n.id&&n.note);assert.ok(Math.abs(n.frequency-440*2**((n.midi-69)/12))<.001);assert.equal(n.endBeat-n.startBeat,n.durationBeats);assert.ok(Math.abs(n.startSeconds-n.startBeat*60/l.originalBpm)<1e-6);assert.ok(n.endSeconds>n.startSeconds);}
  const chord=guitar.lessons.find(l=>l.id==='detail-g-chords-02');assert.equal(A.assessGuitar({notes:chord.notes,hits:chord.notes.length,errors:0,cents:chord.notes.map(()=>0)}).pitchClean,false);
});
test('materials distinguish finger numbering, authored rhythm and unverified ear training, and escape edits',()=>{
  const l=copy(app.lessons.find(l=>l.id==='detail-p-hearing-01'));l.learning.goal='<script>alert(1)</script>';const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const html=D.materialHtml(l,'piano',esc);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/автоматического теста слуха/);assert.match(D.materialHtml(guitar.lessons.find(l=>l.id==='detail-g-pima-04'),'guitar',esc),/p — большой/);
});
test('all reproduced semantic errors have regressions and are absent after correction',()=>{assert.deepEqual(require('../tools/inspect-pedagogy.cjs').inspect().summary,{});});
