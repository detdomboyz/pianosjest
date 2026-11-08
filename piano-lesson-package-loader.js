(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-lesson-parts-codec.js')):factory(root.PianoLessonPartsCodec);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoLessonPackageLoader=api;})(typeof window==='object'?window:globalThis,function(Codec){
  'use strict';
  // Verified data in memory only. No catalog/progress storage is read or written.
  const VERSION=1,MAX_PACKAGE_BYTES=16*1024*1024,verifiedPackages=new WeakSet();
  const messages={INPUT:'Некорректные параметры загрузки.',SOURCE:'Не совпадает закреплённый источник.',STALE:'Предложена устаревшая версия курса.',NETWORK:'Не удалось загрузить курс. Рабочая версия сохранена.',HTTP:'Сервер не вернул часть курса.',INTEGRITY:'Не совпадают размер или контрольная сумма.',CONTRACT:'Формат части курса не поддерживается.',LIMIT:'Превышен допустимый объём курса.',UNAVAILABLE:'Проверка курса недоступна в этом браузере.',ABORTED:'Загрузка отменена.',TIMEOUT:'Истекло время загрузки.'};
  const failure=code=>Object.assign(new Error(messages[code]),{name:'LessonPackageLoadError',code});
  const requireValue=(ok,code='INPUT')=>{if(!ok)throw failure(code);};
  const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
  const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
  const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
  function pin(value){
    requireValue(object(value),'SOURCE');const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
    requireValue(keys.length===3&&['release','manifestSha256','webManifestSha256'].every(k=>Object.hasOwn(d,k)&&Object.hasOwn(d[k],'value')),'SOURCE');
    const p=Object.fromEntries(keys.map(k=>[k,d[k].value]));
    requireValue(typeof p.release==='string'&&/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(p.release)&&sha(p.manifestSha256)&&sha(p.webManifestSha256),'SOURCE');return p;
  }
  function forward(current,next){if(!current)return;const a=current.release.split('.').map(Number),b=next.release.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i]){requireValue(b[i]>a[i],'STALE');return;}requireValue(current.manifestSha256===next.manifestSha256&&current.webManifestSha256===next.webManifestSha256,'SOURCE');}
  function create({baseUrl,origin,fetch:fetcher,subtle,cache=null}={}){
    requireValue(Codec&&typeof Codec.readPartData==='function'&&typeof fetcher==='function'&&subtle&&typeof subtle.digest==='function','UNAVAILABLE');
    let base;try{base=new URL(baseUrl);}catch{throw failure('INPUT');}
    requireValue(typeof origin==='string'&&base.origin===origin&&!base.username&&!base.password&&!base.search&&!base.hash&&base.pathname.endsWith('/'));
    requireValue(base.protocol==='https:'||(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)));
    requireValue(cache===null||(typeof cache.match==='function'&&typeof cache.put==='function'));
    async function load({pin:requested,active=null,signal=null,timeoutMs=15000,reload=false}={}){
      const next=pin(requested),current=active===null?null:pin(active);forward(current,next);
      requireValue(Number.isInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=60000&&typeof reload==='boolean');
      requireValue(signal===null||(typeof signal.aborted==='boolean'&&typeof signal.addEventListener==='function'&&typeof signal.removeEventListener==='function'));
      const stats={requests:0,networkBytes:0,cacheHits:0,cacheReadFailures:0,cacheWriteFailures:0,verifiedFiles:0};
      const controller=new AbortController();let rejection,abortCode=null;
      const canceled=new Promise((_,reject)=>{rejection=reject;});canceled.catch(()=>{});
      const abort=code=>{if(!abortCode){abortCode=code;controller.abort();rejection(failure(code));}};
      const externalAbort=()=>abort('ABORTED');if(signal?.aborted)abort('ABORTED');else signal?.addEventListener('abort',externalAbort,{once:true});
      const timer=setTimeout(()=>abort('TIMEOUT'),timeoutMs);
      const guard=()=>{if(abortCode)throw failure(abortCode);};
      const wait=async work=>{guard();const value=await Promise.race([work,canceled]);guard();return value;};
      async function responseBytes(response,max,expected,url,fromCache){
        requireValue(response&&response.status===200&&!response.redirected&&!['opaque','opaqueredirect','error'].includes(response.type),'HTTP');
        requireValue(!response.url||response.url===url,'HTTP');
        requireValue(/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get('Content-Type')||''),'HTTP');
        const length=response.headers.get('Content-Length'),encoding=response.headers.get('Content-Encoding');
        if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')){requireValue(/^\d+$/.test(length)&&Number(length)>0&&Number(length)<=max,'LIMIT');if(expected!==null)requireValue(Number(length)===expected,'INTEGRITY');}
        requireValue(response.body&&typeof response.body.getReader==='function','UNAVAILABLE');
        const reader=response.body.getReader(),chunks=[];let count=0,complete=false;
        try{while(true){const {done,value}=await wait(reader.read());if(done){complete=true;break;}requireValue(value instanceof Uint8Array,'CONTRACT');count+=value.byteLength;requireValue(count<=max,'LIMIT');if(expected!==null)requireValue(count<=expected,'INTEGRITY');chunks.push(Uint8Array.from(value));}}
        finally{if(!complete)reader.cancel().catch(()=>{});reader.releaseLock();}
        requireValue(count>0&&(expected===null||count===expected),'INTEGRITY');const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
        if(!fromCache)stats.networkBytes+=count;return bytes;
      }
      async function verified(key,expectedSha,max,expected,decode){
        guard();const url=new URL(key,base).href;let cached=null;
        if(cache&&!reload){try{cached=await wait(cache.match(url));}catch(error){guard();stats.cacheReadFailures++;}}
        let response=cached;
        if(response)stats.cacheHits++;
        else{stats.requests++;response=await wait(fetcher(url,{method:'GET',mode:'same-origin',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',headers:{Accept:'application/json'},signal:controller.signal}));}
        const bytes=await responseBytes(response,max,expected,url,!!cached);
        const digest=await wait(subtle.digest('SHA-256',bytes));requireValue([...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')===expectedSha,'INTEGRITY');
        let value;try{value=decode(bytes);}catch{throw failure('CONTRACT');}guard();stats.verifiedFiles++;
        if(cache&&!cached){try{await wait(cache.put(url,new Response(bytes,{status:200,headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=31536000, immutable'}})));}catch{guard();stats.cacheWriteFailures++;}}
        return value;
      }
      try{
        guard();const manifest=await verified('manifests/v1/'+next.manifestSha256+'.json',next.manifestSha256,Codec.MAX_MANIFEST_BYTES,null,bytes=>Codec.readManifestData(bytes));
        requireValue(manifest.source.release===next.release&&manifest.source.webManifestSha256===next.webManifestSha256,'SOURCE');
        requireValue(manifest.parts.reduce((n,p)=>n+p.bytes,0)<=MAX_PACKAGE_BYTES,'LIMIT');
        const themes=new Map(),lessons=new Map();
        for(const d of manifest.parts){const topic=await verified(d.key,d.sha256,Codec.MAX_PART_BYTES,d.bytes,bytes=>Codec.readPartData(manifest,d.key,bytes));themes.set(topic.theme.id,topic.theme);for(const l of topic.lessons)lessons.set(l.id,l);}
        guard();const catalog={version:7,themes:manifest.themeOrder.map(id=>themes.get(id)),lessons:manifest.lessonOrder.map(id=>lessons.get(id))};
        const loaded=freeze({active:next,catalog,stats});verifiedPackages.add(loaded);return loaded;
      }catch(error){if(abortCode)throw failure(abortCode);if(error?.name==='LessonPackageLoadError')throw error;throw failure('NETWORK');}
      finally{clearTimeout(timer);signal?.removeEventListener('abort',externalAbort);controller.abort();}
    }
    return Object.freeze({load});
  }
  function requireVerified(value){requireValue(value&&verifiedPackages.has(value));return value;}
  return Object.freeze({VERSION,MAX_PACKAGE_BYTES,create,requireVerified});
});
