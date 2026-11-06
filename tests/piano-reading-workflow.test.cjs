'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Core=require('../piano-reading-session.js'),Bank=require('../piano-reading-bank.js'),Store=require('../piano-reading-store.js'),Controller=require('../piano-reading-controller.js'),Midi=require('../piano-reading-midi.js'),{baseSpecification}=require('../web-app/tools/reading-spec.cjs'),SourceAudit=require('../tools/piano-reading-catalog-audit.cjs');
// Protocol fixtures use an independent synthetic catalog in another register.
// Production catalog familiarity is covered separately in piano-reading-catalog.
function specification(){const base=baseSpecification(),audit=SourceAudit.audit([{id:'fixture-other-register',contentKind:'exercise',pattern:'1 2 3'}],Bank.candidates(base).items);return {...base,catalogAudit:{...audit,items:audit.items.map(({itemId,contentKey,occurrences})=>({itemId,contentKey,occurrences}))}};}
const NOW='2026-11-06T08:10:00Z',copy=x=>JSON.parse(JSON.stringify(x)),bank=Bank.build(specification());
function environment(shared){const map=shared?.map||new Map();let tail=Promise.resolve();const locks=shared?.locks||{request(name,options,work){assert.equal(name,Store.LOCK_NAME);assert.equal(options.mode,'exclusive');const result=tail.then(()=>work({name}));tail=result.catch(()=>{});return result;}},access=[],storage={getItem(key){access.push(['read',key]);return map.get(key)??null;},setItem(key,value){access.push(['write',key]);map.set(key,value);}},store=Store.create({storage,locks});let serial=0;const changes=[],controller=Controller.create({store,bank,clef:'treble',now:()=>NOW,sessionId:()=>`session-${++serial}-${shared?'b':'a'}`,onChange:s=>changes.push(s)});return {map,locks,storage,store,controller,access,changes,history:()=>Core.parseHistory(map.get(Store.STORAGE_KEY)??null)};}
function opts(id){return {sessionId:id,mode:'first',now:NOW,publishedExamples:bank.publishedExamples};}
function send(controller,sequence,source='midi'){for(const midi of sequence){controller.input({type:'note-on',midi,source});controller.input({type:'note-off',midi,source});}}

test('synthetic source-free bank contains six adjacent-step/repeated-attack templates per clef with four unpublished first items',()=>{
 assert.equal(bank.items.length,12);assert.equal(bank.publishedExamples.length,4);const keyset=new Set();
 for(const clef of ['treble','bass']){const items=bank.items.filter(i=>i.notation.clef===clef),published=new Set(bank.publishedExamples.map(Core.contentKey)),fresh=items.filter(i=>!published.has(Core.contentKey(i)));assert.equal(fresh.length,4);
  assert.deepEqual(fresh.map(i=>i.music.notes.map(n=>n.pitch.value)),clef==='treble'?[[60,62,64,64],[64,64,62,60],[64,62,62,60],[64,62,60,60]]:[[48,50,52,52],[52,52,50,48],[52,50,50,48],[52,50,48,48]]);
  for(const i of items){const pitches=i.music.notes.map(n=>n.pitch.value);assert.equal(pitches.length,4);assert.ok(pitches.slice(1).every((m,j)=>Math.abs(m-pitches[j])<=2));assert.equal(pitches.slice(1).filter((m,j)=>m===pitches[j]).length,1);assert.equal(new Set(pitches).size,3);assert.deepEqual(i.fingers,pitches.map(m=>clef==='treble'?{60:1,62:2,64:3}[m]:{48:5,50:4,52:3}[m]));keyset.add(Core.contentKey(i));}
 }assert.equal(keyset.size,12);
});

test('bank rejects wrong hands, changed fingers, bad timing and duplicate clefs without changing the source',()=>{
 const spec=specification(),before=copy(spec);for(const mutate of [s=>s.entries[0].hand='left',s=>s.entries[1].clef='treble',s=>s.entries[0].transfer[0].finger=5,s=>s.entries[1].demonstration[0].startBeat=2,s=>s.entries[0].demonstration[0].midi=61]){const bad=copy(spec);mutate(bad);assert.throws(()=>Bank.build(bad));}Bank.build(spec);assert.deepEqual(spec,before);
});

