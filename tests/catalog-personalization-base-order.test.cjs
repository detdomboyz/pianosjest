'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../catalog-personalization.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const create=(b,c)=>P.create(b,c,{baseRelease:'23.5.61'});
function base(){return {version:7,savedAt:'2026-11-19T00:00:00Z',themes:[{id:'t1',name:'Один',order:1},{id:'t2',name:'Два',order:2}],lessons:[{id:'a',themeId:'t1',title:'A',pattern:'t y',order:1,rhythm:{steps:[{startBeat:0,durationBeats:1},{startBeat:1,durationBeats:1}]},fingeringSpec:{hand:'right',fingers:[1,2]},extra:{unicode:'🎹',values:[false,0,null]}},{id:'b',themeId:'t2',title:'B',pattern:'u y',order:2}]};}
function restore(b,p,c){const rb=copy(b),rp=copy(p),r=P.apply(b,p);assert.equal(r.ok,true);assert.deepEqual(r.snapshot,c);assert.deepEqual(b,rb);assert.deepEqual(p,rp);}

test('base-order: the actual growing shipped corpus stores one title edit under2k and restores all music exactly',()=>{
 const b=copy(require('./helpers/load-app.cjs').loadApp().catalogSnapshot()),c=copy(b);assert.ok(b.lessons.length>=755);for(const id of ['detail-p-fsharp-major-upper-three-paired-descent-01','detail-p-fsharp-major-middle-three-paired-descent-01','detail-p-fsharp-major-lower-four-paired-descent-01'])assert.ok(b.lessons.some(x=>x.id===id));c.lessons.find(x=>x.id==='course01-01').title='Личная подпись';const p=create(b,c);assert.ok(Buffer.byteLength(JSON.stringify(p))<2000);assert.equal(p.lessons.baseOrder,true);assert.equal(p.themes.baseOrder,true);assert.deepEqual(p.lessons.order,[]);assert.deepEqual(p.themes.order,[]);restore(b,JSON.parse(JSON.stringify(p)),c);
});

test('base-order:2000 long stable IDs do not increase an unchanged-order title delta or duplicate note data',()=>{
 const b=base();b.lessons=Array.from({length:2000},(_,i)=>({...copy(b.lessons[0]),id:'prepared-music-'+String(i).padStart(5,'0')+'-'+'long-stable-id-'.repeat(5),order:i}));const c=copy(b);c.lessons[1700].title='Личный заголовок';const p=create(b,c),raw=JSON.stringify(p);assert.ok(Buffer.byteLength(JSON.stringify(b))>200000);assert.ok(Buffer.byteLength(raw)<2000);assert.ok(!raw.includes('startBeat'));assert.equal(p.lessons.baseOrder,true);restore(b,p,c);
});

test('base-order: an explicit user permutation remains a full legacy order and retains it across new source records',()=>{
 const b=base(),c=copy(b);c.lessons.reverse();c.themes.reverse();c.lessons[0].title='Личный B';const p=create(b,c);assert.equal(p.lessons.baseOrder,undefined);assert.equal(p.themes.baseOrder,undefined);assert.deepEqual(p.lessons.order,['b','a']);assert.deepEqual(p.themes.order,['t2','t1']);restore(b,p,c);const next=copy(b);next.lessons.unshift({id:'future',themeId:'t1',title:'Новый',pattern:'y'});next.themes.unshift({id:'new-theme',name:'Новая'});const result=P.apply(next,p);assert.equal(result.ok,true);assert.deepEqual(result.snapshot.lessons.map(x=>x.id),['b','a','future']);assert.deepEqual(result.snapshot.themes.map(x=>x.id),['t2','t1','new-theme']);assert.equal(result.snapshot.lessons[0].title,'Личный B');
});

test('base-order: untouched default order follows a new base while appends and removals retain every personal field',()=>{
 const b=base(),c=copy(b);c.lessons.shift();c.lessons[0].title='Мой B';c.lessons.push({id:'mine',themeId:'t2',title:'Своё',pattern:'t u',extra:{keep:[3,1,2]}});const p=create(b,c);assert.equal(p.lessons.baseOrder,true);assert.deepEqual(p.lessons.removed,['a']);restore(b,p,c);const next=copy(b);next.lessons.unshift({id:'new-default',themeId:'t1',title:'Новая подготовка',pattern:'u'});const result=P.apply(next,p);assert.equal(result.ok,true);assert.deepEqual(result.snapshot.lessons.map(x=>x.id),['new-default','b','mine']);assert.deepEqual(result.snapshot.lessons.at(-1),c.lessons.at(-1));assert.equal(b.lessons.length,2);
});

