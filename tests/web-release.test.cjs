'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const {buildWeb,ASSETS}=require('../tools/build-web.cjs');
const {makeWebServer}=require('../tools/serve-web.cjs');
const {loadApp}=require('./helpers/load-app.cjs');
const ROOT=path.resolve(__dirname,'..');
const OUT=fs.mkdtempSync(path.join(ROOT,'tmp','web-release-test-'));
const CONTENT_KEY='piano-blind-trainer-content-v20';

test('public export contains only declared browser assets, never personal/native/server files',()=>{
  const release=buildWeb({outDir:OUT});
  assert.equal(release.storage,'browser');assert.equal(release.nativeCompanion,false);
  assert.deepEqual(fs.readdirSync(OUT).sort(),[...ASSETS,'web-runtime.js','web-release.json'].sort());
  for(const forbidden of ['trainer-content.json','midi-keyboard-settings.ini','server.cjs','midi-keyboard.ps1','AGENTS.md','.git'])assert.ok(!fs.existsSync(path.join(OUT,forbidden)));
  const html=fs.readFileSync(path.join(OUT,'index.html'),'utf8');
  assert.ok(html.indexOf('src="web-runtime.js"')<html.indexOf('src="chopin-theme.js"'));
  assert.throws(()=>buildWeb({outDir:ROOT}),/subdirectory/);
  fs.writeFileSync(path.join(OUT,'personal-draft.json'),'private');
  assert.throws(()=>buildWeb({outDir:OUT}),/Unexpected files/);
  fs.unlinkSync(path.join(OUT,'personal-draft.json'));
});

test('static preview rejects API mutations, native launch, source files and encoded traversal',async t=>{
  buildWeb({outDir:OUT});const server=makeWebServer({root:OUT});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  for(const url of ['/','/piano-learning-ui.js','/web-runtime.js'])assert.equal((await fetch(base+url)).status,200);
  for(const url of ['/api/content','/api/midi-keyboard/launch','/api/midi-bridge/events','/server.cjs','/trainer-content.json','/%2e%2e%2fserver.cjs'])assert.equal((await fetch(base+url)).status,404,url);
  for(const url of ['/api/content','/api/midi-keyboard/launch','/'])assert.equal((await fetch(base+url,{method:'POST',body:'{}'})).status,405,url);
});

test('actual web app saves/loads private edits without calling any server API or native bridge',async()=>{
  const data=new Map();const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
  let requests=0,streams=0;
  const app=loadApp({web:true,events:true,storage,fetch:()=>{requests++;throw Error('No web API');},EventSource:function(){streams++;}});
  const lesson=app.lessons.find(l=>l.id==='course01-01');const old=lesson.description;
  lesson.description='Private edit saved by web release';await app.saveCatalog();
  assert.match(app.state.contentStatus,/Сохранено в этом браузере/);
  assert.ok([...data.values()].some(v=>v.includes('Private edit saved by web release')));
  lesson.description=old;await app.loadCatalog();
  assert.equal(app.lessons.find(l=>l.id===lesson.id).description,'Private edit saved by web release');
  app.connectMidiBridgeEvents();
  app.state.selectedInput={name:'test device',close(){throw Error('Do not close MIDI for native launch in web mode');}};
  await app.launchMidiKeyboardProgram();
  assert.match(app.state.message,/Дополнение для Windows будет доступно отдельно/);
  assert.equal(requests,0);assert.equal(streams,0);
});

test('web persistence reports a storage failure instead of claiming a successful save',async()=>{
  const app=loadApp({web:true,events:true,storage:{getItem:()=>null,setItem(){throw Error('Storage full');}}});
  await app.saveCatalog();assert.match(app.state.contentStatus,/Сохранение недоступно/);
});
