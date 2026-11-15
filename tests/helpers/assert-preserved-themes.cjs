'use strict';
const assert=require('node:assert/strict');
function assertPreservedThemes(actual,historical){
 assert.ok(Array.isArray(actual)&&Array.isArray(historical),'Theme inventories must be arrays');
 const normalized=JSON.parse(JSON.stringify(actual)),prior=JSON.parse(JSON.stringify(historical));
 for(const rows of [normalized,prior]){const ids=new Set();for(const row of rows){assert.ok(row&&typeof row.id==='string'&&row.id.trim(),'Theme ID is required');assert.ok(typeof row.name==='string'&&row.name.trim(),'Theme name is required');assert.ok(Number.isFinite(row.order),'Theme order must be finite');assert.ok(!ids.has(row.id),'Duplicate theme ID: '+row.id);ids.add(row.id);}}
 const ids=new Set(prior.map(x=>x.id)),preserved=normalized.filter(x=>ids.has(x.id));
 assert.deepEqual(preserved,prior,'Historical theme records and relative order must remain exact');
 return preserved;
}
module.exports={assertPreservedThemes};
