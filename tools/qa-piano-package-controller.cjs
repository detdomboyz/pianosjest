'use strict';
// Own loopback allowlist and synthetic packages; never serves the checkout root.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {buildFixture}=require('./qa-piano-package-planner.cjs'),ROOT=path.resolve(__dirname,'..');
const SCRIPTS=['music-document.js','practice-assessment.js','piano-catalog-adapter.js','piano-lesson-parts-codec.js','piano-lesson-package-loader.js','piano-lesson-package-plan-core.js','piano-lesson-package-planner.js','piano-lesson-package-store.js','piano-lesson-package-controller.js'];
const PAGE=String.raw`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MelodiaJest — проверка записи каталога</title><style>body{margin:0;background:#0b1726;color:#eef5fc;font:16px/1.5 system-ui}main{max-width:860px;margin:32px auto;padding:24px}h1{font-size:28px;text-wrap:balance}button{min-height:44px;padding:10px 18px;background:#8edbff;border:0;border-radius:10px;color:#0b1726;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #ffe090;outline-offset:4px}p{max-width:72ch}pre{padding:18px;border:1px solid #3c526a;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace}.ok{color:#9ce6bc}.bad{color:#ffb2aa}@media(max-width:480px){main{margin:12px auto;padding:16px}h1{font-size:24px}}</style><main><h1>Подтверждённая запись каталога</h1><p>Изолированная проверка общего контроллера: загрузка проверенных частей, личные редакции, незавершённая запись и восстановление. Рабочий сайт остаётся на 23.5.46. Его данные, MIDI и звук не подключены.</p><button id="run" type="button">Проверить запись и восстановление</button><p id="status" role="status" aria-live="polite">Готово к проверке.</p><pre id="results" aria-label="Результаты проверки">Проверка ещё не запускалась.</pre></main>`+SCRIPTS.map(file=>'<script src="/'+file+'"></script>').join('')+'<script src="/suite.js"></script></html>';
function start({port=63347}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid own QA port');const data=buildFixture(),scripts=new Set(SCRIPTS);data.fixture.scope='Synthetic 44→45 packages; public site remains 23.5.46';
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(body,type='application/json',status=200)=>{res.writeHead(status,{'Content-Type':type});res.end(body);};
  if(req.method!=='GET')return send('','text/plain',404);
  if(req.url==='/')return send(PAGE,'text/html; charset=utf-8');
  if(req.url==='/fixture.json')return send(JSON.stringify(data.fixture));
  if(req.url==='/suite.js')return send(fs.readFileSync(path.join(ROOT,'tools/qa/piano-package-controller-suite.js')),'text/javascript; charset=utf-8');
  if(scripts.has(req.url.slice(1)))return send(fs.readFileSync(path.join(ROOT,req.url.slice(1))),'text/javascript; charset=utf-8');
  const match=/^\/(old|new)\/((?:manifests|parts)\/v1\/[a-f0-9]{64}\.json)$/.exec(req.url);if(!match)return send('','text/plain',404);
  const raw=data.files.get(match[1]+'/'+match[2]);return raw?send(raw):send('','text/plain',404);
 });server.listen(port,'127.0.0.1',()=>console.log('Own isolated controller QA at http://127.0.0.1:'+port));return server;
}
if(require.main===module)start();module.exports={start,PAGE,SCRIPTS};
