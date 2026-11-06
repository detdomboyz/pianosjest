'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Core=require('../piano-reading-session.js'),Store=require('../piano-reading-store.js'),Staff=require('../piano-staff-view.js'),{examples}=require('../web-reader/tools/fixtures.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),NOW='2026-11-06T07:30:00.000Z',LATER='2026-11-06T07:31:00.000Z';
function item(sequence=[60,64,62,64],clef='treble',id='unseen-a'){
 const octave=clef==='treble'?4:3,base=12*(octave+1),step=m=>({0:'C',2:'D',4:'E'}[m-base]);
 return {schemaVersion:1,instrument:'piano',itemId:id,itemVersion:'v1',lessonId:'detail-p-read-'+clef+'-01',music:{schemaVersion:1,id:'score-'+id,revision:'score-v1',timeUnit:'quarter',bpm:56,parts:[{id:'line'},{id:'other'}],notes:sequence.map((value,i)=>({id:'n'+i,partId:'line',pitch:{kind:'midi',value},span:{kind:'known',start:i,duration:1}}))},notation:{documentRevision:'score-v1',partId:'line',clef,spelling:sequence.map((m,i)=>({noteId:'n'+i,step:step(m),octave,alter:0}))}};
}
function published(){const demos=examples(),plans=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/piano-lesson-backlog.json'),'utf8')).lessons;return ['treble','bass'].flatMap(clef=>{const f=demos[clef],plan=plans.find(p=>p.id==='detail-p-read-'+clef+'-01'),demo={schemaVersion:1,instrument:'piano',itemId:'published-'+clef,itemVersion:'v1',lessonId:plan.id,music:f.music,notation:f.notation};return [demo,item(plan.transfer.notes.map(n=>n.midi),clef,'published-transfer-'+clef)];});}
function options(id='attempt-a',mode='first'){return {sessionId:id,mode,now:NOW,publishedExamples:published()};}
function opened(source=item(),id='attempt-a',history=Core.emptyHistory(),mode='first'){const c=Core.open(history,source,options(id,mode));return {...c,session:Core.activate(c.session,c.history)};}
function play(session,sequence=session.expected,source='midi'){let s=session;for(const midi of sequence){s=Core.input(s,{type:'note-on',midi,source});s=Core.input(s,{type:'note-off',midi,source});}return s;}
function finish(change,session=play(change.session)){return Core.finish(change.history,session,{now:LATER});}
function freeze(x){if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(freeze);}return x;}
function env(initial){const map=new Map(initial===undefined?[]:[[Store.STORAGE_KEY,initial]]),access=[],locksCalled=[];let tail=Promise.resolve();
 const storage={getItem(k){access.push(['read',k]);return map.get(k)??null;},setItem(k,v){access.push(['write',k]);map.set(k,v);}},locks={request(name,opts,callback){locksCalled.push({name,...opts});const next=tail.then(()=>callback({name,mode:opts.mode}));tail=next.catch(()=>{});return next;}};
 return {map,access,locksCalled,storage,locks,store:Store.create({storage,locks}),history:()=>Core.parseHistory(map.get(Store.STORAGE_KEY)??null)};
}

test('opening reserves exposure before activation; pending sessions cannot capture a response',()=>{
 const source=freeze(item()),history=freeze(Core.emptyHistory()),before=copy({source,history}),c=Core.open(history,source,freeze(options()));
 assert.equal(c.session.phase,'awaiting-save');assert.equal(c.history.exposures.length,1);assert.equal(c.history.attempts[0].result,null);
 assert.throws(()=>Core.input(c.session,{type:'note-on',midi:60,source:'midi'}),{code:'SESSION_NOT_ACTIVE'});
 assert.throws(()=>Core.activate(c.session,history),{code:'SESSION_NOT_FOUND'});
 assert.equal(Core.activate(c.session,c.history).phase,'active');assert.deepEqual({source,history},before);
});

test('fresh MIDI onset order has its own limited result and exact source edition identity in both clefs',()=>{
 for(const clef of ['treble','bass']){const source=item(clef==='treble'?[60,64,62,64]:[48,52,50,52],clef),c=opened(source),done=finish(c);
  assert.equal(done.result.outcome,'first-pitch-order-matched');assert.equal(done.result.scope,'pitch-order-only');assert.equal(done.result.executionVerified,false);
  assert.deepEqual(done.history.attempts[0].identity,{instrument:'piano',lessonId:source.lessonId,itemId:source.itemId,itemVersion:'v1',documentId:source.music.id,documentRevision:'score-v1',partId:'line'});
  assert.ok(!Object.hasOwn(done.result,'cleanTakes')&&!Object.hasOwn(done.result,'memoryVerified'));assert.deepEqual(Core.parseHistory(JSON.stringify(done.history)),done.history);
 }
});

