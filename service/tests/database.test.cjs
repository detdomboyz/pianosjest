'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {openRepository}=require('../repository.cjs');
async function setup(t){const dir=fs.mkdtempSync(path.resolve(__dirname,'../../tmp/repository-'));const store=await openRepository({filename:path.join(dir,'accounts.sqlite')});t.after(async()=>{await store.close();fs.rmSync(dir,{recursive:true,force:true});});return store;}
test('transaction reads wait for commit and rollback never exposes another request’s partial data',async t=>{
  const store=await setup(t);await store.register('transaction_user','Transactional user','hash-one','recovery-one',1);
  let release;const gate=new Promise(resolve=>{release=resolve;});let entered;const ready=new Promise(resolve=>{entered=resolve;});
  const write=store.atomic(async()=>{await store.statement('UPDATE users SET display_name=?').run('Partial');entered();await gate;throw Error('rollback fixture');});
  await ready;let observed=false;const read=store.credentials('transaction_user').then(row=>{observed=true;return row;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(observed,false);release();await assert.rejects(write,/rollback fixture/);assert.equal((await read).username,'transaction_user');
  const user=await store.credentials('transaction_user');assert.equal((await store.getUser(user.user_id)).displayName,'Transactional user');
});
test('concurrent optimistic writes cannot silently overwrite the same account',async t=>{
  const store=await setup(t),user=await store.register('revision_user','Revision user','hash','recovery',1);
  const results=await Promise.allSettled([store.putObject(user.id,'preferences',0,'{"mode":"a"}',2),store.putObject(user.id,'preferences',0,'{"mode":"b"}',2)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.status,409);assert.equal((await store.getObject(user.id,'preferences')).revision,1);
});
test('simultaneous retries create one operation receipt and keep independent owners isolated',async t=>{
  const store=await setup(t),a=await store.register('first_owner','First','hash','recovery',1),b=await store.register('second_owner','Second','hash','recovery',1),operation=randomUUID();
  const results=await Promise.all([store.createFeedback(a.id,'Proposal','Private text','lesson',2,operation),store.createFeedback(a.id,'Proposal','Private text','lesson',2,operation)]);
  assert.equal(results[0].id,results[1].id);assert.equal((await store.feedbackList(a.id)).length,1);assert.equal((await store.feedbackList(b.id)).length,0);
});
test('credential compare-and-set rejects a stale recovery after the first concurrent change',async t=>{
  const store=await setup(t),user=await store.register('credential_user','Credential user','original','recovery',1);
  const results=await Promise.allSettled([store.resetPassword(user.id,'new-one','code-one',2,{passwordHash:'original',recoveryHash:'recovery'}),store.resetPassword(user.id,'new-two','code-two',2,{passwordHash:'original',recoveryHash:'recovery'})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.find(x=>x.status==='rejected').reason.code,'CREDENTIAL_CHANGED');
});
