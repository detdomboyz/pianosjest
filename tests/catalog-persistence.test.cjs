'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {loadApp}=require('./helpers/load-app.cjs');
const KEY='piano-blind-trainer-catalog-v1';

function setup({web=true,fail=false,readback=false,fetch}={}){
  const data=new Map(),handlers=new Map(),writes=[];let reject=fail,mismatch=readback;
  const storage={getItem(key){return mismatch&&key===KEY&&data.has(key)?'other bytes':data.get(key)??null;},setItem(key,value){if(key===KEY)writes.push(value);if(reject&&key===KEY)throw Error('Synthetic quota failure');data.set(key,value);}};
  const app=loadApp({web,events:true,storage,fetch,onWindowEvent:(name,handler)=>handlers.set(name,handler)});
  return {app,data,handlers,writes,setFail:value=>{reject=value;},setMismatch:value=>{mismatch=value;}};
}
function unload(handlers){const event={prevented:false,preventDefault(){this.prevented=true;}};handlers.get('beforeunload')(event);return event;}

test('failed catalog save keeps the edited music exportable and guards page close',async()=>{
  const {app,data,handlers}=setup({fail:true});
  app.lessons[0].description='Synthetic unsaved private edition';
  await app.saveCatalog();
  assert.equal(JSON.parse(app.catalogExportText()).lessons[0].description,'Synthetic unsaved private edition');
  assert.equal(data.has(KEY),false);
  assert.equal(unload(handlers).prevented,true,'unsaved catalog must participate in the real beforeunload handler');
});

test('local file and browser failure cannot claim a successful browser save',async()=>{
  const {app,handlers}=setup({web:false,fail:true,fetch:async()=>({ok:false,status:503,json:async()=>({error:'Synthetic unavailable file'})})});
  await app.saveCatalog();
  assert.match(app.state.contentStatus,/Сохранение недоступно/);
  assert.equal(unload(handlers).prevented,true);
});

test('catalog save verifies readback rather than accepting a silent storage failure',async()=>{
  const {app,handlers}=setup({readback:true});
  app.lessons[0].description='Keep this unconfirmed edition';
  await app.saveCatalog();
  assert.match(app.state.contentStatus,/Сохранение недоступно|не подтверждено/);
  assert.equal(unload(handlers).prevented,true);
  assert.match(app.catalogExportText(),/Keep this unconfirmed edition/);
});

test('a no-op setItem mock is an unconfirmed write and cannot acknowledge an import',async()=>{
  const app=loadApp({web:true,events:true,storage:{getItem:()=>null,setItem(){}}});
  const incoming=app.catalogExportText();
  assert.equal(await app.importCatalogText(incoming,()=>true),false);
  assert.equal(app.catalogSaveSnapshot().pending,true);
  assert.equal(app.catalogSaveSnapshot().browserCode,'SAVE_NOT_CONFIRMED');
});

test('retry writes the exact failed candidate and clears the unload guard only on confirmation',async()=>{
  const {app,data,handlers,writes,setFail}=setup({fail:true});
  app.lessons[0].description='Synthetic retry edition';await app.saveCatalog();
  const candidate=writes[0];assert.equal(app.catalogSaveSnapshot().pending,true);
  app.catalogExportText();assert.equal(unload(handlers).prevented,true,'export text is not proof of durable storage');
  setFail(false);const result=await app.retryCatalogSave();
  assert.equal(result.status,'saved');assert.equal(writes[1],candidate);assert.equal(data.get(KEY),candidate);
  assert.equal(app.catalogSaveSnapshot().pending,false);assert.equal(unload(handlers).prevented,false);
});

test('a newer complete edition supersedes a failed save; retry cannot restore the older one',async()=>{
  const {app,data,writes,setFail}=setup();
  await app.saveCatalog();const confirmed=data.get(KEY);setFail(true);
  app.lessons[0].description='older unsaved edition';await app.saveCatalog();
  app.lessons[0].description='latest unsaved edition';await app.saveCatalog();
  assert.equal(data.get(KEY),confirmed);const latest=writes.at(-1);
  setFail(false);await app.retryCatalogSave();
  assert.equal(data.get(KEY),latest);assert.match(data.get(KEY),/latest unsaved edition/);
});

test('a file-only confirmed save is labeled accurately when browser storage is unavailable',async()=>{
  let raw=null;
  const fetch=async(_url,options)=>options.method==='PUT'?(raw=options.body,{ok:true}):({ok:true,json:async()=>({catalog:JSON.parse(raw)})});
  const {app,handlers}=setup({web:false,fail:true,fetch});
  await app.saveCatalog();assert.match(app.state.contentStatus,/Сохранено в trainer-content.json/);
  assert.match(app.state.contentStatus,/копия браузера недоступна/);
  assert.equal(app.catalogSaveSnapshot().fileSaved,true);assert.equal(unload(handlers).prevented,false);
});