test('atomic next selection chooses different first items in cooperating tabs rather than opening a repeat',async()=>{
 const a=environment(),b=environment(a),items=bank.items.filter(i=>i.notation.clef==='treble'),[one,two]=await Promise.all([a.store.openNext(items,opts('a')),b.store.openNext(items,opts('b'))]);assert.equal(one.status,'saved');assert.equal(two.status,'saved');assert.notEqual(one.item.itemId,two.item.itemId);assert.equal(one.session.reservation.mode,'first');assert.equal(two.session.reservation.mode,'first');assert.equal(a.history().attempts.length,2);
});

test('atomic next exhausts four new treble items and never discards the bass branch',async()=>{
 const e=environment(),treble=bank.items.filter(i=>i.notation.clef==='treble');for(let i=0;i<4;i++)assert.equal((await e.store.openNext(treble,opts('t'+i))).status,'saved');const before=e.map.get(Store.STORAGE_KEY);assert.equal((await e.store.openNext(treble,opts('end'))).status,'exhausted');assert.equal(e.map.get(Store.STORAGE_KEY),before);assert.equal((await e.store.openNext(bank.items.filter(i=>i.notation.clef==='bass'),opts('bass'))).status,'saved');
});

test('history import preserves exposures, results, editions and extension data in an empty destination',async()=>{
 const source=environment(),opened=await source.store.openNext(bank.items,opts('original')),s=opened.session;let played=s;for(const midi of s.expected){played=Core.input(played,{type:'note-on',midi,source:'midi'});played=Core.input(played,{type:'note-off',midi,source:'midi'});}await source.store.finish(played,{now:NOW});
 const imported=source.history();imported.metadata={label:'keep me'};const target=environment(),r=await target.store.importHistory(JSON.stringify(imported));assert.equal(r.status,'saved');assert.deepEqual(target.history(),imported);const again=await target.store.importHistory(JSON.stringify(imported));assert.equal(again.status,'saved');assert.equal(target.history().attempts.length,1);assert.notEqual((await target.store.openNext(bank.items,opts('next'))).item.itemId,opened.item.itemId);
});

test('import never overwrites a different local history or accepts corrupted/future data',async()=>{
 const e=environment();await e.store.openNext(bank.items,opts('local'));const before=e.map.get(Store.STORAGE_KEY);for(const raw of [JSON.stringify(Core.emptyHistory()),'{broken',JSON.stringify({schemaVersion:2})]){const r=await e.store.importHistory(raw);assert.equal(r.status,'blocked');assert.equal(e.map.get(Store.STORAGE_KEY),before);}const e2=environment(),extended={...Core.emptyHistory(),metadata:'existing extension'};e2.map.set(Store.STORAGE_KEY,JSON.stringify(extended));assert.equal((await e2.store.importHistory(JSON.stringify(Core.emptyHistory()))).status,'blocked');assert.deepEqual(e2.history(),extended);
});

test('controller does not write on creation/refresh; a first item is not exposed before its store write completes',async()=>{
 const e=environment();assert.equal(e.access.length,0);await e.controller.refresh();assert.ok(e.access.every(a=>a[0]==='read'));const c=e.controller,pending=c.start('first');assert.equal(c.snapshot().item.role,'demonstration');await pending;assert.equal(c.snapshot().mode,'first');assert.equal(c.snapshot().phase,'active');assert.equal(c.snapshot().remaining,3);assert.equal(e.history().exposures.length,1);assert.equal(c.snapshot().exportText,'');
});

test('controller first MIDI response preserves a pitch-only result without revealing names before finish',async()=>{
 const e=environment(),c=e.controller;await c.start('first');const notes=c.snapshot().item.music.notes.map(n=>n.pitch.value);send(c,notes);assert.equal(c.snapshot().mode,'first');assert.equal(c.snapshot().captured,4);assert.equal(c.snapshot().held,0);await c.finish();assert.equal(c.snapshot().result.outcome,'first-pitch-order-matched');assert.equal(c.snapshot().result.executionVerified,false);assert.equal(c.snapshot().mode,'study');assert.equal(c.snapshot().phase,'finished');
});

