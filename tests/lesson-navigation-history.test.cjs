'use strict';
const {assertPreservedThemes}=require('./helpers/assert-preserved-themes.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {loadApp}=require('./helpers/load-app.cjs');
const A='detail-p-eighth-rest-middle-ring-left-g-01',B='detail-p-left-g-position-01',C='detail-p-eighth-rest-ring-middle-right-01';
const uuid='11111111-1111-4111-8111-111111111111',sha=x=>crypto.createHash('sha256').update(x).digest('hex');
// Browser boundary only: these entries model the real History API. Selection,
// boot, prerequisites, attempt cancellation and catalog persistence are shipped code.
function browser(url='https://melodiajest.test/trainer.html?lesson='+A,options={}){
 let index=0;const entries=[{url:new URL(url).href,state:{outside:'preserve me'}}],calls=[],events=new Map(),data=options.data||new Map(),writes=[];
 const location={get href(){return entries[index].url;},get search(){return new URL(this.href).search;},get protocol(){return new URL(this.href).protocol;}};
 const history={get state(){return entries[index].state;},pushState(state,_unused,url){calls.push('push');entries.splice(index+1);entries.push({url:new URL(url,location.href).href,state});index++;},replaceState(state,_unused,url){calls.push('replace');entries[index]={url:new URL(url,location.href).href,state};}};
 const storage={getItem:k=>data.get(k)??null,setItem(k,v){writes.push(k);data.set(k,v);}};
 const focus={count:0,focus(){this.count++;}},prerequisite={dataset:{learningPrerequisite:B}},doc={addEventListener(){},getElementById(){return null;},querySelector:s=>s==='.lesson-name'?focus:null,querySelectorAll:s=>s==='[data-learning-prerequisite]'?[prerequisite]:[]};
 const apiCalls=[],client=options.service?{storage,status:()=>({user:options.personalized?{id:'synthetic-owner'}:null,locked:false}),async init(){},async getObject(key){if(key!=='catalog'||!options.personalized)return{raw:null};const snapshot=app.catalogSnapshot();snapshot.lessons.find(l=>l.id===A).pattern='e e r t u';return{raw:JSON.stringify(snapshot)};},async api(path){apiCalls.push(path);return{data:{entry:{title:'Synthetic test melody',description:'Isolated fixture only',pattern:'t y',timeLimit:20},source:'test fixture'},author:'fixture'};}}:undefined;
 const app=loadApp({appRoot:process.env.NAVIGATION_TEST_ROOT,web:options.web!==false,events:true,location,history:options.noHistory?undefined:history,storage,document:doc,serviceClient:client,onWindowEvent:(name,fn)=>events.set(name,fn),console:{log(){},warn(){},error(){}},timers:{setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){}}});
 const go=delta=>{index+=delta;assert.ok(index>=0&&index<entries.length,'History traversal must stay in the test document');assert.ok(events.has('popstate'),'The actual application must restore popstate');events.get('popstate')({state:history.state});};
 return{app,location,history,entries,calls,events,data,writes,prerequisite,focus,apiCalls,go,boot:()=>app.boot(),setUrl(url){entries[index].url=new URL(url,location.href).href;}};
}

test('boot replaces its initial ordinary entry and preserves unrelated query, hash and history state',async()=>{
 const b=browser('https://melodiajest.test/trainer.html?lesson='+A+'&qa=keep%20value#score');await b.boot();
 assert.deepEqual(b.calls,['replace']);assert.equal(b.entries.length,1);assert.equal(b.app.state.lesson.id,A);assert.equal(new URL(b.location.href).searchParams.get('qa'),'keep value');assert.equal(new URL(b.location.href).hash,'#score');assert.deepEqual(b.history.state,{outside:'preserve me'});
});

test('actual prerequisite control updates the URL and a fresh boot reloads that preparation',async()=>{
 const b=browser();await b.boot();b.app.bindLearningMaterialControls();b.prerequisite.onclick();
 assert.equal(b.app.state.lesson.id,B);assert.equal(new URL(b.location.href).searchParams.get('lesson'),B);assert.equal(b.focus.count,1);assert.deepEqual(b.calls,['replace','push']);
 const reloaded=browser(b.location.href,{data:b.data});await reloaded.boot();assert.equal(reloaded.app.state.lesson.id,B);assert.equal(reloaded.entries.length,1);assert.deepEqual(reloaded.calls,['replace']);
});

test('Back and Forward restore each selected lesson without creating extra entries or grading progress',async()=>{
 const b=browser();await b.boot();b.app.state.learningProgress.synthetic={cleanTakes:2};b.app.selectLesson(B);b.app.selectLesson(C);const count=b.calls.length;
 b.go(-1);assert.equal(b.app.state.lesson.id,B);b.go(-1);assert.equal(b.app.state.lesson.id,A);b.go(1);assert.equal(b.app.state.lesson.id,B);
 assert.equal(b.calls.length,count);assert.equal(b.entries.length,3);assert.equal(b.app.state.learningProgress.synthetic.cleanTakes,2);assert.ok(b.focus.count>=3);
});

