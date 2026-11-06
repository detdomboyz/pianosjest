'use strict';
const crypto=require('node:crypto'),Adapter=require('../piano-catalog-adapter.js'),Core=require('../piano-reading-session.js');
const SCOPE='builtin-piano-monophonic-windows-v1';
// Pure source check of the actual parser's monophonic steps. Duration, title,
// hand and BPM cannot make an already published pitch sequence unseen.
function audit(catalog,items){
 if(!Array.isArray(catalog)||!catalog.length||!Array.isArray(items)||!items.length)throw Error('READING_SOURCE_INPUT');
 const ids=new Set(),sources=catalog.map(entry=>{if(!entry||typeof entry.id!=='string'||ids.has(entry.id))throw Error('READING_SOURCE_ID');ids.add(entry.id);const steps=Adapter.parsePattern(entry.pattern).steps.map(s=>s.keys.map(k=>Adapter.KEY_MAP[k]));return {id:entry.id,contentKind:entry.contentKind||null,steps};});
 const catalogHash=crypto.createHash('sha256').update(JSON.stringify(sources)).digest('hex');
 const rows=items.map(item=>{const contentKey=Core.contentKey(item),pitches=item.music.notes.filter(n=>n.partId===item.notation.partId).slice().sort((a,b)=>a.span.start-b.span.start).map(n=>n.pitch.value),matches=[];
  for(const source of sources)for(let start=0;start<=source.steps.length-pitches.length;start++)if(pitches.every((pitch,j)=>source.steps[start+j].length===1&&source.steps[start+j][0]===pitch))matches.push({lessonId:source.id,contentKind:source.contentKind,startStep:start,endStep:start+pitches.length-1});
  return {itemId:item.itemId,clef:item.notation.clef,contentKey,pitches,occurrences:matches.length,matches};
 });
 return {version:1,scope:SCOPE,catalogRecords:catalog.length,catalogHash,items:rows};
}
if(require.main===module){const fs=require('node:fs'),Bank=require('../piano-reading-bank.js'),{loadApp}=require('../tests/helpers/load-app.cjs'),{baseSpecification}=require('../web-app/tools/reading-spec.cjs'),result=audit(loadApp().catalogSnapshot().lessons,Bank.candidates(baseSpecification()).items);fs.writeFileSync('docs/piano-reading-catalog-audit.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({catalogRecords:result.catalogRecords,items:result.items.length,publishedItems:result.items.filter(i=>i.occurrences>0).length,matches:result.items.reduce((n,i)=>n+i.occurrences,0)}));}
module.exports={SCOPE,audit};
