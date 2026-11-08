'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const Reader=require('../piano-legacy-v7-adapter.js'),Loader=require('../piano-lesson-package-loader.js'),Controller=require('../piano-lesson-package-controller.js'),Legacy=require('../piano-legacy-catalog-copy.js'),Store=require('../piano-lesson-package-store.js'),Transfer=require('../catalog-transfer.js'),A=require('../practice-assessment.js'),{loadApp}=require('./helpers/load-app.cjs');
const data=require('../tools/qa-piano-package-planner.cjs').buildFixture(),copy=x=>JSON.parse(JSON.stringify(x)),catalog=copy(data.fixture.initial.catalog),raw=JSON.stringify(catalog),client=Loader.create({baseUrl:'https://reader.invalid/old/',origin:'https://reader.invalid',subtle:webcrypto.subtle,fetch:async url=>{const bytes=data.files.get(new URL(url).pathname.slice(1));assert.ok(bytes);return new Response(bytes,{headers:{'Content-Type':'application/json'}});}}),sourcePromise=client.load({pin:data.fixture.previous});
const reason=(code,r)=>e=>e.name==='LegacyV7AdapterError'&&e.code===code&&(!r||e.reason===r);

test('reader import and creation have no storage, network, device or global application access',async()=>{
 const source=await sourcePromise,access=[],context={window:{CatalogTransfer:Transfer,PianoLessonPackageStore:Store,PianoLessonPackageLoader:Loader},TextEncoder};for(const key of['indexedDB','localStorage','fetch','navigator'])Object.defineProperty(context,key,{get(){access.push(key);throw Error('Unexpected I/O');}});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../piano-legacy-v7-adapter.js'),'utf8'),context);const decode=context.window.PianoLegacyV7Adapter.create({source});assert.equal(typeof decode,'function');assert.deepEqual(access,[]);assert.throws(()=>Reader.create({source:copy(source)}),reason('INPUT','verified-source'));assert.equal(require('../tools/build-web.cjs').ASSETS.includes('piano-legacy-v7-adapter.js'),false);
});

test('real app v7 export round-trips every current theme, record and assessment edition without normalization by the reader',async()=>{
 const source=await sourcePromise,app=loadApp(),before=JSON.parse(JSON.stringify(app.catalogSnapshot())),grades=Object.fromEntries(app.lessons.map(l=>[l.id,A.pianoSignature(l)])),text=JSON.stringify(before),decoded=Reader.create({source})(text);assert.equal(before.themes.length,require('./fixtures/piano-curriculum-counts.json').themes);assert.equal(before.lessons.length,require('./fixtures/piano-curriculum-counts.json').catalogRecords);assert.ok(Buffer.byteLength(text)>5*1024*1024);assert.deepEqual(decoded,before);assert.equal(app.applyCatalogSnapshot(decoded),true);for(const lesson of app.lessons)assert.equal(A.pianoSignature(lesson),grades[lesson.id],lesson.id);const restored=copy(app.catalogSnapshot());delete restored.savedAt;const expected=copy(before);delete expected.savedAt;assert.deepEqual(restored,expected);
});

test('private edits, opaque versions, notes, fingers, order, annotation and piece classification survive unchanged',async()=>{
 const source=await sourcePromise,c=copy(catalog);c.lessons.reverse();c.lessons[0]={...c.lessons[0],order:91,contentKind:'piece',privateAnnotations:{text:'private reader test 🎹\ud800\u0000',version:99,notes:[{pitch:60,start:0,duration:.25}],fingers:[{hand:'left',num:5}]},savedEditions:[{version:'private-music-2',pattern:'t y',createdAt:'2026-11-07'}]};c.themes[0].privateAnnotation='theme field';const decode=Reader.create({source}),one=decode(JSON.stringify(c)),two=decode(JSON.stringify(c));assert.deepEqual(one,c);one.lessons[0].privateAnnotations.text='late caller mutation';assert.deepEqual(two,c);assert.equal(c.lessons[0].privateAnnotations.text,'private reader test 🎹\ud800\u0000');
});

test('duplicate properties at the root, in a lesson and in nested private values stop instead of selecting the last value',async()=>{
 const decode=Reader.create({source:await sourcePromise});const variants=[raw.replace('"version":7','"version":8,"version":7'),raw.replace('"version":7','"version":7,"version":7'),raw.replace('"lessons":[{','"lessons":[{"private":{"x":1,"x":2},'),raw.replace('"lessons":[{','"lessons":[{"private":{"title":1,"\\u0074itle":2},')];for(const text of variants)assert.throws(()=>decode(text),reason('SCHEMA','duplicate-property'));
});