test('missing, wrong and extra MIDI attacks fail the pitch sequence without losing the first reservation',()=>{
 for(const sequence of [[60,64,62],[60,62,62,64],[60,64,62,64,60],[]]){const c=opened(),done=finish(c,play(c.session,sequence));assert.equal(done.result.outcome,'first-needs-repeat');assert.equal(done.result.matched,false);assert.equal(done.history.exposures.length,1);}
});

test('renaming, edition, BPM, timing and note IDs do not manufacture a new pitch-reading item',()=>{
 const original=item(),variant=copy(original);variant.itemId='renamed';variant.itemVersion='v2';variant.music.id='new-score';variant.music.revision='new-edition';variant.music.bpm=84;variant.notation.documentRevision='new-edition';
 variant.music.notes.forEach((n,i)=>{n.id='new-'+i;n.span={kind:'known',start:i*2,duration:.5};variant.notation.spelling[i].noteId=n.id;});
 assert.equal(Core.contentKey(original),Core.contentKey(variant));const first=opened(original),next=opened(variant,'second',first.history);assert.equal(next.session.reservation.mode,'practice');assert.deepEqual(next.session.reasons,['already-exposed']);assert.equal(finish(next).result.outcome,'practice-only');assert.equal(next.history.exposures.length,1);assert.equal(next.history.attempts[1].identity.itemVersion,'v2');
});

test('actual published treble/bass demonstrations and transfer examples are excluded even when renamed',()=>{
 const known=published(),bank=known.map((x,i)=>({...copy(x),itemId:'renamed-'+i,itemVersion:'v99'}));assert.equal(known.length,4);
 assert.equal(Core.selectUnseen(Core.emptyHistory(),bank,known),null);
 for(const source of bank){const c=Core.open(Core.emptyHistory(),source,{...options(),publishedExamples:known});assert.equal(c.session.reservation.mode,'practice');assert.ok(c.session.reasons.includes('published-example'));}
 assert.throws(()=>Core.selectUnseen(Core.emptyHistory(),[item()],[]),{code:'PUBLISHED_EXAMPLES_REQUIRED'});
});

test('bank exhaustion returns no unknown item; exposure persists across serialization and reload',()=>{
 const source=item(),c=opened(source),reloaded=Core.parseHistory(JSON.stringify(c.history));assert.equal(Core.selectUnseen(reloaded,[source],published()),null);
 const next=opened(source,'after-reload',reloaded);assert.equal(next.session.reservation.mode,'practice');assert.equal(next.history.attempts[0].result,null);
 const other=item([60,62,64,62],'treble','other');assert.equal(Core.selectUnseen(reloaded,[source,other],published()).itemId,'other');
});

test('all assistance and retries irreversibly mark practice; stored help survives a stale in-memory session',()=>{
 for(const reason of ['answer','names','fingering','audio-replay','text-alternative','retry','interrupted']){const c=opened(),s=Core.assist(play(c.session),reason),done=finish(c,reason==='retry'?play(s):s);assert.equal(done.result.outcome,'practice-only');assert.ok(done.result.reasons.includes(reason));}
 const c=opened(),help=Core.rememberAssistance(c.history,Core.assist(c.session,'names')),done=Core.finish(help.history,play(c.session),{now:LATER});assert.equal(done.result.outcome,'practice-only');assert.deepEqual(done.result.reasons,['names']);
});

test('pointer and keyboard practice cannot earn a first MIDI response result',()=>{
 for(const source of ['pointer','keyboard']){const c=opened(),done=finish(c,play(c.session,undefined,source));assert.equal(done.result.matched,true);assert.equal(done.result.outcome,'practice-only');assert.ok(done.result.reasons.includes('non-midi-input'));}
});

test('a repeated pitch requires note-off then a new note-on; held keys prevent finish',()=>{
 const c=opened(item([60,62,62,64])),on=Core.input(c.session,{type:'note-on',midi:60,source:'midi'});assert.throws(()=>finish(c,on),{code:'RELEASE_REQUIRED'});
 const duplicate=Core.input(on,{type:'note-on',midi:60,source:'midi'});assert.deepEqual(duplicate.played,[60]);assert.deepEqual(duplicate.reasons,['published-example','duplicate-note-on']);
 let s=c.session;for(const midi of [60,62,62,64]){s=Core.input(s,{type:'note-on',midi,source:'midi'});s=Core.input(s,{type:'note-off',midi,source:'midi'});}assert.equal(finish(c,s).result.outcome,'practice-only'); // published demonstration
 const fresh=opened(item([60,64,64,62]));assert.equal(finish(fresh).result.outcome,'first-pitch-order-matched');
 const overlapping=Core.input(on,{type:'note-on',midi:64,source:'midi'});assert.ok(overlapping.reasons.includes('overlap'));
});