test('same selection and unknown IDs do not duplicate history, while within-section filters survive',async()=>{
 const b=browser();await b.boot();b.app.state.lessonFilter='левая';b.app.selectLesson(B);const n=b.calls.length;b.app.selectLesson(B);b.app.selectLesson('missing-lesson');
 assert.equal(new URL(b.location.href).searchParams.get('lesson'),B);assert.equal(b.calls.length,n);assert.equal(b.app.state.lessonFilter,'левая');
});

test('sections and piece Next use their actual catalog boundaries and browser history',async()=>{
 const b=browser();await b.boot();b.app.setContentSection('pieces');assert.equal(new URL(b.location.href).searchParams.get('section'),'pieces');
 b.app.selectLesson('fav-desperado-part-01');b.app.nextLesson();const next=b.app.state.lesson.id;assert.equal(next,'fav-desperado-part-02');assert.equal(new URL(b.location.href).searchParams.get('lesson'),next);
 b.go(-1);assert.equal(b.app.state.lesson.id,'fav-desperado-part-01');assert.equal(b.app.state.contentSection,'pieces');b.go(1);assert.equal(b.app.state.lesson.id,next);
 b.app.setContentSection('learning');assert.equal(b.app.state.lesson.id,A);assert.equal(new URL(b.location.href).searchParams.has('section'),false);b.go(-1);assert.equal(b.app.state.contentSection,'pieces');assert.equal(b.app.state.lesson.id,next);
});

test('history selection clears held notes and the live attempt but preserves independent saved records',async()=>{
 const b=browser();await b.boot();b.app.selectLesson(B);const saved={cleanTakes:2,versions:{old:{cleanTakes:1}}};b.app.state.learningProgress.synthetic=saved;b.app.state.active.add(60);b.app.state.pcPressedByCode.KeyT='t';b.app.state.started=true;b.app.state.attemptEvents=[{type:'on',midi:60,at:1}];b.app.state.errors=2;
 b.go(-1);assert.equal(b.app.state.lesson.id,A);assert.equal(b.app.state.active.size,0);assert.equal(Object.keys(b.app.state.pcPressedByCode).length,0);assert.equal(b.app.state.started,false);assert.equal(b.app.state.attemptEvents.length,0);assert.equal(b.app.state.errors,0);assert.equal(b.app.state.learningProgress.synthetic,saved);assert.equal(b.app.state.soundOn,false);
});

test('challenge and attempt entry parameters remain on entry and are removed only when leaving it',async()=>{
 for(const suffix of ['&challenge=1','&attempt='+uuid]){
  const b=browser('https://melodiajest.test/trainer.html?lesson='+A+suffix+'&qa=keep',{service:true});await b.boot();const initial=b.location.href;assert.equal(b.calls.length,0);
  b.app.selectLesson(B);const q=new URL(b.location.href).searchParams;assert.equal(q.get('lesson'),B);assert.equal(q.has('challenge'),false);assert.equal(q.has('attempt'),false);assert.equal(q.get('qa'),'keep');b.go(-1);assert.equal(b.location.href,initial);assert.equal(b.app.state.lesson.id,A);assert.equal(b.apiCalls.length,0);
 }
});

test('private and published practice entry URLs restore their loaded temporary melody without another request',async()=>{
 for(const key of ['privateMelody','publication']){
  const b=browser('https://melodiajest.test/trainer.html?'+key+'='+uuid,{service:true});await b.boot();const temporary=b.app.state.lesson,initial=b.location.href;assert.match(temporary.id,/^service-/);assert.equal(b.apiCalls.length,1);assert.equal(b.calls.length,0);
  b.app.selectLesson(B);assert.equal(new URL(b.location.href).searchParams.has(key),false);assert.equal(new URL(b.location.href).searchParams.get('lesson'),B);b.go(-1);assert.equal(b.app.state.lesson,temporary);assert.equal(b.location.href,initial);assert.equal(b.apiCalls.length,1);assert.equal(b.app.catalogSnapshot().lessons.some(l=>l.id===temporary.id),false);
 }
});

test('a missing or blocked History API and the local runtime keep lesson selection usable',async()=>{
 for(const options of [{noHistory:true},{web:false},{}]){
  const b=browser(undefined,options);await b.boot();if(!options.noHistory&&options.web!==false){b.history.pushState=()=>{throw Error('Synthetic browser history refusal');};}
  assert.doesNotThrow(()=>b.app.selectLesson(B));assert.equal(b.app.state.lesson.id,B);
 }
 const local=browser(undefined,{web:false});await local.boot();local.app.selectLesson(B);assert.equal(local.calls.length,0);
});

