'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadApp}=require('./helpers/load-app.cjs'),P=require('../piano-lesson-development.js'),A=require('../practice-assessment.js'),UI=require('../piano-learning-ui.js'),Coverage=require('../tools/piano-skill-coverage.cjs'),originals=require('./fixtures/piano-right-release-black-groups-v1.json');
const copy=x=>JSON.parse(JSON.stringify(x)),app=loadApp(),ids=originals.map(l=>l.id),adapter={normalizeGuide:app.normalizeLessonGuide};
const expected={
 'detail-p-release-01':{midis:[60,60,60,60],fingers:[1,1,1,1],hand:'right',duration:.65,fp:'d1eab36d',requires:['course01-01']},
 'detail-p-black-01':{midis:[61,63,61,63],fingers:[2,3,2,3],hand:'right',duration:.85,fp:'e2814691',requires:['course02-08','detail-p-release-03']},
 'detail-p-black-03':{midis:[66,68,70,68,66],fingers:[2,3,4,3,2],hand:'right',duration:.85,fp:'da3754b5',requires:['detail-p-black-01']},
 'detail-p-black-04':{midis:[58,56,54,56,58],fingers:[2,3,4,3,2],hand:'left',duration:.85,fp:'ef39f991',requires:['detail-p-black-02']}
};

test('right release and both black-key groups retain independently specified pitches, hands, rhythm and credit versions',()=>{
 for(const old of originals){const l=app.lessons.find(l=>l.id===old.id),e=expected[l.id];for(const key of ['steps','fingeringSpec','rhythm'])assert.deepEqual(copy(l[key]),old[key]);assert.deepEqual(Array.from(l.steps,s=>app.stepMidiList(s)[0]),e.midis);assert.deepEqual(Array.from(l.fingeringSpec.steps,s=>s[0].num),e.fingers);assert.ok(l.fingeringSpec.steps.every(g=>g.length===1&&g[0].hand===e.hand));assert.ok(l.rhythm.steps.every((s,i)=>s.startBeat===i&&s.durationBeats===e.duration));assert.equal(l.rhythm.bpm,56);assert.equal(A.pianoSignature(l),e.fp);assert.equal(A.pianoSignature(l),A.pianoSignature(old));assert.equal(l.learning.after,old.learning.after);assert.equal(l.learning.articulation,old.learning.articulation);if(old.learning.contentReview)assert.deepEqual(copy(l.learning.contentReview),old.learning.contentReview);}
});

test('compiled black-key preparations use the same hand transitively and preserve display anchors',()=>{
 const ctx={};vm.runInNewContext(fs.readFileSync('curriculum-plan.js','utf8'),ctx);const route=Array.from(ctx.MUSIC_CURRICULUM_PLAN.piano),order=route.map(l=>l.id),byId=new Map(app.lessons.map(l=>[l.id,l]));
 const ancestors=(id,visited=new Set())=>{assert.ok(!visited.has(id),'Cycle at '+id);const path=new Set(visited);path.add(id);return Array.from(byId.get(id).learning.requires||[]).flatMap(p=>[p,...ancestors(p,path)]);};
 for(const id of ids){const l=byId.get(id),entry=route.find(l=>l.id===id);assert.deepEqual(copy(l.learning.requires),expected[id].requires);assert.deepEqual(copy(entry.preparation),expected[id].requires);for(const p of ancestors(id)){assert.ok(order.indexOf(p)<order.indexOf(id));const prep=byId.get(p);assert.ok(prep.fingeringSpec.steps.every(g=>g.every(n=>n.hand===expected[id].hand)),id+' / '+p);}assert.ok(app.lessons.some(candidate=>candidate.id===l.learning.nextLessonId));}
 assert.deepEqual(ancestors('detail-p-black-03'),['detail-p-black-01','course02-08','detail-p-release-03','detail-p-release-01','course01-01']);assert.deepEqual(ancestors('detail-p-black-04'),['detail-p-black-02','course03-08','detail-p-release-04','detail-p-release-02','course01-02']);
 const coverage=Coverage.build();for(const id of ids.slice(1))assert.ok(coverage.domains.find(d=>d.id==='positions').lessonIds.includes(id));
});

test('four exact-source migrations are idempotent and preserve old instructions plus personal editions',()=>{
 for(const original of originals){const l=copy(original);assert.equal(P.reviewRightReleaseAndBlackGroups([l],adapter),1);const revised=copy(l);assert.equal(P.reviewRightReleaseAndBlackGroups([l],adapter),0);assert.deepEqual(copy(l),revised);assert.deepEqual(copy(l.learning.preparationReview.previousInstruction.learning),original.learning);assert.equal(l.learning.preparationReview.previousAssessmentFingerprint,A.pianoSignature(original));
  for(const edit of [x=>x.title='Моя версия',x=>x.description='Мой разбор',x=>x.guide.motion='Моё движение',x=>x.learning.requires=['mine'],x=>x.rhythm.steps[0].durationBeats=.5,x=>x.fingeringSpec.steps[0][0].num=5,x=>x.contentKind='piece',x=>x.learning.contentReview={id:'mine'},x=>x.learning.preparationReview={id:'mine'}]){const x=copy(original);edit(x);const before=copy(x);assert.equal(P.reviewRightReleaseAndBlackGroups([x],adapter),0);assert.deepEqual(copy(x),before);}
 }
});

