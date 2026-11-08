'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),P=require('../portal-experience.js');
test('portal thresholds match Libreta and service contributions sum before level calculation',()=>{
  assert.equal(P.level(0).level,1);assert.equal(P.level(119).level,1);assert.equal(P.level(120).level,2);assert.equal(P.level(479).level,2);assert.equal(P.level(480).level,3);
  for(let n=1;n<1000;n++){const start=120*(n-1)**2;assert.equal(P.level(start).level,n);assert.equal(P.level(start).remaining,120*(2*n-1));}
  assert.equal(P.level(80+60+100).xp,240);assert.equal(P.level(240).level,2);assert.throws(()=>P.level(-1));assert.throws(()=>P.level(.5));
});
test('verified performance earns more for quality while retries credit only improvement',()=>{
  assert.equal(P.award({clean:false,quality:100}),0);assert.equal(P.award({clean:true,quality:0}),60);assert.equal(P.award({clean:true,quality:100}),100);
  assert.deepEqual(P.improvement(0,80),{best:80,delta:80});assert.deepEqual(P.improvement(80,80),{best:80,delta:0});assert.deepEqual(P.improvement(80,70),{best:80,delta:0});assert.deepEqual(P.improvement(80,95),{best:95,delta:15});
});
