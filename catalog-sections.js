(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MusicCatalog=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const SECTIONS=['learning','pieces'];
  function validKind(value){return ['exercise','piece'].includes(value)?value:null;}
  function kind(instrument,lesson,group){
    const explicit=validKind(lesson?.contentKind)||validKind(group?.contentKind);if(explicit)return explicit;
    if(instrument==='piano')return /^(fav-|chopin-midi-)/.test(lesson.id)||/^mel20[1-3]$/.test(lesson.id)||['midi','audio-recognition'].includes(lesson.rhythm?.source)?'piece':'exercise';
    return lesson.category==='melody'||group?.category==='melody'||/^(mel-|song-|topic-study-|topic-lifes-a-gas-)/.test(lesson.topicId||'')?'piece':'exercise';
  }
  function sectionOf(instrument,lesson,groups){const id=instrument==='piano'?lesson.themeId:lesson.topicId;return kind(instrument,lesson,groups.find(g=>g.id===id))==='piece'?'pieces':'learning';}
  function available(instrument,section,lessons,groups){return lessons.filter(l=>sectionOf(instrument,l,groups)===section);}
  function workKey(instrument,lesson){if(instrument==='piano'&&lesson.themeId==='builtin-theme-gv1eeg'&&/^mel20[1-3]$/.test(lesson.id))return 'builtin-twinkle';return instrument==='piano'?lesson.themeId:lesson.topicId;}
  function works(instrument,lessons,groups){
    const result=new Map();for(const lesson of available(instrument,'pieces',lessons,groups)){
      const id=workKey(instrument,lesson),group=groups.find(g=>g.id===(instrument==='piano'?lesson.themeId:lesson.topicId));
      if(!result.has(id))result.set(id,{id,title:id==='builtin-twinkle'?'Twinkle, Twinkle, Little Star':String(group?.name||group?.title||lesson.title).replace(/^Любимые ноты:\s*/,''),sourceGroupId:group?.id,lessons:[],study:instrument==='guitar'&&/^(song-|mel-)/.test(lesson.topicId||'')});
      result.get(id).lessons.push(lesson);
    }
    for(const group of groups){if((group.contentKind==='piece'||instrument==='guitar'&&group.category==='melody')&&!result.has(group.id))result.set(group.id,{id:group.id,title:group.name||group.title,sourceGroupId:group.id,lessons:[],study:instrument==='guitar'&&/^(song-|mel-)/.test(group.id)});}
    return [...result.values()];
  }
  function work(instrument,lesson,lessons,groups){return works(instrument,lessons,groups).find(w=>w.id===workKey(instrument,lesson))||null;}
  function resolve(instrument,section,lessons,groups,preferred){const items=available(instrument,section,lessons,groups);return items.find(l=>l.id===preferred)||items[0]||null;}
  function readState(storage,key){try{const value=JSON.parse(storage.getItem(key)||'{}');return {section:SECTIONS.includes(value?.section)?value.section:'learning',selected:{learning:typeof value?.selected?.learning==='string'?value.selected.learning:'',pieces:typeof value?.selected?.pieces==='string'?value.selected.pieces:''}};}catch{return {section:'learning',selected:{learning:'',pieces:''}};}}
  function saveState(storage,key,value){try{storage.setItem(key,JSON.stringify({section:value.section,selected:{...value.selected}}));}catch{}}
  return {SECTIONS,validKind,kind,sectionOf,available,workKey,works,work,resolve,readState,saveState};
});