test('actual MIDI path still requires the correct pitches and the final note release',()=>{
 const clock={now:1000},a=loadApp({events:true,clock});for(const id of ids)for(const mode of ['correct','wrong','early','late']){const l=a.lessons.find(l=>l.id===id),beat=60000/56,take=[];a.setTestLesson(l);a.state.attemptMode='memory';for(const[i,s]of l.rhythm.steps.entries()){const midi=a.stepMidiList(l.steps[i])[0]+(mode==='wrong'&&i===0?1:0);let end=s.startBeat+s.durationBeats;if(i===l.steps.length-1){if(mode==='early')end=s.startBeat+.05;if(mode==='late')end+=.8;}take.push({type:'on',midi,at:1000+s.startBeat*beat},{type:'off',midi,at:1000+end*beat});}take.sort((a,b)=>a.at-b.at||(a.type==='off'?-1:1));for(const[i,e]of take.entries()){clock.now=e.at;if(e.type==='on')a.handleNoteOn(e.midi,'midi');else{if(mode==='correct'&&i===take.length-1)assert.equal(a.state.completed,false);a.handleNoteOff(e.midi);}}assert.equal(a.state.passed,mode==='correct',id+' / '+mode);a.resetLessonState();}
});

test('JSON preserves each review, personal explanation, flat opt-in and unchanged memory credit',()=>{
 const a=loadApp(),snapshot=copy(a.catalogSnapshot());for(const old of originals){const l=app.lessons.find(l=>l.id===old.id);let progress=A.record(undefined,{instrument:'piano',lessonId:l.id,fingerprint:A.pianoSignature(old),mode:'memory',clean:true,now:1000});progress=A.record(progress,{instrument:'piano',lessonId:l.id,fingerprint:A.pianoSignature(l),mode:'challenge',clean:true,now:2000});assert.equal(progress.memory,true);snapshot.lessons.find(candidate=>candidate.id===old.id).learning.practiceSteps[0]='Моя подготовка '+l.id;}a.applyCatalogSnapshot(snapshot);assert.equal(a.installReviewedLessons(),false);for(const id of ids){const l=a.lessons.find(l=>l.id===id);assert.equal(l.learning.practiceSteps[0],'Моя подготовка '+id);assert.ok(l.learning.preparationReview.previousInstruction);assert.equal(l.contentKind,'exercise');}assert.equal(a.lessons.find(l=>l.id==='detail-p-black-04').learning.pitchSpelling,'flat-alias-v1');
});

test('cards name actual preparation, opposite directions and separate ungraded transfer phrases',()=>{
 const a=loadApp({events:true});for(const id of ids){const l=a.lessons.find(l=>l.id===id);a.setTestLesson(l);a.state.attemptMode='practice';a.state.learningMaterialMode='expanded';const html=a.learningMaterialHtml();for(const p of expected[id].requires)assert.ok(html.includes('data-learning-prerequisite="'+p+'"'));if(id==='detail-p-black-01'){assert.match(html,/D♯4–C♯4–C♯4–D♯4/);assert.match(html,/3,85/);}if(id==='detail-p-black-03'){assert.match(html,/G♯4–A♯4–G♯4–F♯4/);assert.match(html,/2–3–4/);assert.match(html,/4,85/);}if(id==='detail-p-black-04'){assert.match(html,/A♭3–G♭3–A♭3–B♭3/);assert.match(html,/Спускайся/);assert.match(html,/2–3–4/);}if(id!=='detail-p-release-01'){assert.match(html,/не текущая MIDI-последовательность/);assert.equal(l.learning.provenance.type,'project-technical-drill');}}
});

test('flat alias helper relates all five black keys with correct MIDI octave boundaries',()=>{
 for(const[m,flat,sharp]of [[61,'D♭4','C#4'],[63,'E♭4','D#4'],[54,'G♭3','F#3'],[56,'A♭3','G#3'],[58,'B♭3','A#3'],[1,'D♭-1','C#-1'],[126,'G♭9','F#9']]){const html=UI.flatNameHtml('flat-alias-v1',[m]);assert.ok(html.includes(flat+' и '+sharp));assert.match(html,/одна клавиша в этом упражнении/);}
});

test('flat alias helper rejects unknown profiles, chords, natural keys and malformed input',()=>{
 for(const input of [null,undefined,[],[54,58],[60],[127],[-1],[128],[NaN],[Infinity],[54.5],['54'],{0:54,length:1}])assert.equal(UI.flatNameHtml('flat-alias-v1',input),'');for(const profile of [undefined,null,'flat','<img src=x onerror=alert(1)>'])assert.equal(UI.flatNameHtml(profile,[54]),'');
});

test('actual current goal shows each left flat alias only when opted in and never in memory',()=>{
 const target={innerHTML:''},a=loadApp({events:true,playback:true,elements:{'current-note-content':target}}),l=a.lessons.find(l=>l.id==='detail-p-black-04');a.setTestLesson(l);a.state.attemptMode='practice';for(const[i,flat,sharp]of [[0,'B♭3','A#3'],[1,'A♭3','G#3'],[2,'G♭3','F#3']]){a.state.stepIndex=i;const html=a.currentNoteHtml();assert.ok(html.includes(flat+' и '+sharp));}for(const mode of ['compact','expanded','hidden']){a.state.learningMaterialMode=mode;a.state.attemptMode='memory';a.changePracticeBpm(40);assert.equal(a.learningMaterialHtml(),'');for(const html of [a.currentNoteHtml(),target.innerHTML])assert.doesNotMatch(html,/flat-name-hint|B♭3|A♭3|G♭3|A#3|G#3|F#3|Аппликатура|Ритм:/);}a.setTestLesson(a.lessons.find(l=>l.id==='detail-p-black-03'));a.state.attemptMode='practice';assert.doesNotMatch(a.currentNoteHtml(),/flat-name-hint/);
});
