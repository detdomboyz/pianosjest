'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const Controller=require('../piano-lesson-package-controller.js'),Store=require('../piano-lesson-package-store.js'),Loader=require('../piano-lesson-package-loader.js');
const data=require('../tools/qa-piano-package-planner.cjs').buildFixture(),fixture=data.fixture,copy=x=>JSON.parse(JSON.stringify(x));
const subtle={digest:webcrypto.subtle.digest.bind(webcrypto.subtle)};
const client=prefix=>Loader.create({baseUrl:'https://controller.invalid/'+prefix+'/',origin:'https://controller.invalid',subtle,fetch:async url=>{const raw=data.files.get(new URL(url).pathname.slice(1));return new Response(raw??'',{status:raw?200:404,headers:{'Content-Type':'application/json'}});}});
const verified=Promise.all([client('old').load({pin:fixture.previous}),client('new').load({pin:fixture.incoming})]);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
// Deliberately only an I/O spy: no IndexedDB, CAS or planner algorithm is reimplemented.
function io({stageGate,commitGate,stageError}={}){
 const calls=[],captures=[];let commits=0;
 const before=Object.freeze({format:'melodiajest-piano-package-state-v1',revision:1,operationId:'initial',...Store.validateCandidate(fixture.initial)});
 const store={read:async()=>{calls.push('read');return before;},prepare(expected,candidate){calls.push('prepare');const next=Store.validateCandidate(candidate);captures.push({expected,next});return Object.freeze({operationId:'operation-'+captures.length,fromRevision:expected?.revision??0,toRevision:(expected?.revision??0)+1});},stage:async()=>{calls.push('stage');if(stageError)throw stageError;if(stageGate)await stageGate.promise;return {status:'staged'};},commit:async change=>{calls.push('commit');if(commitGate)await commitGate.promise;commits++;const capture=captures.find((x,i)=>'operation-'+(i+1)===change.operationId);return {status:commits>1?'replayed':'committed',durability:'strict',current:Object.freeze({format:'melodiajest-piano-package-state-v1',revision:change.toRevision,operationId:change.operationId,...capture.next})};},recoverPending:async()=>null,exportRecovery:async()=>'{"private":"explicit export"}',close:()=>calls.push('close')};
 return {store,calls,captures,before};
}
test('controller import and creation do not access database, network, legacy storage or devices',()=>{
 const reads=[],context={window:{PianoLessonPackageStore:Store,PianoLessonPackagePlanner:require('../piano-lesson-package-planner.js'),PianoLessonPackageLoader:Loader}};
 for(const name of ['indexedDB','fetch','localStorage','navigator'])Object.defineProperty(context,name,{get(){reads.push(name);throw Error('Unexpected access');}});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../piano-lesson-package-controller.js'),'utf8'),context);assert.equal(context.window.PianoLessonPackageController.VERSION,1);const spy=io(),c=Controller.create({store:spy.store,subtle});assert.equal(c.status().phase,'idle');assert.deepEqual(spy.calls,[]);assert.deepEqual(reads,[]);assert.equal(require('../tools/build-web.cjs').ASSETS.includes('piano-lesson-package-controller.js'),false);
});
test('configuration and fake verified package/token/view fail before persistence',async()=>{
 assert.throws(()=>Controller.create({store:{},subtle}),{code:'UNAVAILABLE'});assert.throws(()=>Controller.create({store:io().store}),{code:'UNAVAILABLE'});const [source]=await verified,spy=io(),c=Controller.create({store:spy.store,subtle});
 await assert.rejects(c.initializeV7(copy(source),fixture.initial.catalog),{code:'INPUT'});await assert.rejects(c.writeCatalog({},fixture.initial.catalog),{code:'PLAN'});await assert.rejects(c.commitUpdate({}),{code:'PLAN'});await assert.rejects(c.commitRecovery({}),{code:'PLAN'});assert.deepEqual(spy.calls,[]);assert.equal(c.status().phase,'failed');
});
test('initialization captures all fields before awaiting and reports saved only after commit resolves',async()=>{
 const [source]=await verified,stageGate=deferred(),commitGate=deferred(),spy=io({stageGate,commitGate}),events=[],c=Controller.create({store:spy.store,subtle,onChange:s=>events.push(s)}),catalog=copy(fixture.initial.catalog),before=copy(catalog),saving=c.initializeV7(source,catalog);catalog.lessons[0].pattern='late caller edit';assert.deepEqual(spy.captures[0].next.catalog,before);await Promise.resolve();assert.equal(c.status().phase,'saving');stageGate.resolve();await new Promise(setImmediate);assert.equal(c.status().phase,'saving');assert.ok(c.status().stagedOperationId);commitGate.resolve();const out=await saving;assert.equal(out.current.revision,1);assert.equal(c.status().phase,'saved');assert.deepEqual(spy.calls,['prepare','stage','commit']);assert.ok(events.every(s=>!Object.hasOwn(s,'catalog')));
});
test('a real verified three-way proposal uses the captured source/view and one staged change on replay',async()=>{
 const [previous,incoming]=await verified,spy=io(),c=Controller.create({store:spy.store,subtle}),proposal=await c.prepareUpdate({previous,incoming});assert.equal(proposal.status,'ready');assert.deepEqual(proposal,fixture.expected);const one=await c.commitUpdate(proposal),two=await c.commitUpdate(proposal);assert.equal(one.current.revision,2);assert.equal(two.status,'replayed');assert.equal(spy.calls.filter(x=>x==='stage').length,1);assert.equal(spy.calls.filter(x=>x==='prepare').length,1);assert.equal(spy.captures[0].expected,spy.before);assert.deepEqual(spy.captures[0].next,fixture.expectedCandidate);
});
test('a cloned/cross-controller update proposal cannot be committed',async()=>{
 const [previous,incoming]=await verified,a=io(),b=io(),first=Controller.create({store:a.store,subtle}),second=Controller.create({store:b.store,subtle}),proposal=await first.prepareUpdate({previous,incoming});await assert.rejects(first.commitUpdate(copy(proposal)),{code:'PLAN'});await assert.rejects(second.commitUpdate(proposal),{code:'PLAN'});assert.deepEqual(a.calls,['read']);assert.deepEqual(b.calls,[]);
});
test('ordinary catalog writes preserve private notes, fingers, versions, annotations, order and content kind',async()=>{
 const spy=io(),c=Controller.create({store:spy.store,subtle}),view=await c.read(),catalog=copy(view.catalog);catalog.lessons.at(-1).description='Explicit private edit';const expected=copy(catalog),saving=c.writeCatalog(view,catalog);catalog.lessons.reverse();catalog.lessons[0].pattern='late';const out=await saving;assert.deepEqual(spy.captures[0].next.catalog,expected);assert.deepEqual(out.current.catalog,expected);await assert.rejects(c.writeCatalog(copy(view),expected),{code:'PLAN'});assert.ok(expected.lessons.some(l=>l.id==='qa-private-piece'&&l.contentKind==='piece'));
});
test('typed storage failures expose no raw private error and do not claim a staged draft',async()=>{
 const [source]=await verified,spy=io({stageError:Object.assign(new Error('private draft secret in provider message'),{code:'QUOTA'})}),c=Controller.create({store:spy.store,subtle});await assert.rejects(c.initializeV7(source,fixture.initial.catalog),e=>e.code==='QUOTA'&&!e.message.includes('secret'));assert.equal(c.status().phase,'failed');assert.equal(c.status().stagedOperationId,null);assert.equal(spy.calls.includes('commit'),false);
});
test('observer exceptions cannot turn a completed save into false failure',async()=>{
 const [source]=await verified,spy=io(),c=Controller.create({store:spy.store,subtle,onChange(){throw Error('observer failed');}}),out=await c.initializeV7(source,fixture.initial.catalog);assert.equal(out.status,'committed');assert.equal(c.status().phase,'saved');assert.equal(c.status().code,null);
});
test('closing before a queued write starts leaves the candidate uncommitted',async()=>{
 const [source]=await verified,spy=io(),c=Controller.create({store:spy.store,subtle}),saving=c.initializeV7(source,fixture.initial.catalog);c.close();await assert.rejects(saving,{code:'CLOSED'});assert.deepEqual(spy.calls,['prepare','close']);await assert.rejects(c.read(),{code:'CLOSED'});
});
test('digest failure and empty recovery are explicit and never trigger a write or export',async()=>{
 const [previous,incoming]=await verified,spy=io(),c=Controller.create({store:spy.store,subtle:{digest:async()=>{throw Error('private digest message');}}});await assert.rejects(c.prepareUpdate({previous,incoming}),{code:'DIGEST'});assert.equal(c.status().phase,'failed');assert.deepEqual(spy.calls,['read']);assert.equal(await c.prepareRecovery(),null);assert.equal(await c.exportRecovery(),'{"private":"explicit export"}');
});
