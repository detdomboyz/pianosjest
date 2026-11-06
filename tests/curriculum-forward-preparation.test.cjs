'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {insertDetails,build}=require('../tools/build-curriculum-plan.cjs'),A=require('../practice-assessment.js');
const lesson=(id,after)=>({id,pattern:id,learning:after?{after,stage:'p5',requires:[after],machineCheck:'piano-midi'}:{}});

test('a preparation written later in the catalogue resolves before its dependent lesson without changing source order',()=>{
 const lessons=[lesson('root'),lesson('child','future'),lesson('future','root')],before=JSON.stringify(lessons),route=[{id:'root',stage:'p1'}];
 insertDetails(route,lessons,'piano');assert.deepEqual(route.map(e=>e.id),['root','future','child']);assert.equal(JSON.stringify(lessons),before);assert.equal(route[2].fingerprint,A.pianoSignature(lessons[1]));assert.equal(route[2].challenge,true);assert.deepEqual(route[2].preparation,['future']);
});

test('an existing anchor is moved to its final position before inserting an earlier-listed child',()=>{
 const lessons=[lesson('root'),lesson('child','parent'),lesson('unrelated'),lesson('parent','root')],route=[{id:'root'},{id:'unrelated'},{id:'parent'},{id:'child'}];
 insertDetails(route,lessons,'piano');assert.deepEqual(route.map(e=>e.id),['root','parent','child','unrelated']);assert.equal(new Set(route.map(e=>e.id)).size,4);
});

test('missing anchors, self references and cycles fail explicitly instead of looping or silently appending lessons',()=>{
 assert.throws(()=>insertDetails([{id:'root'}],[lesson('root'),lesson('a','missing')],'piano'),/Missing preparation missing for a/);
 assert.throws(()=>insertDetails([],[lesson('a','a')],'piano'),/cycle/);
 assert.throws(()=>insertDetails([],[lesson('a','b'),lesson('b','a')],'piano'),/cycle/);
 assert.throws(()=>insertDetails([],[lesson('root'),lesson('a','root')],'piano'),/missing route anchor/);
});

test('the executable complete route places the left A minor after its left-hand preparations and retains valid maps',()=>{
 const route=build(),ids=route.piano.map(e=>e.id),app=require('./helpers/load-app.cjs').loadApp();for(const prep of ['detail-p-left-position-triad-02','course08-02'])assert.ok(ids.indexOf('detail-p-minor-triads-02')>ids.indexOf(prep));assert.equal(new Set(ids).size,app.lessons.length);assert.deepEqual(new Set(ids),new Set(Array.from(app.lessons,l=>l.id)));assert.equal(new Set(route.guitar.map(e=>e.id)).size,713);assert.equal(route.piano.find(e=>e.id==='detail-p-minor-triads-02').challenge,true);
});
