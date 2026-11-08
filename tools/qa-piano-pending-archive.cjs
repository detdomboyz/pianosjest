'use strict';
// Own synthetic QA host. No project-root serving, devices or production storage.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),ROOT=path.resolve(__dirname,'..');
const SCRIPTS=require('./qa-piano-package-controller.cjs').SCRIPTS;
const PAGE=String.raw`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MelodiaJest — архив незавершённой правки</title><style>body{margin:0;background:#0b1726;color:#eef5fc;font:16px/1.5 system-ui}main{max-width:860px;margin:32px auto;padding:24px}h1{font-size:28px;text-wrap:balance}button{min-height:44px;padding:10px 18px;background:#8edbff;border:0;border-radius:10px;color:#0b1726;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #ffe090;outline-offset:4px}p{max-width:72ch}pre{padding:18px;border:1px solid #3c526a;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace}.ok{color:#9ce6bc}.bad{color:#ffb2aa}@media(max-width:480px){main{margin:12px auto;padding:16px}h1{font-size:24px}}</style><main><h1>Сохранить незавершённую правку</h1><p>Архив удерживает правку вместе с её контекстом. Рабочий каталог сохраняется. Проверка использует только отдельные тестовые базы; сайт 23.5.50, личный каталог, прогресс, MIDI и звук не подключены.</p><button id="run" type="button">Проверить архив и рабочую копию</button><p id="status" role="status" aria-live="polite">Готово к проверке.</p><pre id="results" aria-label="Результаты проверки">Проверка ещё не запускалась.</pre></main>`+SCRIPTS.map(file=>'<script src="/'+file+'"></script>').join('')+'<script src="/suite.js"></script></html>';
function start({port=63349}={}){
 const scripts=new Set(SCRIPTS),fixture=require('./qa-piano-package-planner.cjs').buildFixture().fixture;
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(raw,type='application/json',code=200)=>{res.writeHead(code,{'Content-Type':type});res.end(raw);};
  if(req.method!=='GET')return send('','text/plain',405);
  if(req.url==='/')return send(PAGE,'text/html; charset=utf-8');
  if(req.url==='/fixture.json')return send(JSON.stringify(fixture.initial));
  if(req.url==='/suite.js')return send(fs.readFileSync(path.join(ROOT,'tools/qa/piano-pending-archive-suite.js')),'text/javascript; charset=utf-8');
  if(scripts.has(req.url.slice(1)))return send(fs.readFileSync(path.join(ROOT,req.url.slice(1))),'text/javascript; charset=utf-8');
  return send('','text/plain',404);
 });server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({port,pid:process.pid,scope:'own isolated pending-archive QA'})));return server;
}
if(require.main===module)start();module.exports={start,PAGE,SCRIPTS};