test('a real browser-only success stays durable when the local file endpoint fails',async()=>{
  const {app,handlers}=setup({web:false,fetch:async()=>({ok:false,status:404})});
  await app.saveCatalog();assert.match(app.state.contentStatus,/Сохранено только в браузере/);
  assert.equal(app.catalogSaveSnapshot().browserSaved,true);assert.equal(app.catalogSaveSnapshot().pending,false);
  assert.equal(unload(handlers).prevented,true,'local startup prefers its file; preserve the warning until that file is confirmed');
});

test('an HTTP success without matching file readback does not confirm a file-only save',async()=>{
  const {app,handlers}=setup({web:false,fail:true,fetch:async(_url,options)=>options.method==='PUT'?{ok:true}:{ok:true,json:async()=>({catalog:{version:7,themes:[],lessons:[]}})}});
  await app.saveCatalog();assert.equal(app.catalogSaveSnapshot().fileSaved,false);
  assert.equal(unload(handlers).prevented,true);assert.match(app.state.contentStatus,/Сохранение недоступно/);
});

test('local file PUT and readback are serialized and stale completion cannot clear a newer pending edition',async()=>{
  const puts=[];let fileRaw=null,active=0,maxActive=0;
  const fetch=async(_url,options)=>{
    if(options.method==='PUT')return new Promise(resolve=>{active++;maxActive=Math.max(maxActive,active);puts.push({raw:options.body,complete(ok=true){active--;if(ok)fileRaw=options.body;resolve({ok});}});});
    return {ok:true,json:async()=>({catalog:JSON.parse(fileRaw)})};
  };
  const {app,data,handlers}=setup({web:false,fail:true,fetch});
  app.lessons[0].description='first immutable candidate';const first=app.saveCatalog();
  app.lessons[0].description='second immutable candidate';const second=app.saveCatalog();
  await new Promise(setImmediate);assert.equal(puts.length,1);assert.equal(maxActive,1);
  assert.equal(JSON.parse(puts[0].raw).lessons[0].description,'first immutable candidate');
  puts[0].complete();await first;await new Promise(setImmediate);
  assert.equal(puts.length,2);assert.equal(unload(handlers).prevented,true,'older file success cannot confirm the newer complete catalog');
  assert.equal(JSON.parse(puts[1].raw).lessons[0].description,'second immutable candidate');
  puts[1].complete(false);await second;
  assert.equal(data.has(KEY),false);assert.equal(unload(handlers).prevented,true);
  assert.match(app.state.contentStatus,/Сохранение недоступно/);assert.equal(maxActive,1);
});

test('import cannot replace an unsaved edition and does not clear its pending after export',async()=>{
  const {app,writes}=setup({fail:true});app.lessons[0].description='pending before import';await app.saveCatalog();
  const incoming=JSON.parse(app.catalogExportText());incoming.lessons[0].description='incoming replacement';let confirmations=0;
  assert.equal(await app.importCatalogText(JSON.stringify(incoming),()=>{confirmations++;return true;}),false);
  assert.equal(confirmations,0);assert.equal(writes.length,1);
  assert.equal(app.lessons[0].description,'pending before import');assert.equal(app.catalogSaveSnapshot().pending,true);
});

test('uncertain import readback keeps the accepted model exportable until the same candidate is confirmed',async()=>{
  const {app,data,writes,handlers,setMismatch}=setup({readback:true});
  const incoming=JSON.parse(app.catalogExportText());incoming.lessons[0].description='unconfirmed imported edition';
  assert.equal(await app.importCatalogText(JSON.stringify(incoming),()=>true),false);
  assert.equal(app.lessons[0].description,'unconfirmed imported edition');assert.match(app.catalogExportText(),/unconfirmed imported edition/);
  assert.equal(unload(handlers).prevented,true);assert.match(app.state.message,/сохранение не подтверждено/);
  const candidate=writes[0];setMismatch(false);await app.retryCatalogSave();
  assert.equal(data.get(KEY),candidate);assert.equal(writes[1],candidate);assert.equal(unload(handlers).prevented,false);
});

test('catalog confirmation preserves the independent pending MIDI progress unload guard',async()=>{
  const {app,handlers}=setup();await app.saveCatalog();
  const A=require('../practice-assessment.js'),lesson=app.lessons.find(l=>l.id==='course01-01');
  await app.legacyProgressStore.record({id:'synthetic-unsaved-midi',lessonId:lesson.id,fingerprint:A.pianoSignature(lesson),mode:'challenge',clean:true,at:Date.now()});
  assert.equal(app.catalogSaveSnapshot().pending,false);assert.equal(app.legacyProgressStore.snapshot().pendingCount,1);
  assert.equal(unload(handlers).prevented,true);
});
