'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),Copy=require('../piano-legacy-catalog-copy.js');
const subtle={digest:crypto.webcrypto.subtle.digest.bind(crypto.webcrypto.subtle)},now=()=> '2026-11-07T13:50:00.000Z';
function setup(extra={}){let opens=0;const copies=Copy.create({indexedDB:{open(){opens++;throw Error('Unexpected database open');}},subtle,now,...extra});return {copies,opens:()=>opens};}
const expected=raw=>crypto.createHash('sha256').update(Buffer.concat([Buffer.from([raw===null?0:1]),Buffer.from(raw??'','utf16le')])).digest('hex');
test('import and construction do not access global storage, database, network or devices',()=>{
 const reads=[],context={window:{}};for(const key of ['indexedDB','fetch','localStorage','navigator'])Object.defineProperty(context,key,{get(){reads.push(key);throw Error('Unexpected access');}});vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../piano-legacy-catalog-copy.js'),'utf8'),context);assert.equal(context.window.PianoLegacyCatalogCopy.VERSION,1);const s=setup();assert.equal(s.opens(),0);assert.deepEqual(reads,[]);assert.equal(require('../tools/build-web.cjs').ASSETS.includes('piano-legacy-catalog-copy.js'),false);
});
test('unavailable configuration and names outside the own namespace are rejected',()=>{
 assert.throws(()=>Copy.create(),{code:'UNAVAILABLE'});assert.throws(()=>setup({subtle:{}}),{code:'UNAVAILABLE'});for(const name of ['private','melodiajest-piano-packages-v1','melodiajest-legacy-catalog-v1-qa-../other'])assert.throws(()=>setup({name}),{code:'INPUT'});
});
test('the fixed key is read once before digest awaits and the token never exposes private data',async()=>{
 let raw='  {"private":"copy exact"}\n',calls=0,release;const gate=new Promise(r=>{release=r;}),s=setup({subtle:{digest:async(...args)=>{await gate;return subtle.digest(...args);}}}),work=s.copies.prepareFrom({getItem:key=>{assert.equal(key,Copy.KEY);calls++;return raw;}});raw='late source change';assert.equal(calls,1);release();const change=await work;assert.equal(change.id,expected('  {"private":"copy exact"}\n'));assert.equal(Object.hasOwn(change,'raw'),false);assert.equal(JSON.stringify(change).includes('private'),false);assert.equal(s.opens(),0);assert.ok(Object.isFrozen(change));
});
test('missing, empty, malformed JSON and exact UTF-16 units have independently checked hashes',async()=>{
 const s=setup(),values=[null,'','not json\n','\ud800','\ud801','\ufffd','🎹\u0000  '],ids=[];for(const raw of values){const change=await s.copies.prepareFrom({getItem:()=>raw});assert.equal(change.id,expected(raw));assert.equal(change.codeUnits,raw?.length??0);assert.equal(change.missing,raw===null);ids.push(change.id);}assert.equal(new Set(ids).size,values.length);assert.equal(s.opens(),0);
});
test('source access and digest failures are typed without leaking the provider message',async()=>{
 const s=setup();for(const storage of [{},{getItem:()=>undefined},{getItem:()=>7}])await assert.rejects(s.copies.prepareFrom(storage),{code:'INPUT'});await assert.rejects(s.copies.prepareFrom({getItem(){throw Error('PRIVATE source');}}),e=>e.code==='UNAVAILABLE'&&!e.message.includes('PRIVATE'));const broken=setup({subtle:{digest:async()=>{throw Error('PRIVATE digest');}}});await assert.rejects(broken.copies.prepareFrom({getItem:()=>'{PRIVATE}'}),e=>e.code==='DIGEST'&&!e.message.includes('PRIVATE'));assert.equal(s.opens(),0);
});
test('JSON copies, fake and foreign tokens are rejected before persistence',async()=>{
 const a=setup(),b=setup(),token=await a.copies.prepareFrom({getItem:()=>'{raw}'});for(const fake of [{},JSON.parse(JSON.stringify(token)),Object.freeze({...token})])await assert.rejects(a.copies.commit(fake),{code:'PLAN'});await assert.rejects(b.copies.commit(token),{code:'PLAN'});assert.equal(a.opens()+b.opens(),0);
});
test('closing before or during preparation cannot create a late token or write',async()=>{
 const s=setup();s.copies.close();await assert.rejects(s.copies.prepareFrom({getItem:()=>''}),{code:'CLOSED'});await assert.rejects(s.copies.read('a'.repeat(64)),{code:'CLOSED'});let release;const gate=new Promise(r=>{release=r;}),late=setup({subtle:{digest:async(...args)=>{await gate;return subtle.digest(...args);}}}),work=late.copies.prepareFrom({getItem:()=>''});late.copies.close();release();await assert.rejects(work,{code:'CLOSED'});assert.equal(s.opens()+late.opens(),0);
});
test('size, timestamp and read identifiers fail explicitly before database access',async()=>{
 const s=setup();await assert.rejects(s.copies.prepareFrom({getItem:()=> 'a'.repeat(Copy.MAX_CODE_UNITS+1)}),{code:'LIMIT'});const bad=setup({now:()=> 'not-time'});await assert.rejects(bad.copies.prepareFrom({getItem:()=>null}),{code:'INPUT'});for(const id of ['',null,'A'.repeat(64),'../private'])await assert.rejects(s.copies.read(id),{code:'INPUT'});assert.equal(s.opens()+bad.opens(),0);
});