test('invalid popstate and an invalidated account cannot replace the visible selection or pending edits',async()=>{
 const b=browser(undefined,{service:true});await b.boot();b.app.state.lessonFilter='левая';b.app.state.editor={description:'unsaved synthetic editor'};const editor=b.app.state.editor;b.setUrl('?lesson=missing');assert.ok(b.events.has('popstate'));b.events.get('popstate')({state:null});assert.equal(b.app.state.lesson.id,A);assert.equal(b.app.state.editor,editor);
 b.app.selectLesson(B);b.app.handleServiceAccountChange();b.go(-1);assert.equal(b.app.state.lesson.id,B);assert.equal(b.app.state.lessonFilter,'левая');
});

test('history traversal in memory does not create learning hints or a new result',async()=>{
 const b=browser();await b.boot();b.app.selectLesson(B);b.app.state.attemptMode='memory';b.app.state.learningMaterialMode='expanded';b.go(-1);assert.equal(b.app.state.lesson.id,A);assert.equal(b.app.state.attemptMode,'memory');assert.equal(b.app.learningMaterialHtml(),'');assert.doesNotMatch(b.app.sidebarHtml(),/data-lesson=|data-learning-prerequisite/);
});

test('navigation preserves every complete built-in record, canonical server edition, order and musical baseline',()=>{
 const baseline=require('./fixtures/piano-before-navigation-history-v1.json'),b=browser();b.app.selectLesson(A);b.app.selectLesson(B);b.app.setContentSection('pieces');b.app.nextLesson();b.app.setContentSection('learning');
 const cohortIds=new Set(baseline.fullRecords.map(l=>l.id));assert.deepEqual(Array.from(b.app.lessons.filter(l=>cohortIds.has(l.id)),l=>({id:l.id,sha256:sha(JSON.stringify(l))})),baseline.fullRecords);assert.equal(b.app.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);assert.equal(sha(JSON.stringify(assertPreservedThemes(b.app.themes,require('./fixtures/piano-before-c-first-inversion-right-v1.json').themes))),baseline.themesSha256);
 const registry=JSON.parse(fs.readFileSync('service/course-registry.json','utf8'));assert.deepEqual(registry,JSON.parse(JSON.stringify(require('../tools/build-service-curriculum.cjs').build())));assert.equal(registry.sourceVersion,require('../package.json').version);assert.equal(registry.lessons.length,require('./fixtures/piano-curriculum-counts.json').implementedLearningLessons);registry.sourceVersion=baseline.version;
 registry.lessons=registry.lessons.filter(l=>cohortIds.has(l.id));registry.route=registry.route.filter(id=>cohortIds.has(id));assert.equal(registry.lessons.length,464);registry.counts={learning:registry.lessons.length,graded:registry.lessons.filter(l=>l.challengeReady).length,sequential:registry.route.length,practice:registry.lessons.filter(l=>!l.challengeReady).length};registry.contentSha256=require('../service/canonical.cjs').hash({route:registry.route,lessons:registry.lessons});
 assert.equal(sha(JSON.stringify(registry,null,2)+'\n'),baseline.serverRegistrySha256);assert.equal(sha(fs.readFileSync('lesson-review-baseline.js')),baseline.protectedBaselineSha256);
});

test('Back to a challenge restores its original edition while the personal notes remain intact',async()=>{
 const b=browser('https://melodiajest.test/trainer.html?lesson='+A+'&challenge=1',{service:true,personalized:true});await b.boot();
 const original=b.app.state.lesson,personal=b.app.lessons.find(l=>l.id===A),personalBytes=JSON.stringify(personal);assert.notEqual(original,personal);assert.notEqual(original.pattern,personal.pattern);
 b.app.selectLesson(B);assert.equal(new URL(b.location.href).searchParams.has('challenge'),false);b.go(-1);assert.equal(b.app.state.lesson,original);assert.equal(JSON.stringify(personal),personalBytes);assert.equal(b.app.catalogSnapshot().lessons.find(l=>l.id===A).pattern,personal.pattern);
});

test('Back across sections applies the existing filter reset while same-section history keeps search text',async()=>{
 const b=browser();await b.boot();b.app.state.lessonFilter='левая';b.app.selectLesson(B);b.go(-1);assert.equal(b.app.state.lessonFilter,'левая');
 b.app.setContentSection('pieces');assert.equal(b.app.state.lessonFilter,'');b.app.state.lessonFilter='Chopin';b.app.selectLesson('chopin-midi-prep-right');b.go(-1);assert.equal(b.app.state.contentSection,'pieces');assert.equal(b.app.state.lessonFilter,'Chopin');b.go(-1);assert.equal(b.app.state.contentSection,'learning');assert.equal(b.app.state.lesson.id,A);assert.equal(b.app.state.lessonFilter,'');
});
