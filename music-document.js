(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MusicDocument=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const VERSION=1,object=v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)),id=v=>typeof v==='string'&&v.length>0;
  function validate(doc){
    const issues=[],fail=(code,path)=>issues.push({code,path});
    if(!object(doc)||doc.schemaVersion!==VERSION)return {valid:false,issues:[{code:'DOCUMENT_VERSION',path:'schemaVersion'}]};
    if(!id(doc.id)||!id(doc.revision))fail('DOCUMENT_ID','id/revision');
    if(doc.timeUnit!=='quarter')fail('TIME_UNIT','timeUnit');
    if(doc.bpm!==null&&(!Number.isFinite(doc.bpm)||doc.bpm<=0))fail('TEMPO','bpm');
    if(!Array.isArray(doc.parts)||!doc.parts.length||!Array.isArray(doc.notes))return {valid:false,issues:[...issues,{code:'DOCUMENT_ARRAYS',path:'parts/notes'}]};
    const parts=new Set(),notes=new Set();
    for(const[i,part]of doc.parts.entries()){if(!object(part)||!id(part.id)||parts.has(part.id))fail('PART_ID','parts['+i+']');else parts.add(part.id);}
    for(const[i,note]of doc.notes.entries()){
      const path='notes['+i+']';if(!object(note)){fail('NOTE','notes['+i+']');continue;}
      if(!id(note.id)||notes.has(note.id))fail('NOTE_ID',path+'.id');else notes.add(note.id);
      if(!parts.has(note.partId))fail('PART_REFERENCE',path+'.partId');
      const p=note.pitch,validPitch=object(p)&&((p.kind==='midi'&&Number.isInteger(p.value)&&p.value>=0&&p.value<=127)||(p.kind==='frequency'&&Number.isFinite(p.hz)&&p.hz>0)||(p.kind==='unpitched'&&id(p.key)));
      if(!validPitch)fail('PITCH',path+'.pitch');
      const s=note.span;if(!object(s)||!((s.kind==='unknown'&&!Object.hasOwn(s,'start')&&!Object.hasOwn(s,'duration'))||(s.kind==='known'&&Number.isFinite(s.start)&&s.start>=0&&Number.isFinite(s.duration)&&s.duration>0)))fail('NOTE_TIME',path+'.span');
    }
    return {valid:issues.length===0,issues};
  }
  function assertValid(doc){const result=validate(doc);if(!result.valid)throw Error('Некорректный музыкальный документ: '+result.issues.map(x=>x.code+' '+x.path).join('; '));return doc;}
  return {VERSION,validate,assertValid};
});