test('base-order: existing v1 full-ID-order overlays remain readable without rewriting their payload',()=>{
 const b=base(),c=copy(b);c.lessons[1].title='Личный B';const legacy={version:1,kind:'melodiajest-personal-catalog',baseRelease:'23.5.61',savedAt:b.savedAt,themes:{order:['t1','t2'],created:[],patches:[],removed:[]},lessons:{order:['a','b'],created:[],patches:[{id:'b',fields:[{key:'title',before:{present:true,value:'B'},after:{present:true,value:'Личный B'}}]}],removed:[]},fields:[]};const bytes=JSON.stringify(legacy);P.validate(legacy);restore(b,legacy,c);assert.equal(JSON.stringify(legacy),bytes);assert.equal(P.VERSION,1);
});

test('base-order: a personally inserted record in the middle uses explicit order and preserves opaque music',()=>{
 const b=base(),c=copy(b),mine={id:'mine',themeId:'t1',title:'Мой мотив',pattern:'u t',rhythm:{steps:[{startBeat:0,durationBeats:.5},{startBeat:1,durationBeats:2}]},fingeringSpec:{hand:'left',fingers:[3,1]},extension:{keep:'🎹'}};c.lessons.splice(1,0,mine);const p=create(b,c);assert.equal(p.lessons.baseOrder,undefined);assert.deepEqual(p.lessons.order,['a','mine','b']);restore(b,JSON.parse(JSON.stringify(p)),c);assert.deepEqual(p.lessons.created,[mine]);
});

test('base-order: a missing patched source or colliding private ID remains an explicit conflict without mutation',()=>{
 const b=base(),c=copy(b);c.lessons[0].title='Лично';const p=create(b,c);assert.equal(p.lessons.baseOrder,true);const next=copy(b);next.lessons.shift();const rb=copy(next),rp=copy(p),missing=P.apply(next,p);assert.equal(missing.ok,false);assert.equal(missing.snapshot,null);assert.equal(missing.conflicts[0].code,'PERSONAL_CATALOG_BASE_MISSING');assert.deepEqual(next,rb);assert.deepEqual(p,rp);const own=copy(b);own.lessons.push({id:'new',themeId:'t1',title:'Моё',pattern:'t'});const added=create(b,own),changedBase=copy(b);changedBase.lessons.push({id:'new',themeId:'t1',title:'Чужое',pattern:'u'});assert.equal(added.lessons.baseOrder,true);assert.equal(P.apply(changedBase,added).conflicts[0].code,'PERSONAL_CATALOG_ID_CONFLICT');
});

test('base-order: malformed markers,nonempty inherited order and invalid patch IDs are rejected',()=>{
 const b=base(),c=copy(b);c.lessons[0].title='Лично';const p=create(b,c);assert.equal(p.lessons.baseOrder,true);for(const marker of [false,null,1,'true']){const bad=copy(p);bad.lessons.baseOrder=marker;assert.throws(()=>P.validate(bad));}const nonempty=copy(p);nonempty.lessons.order=['a'];assert.throws(()=>P.validate(nonempty));for(const id of ['', '__proto__','constructor','x'.repeat(201)]){const bad=copy(p);bad.lessons.patches[0].id=id;assert.throws(()=>P.validate(bad));}const duplicate=copy(p);duplicate.lessons.patches.push(copy(duplicate.lessons.patches[0]));assert.throws(()=>P.validate(duplicate));const removed=copy(p);removed.lessons.removed=['a'];assert.throws(()=>P.validate(removed));assert.equal({}.polluted,undefined);
});

test('base-order: unrelated source corrections survive and the existing2MiB limit still rejects oversized edits',()=>{
 const b=base(),c=copy(b);c.lessons[0].title='Личная подпись';const p=create(b,c);assert.equal(p.lessons.baseOrder,true);const next=copy(b);next.lessons[0].pattern='u t';const result=P.apply(next,p);assert.equal(result.ok,true);assert.equal(result.snapshot.lessons[0].pattern,'u t');assert.equal(result.snapshot.lessons[0].title,'Личная подпись');next.lessons[0].title='Исправление автора';assert.equal(P.apply(next,p).ok,false);const large=copy(b);large.lessons[0].title='x'.repeat(2*1024*1024);assert.equal(P.MAX_BYTES,2*1024*1024);assert.throws(()=>create(b,large),e=>e.code==='PERSONAL_CATALOG_SIZE');
});