test('explicit reveal makes an exact pointer response practice; changing saved description mode cannot change a session',async()=>{
 const e=environment(),c=e.controller;await c.start('first');await c.reveal();assert.equal(c.snapshot().mode,'study');assert.ok(c.snapshot().reasons.includes('names'));send(c,c.snapshot().item.music.notes.map(n=>n.pitch.value),'pointer');await c.finish();assert.equal(c.snapshot().result.outcome,'practice-only');assert.equal(c.snapshot().result.matched,true);assert.ok(c.snapshot().result.reasons.includes('non-midi-input'));
});

test('interruptions persist practice status without automatically revealing the first notation',async()=>{
 const e=environment(),c=e.controller;await c.start('first');await c.interrupt();assert.equal(c.snapshot().mode,'first');assert.ok(c.snapshot().reasons.includes('interrupted'));send(c,c.snapshot().item.music.notes.map(n=>n.pitch.value));await c.finish();assert.equal(c.snapshot().result.outcome,'practice-only');
});

test('controller blocks extra actions during a live attempt, handles held notes and cancels without restoring freshness',async()=>{
 const e=environment(),c=e.controller;await c.start('first');const original=c.snapshot().item.itemId;await c.exportHistory();assert.equal(c.snapshot().code,'ATTEMPT_ACTIVE');assert.equal(c.snapshot().exportText,'');await c.start('practice');assert.equal(c.snapshot().code,'ATTEMPT_ACTIVE');c.input({type:'note-on',midi:60,source:'midi'});await c.finish();assert.equal(c.snapshot().code,'RELEASE_REQUIRED');assert.equal(c.snapshot().phase,'active');await c.cancel();assert.equal(c.snapshot().phase,'ready');assert.equal(e.history().attempts[0].result,null);await c.start('first');assert.notEqual(c.snapshot().item.itemId,original);
});

test('controller write failure leaves the unseen candidate unexposed, and failed finish can be retried',async()=>{
 const e=environment(),c=e.controller,write=e.storage.setItem;e.storage.setItem=()=>{throw Error('quota');};await c.start('first');assert.equal(c.snapshot().phase,'blocked');assert.equal(c.snapshot().item.role,'demonstration');assert.equal(e.history().attempts.length,0);e.storage.setItem=write;await c.start('first');send(c,c.snapshot().item.music.notes.map(n=>n.pitch.value));e.storage.setItem=()=>{throw Error('quota');};await c.finish();assert.equal(c.snapshot().phase,'unsaved');assert.equal(c.snapshot().result,null);await c.start('first');assert.equal(c.snapshot().code,'ATTEMPT_ACTIVE');e.storage.setItem=write;await c.finish();assert.equal(c.snapshot().phase,'finished');assert.equal(e.history().attempts.length,1);
});

test('controller exports/imports only outside a live attempt and imported items remain exposed after reload',async()=>{
 const a=environment();await a.controller.start('first');await a.controller.cancel();await a.controller.exportHistory();const raw=a.controller.snapshot().exportText;assert.equal(Core.parseHistory(raw).exposures.length,1);const b=environment();await b.controller.importHistory(raw);assert.equal(b.controller.snapshot().remaining,3);await b.controller.start('first');assert.notEqual(b.controller.snapshot().item.itemId,a.history().attempts[0].identity.itemId);
});

test('a refused conflicting import preserves the ready screen, existing history and ability to start another item',async()=>{
 const e=environment(),c=e.controller;await c.start('first');await c.cancel();const before=e.map.get(Store.STORAGE_KEY);await c.importHistory(JSON.stringify(Core.emptyHistory()));assert.equal(c.snapshot().phase,'ready');assert.equal(c.snapshot().code,'HISTORY_NOT_EMPTY');assert.equal(e.map.get(Store.STORAGE_KEY),before);await c.start('first');assert.equal(c.snapshot().phase,'active');assert.equal(c.snapshot().remaining,2);
});

test('MIDI decoding handles channels and zero-velocity note-off; malformed bytes, controllers and SysEx are ignored',()=>{
 assert.deepEqual(Midi.decode([0x95,60,80]),{type:'note-on',midi:60,source:'midi'});assert.deepEqual(Midi.decode([0x95,60,0]),{type:'note-off',midi:60,source:'midi'});assert.deepEqual(Midi.decode([0x85,60,64]),{type:'note-off',midi:60,source:'midi'});
 for(const bytes of [null,[],[60,100],[-112,60,100],[0x90,128,100],[0x90,60,-1],[0xb0,64,127],[0xf0,0,0],[0x90,60,1.5]])assert.equal(Midi.decode(bytes),null);
});

