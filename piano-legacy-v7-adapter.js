(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./catalog-transfer.js'),require('./piano-lesson-package-store.js'),require('./piano-lesson-package-loader.js')):factory(root.CatalogTransfer,root.PianoLessonPackageStore,root.PianoLessonPackageLoader);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoLegacyV7Adapter=api;})(typeof window==='object'?window:globalThis,function(Transfer,Store,Loader){
 'use strict';
 // Pure current-v7 reader only. No application normalization, migration, I/O or activation.
 const VERSION=1,MAX_BYTES=20*1024*1024,MAX_SOURCE_DEPTH=80,encoder=new TextEncoder();
 const messages={INPUT:'Не удалось прочитать каталог. Исходная копия сохранена.',EMPTY:'Исходного каталога нет. Автоматическая замена не выполнялась.',SCHEMA:'Каталог требует отдельного разбора. Сохрани исходную копию.',LIMIT:'Каталог превышает допустимый объём. Исходная копия сохранена.',UNAVAILABLE:'Проверка каталога недоступна.'};
 const failure=(code,reason)=>Object.assign(new Error(messages[code]??messages.INPUT),{name:'LegacyV7AdapterError',code,reason});
 function requireValue(ok,code='INPUT',reason='catalog'){if(!ok)throw failure(code,reason);}
 // Runs only after strict JSON parsing. Track object scopes, not string values or key spelling.
 // JSON.parse alone overwrites earlier duplicate names, including escaped-equivalent names.
 function unambiguousTokens(raw){
  const scopes=[];
  for(let i=0;i<raw.length;i++){
   const c=raw[i];
   if(c==='"'){
    const start=i;for(i++;i<raw.length;i++){if(raw[i]==='\\'){i++;continue;}if(raw[i]==='"')break;}
    const scope=scopes.at(-1);if(scope?.object&&scope.key){const name=JSON.parse(raw.slice(start,i+1));requireValue(!scope.names.has(name),'SCHEMA','duplicate-property');scope.names.add(name);scope.key=false;}
   }else if(c==='-'||(c>='0'&&c<='9')){
    const start=i;while(i+1<raw.length&&'0123456789eE+-.'.includes(raw[i+1]))i++;const token=raw.slice(start,i+1),n=Number(token);
    requireValue(Number.isFinite(n)&&(!Number.isInteger(n)||Number.isSafeInteger(n))&&!Object.is(n,-0),'SCHEMA','numeric-precision');
    requireValue(n!==0||!/[1-9]/.test(token.split(/[eE]/,1)[0]),'SCHEMA','numeric-underflow');
   }else if(c==='{'){scopes.push({object:true,key:true,names:new Set()});requireValue(scopes.length<=MAX_SOURCE_DEPTH,'LIMIT','depth');}
   else if(c==='['){scopes.push({object:false});requireValue(scopes.length<=MAX_SOURCE_DEPTH,'LIMIT','depth');}
   else if(c==='}'||c===']')scopes.pop();
   else if(c===','&&scopes.at(-1)?.object)scopes.at(-1).key=true;
  }
 }
 function create({source}={}){
  requireValue(Transfer&&Store&&Loader&&typeof Transfer.read==='function'&&typeof Store.validateCandidate==='function'&&typeof Loader.requireVerified==='function','UNAVAILABLE','dependencies');
  let active;try{active=Loader.requireVerified(source).active;}catch{throw failure('INPUT','verified-source');}
  return Object.freeze(function decode(raw){
   requireValue(raw!==null,'EMPTY','missing-source');requireValue(typeof raw==='string','INPUT','raw-type');requireValue(raw.length<=MAX_BYTES&&encoder.encode(raw).byteLength<=MAX_BYTES,'LIMIT','source-bytes');
   let catalog;try{catalog=Transfer.read(raw);}catch{throw failure('SCHEMA','v7-or-json');}
   unambiguousTokens(raw);
   try{return Store.validateCandidate({active,catalog}).catalog;}catch(error){throw failure(error?.code==='LIMIT'?'LIMIT':'SCHEMA','catalog-shape');}
  });
 }
 return Object.freeze({VERSION,MAX_BYTES,create});
});
