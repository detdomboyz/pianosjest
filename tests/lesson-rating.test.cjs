'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),R=require('../lesson-rating.js');
test('rating conversions retain Libreta numeric anchors and half-down boundaries',()=>{
  assert.equal(R.toCanonical('ten',8),80);assert.equal(R.toCanonical('ten_decimal','8,45'),84.5);assert.equal(R.toCanonical('hundred',85),85);
  assert.deepEqual([1,2,3,4,5].map(x=>R.toCanonical('five',x)),[10,25,50,75,95]);
  assert.deepEqual(['bad','normal','good'].map(x=>R.toCanonical('three',x)),[20,50,80]);assert.equal(R.toCanonical('two','like'),80);
  assert.equal(R.fromCanonical('ten',85),8);assert.equal(R.fromCanonical('ten',85.001),9);assert.equal(R.fromCanonical('hundred',84.5),84);assert.equal(R.fromCanonical('ten_decimal',84.5),8.45);
  assert.equal(R.fromCanonical('five',89.999),4);assert.equal(R.fromCanonical('five',90),5);assert.equal(R.fromCanonical('two',50),'dislike');
});
test('missing votes are different from zero and personal display changes do not lose precision',()=>{
  for(const value of [null,undefined,'',' ',false,{},[],NaN,Infinity])assert.equal(R.record('ten',value),null);
  assert.deepEqual(R.record('ten',0),{system:'ten',value:0,canonicalUnits:0});
  const saved=R.record('hundred',85);assert.equal(R.valueFor(saved,'ten'),8);assert.equal(R.valueFor(saved,'hundred'),85);assert.equal(R.valueFor(saved,'ten_decimal'),8.5);assert.equal(saved.canonicalUnits,8500);
  assert.equal(R.record('five',0),null);assert.equal(R.record('ten',8.5),null);assert.equal(R.record('hundred',101),null);
});
test('public average is fractional ten-point for every personal scale and includes zero votes',()=>{
  assert.equal(R.average(0,0),null);assert.deepEqual(R.average(16900,2),{canonical:84.5,decimalTen:8.45,count:2});
  assert.equal(R.format('ten_decimal',R.average(8000,2).decimalTen),'4,00/10');assert.equal(R.format('ten_decimal',null),'Без оценки');assert.equal(R.average(10001,1),null);
});
