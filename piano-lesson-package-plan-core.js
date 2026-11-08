(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PianoLessonPackagePlanCore=factory();})(typeof window==='object'?window:globalThis,function(){
'use strict';
// Shared policy; wrappers verify package bytes before calling this module.
const VERSION=1,MAX_CATALOG_BYTES=32*1024*1024,MAX_STRING_BYTES=1024*1024,MAX_JSON_NODES=1000000,MAX_DEPTH=80;
const encoder=new TextEncoder(),bytes=value=>encoder.encode(value).byteLength;
const requireValue=(ok,message)=>{if(!ok){const code=message.includes('limit')?'LIMIT':/pin|release|source|inventory change/.test(message)?'SOURCE':message==='unknown or serialized plan'?'PLAN':message==='unresolved local conflict'?'CONFLICT':message==='local catalog changed; prepare again'?'STALE':'INPUT';throw Object.assign(new Error('Lesson package update: '+message),{code});}};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function data(value,depth=0,seen=new Set(),budget={bytes:0,nodes:0}){
  requireValue(depth<=MAX_DEPTH,'JSON depth limit');
  requireValue(++budget.nodes<=MAX_JSON_NODES,'JSON node limit');
  const add=bytes=>{budget.bytes+=bytes;requireValue(budget.bytes<=MAX_CATALOG_BYTES,'catalog byte limit');};
  if(value===null||typeof value==='string'||typeof value==='boolean'){
    if(typeof value==='string')requireValue(bytes(value)<=MAX_STRING_BYTES,'JSON string limit');
    add(bytes(JSON.stringify(value)));return value;
  }
  if(typeof value==='number'){requireValue(Number.isFinite(value),'non-JSON number');add(String(value).length);return value;}
  requireValue(value&&typeof value==='object'&&!seen.has(value),'non-JSON or cyclic input');
  const prototype=Object.getPrototypeOf(value);
  requireValue(Array.isArray(value)||prototype===Object.prototype||prototype===null,'non-JSON object');
  seen.add(value);let result;
  if(Array.isArray(value)){
    requireValue(value.length<=10000,'JSON array limit');
    add(2+Math.max(0,value.length-1));
    result=Array.from({length:value.length},(_,i)=>{const d=Object.getOwnPropertyDescriptor(value,String(i));requireValue(d&&Object.hasOwn(d,'value'),'sparse/accessor array');return data(d.value,depth+1,seen,budget);});
  }else{
    const descriptors=Object.getOwnPropertyDescriptors(value),entries=[];
    requireValue(Reflect.ownKeys(descriptors).every(k=>typeof k==='string'),'symbol property');
    requireValue(Object.keys(descriptors).length<=10000,'JSON object limit');add(2);
    for(const k of Object.keys(descriptors).sort()){
      const d=descriptors[k];requireValue(Object.hasOwn(d,'value'),'accessor property');
      // Undefined object members are absent in the existing serialized v7 format.
      if(d.value!==undefined){requireValue(bytes(k)<=MAX_STRING_BYTES,'JSON string limit');add(bytes(JSON.stringify(k))+1+(entries.length?1:0));entries.push([k,data(d.value,depth+1,seen,budget)]);}
    }
    result=Object.fromEntries(entries);
  }
  seen.delete(value);return result;
}
function copy(value){const result=data(value),raw=JSON.stringify(result);requireValue(bytes(raw)<=MAX_CATALOG_BYTES,'catalog byte limit');return result;}
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function canonical(value){return JSON.stringify(data(value));}
function release(value){requireValue(typeof value==='string'&&/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value),'unsupported release');return value.split('.').map(Number);}
function compareRelease(a,b){const x=release(a),y=release(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]<y[i]?-1:1;return 0;}
function pin(value){const p=copy(value);requireValue(object(p)&&Object.keys(p).length===3&&Object.hasOwn(p,'release')&&Object.hasOwn(p,'manifestSha256')&&Object.hasOwn(p,'webManifestSha256'),'invalid source pin');release(p.release);requireValue(sha(p.manifestSha256)&&sha(p.webManifestSha256),'invalid source pin');return p;}
function catalog(value){
  const c=copy(value);requireValue(object(c)&&c.version===7&&Array.isArray(c.themes)&&Array.isArray(c.lessons)&&Object.keys(c).every(k=>['version','savedAt','themes','lessons'].includes(k)),'serialized catalog v7 required; progress is separate');
  requireValue(!Object.hasOwn(c,'savedAt')||typeof c.savedAt==='string','invalid savedAt');
  requireValue(c.themes.length<=2048&&c.lessons.length<=10000,'catalog inventory limit');
  const themes=new Set(),lessons=new Set();
  for(const t of c.themes){requireValue(object(t)&&id(t.id)&&typeof t.name==='string'&&Number.isSafeInteger(t.order)&&t.order>=1&&!themes.has(t.id),'invalid or duplicate local theme');themes.add(t.id);}
  for(const l of c.lessons){requireValue(object(l)&&id(l.id)&&typeof l.pattern==='string'&&themes.has(l.themeId)&&Number.isSafeInteger(l.order)&&l.order>=1&&!lessons.has(l.id),'invalid or duplicate local lesson');lessons.add(l.id);}
  return c;
}
function catalogText(c){return canonical({version:c.version,themes:c.themes,lessons:c.lessons});}
function content(value,kind){return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='order'&&(kind==='theme'||k!=='themeId')));}
function sameContent(a,b,kind){return canonical(content(a,kind))===canonical(content(b,kind));}
function sameIds(a,b){return a.length===b.length&&a.every(x=>b.includes(x));}
function create({hash}={}){
  requireValue(typeof hash==='function','digest required');const plans=new WeakMap();
function prepare({active,previous,incoming,catalog:local}){
  const installed=pin(active),old={source:pin(previous.source),catalog:catalog(previous.catalog)},next={source:pin(incoming.source),catalog:catalog(incoming.catalog)},current=catalog(local);
  requireValue(canonical(installed)===canonical(old.source),'active pin does not match previous package');
  const direction=compareRelease(next.source.release,installed.release);requireValue(direction>=0,'release downgrade');
  if(direction===0)requireValue(canonical(next.source)===canonical(installed),'same release has different content');
  requireValue(sameIds(old.catalog.themes.map(t=>t.id),next.catalog.themes.map(t=>t.id))&&sameIds(old.catalog.lessons.map(l=>l.id),next.catalog.lessons.map(l=>l.id)),'inventory change requires a separate contract');
  const conflicts=[],changedLessonIds=[],changedThemeIds=[],placementOverrides=[],candidate=copy(current),baseText=catalogText(current);
  const summary={version:VERSION,status:'unchanged',from:installed,to:next.source,changedLessonIds,changedThemeIds,placementOverrides,conflicts};
  if(direction!==0){
    for(const [kind,field,changed]of [['theme','themes',changedThemeIds],['lesson','lessons',changedLessonIds]]){
      const before=new Map(old.catalog[field].map(v=>[v.id,v])),fresh=new Map(next.catalog[field].map(v=>[v.id,v])),positions=new Map(candidate[field].map((v,i)=>[v.id,i]));
      for(const [key,base]of before){
        const index=positions.get(key),replacement=fresh.get(key);
        if(index===undefined){conflicts.push({kind:'missing-'+kind,id:key});continue;}
        const own=candidate[field][index];
        if(!sameContent(own,base,kind)&&!sameContent(own,replacement,kind)){conflicts.push({kind:kind+'-edited',id:key});continue;}
        if(own.order!==base.order||(kind==='lesson'&&own.themeId!==base.themeId))placementOverrides.push({kind,id:key});
        if(!sameContent(own,replacement,kind))changed.push(key);
        candidate[field][index]={...copy(replacement),order:own.order,...(kind==='lesson'?{themeId:own.themeId}:{})};
      }
    }
    summary.status=conflicts.length?'blocked':'ready';
  }
  // Capture every input before the first asynchronous digest can yield.
  const captured=conflicts.length?null:catalog(candidate);
  const finish=digest=>{
    requireValue(sha(digest),'invalid digest');const plan=freeze(copy({...summary,baseCatalogSha256:digest}));
    plans.set(plan,{baseText,candidate:captured,source:next.source});return plan;
  };
  const digest=hash(baseText);return typeof digest==='string'?finish(digest):Promise.resolve(digest).then(finish);
}
function materialize(plan,latestCatalog){
  const saved=plans.get(plan);requireValue(saved,'unknown or serialized plan');requireValue(plan.status!=='blocked'&&saved.candidate,'unresolved local conflict');
  const latest=catalog(latestCatalog);requireValue(catalogText(latest)===saved.baseText,'local catalog changed; prepare again');
  const result=copy(saved.candidate);if(Object.hasOwn(latest,'savedAt'))result.savedAt=latest.savedAt;else delete result.savedAt;
  return {catalog:result,active:copy(saved.source)};
}
return Object.freeze({prepare,materialize});
}
return Object.freeze({VERSION,MAX_CATALOG_BYTES,MAX_STRING_BYTES,MAX_JSON_NODES,MAX_DEPTH,compareRelease,validatePin:pin,create});
});
