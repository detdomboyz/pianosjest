'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const sourceCore=entry=>Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='applications'));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function assertPreservedSourceCores(ledger,baseline){
  assert.equal(baseline.entries.length,baseline.sourceCoreCount);
  const current=new Map(ledger.entries.map(entry=>[entry.id,entry]));
  assert.equal(current.size,ledger.entries.length,'Unique source IDs');
  assert.equal(new Set(baseline.entries.map(entry=>entry.id)).size,baseline.sourceCoreCount);
  for(const old of baseline.entries){
    assert.ok(current.has(old.id),'Preserved source '+old.id);
    assert.equal(hash(sourceCore(current.get(old.id))),old.sha256,'Exact source core '+old.id);
  }
}
module.exports={assertPreservedSourceCores};