test('source edits, unsupported notes, other instruments and malformed responses are rejected without source mutation',()=>{
 const source=item(),before=copy(source);for(const mutate of [s=>s.notation.documentRevision='stale',s=>s.notation.partId='missing',s=>s.music.notes[0].pitch.value=61,s=>s.instrument='guitar']){const s=copy(source);mutate(s);assert.throws(()=>Core.open(Core.emptyHistory(),s,options()));}
 const c=opened();for(const event of [{type:'note-on',midi:128,source:'midi'},{type:'note-on',midi:60,source:'audio-preview'},{type:'hold',midi:60,source:'midi'}])assert.throws(()=>Core.input(c.session,event),{code:'INPUT_INVALID'});
 const forged=copy(play(c.session));forged.reservation.identity.documentRevision='other';assert.throws(()=>finish(c,forged),{code:'SESSION_NOT_FOUND'});assert.deepEqual(source,before);
});

test('corrupt, future-version, duplicate and orphan histories fail closed; unknown extension data roundtrips',()=>{
 const c=opened(),bad=[undefined,'','not json','null',JSON.stringify({...c.history,schemaVersion:2})];
 for(const mutate of [h=>h.attempts.push(copy(h.attempts[0])),h=>h.attempts=[],h=>h.exposures[0].contentKey='bad',h=>h.attempts[0].identity.instrument='guitar',h=>h.attempts[0].reasons=['invented']]){const h=copy(c.history);mutate(h);bad.push(JSON.stringify(h));}
 for(const raw of bad)assert.throws(()=>Core.parseHistory(raw));assert.deepEqual(Core.parseHistory(null),Core.emptyHistory());
 const contradictory=finish(c).history;contradictory.attempts[0].result.played=[60];assert.throws(()=>Core.validateHistory(contradictory),{code:'HISTORY_INVALID'});
 const extended={...c.history,userMetadata:{label:'keep me'}};extended.attempts[0].annotation='keep this too';assert.deepEqual(Core.validateHistory(extended),extended);
});

test('finish is idempotent and sessions cannot reuse IDs or accept input after completion',()=>{
 const c=opened(),done=finish(c),again=Core.finish(done.history,done.session,{now:'2026-11-07T07:00:00Z'});assert.deepEqual(again,done);assert.equal(done.history.attempts.length,1);
 assert.throws(()=>Core.input(done.session,{type:'note-on',midi:60,source:'midi'}),{code:'SESSION_NOT_ACTIVE'});assert.throws(()=>Core.open(done.history,item(),options()),{code:'SESSION_ID_REUSED'});
});

test('injected store confirms exposure write before exposing an active session and uses only its own key',async()=>{
 const e=env();e.map.set('music-learning-piano-v1','existing memory');e.map.set('piano-blind-trainer-catalog-v1','existing notes');const opened=await e.store.open(item(),options());assert.equal(opened.status,'saved');assert.equal(opened.session.phase,'active');assert.equal(e.history().attempts.length,1);
 assert.deepEqual(e.access.map(x=>x[0]),['read','write','read']);assert.ok(e.access.every(x=>x[1]===Store.STORAGE_KEY));assert.ok(e.locksCalled.every(l=>l.name===Store.LOCK_NAME&&l.mode==='exclusive'));assert.equal(e.map.get('music-learning-piano-v1'),'existing memory');assert.equal(e.map.get('piano-blind-trainer-catalog-v1'),'existing notes');
 const done=await e.store.finish(play(opened.session),{now:LATER});assert.equal(done.status,'saved');assert.equal(done.result.outcome,'first-pitch-order-matched');
});

test('same-origin cooperating tabs serialize fresh opens and preserve both results when finishing out of order',async()=>{
 const e=env(),second=Store.create({storage:e.storage,locks:e.locks}),[a,b]=await Promise.all([e.store.open(item(),options('tab-a')),second.open(item(),options('tab-b'))]);
 assert.equal(a.status,'saved');assert.equal(b.status,'saved');assert.equal(a.session.reservation.mode,'first');assert.equal(b.session.reservation.mode,'practice');assert.equal(e.history().exposures.length,1);
 await second.finish(play(b.session),{now:LATER});await e.store.finish(play(a.session),{now:LATER});const h=e.history();assert.equal(h.attempts.length,2);assert.deepEqual(h.attempts.map(a=>a.result.outcome),['first-pitch-order-matched','practice-only']);
});

test('storage read/write errors and unconfirmed writes block opening without returning the candidate',async()=>{
 for(const fault of ['read','write','no-op','readback']){const e=env(),realGet=e.storage.getItem;let reads=0;e.storage.getItem=k=>{reads++;if(fault==='read'||(fault==='readback'&&reads>1))throw new Error('denied');return realGet(k);};if(fault==='write')e.storage.setItem=()=>{throw new Error('quota');};if(fault==='no-op')e.storage.setItem=()=>{};
  const r=await e.store.open(item(),options());assert.equal(r.status,'blocked');assert.ok(!r.session&&!r.history);assert.equal(r.code,{read:'STORAGE_READ_FAILED',write:'STORAGE_WRITE_FAILED','no-op':'SAVE_NOT_CONFIRMED',readback:'SAVE_NOT_CONFIRMED'}[fault]);
 }
});

