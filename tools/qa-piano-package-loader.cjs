'use strict';
// Own loopback fixture host only. No API, private user files or production origin.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),Parts=require('../piano-lesson-parts.js');
const {loadApp}=require('../tests/helpers/load-app.cjs'),ROOT=path.resolve(__dirname,'..'),copy=x=>JSON.parse(JSON.stringify(x));
function buildFixture(){
 const all=copy(loadApp().catalogSnapshot()),theme=all.lessons.find(l=>l.id==='course01-01').themeId;
 const original={version:7,themes:all.themes.filter(t=>t.id===theme),lessons:all.lessons.filter(l=>l.themeId===theme)},fresh=copy(original);fresh.lessons[0].description+=' Изолированная проверка будущего пакета.';
 const old=Parts.build(original,{release:'23.5.43',webManifestSha256:'a'.repeat(64),themeIds:[theme]}),next=Parts.build(fresh,{release:'23.5.44',webManifestSha256:'b'.repeat(64),themeIds:[theme]});
 const pin=b=>({...b.manifest.source,manifestSha256:b.manifestSha256});const local=copy(original);local.lessons.reverse();local.themes.push({id:'qa-personal-theme',name:'Личная тестовая тема',order:99});local.lessons.push({...copy(original.lessons[0]),id:'qa-personal-piece',themeId:'qa-personal-theme',order:100,contentKind:'piece',privateAnnotation:'Изолированный fixture, не данные пользователя'});
 return {fixture:{scope:'Synthetic 43→44 transport; public release remains 23.5.43',active:pin(old),pin:pin(next),catalog:Parts.assemble(next.manifest,next.files),partKey:next.manifest.parts[0].key,initial:{active:pin(old),catalog:local}},files:new Map([[next.manifestKey,next.manifestBytes],...next.files]),old};
}
const PAGE=String.raw`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MelodiaJest — проверка загрузки курса</title><style>body{margin:0;background:#0b1726;color:#eef5fc;font:16px/1.5 system-ui}main{max-width:860px;margin:32px auto;padding:24px}h1{font-size:28px;text-wrap:balance}button{min-height:44px;padding:10px 18px;background:#8edbff;border:0;border-radius:10px;color:#0b1726;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #ffe090;outline-offset:4px}p{max-width:72ch}pre{padding:18px;border:1px solid #3c526a;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace}.ok{color:#9ce6bc}.bad{color:#ffb2aa}@media(max-width:480px){main{margin:12px auto;padding:16px}h1{font-size:24px}}</style><main><h1>Загрузка частей курса</h1><p>Проверка сети, SHA256 и кеша на тестовой теме. Рабочий каталог, прогресс, MIDI и звук сайта не подключены. Публичная версия остаётся 23.5.43.</p><button id="run" type="button">Проверить загрузку и сохранность</button><p id="status" role="status" aria-live="polite">Готово к проверке.</p><pre id="results" aria-label="Результаты проверки">Проверка ещё не запускалась.</pre></main><script src="/music-document.js"></script><script src="/practice-assessment.js"></script><script src="/piano-catalog-adapter.js"></script><script src="/piano-lesson-parts-codec.js"></script><script src="/piano-lesson-package-loader.js"></script><script src="/piano-lesson-package-store.js"></script><script src="/suite.js"></script></html>`;
function start({port=63344}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local QA port');
 const data=buildFixture(),scripts=new Set(['music-document.js','practice-assessment.js','piano-catalog-adapter.js','piano-lesson-parts-codec.js','piano-lesson-package-loader.js','piano-lesson-package-store.js']);
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(body,type='application/json',status=200)=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  if(req.method!=='GET')return send('', 'text/plain',404);
  if(req.url==='/')return send(PAGE,'text/html; charset=utf-8');
  if(req.url==='/fixture.json')return send(JSON.stringify(data.fixture));
  if(req.url==='/suite.js')return send(fs.readFileSync(path.join(ROOT,'tools/qa/piano-package-loader-suite.js')),'text/javascript; charset=utf-8');
  if(scripts.has(req.url.slice(1)))return send(fs.readFileSync(path.join(ROOT,req.url.slice(1))),'text/javascript; charset=utf-8');
  const match=/^\/(packages|corrupt|stale|network|http|redirect|mime)\/((?:manifests|parts)\/v1\/[a-f0-9]{64}\.json)$/.exec(req.url);
  if(!match)return send('','text/plain',404);const [,mode,key]=match,raw=data.files.get(key);if(!raw)return send('','text/plain',404);
  if(mode==='network'){req.socket.destroy();return;}
  if(mode==='http')return send('{}','application/json',503);
  if(mode==='redirect'){res.writeHead(302,{Location:'/packages/'+key});res.end();return;}
  if(mode==='stale'&&key.startsWith('manifests/'))return send(data.old.manifestBytes);
  if(mode==='corrupt'&&key.startsWith('parts/'))return send(Buffer.from('corrupt fixture'));
  return send(raw,mode==='mime'?'text/html':'application/json');
 });server.listen(port,'127.0.0.1',()=>console.log('Own isolated package loader QA at http://127.0.0.1:'+port));return server;
}
if(require.main===module)start();module.exports={buildFixture,start,PAGE};
