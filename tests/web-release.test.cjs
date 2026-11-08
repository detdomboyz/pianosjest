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

test('shared-host service names cannot shadow another portal app through automatic Compose DNS aliases',()=>{
  const config=fs.readFileSync(path.join(ROOT,'deploy/shared-host/compose.yaml'),'utf8');
  const services=config.split(/^services:\s*$/m)[1].split(/^networks:\s*$/m)[0];
  const names=[...services.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map(m=>m[1]);
  assert.ok(names.length>0);assert.ok(names.every(name=>name.startsWith('melodiajest-')),'Compose automatically advertises every service name, even with explicit network aliases');
  assert.match(services,/container_name: melodiajest-/);
  const aliases=[...services.matchAll(/aliases:\s*\[([^\]]*)\]/g)].flatMap(m=>m[1].split(',').map(s=>s.trim().replace(/^['"]|['"]$/g,'')));
  assert.ok(aliases.every(name=>!['web','app','gateway','db'].includes(name)));
});

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
test('service export builds its course hub and trainer from their canonical sources without a second music algorithm',()=>{
  const exported=buildWeb({outDir:OUT,service:true});assert.equal(exported.gameVersion,1);assert.equal(exported.personalProgress,'database-and-versioned-browser-history');assert.deepEqual(exported.sourceEntries,{'index.html':'learn.html','trainer.html':'index.html'});
  assert.equal(fs.readFileSync(path.join(OUT,'index.html'),'utf8'),fs.readFileSync(path.join(ROOT,'learn.html'),'utf8'));
  const original=fs.readFileSync(path.join(ROOT,'index.html'),'utf8').replace('<script src="chopin-theme.js">','<script src="web-runtime.js"></script>\n<script src="chopin-theme.js">');assert.equal(fs.readFileSync(path.join(OUT,'trainer.html'),'utf8'),original);
  assert.match(fs.readFileSync(path.join(OUT,'web-runtime.js'),'utf8'),/serviceVersion:1,gameVersion:1/);
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