test('corrupted stored history is preserved byte for byte rather than reset on open',async()=>{
 for(const raw of ['{broken',JSON.stringify({schemaVersion:99}),JSON.stringify({...Core.emptyHistory(),scope:'memory'})]){const e=env(raw),r=await e.store.open(item(),options());assert.equal(r.status,'blocked');assert.equal(e.map.get(Store.STORAGE_KEY),raw);assert.ok(!e.access.some(a=>a[0]==='write'));}
});

test('without an acquired Web Lock no new item is opened or storage written',async()=>{
 for(const locks of [undefined,{request(){throw new Error('not supported');}},{async request(n,o,callback){return callback(null);}}]){const e=env(),r=await Store.create({storage:e.storage,locks}).open(item(),options());assert.equal(r.status,'blocked');assert.equal(e.access.length,0);assert.equal(e.map.size,0);}
});

test('failed assistance save keeps practice status locally and is merged on the next successful finish',async()=>{
 const e=env(),c=await e.store.open(item(),options()),write=e.storage.setItem;e.storage.setItem=()=>{throw new Error('quota');};const help=await e.store.assist(c.session,'names');assert.equal(help.status,'unsaved');assert.ok(help.session.reasons.includes('names'));assert.equal(e.history().attempts[0].reasons.length,0);
 e.storage.setItem=write;const done=await e.store.finish(play(help.session),{now:LATER});assert.equal(done.status,'saved');assert.equal(done.result.outcome,'practice-only');assert.deepEqual(e.history().attempts[0].result.reasons,['names']);
});

test('unsaved finish grants no result, retains exposure and can be retried without a duplicate',async()=>{
 const e=env(),c=await e.store.open(item(),options()),write=e.storage.setItem;e.storage.setItem=()=>{throw new Error('quota');};const session=play(c.session),r=await e.store.finish(session,{now:LATER});assert.equal(r.status,'unsaved');assert.ok(!r.result);assert.equal(e.history().exposures.length,1);assert.equal(e.history().attempts[0].result,null);
 e.storage.setItem=write;const done=await e.store.finish(session,{now:LATER}),again=await e.store.finish(session,{now:LATER});assert.equal(done.status,'saved');assert.deepEqual(done.result,again.result);assert.equal(e.history().attempts.length,1);
});

test('separate new pitches stay fresh while assistance persisted by another tab remains irreversible',async()=>{
 const e=env(),a=await e.store.open(item(),options('a')),b=await e.store.open(item([64,62,60,62],'treble','second'),options('b'));assert.equal(b.session.reservation.mode,'first');
 await e.store.assist(a.session,'text-alternative');const done=await e.store.finish(play(a.session),{now:LATER});assert.equal(done.result.outcome,'practice-only');assert.deepEqual(done.result.reasons,['text-alternative']);assert.equal(e.history().attempts[1].result,null);
});

test('a failed readback after a successful result write can be retried idempotently; queued inputs are captured',async()=>{
 const e=env(),source=item(),settings=options(),pending=e.store.open(source,settings);source.itemId='changed-later';settings.sessionId='changed-later';const c=await pending;assert.equal(c.session.reservation.id,'attempt-a');assert.equal(c.session.reservation.identity.itemId,'unseen-a');
 const get=e.storage.getItem,session=play(c.session);let reads=0;e.storage.getItem=k=>{if(++reads===2)throw new Error('readback denied');return get(k);};const uncertain=await e.store.finish(session,{now:LATER});assert.equal(uncertain.status,'unsaved');assert.ok(!uncertain.result);
 e.storage.getItem=get;const saved=await e.store.finish(session,{now:LATER});assert.equal(saved.status,'saved');assert.equal(saved.result.outcome,'first-pitch-order-matched');assert.equal(e.history().attempts.length,1);
});

test('browser UMD modules import without reading storage, devices, network or the app runtime',()=>{
 const window={PianoStaffView:Staff};for(const key of ['localStorage','navigator','fetch','document'])Object.defineProperty(window,key,{get(){throw new Error('unexpected global access '+key);}});
 const context=vm.createContext({window});for(const name of ['piano-reading-session.js','piano-reading-store.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context,{filename:name});
 assert.equal(window.PianoReadingSession.VERSION,1);assert.equal(window.PianoReadingStore.STORAGE_KEY,'music-reading-piano-v1');assert.ok(window.PianoReadingStore.create());
});