test('braces, escapes, apparent duplicate text inside values and repeated names in separate objects remain ordinary data',async()=>{
 const c=copy(catalog);c.lessons[0].privateData={text:'{"x":1,"x":2}, \\" 😀',objects:[{same:1},{same:2}],different:{'é':1,'e\u0301':2},__safe__:true};Object.defineProperty(c.lessons[0].privateData,'__proto__',{value:{qa:true},enumerable:true});const text=JSON.stringify(c),out=Reader.create({source:await sourcePromise})(text);assert.deepEqual(out,c);assert.equal(Object.prototype.qa,undefined);assert.equal(Object.hasOwn(out.lessons[0].privateData,'__proto__'),true);
});

test('missing, broken, old and future sources never seed a default catalog or expose their private text',async()=>{
 const decode=Reader.create({source:await sourcePromise});assert.throws(()=>decode(null),reason('EMPTY','missing-source'));for(const text of['','  broken private-provider-text',JSON.stringify({...catalog,version:1}),JSON.stringify({...catalog,version:8}),JSON.stringify({...catalog,version:'7'})])assert.throws(()=>decode(text),e=>e.code==='SCHEMA'&&!e.message.includes('private-provider-text'));assert.throws(()=>decode({version:7}),reason('INPUT','raw-type'));
});

test('duplicate IDs, missing themes, invalid order and unknown envelope fields fail without silently discarding fields',async()=>{
 const decode=Reader.create({source:await sourcePromise});for(const edit of[c=>c.lessons.push(copy(c.lessons[0])),c=>c.lessons[0].themeId='missing',c=>c.themes[0].order=0,c=>c.lessons[0].order=1.2,c=>c.lessons[0].contentKind='future-kind',c=>c.futureEnvelope={version:8}]){const c=copy(catalog);edit(c);const text=JSON.stringify(c);assert.throws(()=>decode(text),reason('SCHEMA'));assert.equal(JSON.stringify(c),text);}
});

test('unsafe integer, overflow, underflow and negative-zero tokens are refused while current finite musical fractions survive',async()=>{
 const decode=Reader.create({source:await sourcePromise});for(const token of['9007199254740993','1e9999','1e-9999','-0','-1e-9999']){const text=raw.replace('"lessons":[{','"lessons":[{"privateNumber":'+token+',');assert.throws(()=>decode(text),e=>e.code==='SCHEMA'&&/numeric/.test(e.reason));}const c=copy(catalog);c.lessons[0].privateNumbers=[.5,.85,1/3,1794668871000,0];assert.deepEqual(decode(JSON.stringify(c)),c);
});

test('source bytes, private-string and depth limits stop without truncation',async()=>{
 const decode=Reader.create({source:await sourcePromise});assert.throws(()=>decode(' '.repeat(Reader.MAX_BYTES+1)),reason('LIMIT','source-bytes'));const large=copy(catalog);large.lessons[0].privateText='a'.repeat(Store.MAX_STRING_BYTES+1);assert.throws(()=>decode(JSON.stringify(large)),reason('LIMIT'));const deep=copy(catalog);let value=0;for(let i=0;i<81;i++)value={next:value};deep.lessons[0].privateDeep=value;assert.throws(()=>decode(JSON.stringify(deep)),reason('LIMIT','depth'));
});

test('the real reader joins the controller only after original copy/readback and cannot activate a catalog',async()=>{
 const source=await sourcePromise,original=raw,events=[];let copied;const storage={getItem:key=>{assert.equal(key,Legacy.KEY);return original;}},copies={prepareFrom:async s=>{copied=s.getItem(Legacy.KEY);events.push('capture');return {id:'a'.repeat(64)};},commit:async()=>{events.push('complete');},read:async id=>{events.push('readback');return {id,key:Legacy.KEY,raw:copied};}},store={read:async()=>null,prepare(){throw Error('Unexpected activation');},stage(){throw Error('Unexpected activation');},commit(){throw Error('Unexpected activation');},recoverPending:async()=>null,exportRecovery:async()=>'',close(){}};const controller=Controller.create({store,legacyCopies:copies,subtle:webcrypto.subtle}),plan=await controller.prepareLegacyV7({source,storage,}),out=JSON.parse(await controller.exportLegacyPreparation(plan));assert.deepEqual(events,['capture','complete','readback']);assert.deepEqual(out.candidate.catalog,catalog);assert.equal(out.activationPerformed,false);assert.equal(controller.status().phase,'legacy-prepared');assert.equal(controller.status().confirmedRevision,null);assert.equal(copied,original);controller.close();
});
