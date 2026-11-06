(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CatalogTransfer=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const MAX_BYTES=20*1024*1024;
  const record=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
  const reserved=new Set(['__proto__','constructor','prototype']);
  function assert(condition,message){if(!condition)throw Error(message);}
  function read(text,validPattern){
    assert(typeof text==='string'&&new TextEncoder().encode(text).length<=MAX_BYTES,'Копия слишком большая: предел 20 МБ.');
    let data;try{data=JSON.parse(text);}catch{throw Error('Не удалось прочитать JSON. Выбери копию каталога MelodiaJest.');}
    assert(record(data)&&data.version===7,'Ожидается каталог версии 7. Старую копию сначала открой и пересохрани локальным тренажёром.');
    assert(Array.isArray(data.themes)&&data.themes.length>0&&data.themes.length<=2000,'В копии нет корректного списка тем.');
    assert(Array.isArray(data.lessons)&&data.lessons.length>0&&data.lessons.length<=20000,'В копии нет корректного списка уроков.');
    const themes=new Set(),lessons=new Set();
    function id(value,set,label){assert(typeof value==='string'&&value.length>0&&value.length<=200&&!reserved.has(value)&&!set.has(value),'Повреждён или повторяется ID '+label+'.');set.add(value);}
    for(const theme of data.themes){assert(record(theme),'Повреждена тема.');id(theme.id,themes,'темы');assert(typeof theme.name==='string','У темы нет названия.');}
    for(const lesson of data.lessons){
      assert(record(lesson),'Повреждена запись урока.');id(lesson.id,lessons,'урока');
      assert(themes.has(lesson.themeId),'Урок ссылается на отсутствующую тему.');
      assert(typeof lesson.pattern==='string'&&lesson.pattern.length<=200000&&(!validPattern||validPattern(lesson.pattern)),'В уроке нет читаемых нот.');
      assert(typeof lesson.title==='string'&&typeof lesson.description==='string','Повреждены название или описание урока.');
      assert(lesson.contentKind==null||['exercise','piece'].includes(lesson.contentKind),'Неизвестное назначение материала.');
      const learning=lesson.learning;if(learning==null)continue;
      assert(record(learning),'Повреждено описание учебной цели.');
      for(const key of ['goal','rhythmNotice'])assert(learning[key]==null||typeof learning[key]==='string','Повреждено поле '+key+'.');
      for(const key of ['practiceSteps','selfCheck','limitations','references'])assert(learning[key]==null||(Array.isArray(learning[key])&&learning[key].every(v=>typeof v==='string')),'Повреждён список '+key+'.');
      if(learning.referenceTitles!=null)assert(record(learning.referenceTitles)&&Object.values(learning.referenceTitles).every(v=>typeof v==='string'),'Повреждены названия источников.');
      if(learning.timeSignature!=null)for(const key of ['numerator','denominator'])assert(Number.isInteger(learning.timeSignature[key])&&learning.timeSignature[key]>0&&learning.timeSignature[key]<=64,'Повреждён музыкальный размер.');
      if(learning.provenance!=null){assert(record(learning.provenance),'Повреждено происхождение материала.');for(const key of ['type','author','purpose','context','sourceNote','history'])assert(learning.provenance[key]==null||typeof learning.provenance[key]==='string','Повреждено происхождение: '+key+'.');}
    }
    return data;
  }
  function write(snapshot){return JSON.stringify(snapshot,null,2)+'\n';}
  return {MAX_BYTES,read,write};
});
