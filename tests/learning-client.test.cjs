'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{webcrypto}=require('node:crypto'),Learning=require('../learning-client.js');
function fixture(){const data=new Map(),requests=[];let account='owner-a',handler=async(route)=>route==='/learning/attempts'?{id:'attempt-one',lessonId:'first',gradeFingerprint:'12345678'}:{result:null},failStorage=false;
  const client={requireUser(){if(!account)throw Error('signed out');return {id:account};},storage:{getItem(key){return data.get(account+':'+key)||null;},setItem(key,value){if(failStorage)throw Error('storage full');data.set(account+':'+key,value);}},async api(route,options){requests.push({route,options});return handler(route,options);}};
  return {client,data,requests,setHandler(fn){handler=fn;},setAccount(value){account=value;},failStorage(){failStorage=true;}};
}
const row={id:'first',musicVersion:'music',editionVersion:'edition'};
test('lost start response retries the saved operation and nonce without issuing a second attempt',async()=>{
  const f=fixture();let committed=null,lose=true;
  f.setHandler(async(route,options)=>{if(route==='/learning/attempts'){if(!committed)committed={operationId:options.data.operationId,nonce:options.data.nonce};assert.equal(options.data.operationId,committed.operationId);assert.equal(options.data.nonce,committed.nonce);if(lose){lose=false;throw Error('lost response');}return {id:'one',lessonId:'first'};}throw Error(route);});
  const one=Learning.create({client:f.client,crypto:webcrypto,clock:()=>100});await assert.rejects(()=>one.start(row,'challenge'),/lost response/);
  const reloaded=Learning.create({client:f.client,crypto:webcrypto,clock:()=>200});const recovered=await reloaded.recover();assert.equal(recovered.attempt.id,'one');assert.equal(f.requests.length,2);assert.equal(reloaded.status().ready,true);
});
test('a committed submission with a lost response is read back; MIDI is not resubmitted or awarded twice',async()=>{
  const f=fixture(),game=Learning.create({client:f.client,crypto:webcrypto,clock:()=>0});await game.start(row,'challenge');
  const confirmed={passed:true,xp:{earned:100}},attemptId='attempt-one';f.setHandler(async(route,options)=>{assert.equal(route,'/learning/attempts/'+attemptId);if(options?.method==='POST')throw Error('response lost after commit');return {result:confirmed};});
  await assert.rejects(()=>game.submit({events:[{type:'on',midi:60,at:100,source:'midi'},{type:'off',midi:60,at:1100}],observedAt:1200,interrupted:false}),/response lost/);
  const reloaded=Learning.create({client:f.client,crypto:webcrypto,clock:()=>300});assert.equal(reloaded.read().kind,'submitting');assert.deepEqual((await reloaded.recover()).result,confirmed);assert.equal(reloaded.status().pending,null);assert.equal(f.requests.filter(x=>x.route.endsWith(attemptId)&&x.options?.method==='POST').length,1);
});
test('storage failure stops the start request and retains an exportable private recovery record',async()=>{
  const f=fixture();f.failStorage();const game=Learning.create({client:f.client,crypto:webcrypto});await assert.rejects(()=>game.start(row,'challenge'),/storage full/);assert.equal(f.requests.length,0);assert.equal(JSON.parse(game.exportPending()).accountId,'owner-a');
});
test('another account does not adopt the pending recording and an unconfirmed submission cannot be cancelled',async()=>{
  const f=fixture(),game=Learning.create({client:f.client,crypto:webcrypto,clock:()=>100});await game.start(row,'challenge');f.setHandler(async()=>{throw Error('offline');});await assert.rejects(()=>game.submit({events:[{type:'on',midi:60,at:100,source:'midi'}],observedAt:200,interrupted:true}));await assert.rejects(()=>game.cancel(),/Сначала проверь/);
  f.setAccount('owner-b');assert.throws(()=>game.exportPending(),/Не совпал аккаунт/);const other=Learning.create({client:f.client,crypto:webcrypto});assert.equal(other.read(),null);assert.equal(f.data.has('owner-a:'+Learning.KEY),true);
});
test('an expired uncommitted submission can be cancelled only after authoritative readback',async()=>{
  const f=fixture(),game=Learning.create({client:f.client,crypto:webcrypto,clock:()=>10});await game.start(row,'challenge');f.setHandler(async()=>{throw Error('offline');});await assert.rejects(()=>game.submit({events:[{type:'on',midi:60,at:20,source:'midi'}],observedAt:30,interrupted:true}));
  f.setHandler(async(route,options)=>options?.method==='POST'?{result:{passed:false,cancelled:true}}:{result:null,expiresAt:100,serverTime:200});assert.equal((await game.recover()).expired,true);assert.equal(game.status().ready,false);assert.equal((await game.cancel()).result.cancelled,true);assert.equal(game.status().pending,null);
});
function webLocks(){const busy=new Map(),tails=new Map();return {request(name,options,fn){if(options.ifAvailable){if(busy.has(name))return Promise.resolve(fn(null));const token={name};busy.set(name,token);return Promise.resolve().then(()=>fn(token)).finally(()=>busy.delete(name));}const previous=tails.get(name)||Promise.resolve();const next=previous.catch(()=>{}).then(()=>fn({name}));tails.set(name,next);return next;}};}
test('two tabs cannot overwrite or steal a live recording; closing its writer permits explicit recovery',async()=>{
  const f=fixture(),locks=webLocks(),one=Learning.create({client:f.client,crypto:webcrypto,locks,requireLocks:true,clock:()=>10}),two=Learning.create({client:f.client,crypto:webcrypto,locks,requireLocks:true,clock:()=>20});
  await one.start(row,'challenge');const raw=f.data.get('owner-a:'+Learning.KEY);await assert.rejects(()=>two.start(row,'challenge'),/предыдущую попытку/);assert.equal(f.data.get('owner-a:'+Learning.KEY),raw);
  await assert.rejects(()=>two.recover(),/другой вкладке/);one.releaseOwnership();await Promise.resolve();assert.equal((await two.recover()).attempt.id,'attempt-one');await two.cancel();assert.equal(two.status().pending,null);
});
test('without protected writer locks the public player does not issue an unsafe attempt',async()=>{
  const f=fixture(),game=Learning.create({client:f.client,crypto:webcrypto,locks:null,requireLocks:true});await assert.rejects(()=>game.start(row,'challenge'),/актуальный браузер/);assert.equal(f.requests.length,0);
});
test('a reloaded ready ticket must be explicitly recovered before capturing a new performance',async()=>{
  const f=fixture(),game=Learning.create({client:f.client,crypto:webcrypto,clock:()=>10});await game.start(row,'memory');const reloaded=Learning.create({client:f.client,crypto:webcrypto,clock:()=>20});reloaded.read();assert.equal(reloaded.status().ready,false);await reloaded.recover();assert.equal(reloaded.status().ready,true);
});
