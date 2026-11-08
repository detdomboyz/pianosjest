'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,UI_KEY}=require('../service-client.js');
function setup({failPreferences=false}={}){
  const data=new Map([[UI_KEY,'{"legacy":true}'],['music-learning-piano-v1','{"old-progress":true}']]),writes=[],requests=[];
  let user=null,revision=0,raw=null,conflict=false;
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);writes.push(k);}};
  const fetch=async(url,options)=>{
    requests.push({url,options});const response=(status,value)=>({ok:status<400,status,json:async()=>value});
    if(url.endsWith('/session'))return response(200,{user,csrfToken:'csrf'});
    if(url.endsWith('/auth/register')){user={id:'account-a',username:'pianist_one',displayName:'Один'};return response(200,{user,csrfToken:'new-csrf',recoveryCode:'one-time-secret'});}
    if(url.endsWith('/preferences')){
      if(failPreferences&&options.method==='GET')throw Error('Synthetic preferences outage');
      if(options.method==='GET')return response(200,{revision,raw});
      const input=JSON.parse(options.body);if(conflict||input.expectedRevision!==revision)return response(409,{error:{code:'REVISION_CONFLICT',message:'Server conflict'}});
      raw=input.raw;return response(200,{revision:++revision,raw});
    }
    if(url.endsWith('/catalog'))return response(200,{revision:0,raw:null});
    return response(404,{error:{code:'NOT_FOUND',message:'not found'}});
  };
  const client=create({fetch,storage});
  return {client,data,writes,requests,setUser:value=>user=value,setConflict:()=>{conflict=true;}};
}
test('guest practice cannot read, overwrite or upload existing anonymous browser data',async()=>{
  const x=setup();await x.client.init();assert.equal(x.client.storage.getItem(UI_KEY),null);x.client.storage.setItem(UI_KEY,'{"new":"guest"}');
  assert.equal(x.client.storage.getItem(UI_KEY),'{"new":"guest"}');assert.equal(x.data.get(UI_KEY),'{"legacy":true}');assert.deepEqual(x.writes,[]);
  assert.ok(x.requests.every(r=>r.options.method==='GET'));await assert.rejects(()=>x.client.saveObject('catalog','{}'),/Войди/);
});
test('authenticated local progress is scoped to the permanent account; old keys remain byte-exact',async()=>{
  const x=setup();await x.client.init();await x.client.auth('register',{});x.client.storage.setItem('music-learning-piano-v1','{"personal":true}');
  assert.equal(x.data.get('melodiajest:user:account-a:music-learning-piano-v1'),'{"personal":true}');assert.equal(x.data.get('music-learning-piano-v1'),'{"old-progress":true}');
  assert.equal(x.data.get(UI_KEY),'{"legacy":true}');assert.ok(!x.requests.some(r=>r.options.body?.includes('old-progress')));
});
test('a committed registration returns its recovery code even when the following preferences read fails',async()=>{
  const x=setup({failPreferences:true});await x.client.init();const result=await x.client.auth('register',{});assert.equal(result.recoveryCode,'one-time-secret');assert.equal(x.client.status().user.id,'account-a');
});
test('client refuses to replace an object that has never been loaded',async()=>{
  const x=setup();await x.client.init();await x.client.auth('register',{});await assert.rejects(()=>x.client.saveObject('catalog','{}'),/Сначала нужно загрузить/);
  assert.ok(!x.requests.some(r=>r.url.endsWith('/catalog')&&r.options.method==='PUT'));assert.ok(x.client.status().pending);
});
test('conflicting settings keep the exact pending export and never rebase onto another device',async()=>{
  const x=setup();await x.client.init();await x.client.auth('register',{});x.setConflict();const raw='{"learningMaterialMode":"hidden","unknown":"🎹"}';
  await assert.rejects(()=>x.client.saveObject('preferences',raw),/Server conflict/);const exported=JSON.parse(x.client.pendingExport());assert.equal(exported.objects.preferences,raw);assert.equal(exported.accountId,'account-a');
  const puts=x.requests.filter(r=>r.options.method==='PUT');assert.equal(puts.length,1);assert.equal(JSON.parse(puts[0].options.body).expectedRevision,0);
});
test('a cookie/account change locks the page before it can adopt another user’s private state',async()=>{
  const x=setup();await x.client.init();await x.client.auth('register',{});x.setUser({id:'account-b',displayName:'Другой'});await x.client.checkSession();
  assert.equal(x.client.status().user.id,'account-a');assert.ok(x.client.status().locked);await assert.rejects(()=>x.client.saveObject('preferences','{}'),/Войди/);
});
test('private API reads send the expected account, while public music has no owner header',async()=>{
  const x=setup();await x.client.init();await x.client.auth('register',{});await x.client.api('/catalog');try{await x.client.api('/publications',{publicRequest:true});}catch{}
  assert.equal(x.requests.find(r=>r.url.endsWith('/catalog')).options.headers['X-Melodiajest-Account'],'account-a');assert.equal(x.requests.find(r=>r.url.endsWith('/publications')).options.headers['X-Melodiajest-Account'],undefined);
});
test('authenticated readback observes another tab instead of hiding its changes behind a memory cache',async()=>{
  const x=setup();await x.client.init();await x.client.auth('register',{});const key='music-learning-piano-v1',scoped='melodiajest:user:account-a:'+key;
  x.client.storage.setItem(key,'{"first":true}');x.data.set(scoped,'{"first":true,"other-tab":true}');assert.equal(x.client.storage.getItem(key),'{"first":true,"other-tab":true}');
  x.data.delete(scoped);assert.equal(x.client.storage.getItem(key),null);
});
test('a pending old-account progress writer remains in its original local namespace after an account change',async()=>{
  const x=setup();await x.client.init();await x.client.auth('register',{});x.setUser({id:'account-b',displayName:'Другой'});await x.client.checkSession();assert.ok(x.client.status().locked);
  x.client.storage.setItem('music-learning-piano-v1','{"pending-old-account":true}');assert.equal(x.data.get('melodiajest:user:account-a:music-learning-piano-v1'),'{"pending-old-account":true}');assert.equal(x.data.has('melodiajest:user:account-b:music-learning-piano-v1'),false);
  await assert.rejects(()=>x.client.saveObject('preferences','{}'),/Войди/);
});
