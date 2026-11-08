(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-lesson-package-plan-core.js'),require('./piano-lesson-package-loader.js')):factory(root.PianoLessonPackagePlanCore,root.PianoLessonPackageLoader);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoLessonPackagePlanner=api;})(typeof window==='object'?window:globalThis,function(Core,Loader){
  'use strict';
  // Planning only. No network, CacheStorage, catalog or progress writes.
  const VERSION=1,encoder=new TextEncoder();
  const messages={INPUT:'Некорректный каталог. Рабочая версия сохранена.',LIMIT:'Материал превышает допустимый объём.',SOURCE:'Не совпадает закреплённый источник обновления.',CONFLICT:'Личная редакция расходится с обновлением. Сначала сохрани её и разреши конфликт.',STALE:'Каталог изменился. Подготовь обновление заново.',PLAN:'Подготовь предложение в этой вкладке заново.',UNAVAILABLE:'Проверка обновления недоступна.',DIGEST:'Не удалось проверить контрольную сумму.'};
  const failure=code=>Object.assign(new Error(messages[code]||messages.INPUT),{name:'LessonPackagePlanError',code:Object.hasOwn(messages,code)?code:'INPUT'});
  const wrap=error=>error?.name==='LessonPackagePlanError'?error:failure(error?.code);
  function create({subtle}={}){
    if(!Core||!Loader||!subtle||typeof subtle.digest!=='function')throw failure('UNAVAILABLE');
    const planner=Core.create({hash:async raw=>{
      let result;try{result=await subtle.digest('SHA-256',encoder.encode(raw));}catch{throw failure('DIGEST');}
      if(!(result instanceof ArrayBuffer)||result.byteLength!==32)throw failure('DIGEST');
      return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,'0')).join('');
    }});
    async function prepare({active,previous,incoming,catalog}={}){
      try{const old=Loader.requireVerified(previous),next=Loader.requireVerified(incoming);return await planner.prepare({active,previous:{source:old.active,catalog:old.catalog},incoming:{source:next.active,catalog:next.catalog},catalog});}
      catch(error){throw wrap(error);}
    }
    function materialize(plan,latestCatalog){try{return planner.materialize(plan,latestCatalog);}catch(error){throw wrap(error);}}
    return Object.freeze({prepare,materialize});
  }
  return Object.freeze({VERSION,create});
});
