'use strict';
// Local native-IndexedDB reproducer. No production origin, private catalog or S3.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const Parts=require('../piano-lesson-parts.js'),Update=require('../piano-lesson-package-update.js'),Store=require('../piano-lesson-package-store.js');
const {loadApp}=require('../tests/helpers/load-app.cjs'),copy=x=>JSON.parse(JSON.stringify(x));
const ROOT=path.resolve(__dirname,'..');
function buildFixture(){
 const all=copy(loadApp().catalogSnapshot()),themeId=all.lessons.find(l=>l.id==='course01-01').themeId;
 const original={version:7,themes:all.themes.filter(t=>t.id===themeId),lessons:all.lessons.filter(l=>['course01-01','course01-02'].includes(l.id))};
 const fresh=copy(original);fresh.lessons[0].description+=' Изолированная проверка новой инструкции.';
 const input=(c,r,h)=>{const b=Parts.build(c,{release:r,webManifestSha256:h.repeat(64),themeIds:[themeId]});return {pin:{...b.manifest.source,manifestSha256:b.manifestSha256},manifestBytes:b.manifestBytes,files:b.files};};
 const previous=input(original,'23.5.42','a'),incoming=input(fresh,'23.5.43','b');
 const local=copy(original);local.themes.push({id:'qa-private-theme',name:'Личная проба',order:50,contentKind:'piece'});local.lessons.reverse();local.lessons[0].order=78;local.lessons[0].themeId='qa-private-theme';local.lessons.push({...copy(original.lessons[0]),id:'qa-private-piece',contentKind:'piece',themeId:'qa-private-theme',order:81,privateAnnotation:'Только тестовый материал, не данные пользователя'});
 const plan=Update.prepare({active:previous.pin,previous,incoming,catalog:local});if(plan.status!=='ready')throw Error('Real planner did not create the fixture');
 return {scope:'synthetic storage experiment; actual offline package planner; no network decoder or production migration',initial:Store.validateCandidate({active:previous.pin,catalog:local}),incoming:Store.validateCandidate(Update.materialize(plan,local))};
}
const PAGE=String.raw`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MelodiaJest — проверка сохранения курса</title>
<style>body{margin:0;background:#0b1726;color:#eef5fc;font:16px/1.5 system-ui}main{max-width:860px;margin:32px auto;padding:24px}h1{font-size:28px;text-wrap:balance}button{min-height:44px;padding:10px 18px;background:#8edbff;border:0;border-radius:10px;color:#0b1726;font:inherit;font-weight:700;cursor:pointer}button:focus-visible{outline:3px solid #ffe090;outline-offset:4px}p{max-width:72ch}pre{padding:18px;border:1px solid #3c526a;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace}.ok{color:#9ce6bc}.bad{color:#ffb2aa}@media(max-width:480px){main{margin:12px auto;padding:16px}h1{font-size:24px}}</style>
<main><h1>Сохранение новой версии курса</h1><p>Изолированная проверка IndexedDB. Тестовый каталог подготовлен настоящим планировщиком пакетов. Личные данные сайта, MIDI и звук не подключаются; публичная версия остаётся 23.5.45.</p><button id="run" type="button">Проверить сохранение и восстановление</button><p id="status" role="status" aria-live="polite">Готово к проверке.</p><pre id="results" aria-label="Результаты проверки">Проверка ещё не запускалась.</pre><h2>Возвращение после закрытия вкладки</h2><p>Оставьте пробную правку, закройте вкладку и откройте тот же адрес. Рабочий каталог будет заменён только после явного восстановления.</p><button id="stage-reload" type="button">Оставить пробную правку</button> <button id="recover-reload" type="button" disabled>Восстановить пробную правку</button><p id="reload-status" role="status" aria-live="polite">Пробной правки пока нет.</p><pre id="reload-results" aria-label="Восстановление после закрытия">Проверка ещё не запускалась.</pre></main>
<script src="/piano-lesson-package-store.js"></script><script src="/suite.js"></script></html>
`;
function start({port=63343}={}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local QA port');
 const fixture=Buffer.from(JSON.stringify(buildFixture())+'\n');
 const routes=new Map([['/',()=>[Buffer.from(PAGE),'text/html; charset=utf-8']],['/fixture.json',()=>[fixture,'application/json']],['/suite.js',()=>[fs.readFileSync(path.join(ROOT,'tools/qa/piano-package-store-suite.js')),'text/javascript; charset=utf-8']],['/piano-lesson-package-store.js',()=>[fs.readFileSync(path.join(ROOT,'piano-lesson-package-store.js')),'text/javascript; charset=utf-8']]]);
 const server=http.createServer((req,res)=>{const route=routes.get(new URL(req.url,'http://127.0.0.1').pathname);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET'||!route){res.writeHead(404);res.end();return;}const [bytes,type]=route();res.setHeader('Content-Type',type);res.end(bytes);});
 server.listen(port,'127.0.0.1',()=>console.log('Own isolated package store QA at http://127.0.0.1:'+port));return server;
}
if(require.main===module)start();
module.exports={buildFixture,start,PAGE};