function midiEnvironment(){const events=[],listeners=new Map(),ports=new Map();function port(id){const handlers=new Map(),p={id,name:'Keyboard '+id,state:'connected',async open(){events.push('open:'+id);},async close(){events.push('close:'+id);},addEventListener(k,f){handlers.set(k,f);},removeEventListener(k,f){if(handlers.get(k)===f)handlers.delete(k);},emit(data){handlers.get('midimessage')?.({data});},handlers};ports.set(id,p);return p;}const a=port('a'),b=port('b'),access={inputs:ports,addEventListener(k,f){listeners.set(k,f);},removeEventListener(k,f){if(listeners.get(k)===f)listeners.delete(k);}},input=[],interruptions=[],published=[];let calls=0;const connection=Midi.create({requestAccess:async o=>{assert.deepEqual(o,{sysex:false});calls++;return access;},onInput:e=>input.push(e),onInterrupted:()=>interruptions.push(true),onPorts:p=>published.push(p)});return {a,b,access,connection,events,listeners,input,interruptions,published,calls:()=>calls};}

test('MIDI access and port activation require explicit calls; only a selected input sends performer events',async()=>{
 const e=midiEnvironment();assert.equal(e.calls(),0);assert.deepEqual(e.events,[]);await e.connection.connect();assert.equal(e.calls(),1);assert.deepEqual(e.events,[]);e.a.emit([0x90,60,100]);assert.equal(e.input.length,0);await e.connection.select('a');e.a.emit([0x90,60,100]);assert.equal(e.input.length,1);assert.equal(e.connection.heldCount(),1);e.a.emit([0x90,60,0]);assert.equal(e.connection.heldCount(),0);e.connection.dispose();assert.equal(e.a.handlers.size,0);assert.equal(e.listeners.size,0);
});

test('MIDI port switch, disconnect and input reset interrupt the reading attempt and remove old listeners',async()=>{
 const e=midiEnvironment();await e.connection.connect();await e.connection.select('a');await e.connection.select('b');assert.equal(e.interruptions.length,1);assert.equal(e.a.handlers.size,0);e.b.emit([0x90,64,100]);e.b.emit([0xb0,123,0]);assert.equal(e.connection.heldCount(),0);assert.equal(e.interruptions.length,2);e.b.state='disconnected';e.listeners.get('statechange')();assert.equal(e.interruptions.length,3);assert.equal(e.b.handlers.size,0);e.connection.dispose();
});

test('a disposed or superseded async MIDI selection cannot leave an input listener active',async()=>{
 const e=midiEnvironment();await e.connection.connect();let release;e.a.open=()=>new Promise(resolve=>release=resolve);const pending=e.connection.select('a');await e.connection.select('b');release();await pending;assert.equal(e.a.handlers.size,0);assert.equal(e.b.handlers.size,1);e.connection.dispose();assert.equal(e.b.handlers.size,0);assert.equal(e.listeners.size,0);await assert.rejects(e.connection.connect(),/MIDI_DISPOSED/);
});

test('concurrent MIDI connection calls share one explicit permission request and one state listener',async()=>{
 const e=midiEnvironment();let resolve,calls=0;const connection=Midi.create({requestAccess:()=>{calls++;return new Promise(r=>resolve=r);}}),one=connection.connect(),two=connection.connect();assert.equal(calls,1);resolve(e.access);assert.deepEqual(await one,await two);assert.equal(e.listeners.size,1);connection.dispose();assert.equal(e.listeners.size,0);
});

test('a closed MIDI connection interrupts even when its device remains physically connected',async()=>{
 const e=midiEnvironment();await e.connection.connect();await e.connection.select('a');e.a.connection='closed';e.listeners.get('statechange')();assert.equal(e.a.state,'connected');assert.equal(e.interruptions.length,1);assert.equal(e.a.handlers.size,0);e.connection.dispose();
});
