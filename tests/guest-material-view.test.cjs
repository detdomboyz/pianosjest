'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Service=require('../service-client.js'),{loadApp}=require('./helpers/load-app.cjs');
const KEY='melodiajest-guest-material-view-v1';
function setup({data=new Map(),user=null,blocked=false}={}){
 const writes=[],reads=[],requests=[];let current=user;
 const storage={getItem(key){reads.push(key);if(blocked)throw Error('blocked');return data.get(key)??null;},setItem(key,value){if(blocked)throw Error('blocked');writes.push([key,value]);data.set(key,value);}};
 const fetch=async(url,options)=>{requests.push({url,options});const value=url.endsWith('/session')?{user:current,csrfToken:'fixture-only'}:url.endsWith('/auth/logout')?{user:(current=null)}:{revision:0,raw:'{"learningMaterialMode":"expanded","accountOnly":true}'};return{ok:true,status:200,json:async()=>value};};
 return{data,writes,reads,requests,newClient:()=>Service.create({fetch,storage})};
}

for(const mode of ['compact','expanded','hidden'])test('actual material selection survives a fresh guest client and trainer: '+mode,async()=>{
 const f=setup(),client=f.newClient();await client.init();const first=loadApp({web:true,events:true,storage:client.storage});first.setLearningMaterialMode(mode);const next=f.newClient();await next.init();const reloaded=loadApp({web:true,events:true,storage:next.storage});assert.equal(reloaded.state.learningMaterialMode,mode);assert.equal(f.data.get(KEY),mode);assert.ok(f.writes.every(([key,value])=>key===KEY&&['compact','expanded','hidden'].includes(value)));assert.ok(f.requests.every(x=>x.options.method==='GET'));
});

test('guest persists only the allowlisted nonpersonal view,leaving legacy and private data byte-exact',async()=>{
 const data=new Map([[Service.UI_KEY,'{"privateLegacy":"do-not-read"}'],['music-learning-piano-v1','old-progress'],['melodiajest:user:owner:'+Service.UI_KEY,'account-private']]),before=new Map(data),f=setup({data}),c=f.newClient();await c.init();c.storage.setItem(Service.UI_KEY,JSON.stringify({learningMaterialMode:'hidden',blindMode:true,privateCatalog:'private',selectedLesson:'personal-id',userId:'owner'}));c.storage.setItem('music-learning-piano-v1','guest-only');c.storage.setItem('catalog','guest-private');const next=f.newClient();await next.init();assert.deepEqual(JSON.parse(next.storage.getItem(Service.UI_KEY)),{learningMaterialMode:'hidden'});assert.equal(next.storage.getItem('music-learning-piano-v1'),null);assert.equal(next.storage.getItem('catalog'),null);for(const[key,value]of before)assert.equal(data.get(key),value);assert.ok(f.reads.every(key=>key===KEY));assert.deepEqual(f.writes,[[KEY,'hidden']]);assert.ok(f.requests.every(x=>x.options.method==='GET'));
});

test('unknown stored and imported modes are ignored without adopting another preference object',async()=>{
 for(const raw of ['unknown','{"learningMaterialMode":"hidden","secret":"private"}','<script>']){const f=setup({data:new Map([[KEY,raw]])}),c=f.newClient();await c.init();assert.equal(c.storage.getItem(Service.UI_KEY),null);c.storage.setItem(Service.UI_KEY,'{"learningMaterialMode":"unknown"}');assert.equal(f.writes.length,0);const next=f.newClient();await next.init();assert.equal(loadApp({web:true,storage:next.storage}).state.learningMaterialMode,'compact');}
});

test('storage failure keeps current view and exposes the failure without claiming reload persistence',async()=>{
 const f=setup({blocked:true}),c=f.newClient();await c.init();assert.equal(c.storage.getItem(Service.UI_KEY),null);const app=loadApp({web:true,events:true,storage:c.storage});app.setLearningMaterialMode('hidden');assert.equal(app.state.learningMaterialMode,'hidden');assert.match(c.status().notice,/перезагрузки/);assert.match(c.status().notice,/не сохранил/);assert.equal(loadApp({web:true,storage:f.newClient().storage}).state.learningMaterialMode,'compact');
});

test('account preferences take precedence and never get exported into the guest view key',async()=>{
 const data=new Map([[KEY,'hidden']]),f=setup({data,user:{id:'owner',displayName:'Fixture'}}),c=f.newClient();await c.init();assert.deepEqual(JSON.parse(c.storage.getItem(Service.UI_KEY)),{learningMaterialMode:'expanded',accountOnly:true});assert.equal(data.get(KEY),'hidden');assert.ok(!f.reads.includes(KEY));await c.logout();assert.deepEqual(JSON.parse(c.storage.getItem(Service.UI_KEY)),{learningMaterialMode:'hidden'});assert.ok(!c.pendingExport().includes('accountOnly'));
});

test('persisted view cannot expose any material or source hints in actual memory renderer',async()=>{
 for(const mode of ['compact','expanded','hidden']){const f=setup({data:new Map([[KEY,mode]])}),c=f.newClient();await c.init();const app=loadApp({web:true,events:true,storage:c.storage});app.state.lesson=app.lessons.find(x=>x.id==='detail-p-syncopation-hold-right-01');app.state.attemptMode='memory';assert.equal(app.learningMaterialHtml(),'');}
});
