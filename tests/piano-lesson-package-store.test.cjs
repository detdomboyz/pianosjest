'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Store=require('../piano-lesson-package-store.js'),Parts=require('../piano-lesson-parts.js'),Update=require('../piano-lesson-package-update.js'),Assessment=require('../practice-assessment.js');
const {loadApp}=require('./helpers/load-app.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
const pin={release:'23.5.42',manifestSha256:'a'.repeat(64),webManifestSha256:'b'.repeat(64)};
function candidate(){return {active:copy(pin),catalog:{version:7,themes:[{id:'t',name:'Моя тема',order:7}],lessons:[{id:'l',themeId:'t',order:9,pattern:'t y',contentKind:'exercise',privateAnnotation:{note:'Моя запись'}}],savedAt:'export'}};}
test('candidate validation preserves exact private music, arbitrary annotations and placement without aliasing',()=>{
 const c=candidate();c.catalog.lessons[0].rhythm={bpm:56,steps:[{startBeat:0,durationBeats:1},{startBeat:2,durationBeats:1}]};const before=copy(c),out=Store.validateCandidate(c);assert.deepEqual(out,before);out.catalog.lessons[0].privateAnnotation.note='tampered';assert.deepEqual(c,before);
});
test('root progress/settings, duplicate IDs, unknown themes and malformed catalog/source are rejected',()=>{
 for(const edit of [c=>c.progress={},c=>c.catalog.progress={},c=>c.catalog.lessons.push(copy(c.catalog.lessons[0])),c=>c.catalog.lessons[0].themeId='missing',c=>c.catalog.themes[0].order=0,c=>c.active.release='23.05.42',c=>c.active.manifestSha256='x',c=>c.active.key='secret']){const c=candidate();edit(c);assert.throws(()=>Store.validateCandidate(c),e=>['INPUT','SOURCE'].includes(e.code));}
});
test('functions, sparse arrays, cycles, non-finite values and accessors cannot silently become saved JSON',()=>{
 for(const bad of [Infinity,()=>{},new Date(),new Map(),Symbol('bad')]){const c=candidate();c.catalog.lessons[0].extra=bad;assert.throws(()=>Store.validateCandidate(c));}
 const sparse=candidate();sparse.catalog.lessons.length=3;assert.throws(()=>Store.validateCandidate(sparse));
 const cycle=candidate();cycle.catalog.lessons[0].cycle=cycle;assert.throws(()=>Store.validateCandidate(cycle));
 const accessor=candidate();let calls=0;Object.defineProperty(accessor.catalog.lessons[0],'description',{get(){calls++;return 'private';}});assert.throws(()=>Store.validateCandidate(accessor));assert.equal(calls,0);
});
test('UTF-8 string, tree-depth and whole-catalog limits reject instead of truncating material',()=>{
 const big=candidate();big.catalog.lessons[0].extra='я'.repeat(Store.MAX_STRING_BYTES/2);assert.throws(()=>Store.validateCandidate(big),{code:'LIMIT'});
 const deep=candidate();let at=deep.catalog.lessons[0];for(let i=0;i<Store.MAX_DEPTH+2;i++)at=at.next={};assert.throws(()=>Store.validateCandidate(deep),{code:'LIMIT'});
 const total=candidate();total.catalog.lessons[0].extra=Array.from({length:40},()=> 'x'.repeat(900000));assert.throws(()=>Store.validateCandidate(total),{code:'LIMIT'});
});
test('undefined serialized members and special JSON object keys preserve v7 semantics without prototype mutation',()=>{
 const c=candidate();c.catalog.lessons[0].optional=undefined;c.catalog.lessons[0].metadata=JSON.parse('{"__proto__":{"polluted":true},"constructor":"private"}');const out=Store.validateCandidate(c);assert.equal(Object.hasOwn(out.catalog.lessons[0],'optional'),false);assert.equal(Object.getPrototypeOf(out.catalog.lessons[0].metadata),Object.prototype);assert.equal(out.catalog.lessons[0].metadata.__proto__.polluted,true);assert.equal({}.polluted,undefined);
});
test('the real offline verified planner supplies the complete musical corpus to the storage boundary',()=>{
 const app=loadApp(),original=copy(app.catalogSnapshot()),next=copy(original),themeId=original.lessons.find(l=>l.id==='course01-06').themeId;next.lessons.find(l=>l.id==='course01-06').description+=' Проверка границы хранения.';
 const input=(c,r,h)=>{const b=Parts.build(c,{release:r,webManifestSha256:h.repeat(64),themeIds:[themeId]});return {pin:{...b.manifest.source,manifestSha256:b.manifestSha256},manifestBytes:b.manifestBytes,files:b.files};};
 const previous=input(original,'23.5.42','a'),incoming=input(next,'23.5.43','b'),plan=Update.prepare({active:previous.pin,previous,incoming,catalog:original});assert.equal(plan.status,'ready');const materialized=Update.materialize(plan,original),saved=Store.validateCandidate(materialized);assert.deepEqual(saved,materialized);const freshSnapshot=copy(app.catalogSnapshot());freshSnapshot.savedAt=original.savedAt;const hash=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');assert.equal(hash(original),hash(freshSnapshot));const actual=loadApp();assert.equal(actual.applyCatalogSnapshot(saved.catalog),true);assert.equal(actual.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);
 for(const old of app.lessons)assert.equal(Assessment.pianoSignature(actual.lessons.find(l=>l.id===old.id)),Assessment.pianoSignature(old));
});
test('the browser module evaluates without Node, filesystem, network, storage or database access at import time',()=>{
 const reads=[];const sandbox={window:{},TextEncoder};Object.defineProperty(sandbox,'indexedDB',{get(){reads.push('indexedDB');throw Error('unexpected')}});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../piano-lesson-package-store.js'),'utf8'),sandbox);assert.equal(typeof sandbox.window.PianoLessonPackageStore.create,'function');assert.deepEqual(reads,[]);
 assert.equal(require('../tools/build-web.cjs').ASSETS.includes('piano-lesson-package-store.js'),false);
});
test('creation does not open the database, rejects foreign names and fails explicit closed/forged operations',async()=>{
 let opens=0;const indexedDB={open(){opens++;throw Error('denied')}};assert.throws(()=>Store.create({indexedDB,name:'foreign-user-database'}),{code:'INPUT'});const s=Store.create({indexedDB,id:()=> 'operation-1'});assert.equal(opens,0);assert.throws(()=>s.prepare({},candidate()),{code:'PLAN'});await assert.rejects(s.commit({}),{code:'PLAN'});assert.equal(opens,0);await assert.rejects(s.read(),{code:'UNAVAILABLE'});assert.equal(opens,1);s.close();await assert.rejects(s.read(),{code:'CLOSED'});assert.throws(()=>s.prepare(null,candidate()),{code:'CLOSED'});
});
test('pending staging and recovery stay lazy, reject forged tokens and preserve explicit storage failures',async()=>{
 let opens=0;const s=Store.create({indexedDB:{open(){opens++;throw Error('denied');}}});
 await assert.rejects(s.stage({}),{code:'PLAN'});assert.equal(opens,0);
 await assert.rejects(s.recoverPending(),{code:'UNAVAILABLE'});assert.equal(opens,1);
 const input=candidate(),plan=s.prepare(null,input);input.catalog.lessons[0].pattern='private late edit';
 await assert.rejects(s.stage(copy(plan)),{code:'PLAN'});assert.equal(opens,1);
 s.close();await assert.rejects(s.stage(plan),{code:'CLOSED'});await assert.rejects(s.recoverPending(),{code:'CLOSED'});
});
