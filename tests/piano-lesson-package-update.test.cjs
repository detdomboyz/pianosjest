'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Parts=require('../piano-lesson-parts.js'),Update=require('../piano-lesson-package-update.js'),A=require('../practice-assessment.js');
const {loadApp}=require('./helpers/load-app.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
const app=loadApp(),whole=copy(app.catalogSnapshot()),themeId=whole.lessons.find(l=>l.id==='course01-01').themeId;
const small={version:7,themes:whole.themes.filter(t=>t.id===themeId),lessons:whole.lessons.filter(l=>['course01-01','course01-02'].includes(l.id)),savedAt:'old export'};
function bundle(snapshot,version='23.5.40'){return Parts.build(snapshot,{release:version,webManifestSha256:version.endsWith('41')?'a'.repeat(64):'b'.repeat(64),themeIds:[themeId]});}
function input(b){return {pin:{...b.manifest.source,manifestSha256:b.manifestSha256},manifestBytes:b.manifestBytes,files:b.files};}
function setup(){const old=bundle(copy(small)),fresh=copy(small);fresh.lessons[0].description='Новый встроенный разбор';fresh.lessons[1].description='Второй новый разбор';const next=bundle(fresh,'23.5.41'),previous=input(old),incoming=input(next);return {active:previous.pin,previous,incoming,catalog:copy(small)};}

test('release order is numeric and rejects unsupported prereleases, leading zeroes and excessive components',()=>{
 for(const [a,b,n]of [['23.5.9','23.5.40',-1],['23.10.0','23.9.999',1],['23.5.40','23.5.40',0]])assert.equal(Update.compareRelease(a,b),n);
 for(const s of ['23.05.40','23.5.40-beta','23.5','23.5.40.1','1000000.0.0','../23.5.40'])assert.throws(()=>Update.compareRelease(s,'23.5.40'),/release/);
});
test('verified pristine records produce a complete proposal without changing any input',()=>{
 const s=setup(),before=copy(s.catalog),plan=Update.prepare(s);assert.equal(plan.status,'ready');assert.deepEqual(plan.changedLessonIds,['course01-01','course01-02']);assert.deepEqual(s.catalog,before);const out=Update.materialize(plan,s.catalog);assert.equal(out.catalog.lessons[0].description,'Новый встроенный разбор');assert.equal(out.active.release,'23.5.41');assert.equal(out.catalog.savedAt,'old export');assert.deepEqual(s.catalog,before);
});
test('personal array order, lesson placement and extra private records remain exact',()=>{
 const s=setup(),local=s.catalog;local.themes.push({id:'private-theme',name:'Моё',order:100,contentKind:'piece'});local.themes.reverse();local.themes.find(t=>t.id===themeId).order=99;local.lessons.reverse();local.lessons[0].order=500;local.lessons[0].themeId='private-theme';const extra={...copy(local.lessons[1]),id:'private-song',themeId:'private-theme',order:700,contentKind:'piece',description:'Мои ноты'};local.lessons.push(extra);const before=copy(local),plan=Update.prepare(s),out=Update.materialize(plan,local).catalog;assert.equal(plan.status,'ready');assert.deepEqual(out.lessons.map(l=>[l.id,l.order,l.themeId]),before.lessons.map(l=>[l.id,l.order,l.themeId]));assert.deepEqual(out.themes.map(t=>[t.id,t.order]),before.themes.map(t=>[t.id,t.order]));assert.deepEqual(out.lessons.at(-1),extra);assert.ok(plan.placementOverrides.some(p=>p.kind==='lesson'));assert.deepEqual(local,before);
});
test('private edits to music, fingers, descriptions, classification and review history block the entire package',()=>{
 for(const edit of [l=>l.pattern='y y',l=>l.rhythm.steps[0].durationBeats=.5,l=>l.fingeringSpec.steps[0][0].num=3,l=>l.description='Личная',l=>l.guide.motion='Моя кисть',l=>l.learning.goal='Моя цель',l=>l.learning.contentReview={id:'my-review'},l=>l.contentKind='piece',l=>l.extraAnnotation='Личная пометка']){const s=setup();edit(s.catalog.lessons[0]);const before=copy(s.catalog),plan=Update.prepare(s);assert.equal(plan.status,'blocked');assert.deepEqual(plan.conflicts,[{kind:'lesson-edited',id:'course01-01'}]);assert.throws(()=>Update.materialize(plan,s.catalog),/conflict/);assert.deepEqual(s.catalog,before);assert.equal(Object.hasOwn(plan,'candidate'),false);}
});
test('private theme edits and user deletions remain conflicts instead of being recreated',()=>{
 for(const edit of [c=>c.themes[0].name='Моё имя',c=>c.themes[0].contentKind='piece',c=>c.lessons.shift()]){const s=setup();edit(s.catalog);const before=copy(s.catalog),plan=Update.prepare(s);assert.equal(plan.status,'blocked');assert.equal(plan.conflicts.length,1);assert.throws(()=>Update.materialize(plan,s.catalog),/conflict/);assert.deepEqual(s.catalog,before);}
});
test('bad bytes, missing parts, false source pins and mismatched installed identity cannot prepare any candidate',()=>{
 for(const edit of [s=>s.incoming.pin.manifestSha256='0'.repeat(64),s=>s.incoming.pin.webManifestSha256='0'.repeat(64),s=>s.incoming.files=new Map(),s=>s.active={...s.active,manifestSha256:'0'.repeat(64)},s=>{const d=s.incoming.files.keys().next().value,raw=Buffer.from(s.incoming.files.get(d));raw[30]^=1;s.incoming.files=new Map([[d,raw]]);}]){const s=setup(),before=copy(s.catalog);edit(s);assert.throws(()=>Update.prepare(s));assert.deepEqual(s.catalog,before);}
});
test('downgrades, same-release equivocation and inventory changes fail even if all new bytes are correctly rehashed',()=>{
 for(const make of [()=>bundle(copy(small),'23.5.9'),()=>{const c=copy(small);c.lessons[0].description='другая';return bundle(c,'23.5.40');},()=>{const c=copy(small);c.lessons.pop();return bundle(c,'23.5.41');},()=>{const c=copy(small);c.lessons.push({...copy(c.lessons[0]),id:'new-id',order:999});return bundle(c,'23.5.41');}]){const s=setup();s.incoming=input(make());assert.throws(()=>Update.prepare(s),/downgrade|same release|inventory change/);}
});
test('same pinned package is a no-op and already incoming content is safe to retain',()=>{
 const s=setup();s.incoming=s.previous;s.catalog.lessons[0].description='Личная';const plan=Update.prepare(s);assert.equal(plan.status,'unchanged');assert.deepEqual(Update.materialize(plan,s.catalog).catalog,s.catalog);
 const updated=setup();updated.catalog.lessons=copy(Parts.assemble(Parts.readManifest(updated.incoming.manifestBytes,updated.incoming.pin.manifestSha256),updated.incoming.files).lessons);const p=Update.prepare(updated);assert.equal(p.status,'ready');assert.deepEqual(p.changedLessonIds,[]);
});
test('a changed local catalog invalidates a prepared proposal; savedAt alone does not',()=>{
 for(const edit of [c=>c.lessons[1].description='later edit',c=>c.lessons.reverse(),c=>c.lessons[0].order=77,c=>c.themes[0].name='later theme']){const s=setup(),p=Update.prepare(s);edit(s.catalog);assert.throws(()=>Update.materialize(p,s.catalog),/changed; prepare again/);}
 const s=setup(),p=Update.prepare(s);s.catalog.savedAt='new export time';assert.equal(Update.materialize(p,s.catalog).catalog.savedAt,'new export time');
});
test('proposals are opaque and frozen, while materialized results cannot mutate a later materialization',()=>{
 const s=setup(),p=Update.prepare(s);assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.changedLessonIds)&&Object.isFrozen(p.from));assert.throws(()=>p.changedLessonIds.push('fake'),TypeError);assert.throws(()=>Update.materialize(copy(p),s.catalog),/unknown/);const one=Update.materialize(p,s.catalog);one.catalog.lessons[0].description='tamper output';one.active.release='0.0.0';const two=Update.materialize(p,s.catalog);assert.equal(two.catalog.lessons[0].description,'Новый встроенный разбор');assert.equal(two.active.release,'23.5.41');
});
test('non-JSON input, accessors, root progress, duplicate IDs and bounded strings are rejected without invoking getters',()=>{
 for(const edit of [c=>c.progress={},c=>c.lessons.push(copy(c.lessons[0])),c=>c.lessons[0].order=0,c=>c.lessons[0].hidden=Infinity,c=>c.lessons[0].hidden=()=>{},c=>c.lessons[0].hidden=c,c=>c.lessons[0].hidden='x'.repeat(Update.MAX_STRING_BYTES+1)]){const s=setup();edit(s.catalog);assert.throws(()=>Update.prepare(s));}
 const s=setup();let calls=0;Object.defineProperty(s.catalog.lessons[0],'description',{get(){calls++;return 'executed';},enumerable:true});assert.throws(()=>Update.prepare(s),/accessor/);assert.equal(calls,0);
});
test('the real serialized 572-record catalog applies an instruction-only update without changing music or progress',()=>{
 const original=copy(whole),next=copy(whole);next.lessons.find(l=>l.id==='course01-01').description='Проверенная новая инструкция';const previous=input(bundle(original)),incoming=input(bundle(next,'23.5.41'));
 const raw=JSON.stringify({'course01-01':A.record(undefined,{instrument:'piano',lessonId:'course01-01',fingerprint:'5df64aea',mode:'memory',clean:true,now:1000})}),writes=[],actual=loadApp({storage:{getItem:k=>k==='music-learning-piano-v1'?raw:null,setItem:(...args)=>writes.push(args)}});actual.loadLearningProgress();const plan=Update.prepare({active:previous.pin,previous,incoming,catalog:original}),result=Update.materialize(plan,original);assert.equal(actual.applyCatalogSnapshot(result.catalog),true);assert.equal(writes.length,0);assert.equal(JSON.stringify(actual.state.learningProgress),raw);assert.deepEqual(original,whole);
 for(const old of app.lessons){const fresh=actual.lessons.find(l=>l.id===old.id);assert.equal(A.pianoSignature(fresh),A.pianoSignature(old));assert.deepEqual(copy({steps:fresh.steps,rhythm:fresh.rhythm,fingeringSpec:fresh.fingeringSpec}),copy({steps:old.steps,rhythm:old.rhythm,fingeringSpec:old.fingeringSpec}));assert.equal(fresh.order,old.order);}
 assert.deepEqual(copy(actual.lessons.find(l=>l.id==='course01-01').learning.contentReview),copy(app.lessons.find(l=>l.id==='course01-01').learning.contentReview));
});
test('a genuinely changed musical edition gets a new runtime grade and keeps old memory in history',()=>{
 const s=setup(),changed=copy(small);changed.lessons[0].rhythm.steps[0].durationBeats=.5;s.incoming=input(bundle(changed,'23.5.41'));const p=Update.prepare(s),out=Update.materialize(p,s.catalog),actual=loadApp();assert.equal(actual.applyCatalogSnapshot(out.catalog),true);const oldGrade=A.pianoSignature(app.lessons.find(l=>l.id==='course01-01')),newGrade=A.pianoSignature(actual.lessons.find(l=>l.id==='course01-01'));assert.notEqual(newGrade,oldGrade);
 const remembered=A.record(undefined,{instrument:'piano',lessonId:'course01-01',fingerprint:oldGrade,mode:'memory',clean:true,now:1000}),before=copy(remembered),newAttempt=A.record(remembered,{instrument:'piano',lessonId:'course01-01',fingerprint:newGrade,mode:'practice',clean:false,now:2000});assert.equal(newAttempt.memory,false);assert.equal(newAttempt.ready,false);assert.equal(newAttempt.fingerprint,newGrade);assert.ok(Object.values(newAttempt.history).some(v=>v.fingerprint===oldGrade&&v.memory));assert.deepEqual(remembered,before);
});
test('verified bytes are captured before later buffer changes; excessive depth and root progress remain rejected',()=>{
 const s=setup(),p=Update.prepare(s);for(const raw of s.incoming.files.values())raw.fill(0);assert.equal(Update.materialize(p,s.catalog).catalog.lessons[0].description,'Новый встроенный разбор');
 const deep=setup();let v=deep.catalog.lessons[0];for(let i=0;i<Update.MAX_DEPTH+2;i++){v.extra={};v=v.extra;}assert.throws(()=>Update.prepare(deep),/depth/);
 assert.ok(!require('../tools/build-web.cjs').ASSETS.includes('piano-lesson-package-update.js'));
});
