(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-catalog-adapter.js')):factory(root.PianoCatalogAdapter);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoLessonPartsCodec=api;})(typeof window==='object'?window:globalThis,function(Adapter){
'use strict';
// Shared data-only validation. Callers must check the exact byte hash first.
const VERSION=1,MAX_PART_BYTES=1024*1024,MAX_MANIFEST_BYTES=256*1024;
const clone=value=>JSON.parse(JSON.stringify(value));
const requireValue=(ok,message)=>{if(!ok)throw new Error('Lesson parts: '+message);};
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&value.length>0&&value.length<=160;
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function keys(value,names){requireValue(isObject(value)&&Object.keys(value).length===names.length&&names.every(k=>Object.hasOwn(value,k)),'unexpected or missing fields');}
function source(value){keys(value,['release','webManifestSha256']);requireValue(typeof value.release==='string'&&/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.release)&&value.release.length<=64&&sha(value.webManifestSha256),'invalid source identity');}
function ids(values){requireValue(Array.isArray(values)&&values.length>0&&values.length<=4096&&values.every(id)&&new Set(values).size===values.length,'invalid or duplicate IDs');}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function encoded(value,max){const bytes=new TextEncoder().encode(JSON.stringify(value)+'\n');requireValue(bytes.length<=max,'byte limit exceeded');return bytes;}
function parse(bytes,max){
  requireValue(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=max,'byte limit exceeded');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),pending=[[value,0]];let nodes=0;
  while(pending.length){const [v,depth]=pending.pop();requireValue(depth<=80&&++nodes<=1000000,'JSON structure limit');if(typeof v==='number')requireValue(Number.isFinite(v),'non-JSON number');if(v&&typeof v==='object')for(const child of Object.values(v))pending.push([child,depth+1]);}
  return value;
}
function validateManifest(manifest){
  keys(manifest,['schema','version','instrument','catalogFormat','source','themeOrder','lessonOrder','parts']);
  requireValue(manifest.schema==='melodiajest-piano-parts'&&manifest.version===VERSION&&manifest.instrument==='piano'&&manifest.catalogFormat===7,'unsupported manifest contract');source(manifest.source);ids(manifest.themeOrder);ids(manifest.lessonOrder);
  requireValue(Array.isArray(manifest.parts)&&manifest.parts.length<=64&&manifest.parts.length===manifest.themeOrder.length,'invalid part count');
  const all=[],themes=[];
  for(const d of manifest.parts){keys(d,['themeId','key','sha256','bytes','lessonIds']);requireValue(id(d.themeId)&&sha(d.sha256)&&d.key==='parts/v1/'+d.sha256+'.json'&&Number.isSafeInteger(d.bytes)&&d.bytes>0&&d.bytes<=MAX_PART_BYTES,'invalid descriptor');ids(d.lessonIds);themes.push(d.themeId);all.push(...d.lessonIds);}
  requireValue(same(themes,manifest.themeOrder),'theme order mismatch');requireValue(new Set(all).size===all.length&&all.length===manifest.lessonOrder.length&&manifest.lessonOrder.every(x=>all.includes(x)),'lesson inventory mismatch');
  encoded(manifest,MAX_MANIFEST_BYTES);return manifest;
}
function readManifestData(bytes){requireValue(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=MAX_MANIFEST_BYTES,'manifest byte limit exceeded');return validateManifest(parse(Uint8Array.from(bytes),MAX_MANIFEST_BYTES));}
function readPartData(manifest,key,bytes){
  validateManifest(manifest);const d=manifest.parts.find(p=>p.key===key);requireValue(d,'unlisted part');requireValue(bytes instanceof Uint8Array&&bytes.byteLength===d.bytes,'part size/SHA256 mismatch');const raw=Uint8Array.from(bytes);
  const value=parse(raw,MAX_PART_BYTES);keys(value,['schema','version','instrument','catalogFormat','source','theme','lessons']);
  requireValue(value.schema==='melodiajest-piano-topic'&&value.version===VERSION&&value.instrument==='piano'&&value.catalogFormat===7,'unsupported topic contract');source(value.source);requireValue(value.source.release===manifest.source.release&&value.source.webManifestSha256===manifest.source.webManifestSha256,'source identity mismatch');
  requireValue(isObject(value.theme)&&value.theme.id===d.themeId&&typeof value.theme.name==='string'&&Number.isSafeInteger(value.theme.order)&&value.theme.order>=1&&[undefined,null,'exercise'].includes(value.theme.contentKind)&&Array.isArray(value.lessons)&&value.lessons.length===d.lessonIds.length,'topic inventory mismatch');
  requireValue(same(value.lessons.map(l=>l?.id),d.lessonIds),'lesson ID/order mismatch');
  for(const lesson of value.lessons){requireValue(isObject(lesson)&&lesson.themeId===d.themeId&&lesson.contentKind==='exercise'&&Number.isSafeInteger(lesson.order)&&lesson.order>=1,'non-training lesson or wrong theme/order');const projected=Adapter.project(lesson);requireValue(same(Adapter.restore(projected),lesson),'lossy music projection');}
  return value;
}
return Object.freeze({VERSION,MAX_PART_BYTES,MAX_MANIFEST_BYTES,validateManifest,readManifestData,readPartData,helpers:Object.freeze({clone,requireValue,isObject,id,sha,source,ids,same,encoded})});
});
