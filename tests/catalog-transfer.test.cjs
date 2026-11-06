'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const Transfer=require('../catalog-transfer.js');const {loadApp}=require('./helpers/load-app.cjs');
const A=require('../practice-assessment.js');
const Catalog=require('../catalog-sections.js');
function setup(fail=false){const data=new Map([['piano-blind-trainer-learning-v1','progress unchanged'],['piano-blind-trainer-ui-v20','{"learningMaterialMode":"hidden"}']]);const storage={getItem:k=>data.get(k)??null,setItem(k,v){if(fail)throw Error('Storage full');data.set(k,v);}};return {app:loadApp({web:true,events:true,storage}),data};}

test('catalog JSON roundtrip keeps every note, timing, hand, content kind and lesson order',async()=>{
  const {app,data}=setup();const values=()=>Array.from(app.lessons,l=>({id:l.id,music:A.pianoSignature(l),kind:Catalog.sectionOf('piano',l,app.themes),learning:JSON.stringify(l.learning??null)}));const before=values();
  const text=app.catalogExportText();const copy=Transfer.read(text);assert.equal(copy.lessons.length,before.length);
  assert.equal(await app.importCatalogText(text,()=>true),true);
  assert.deepEqual(values(),before);
  assert.equal(data.get('piano-blind-trainer-learning-v1'),'progress unchanged');
  assert.equal(data.get('piano-blind-trainer-ui-v20'),'{"learningMaterialMode":"hidden"}');
});

test('JSON transfer rejects corrupt IDs, absent themes and executable size metadata before applying',()=>{
  const {app}=setup();const original=JSON.parse(app.catalogExportText());
  for(const mutate of [d=>d.lessons[1].id=d.lessons[0].id,d=>d.lessons[0].themeId='missing',d=>d.version=99,d=>d.lessons[0].learning.timeSignature={numerator:'<img onerror=alert(1)>',denominator:4}]){
    const copy=structuredClone(original);mutate(copy);assert.throws(()=>Transfer.read(JSON.stringify(copy)));
  }
  assert.throws(()=>Transfer.read('{bad json'),/JSON/);
});

test('cancelled or invalid import leaves current catalog and storage untouched',async()=>{
  const {app,data}=setup();const before=JSON.stringify(app.catalogSnapshot().lessons),saved=[...data.entries()];
  assert.equal(await app.importCatalogText(app.catalogExportText(),()=>false),false);
  assert.equal(await app.importCatalogText('{}',()=>true),false);
  assert.equal(JSON.stringify(app.catalogSnapshot().lessons),before);assert.deepEqual([...data.entries()],saved);
});

test('storage failure rolls the in-memory catalog back without overwriting user data',async()=>{
  const {app,data}=setup(true);const copy=JSON.parse(app.catalogExportText());const originalTitle=app.lessons[0].title;
  copy.lessons[0].title='should not remain';assert.equal(await app.importCatalogText(JSON.stringify(copy),()=>true),false);
  assert.equal(app.lessons[0].title,originalTitle);assert.match(app.state.message,/Импорт не выполнен/);
  assert.equal(data.size,2);
});

test('legacy null hand mode cannot silently remove MIDI eligibility after reloading a catalog',async()=>{
  const {app}=setup();app.state.lesson=app.lessons.find(l=>l.id==='course01-01');
  assert.equal(app.challengeEligible(),true);const fingerprint=A.pianoSignature(app.state.lesson);
  const copy=JSON.parse(app.catalogExportText());copy.lessons.find(l=>l.id==='course01-01').handMode=null;
  assert.equal(await app.importCatalogText(JSON.stringify(copy),()=>true),true);
  assert.equal(A.pianoSignature(app.state.lesson),fingerprint);
  assert.equal(app.challengeEligible(),true);
});
