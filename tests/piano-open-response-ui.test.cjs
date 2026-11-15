'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{loadApp}=require('./helpers/load-app.cjs');
function playerFixture(openResponse,challengeReady=false){
 const ids=new Map();class Element{constructor(id=''){this.id=id;this.children=[];this.parentNode=null;this.hidden=false;this.textContent='';this.innerHTML='';this.attributes={};this.classList={add(){},toggle(){}};if(id)ids.set(id,this);}setAttribute(k,v){this.attributes[k]=String(v);}append(c){this.children.push(c);c.parentNode=this;}prepend(c){this.children.unshift(c);c.parentNode=this;}querySelector(){return null;}}
 const main=new Element(),panel=new Element('game-player-root');main.append(panel);for(const id of ['player-site-head','player-identity','player-catalog-toggle','player-advanced'])new Element(id);
 const trainer={lessonId:'fixture-manual',fingerprint:'fixture-fingerprint',mode:'practice',completed:false,midiConnected:false,openResponse};
 const doc={body:new Element(),getElementById:id=>ids.get(id)||null,querySelector:s=>s==='main.main'?main:null,createElement:()=>new Element()};
 const ctx=vm.createContext({document:doc,location:{search:''},URLSearchParams,MelodiaLearning:{create:()=>({status:()=>({pending:null,ready:false,busy:false}),releaseOwnership(){}})}});
 vm.runInContext(fs.readFileSync('piano-game-player.js','utf8'),ctx,{filename:'piano-game-player.js'});
 const ui=ctx.PianoGamePlayer.create({client:{status:()=>({user:null}),api:async()=>({lessons:[{id:trainer.lessonId,gradeFingerprint:trainer.fingerprint,challengeReady}]})},readTrainer:()=>trainer,prepareTrainer(){throw Error('Manual UI must not open an attempt');},render(){}});return{ui,panel};
}
test('a declared free response explains self-check without promising future automatic grading or XP',async()=>{
 for(const ready of [false,true]){const f=playerFixture(true,ready);await f.ui.load();assert.match(f.panel.innerHTML,/Свой музыкальный ответ/);assert.match(f.panel.innerHTML,/самостоятельно/);assert.doesNotMatch(f.panel.innerHTML,/готовится автоматическая|id="game-start"|Получай опыт/);}
});
test('ordinary practice and graded materials keep their existing server-panel messages',async()=>{
 const manual=playerFixture(false);await manual.ui.load();assert.match(manual.panel.innerHTML,/Практика нового навыка/);assert.match(manual.panel.innerHTML,/готовится автоматическая/);const graded=playerFixture(false,true);await graded.ui.load();assert.match(graded.panel.innerHTML,/Играй. Получай опыт. Расти./);assert.match(graded.panel.innerHTML,/id="game-start"/);
});
test('the actual trainer disables rhythm scoring for free responses while ordinary lessons retain it',()=>{
 const root={innerHTML:''},doc={documentElement:{style:{setProperty(){}}},addEventListener(){},getElementById:id=>id==='app'?root:null,querySelector(){return null;},querySelectorAll(){return[];}};
 const storage={getItem(){return null;},setItem(){}};const timers={setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){}};const app=loadApp({document:doc,timers,storage,web:true});app.state.keyWidthMode='manual';app.selectLesson('detail-p-improv-three-key-answer-right-01');const tag=root.innerHTML.match(/<input id="rhythm-check"[^>]*>/)?.[0];assert.ok(tag);assert.match(tag,/disabled/);assert.doesNotMatch(tag,/checked/);assert.match(root.innerHTML,/Свободный ответ проверяется самостоятельно/);app.selectLesson('course02-02');const normal=root.innerHTML.match(/<input id="rhythm-check"[^>]*>/)?.[0];assert.ok(normal);assert.doesNotMatch(normal,/disabled/);
});
