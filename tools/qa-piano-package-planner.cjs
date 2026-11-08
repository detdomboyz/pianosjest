'use strict';
// Own loopback fixtures only. No production catalog, API or private files.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),Parts=require('../piano-lesson-parts.js'),Update=require('../piano-lesson-package-update.js');
const {loadApp}=require('../tests/helpers/load-app.cjs'),ROOT=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
function buildFixture(){
 const all=copy(loadApp().catalogSnapshot()),themeId=all.lessons.find(l=>l.id==='course01-01').themeId;
 const oldCatalog={version:7,themes:all.themes.filter(t=>t.id===themeId),lessons:all.lessons.filter(l=>l.themeId===themeId)},nextCatalog=copy(oldCatalog);nextCatalog.lessons[0].description+=' Изолированное обновление инструкции.';
 const old=Parts.build(oldCatalog,{release:'23.5.44',webManifestSha256:'a'.repeat(64),themeIds:[themeId]}),next=Parts.build(nextCatalog,{release:'23.5.45',webManifestSha256:'b'.repeat(64),themeIds:[themeId]}),pin=b=>({...b.manifest.source,manifestSha256:b.manifestSha256}),input=b=>({pin:pin(b),manifestBytes:b.manifestBytes,files:b.files});
 const local=copy(oldCatalog);local.lessons.reverse();local.themes.push({id:'qa-private-theme',name:'Личная тестовая тема',order:99});local.lessons[0].themeId='qa-private-theme';local.lessons[0].order=77;local.lessons.push({...copy(oldCatalog.lessons[0]),id:'qa-private-piece',themeId:'qa-private-theme',order:100,contentKind:'piece',privateAnnotation:'Изолированная запись, не данные пользователя'});
 const expected=Update.prepare({active:pin(old),previous:input(old),incoming:input(next),catalog:local});
 const files=new Map();for(const[prefix,b]of [['old',old],['new',next]])for(const[k,v]of [[b.manifestKey,b.manifestBytes],...b.files])files.set(prefix+'/'+k,v);
 return {fixture:{scope:'Synthetic 44→45 proposal only; live remains 23.5.44',previous:pin(old),incoming:pin(next),initial:{active:pin(old),catalog:local},expected,expectedCandidate:Update.materialize(expected,local)},files,next};
}
const SCRIPTS=['music-document.js','practice-assessment.js','piano-catalog-adapter.js','piano-lesson-parts-codec.js','piano-lesson-package-loader.js','piano-lesson-package-plan-core.js','piano-lesson-package-planner.js','piano-lesson-package-store.js'];
const PAGE=String.raw`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MelodiaJest — проверка сохранности каталога</title><style>body{margin:0;background:#0b1726;color:#eef5fc;font:16px/1.5 system-ui}main{max-width:860px;margin:32px auto;padding:24px}h1{font-size:28px;text-wrap:balance}button{min-height:44px;padding:10px 18px;background:#8edbff;border:0;border-radius:10px;color:#0b1726;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #ffe090;outline-offset:4px}p{max-width:72ch}pre{padding:18px;border:1px solid #3c526a;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace}.ok{color:#9ce6bc}.bad{color:#ffb2aa}@media(max-width:480px){main{margin:12px auto;padding:16px}h1{font-size:24px}}</style><main><h1>Сохранность личных редакций</h1><p>Объединение обновлённого урока с личным каталогом и проверка двух вкладок на тестовых данных. Рабочий сайт остаётся на 23.5.44. Его каталог, прогресс, MIDI и звук не подключены.</p><button id="run" type="button">Проверить обновление и редакции</button><p id="status" role="status" aria-live="polite">Готово к проверке.</p><pre id="results" aria-label="Результаты проверки">Проверка ещё не запускалась.</pre></main>`+SCRIPTS.map(file=>'<script src="/'+file+'"></script>').join('')+'<script src="/suite.js"></script></html>';
function start({port=63345}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid own QA port');const data=buildFixture(),scripts=new Set(SCRIPTS);
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(body,type='application/json',status=200)=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  if(req.method!=='GET')return send('','text/plain',404);
  if(req.url==='/')return send(PAGE,'text/html; charset=utf-8');
  if(req.url==='/fixture.json')return send(JSON.stringify(data.fixture));
  if(req.url==='/suite.js')return send(fs.readFileSync(path.join(ROOT,'tools/qa/piano-package-planner-suite.js')),'text/javascript; charset=utf-8');
  if(scripts.has(req.url.slice(1)))return send(fs.readFileSync(path.join(ROOT,req.url.slice(1))),'text/javascript; charset=utf-8');
  const match=/^\/(old|new|bad|offline)\/((?:manifests|parts)\/v1\/[a-f0-9]{64}\.json)$/.exec(req.url);
  if(!match)return send('','text/plain',404);const[,mode,key]=match;if(mode==='offline'){req.socket.destroy();return;}
  const raw=data.files.get((mode==='bad'?'new':mode)+'/'+key);if(!raw)return send('','text/plain',404);
  return send(mode==='bad'&&key.startsWith('parts/')?Buffer.from('corrupt test fixture'):raw);
 });server.listen(port,'127.0.0.1',()=>console.log('Own isolated planner QA at http://127.0.0.1:'+port));return server;
}
if(require.main===module)start();module.exports={buildFixture,start,PAGE};
