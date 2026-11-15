'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{loadApp}=require('./helpers/load-app.cjs');
// Small DOM boundary for actual shipped handlers. Layout/performance are measured
// separately in an isolated browser;this fixture does not simulate either.
function fixture({guest=false,failStorage=false,missingSlot=false}={}){
 const writes=[],body={tagName:'BODY'},ids=new Map(),heading={className:'lesson-name',focus(){doc.activeElement=this;}},status={id:'service-account-status',textContent:'existing account status'};
 const control={id:'learning-material-mode',value:'compact',focus(){doc.activeElement=this;}},search={id:'lesson-search',value:'левая',selectionStart:5,selectionEnd:5},player={identity:'player'},keyboard={identity:'keyboard'},side={scrollTop:137,scrollHeight:2000,clientHeight:500,style:{},querySelector(){return null;},writes:0,innerHTML:''};
 let prep=[];const makeToggle=()=>({id:'learning-material-toggle',focus(){doc.activeElement=this;}});
 const slot={id:'learning-material-slot',writes:0,_html:'',get innerHTML(){return this._html;},set innerHTML(value){this._html=value;this.writes++;ids.delete('learning-material-toggle');if(value.includes('id="learning-material-toggle"'))ids.set('learning-material-toggle',makeToggle());prep=[...value.matchAll(/data-learning-prerequisite="([^"]+)"/g)].map(m=>({dataset:{learningPrerequisite:m[1]}}));}};
 const root={writes:0,_html:'',get innerHTML(){return this._html;},set innerHTML(value){this._html=value;this.writes++;doc.activeElement=body;ids.delete('learning-material-toggle');prep=[];}};
 const doc={activeElement:control,documentElement:{style:{setProperty(){}}},addEventListener(){},getElementById:id=>ids.get(id)||null,querySelector:selector=>selector==='.lessons'?side:selector==='.lesson-name'?heading:null,querySelectorAll:selector=>selector==='[data-learning-prerequisite]'?prep:[]};
 for(const [key,value] of [['app',root],['learning-material-mode',control],['lesson-search',search],['game-player-root',player],['keyboard-root',keyboard],['service-account-status',status]])ids.set(key,value);
 if(!missingSlot)ids.set('learning-material-slot',slot);ids.set('learning-material-toggle',makeToggle());
 const storage={getItem(){return null;},setItem(key,value){writes.push([key,value]);if(failStorage)status.textContent='Браузер не сохранил вид разбора. После перезагрузки выбери его заново.';}};
 const client=guest?{storage,status(){return{user:null,locked:false,notice:status.textContent};}}:null;
 const app=loadApp({document:doc,storage,serviceClient:client,timers:{setTimeout(){return 0;},clearTimeout(){}}});app.state.keyWidthMode='manual';app.state.lesson=app.lessons.find(l=>l.id==='detail-p-barline-hold-left-01');app.state.contentSection='learning';app.bindAfterRender();side.scrollTop=app.state.sidebarScroll=137;
 const select=mode=>{control.value=mode;control.onchange({target:control});};
 return{app,doc,root,slot,side,control,search,player,keyboard,status,ids,writes,select,get prep(){return prep;}};
}
function catalogue(app){const {savedAt,...data}=app.catalogSnapshot();return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');}

test('material selector updates only its slot and preserves catalogue,search,player and attempt state',()=>{
 const f=fixture(),hash=catalogue(f.app),lesson=f.app.state.lesson,control=f.control;f.app.state.stepIndex=2;f.app.state.playbackIndex=3;f.app.state.active.add(50);f.app.state.attemptEvents=[{type:'noteon',midi:50,at:7}];const events=f.app.state.attemptEvents;
 f.select('expanded');assert.equal(f.root.writes,0,'Changing material must not replace the whole trainer');assert.equal(f.side.writes,0);assert.equal(f.side.scrollTop,137);assert.equal(f.ids.get('lesson-search'),f.search);assert.equal(f.search.value,'левая');assert.equal(f.search.selectionStart,5);assert.equal(f.ids.get('game-player-root'),f.player);assert.equal(f.ids.get('keyboard-root'),f.keyboard);assert.equal(f.ids.get('learning-material-mode'),control);assert.equal(f.doc.activeElement,control);assert.equal(f.app.state.lesson,lesson);assert.equal(f.app.state.stepIndex,2);assert.equal(f.app.state.playbackIndex,3);assert.equal(f.app.state.attemptEvents,events);assert.ok(f.app.state.active.has(50));assert.equal(catalogue(f.app),hash);assert.match(f.slot.innerHTML,/D3|безымянным/);
});
test('new disclosure and preparation buttons remain bound to actual actions after scoped replacement',()=>{
 const f=fixture();f.select('expanded');const collapse=f.ids.get('learning-material-toggle');assert.equal(typeof collapse.onclick,'function');collapse.onclick();assert.equal(f.app.state.learningMaterialMode,'compact');assert.match(f.slot.innerHTML,/aria-expanded="false"/);const expand=f.ids.get('learning-material-toggle');assert.notEqual(expand,collapse);expand.onclick();assert.equal(f.app.state.learningMaterialMode,'expanded');assert.equal(f.doc.activeElement,f.ids.get('learning-material-toggle'));assert.deepEqual(f.prep.map(x=>x.dataset.learningPrerequisite),['detail-p-syncopation-hold-left-01','detail-p-left-half-01']);assert.ok(f.prep.every(x=>typeof x.onclick==='function'));f.prep[0].onclick();assert.equal(f.app.state.lesson.id,'detail-p-syncopation-hold-left-01');assert.equal(f.doc.activeElement.className,'lesson-name');
});
test('hidden and unknown views keep the selector and avoid full-body hints',()=>{
 const f=fixture();f.select('hidden');assert.equal(f.slot.innerHTML,'');assert.equal(f.control.value,'hidden');assert.equal(f.root.writes,0);f.select('unsupported');assert.equal(f.control.value,'compact');assert.match(f.slot.innerHTML,/learning-preview-text/);assert.doesNotMatch(f.slot.innerHTML,/Первоисточники и дальнейшее чтение/);assert.equal(f.root.writes,0);
});
test('scoped guest view keeps the live storage-failure notice visible and does not replace the player',()=>{
 const f=fixture({guest:true,failStorage:true}),status=f.status;f.select('hidden');assert.equal(f.ids.get('service-account-status'),status);assert.match(status.textContent,/не сохранил/);assert.equal(f.root.writes,0);assert.equal(f.ids.get('game-player-root'),f.player);assert.equal(f.app.state.learningMaterialMode,'hidden');
});
test('a stale material callback in memory uses the actual full privacy renderer',()=>{
 const f=fixture(),callback=f.control.onchange;f.app.state.attemptMode='memory';f.control.value='expanded';callback({target:f.control});assert.equal(f.root.writes,1);assert.equal(f.slot.writes,0);assert.doesNotMatch(f.root.innerHTML,/learning-material-body|data-learning-prerequisite|D3|безымянным|Yamaha|openlearn/);
});
test('an invalidated account rejects stale material callbacks before persisting preferences',()=>{
 const f=fixture({guest:true}),callback=f.control.onchange;f.app.handleServiceAccountChange();const writes=f.writes.length,rootWrites=f.root.writes;f.control.value='expanded';callback({target:f.control});assert.equal(f.writes.length,writes);assert.equal(f.root.writes,rootWrites+1);assert.equal(f.slot.writes,0);assert.match(f.root.innerHTML,/Аккаунт или сессия изменились/);assert.doesNotMatch(f.root.innerHTML,/data-learning-prerequisite|D3/);
});
test('a missing slot falls back to a complete render instead of silently losing the material',()=>{
 const f=fixture({missingSlot:true});f.select('expanded');assert.equal(f.root.writes,1);assert.match(f.root.innerHTML,/id="learning-material-slot"/);assert.match(f.root.innerHTML,/D3|безымянным/);
});
test('a stale learning-material event in pieces cannot insert a learning card',()=>{
 const f=fixture(),callback=f.control.onchange;f.app.setContentSection('pieces');const before=f.root.writes;f.control.value='expanded';callback({target:f.control});assert.equal(f.root.writes,before+1);assert.equal(f.slot.writes,0);assert.doesNotMatch(f.root.innerHTML,/id="learning-material-slot"|piano-learning-card/);
});
