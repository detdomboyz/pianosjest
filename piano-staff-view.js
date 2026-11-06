(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./music-document.js')):factory(root.MusicDocument);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoStaffView=api;})(typeof window==='object'?window:globalThis,function(Music){
  'use strict';
  const VERSION=1,POSITIONS=Object.freeze({treble:Object.freeze({C4:-2,D4:-1,E4:0}),bass:Object.freeze({C3:3,D3:4,E3:5})}),SEMITONES=Object.freeze({C:0,D:2,E:4});
  // A deliberately narrow read-only view. MIDI never supplies spelling or a hand.
  function project(document,notation){
    const warnings=[],notes=[],stringOrNull=value=>typeof value==='string'?value:null,result=status=>({schemaVersion:VERSION,status,documentId:stringOrNull(document?.id),documentRevision:stringOrNull(document?.revision),partId:stringOrNull(notation?.partId),clef:Object.hasOwn(POSITIONS,notation?.clef||'')?notation.clef:null,notes,warnings});
    const warn=(code,message,noteId)=>warnings.push({code,message,...(noteId?{noteId}:{})});
    if(!Music.validate(document).valid){warn('DOCUMENT_INVALID','Музыкальные данные повреждены. Открой исходную запись; ноты не изменены.');return result('unsupported');}
    if(!notation||notation.documentRevision!==document.revision){warn('NOTATION_REVISION','Нотная запись относится к другой редакции. Подготовь её для текущих нот.');return result('unsupported');}
    if(!Object.hasOwn(POSITIONS,notation.clef)){warn('CLEF_UNSUPPORTED','Этот ключ пока не поддержан. Выбери скрипичный или басовый.');return result('unsupported');}
    if(!document.parts.some(p=>p.id===notation.partId)){warn('PART_NOT_FOUND','Выбранная партия не найдена. Исходные партии сохранены.');return result('unsupported');}
    if(!Array.isArray(notation.spelling)){warn('SPELLING_REQUIRED','Нужно явное нотное написание: одна высота MIDI допускает разные записи.');return result('unsupported');}
    const selected=document.notes.filter(n=>n.partId===notation.partId);
    if(!selected.length){warn('PART_EMPTY','В выбранной партии пока нет нот.');return result('unsupported');}
    if(selected.length>8){warn('PHRASE_TOO_LONG','Для этого вида выбери короткую фразу до восьми нот.');return result('unsupported');}
    const spellings=new Map(),selectedIds=new Set(selected.map(n=>n.id));
    for(const s of notation.spelling){
      if(!s||typeof s.noteId!=='string'||spellings.has(s.noteId)){warn('SPELLING_ID','Нотные назначения содержат пустой или повторный ID.');return result('unsupported');}
      spellings.set(s.noteId,s);
      if(!selectedIds.has(s.noteId))warn('SPELLING_OUTSIDE_PART','Назначение другой партии не использовано.',s.noteId);
    }
    const timed=selected.filter(n=>n.span.kind==='known').slice().sort((a,b)=>a.span.start-b.span.start);
    if(timed.some((n,i)=>i&&n.span.start<timed[i-1].span.start+timed[i-1].span.duration-1e-9)){
      warn('POLYPHONY_UNSUPPORTED','Совместные ноты и удержанные голоса пока не показаны этим видом. Исходная музыка сохранена.');return result('unsupported');
    }
    for(const n of selected)if(n.span.kind==='unknown')warn('TIME_UNKNOWN','У ноты нет подтверждённого времени; она не добавлена в строку.',n.id);
    for(const n of timed){
      const s=spellings.get(n.id);
      if(!s){warn('SPELLING_MISSING','Для ноты не задано написание; оно не угадано по MIDI.',n.id);continue;}
      if(n.pitch.kind!=='midi'){warn('PITCH_UNSUPPORTED','Частотная или ударная высота не заменена темперированной нотой.',n.id);continue;}
      if(!Object.hasOwn(SEMITONES,s.step)||s.alter!==0||!Number.isInteger(s.octave)){
        warn('SPELLING_UNSUPPORTED','Этот вид пока читает только явно заданные натуральные C, D и E.',n.id);continue;
      }
      const label=s.step+s.octave;
      if(12*(s.octave+1)+SEMITONES[s.step]!==n.pitch.value){warn('SPELLING_PITCH_MISMATCH','Написание не соответствует звучащей высоте; октава и ноты не изменены.',n.id);continue;}
      if(!Object.hasOwn(POSITIONS[notation.clef],label)){warn('REGISTER_UNSUPPORTED','Эта высота пока вне подготовленного диапазона данного ключа.',n.id);continue;}
      const staffPosition=POSITIONS[notation.clef][label];
      notes.push({noteId:n.id,partId:n.partId,midi:n.pitch.value,label,staffPosition,ledgerPositions:staffPosition===-2?[-2]:[],startBeat:n.span.start,durationBeats:n.span.duration});
    }
    // Never turn a phrase into another phrase by omitting its unsupported note.
    if(notes.length!==selected.length){notes.length=0;return result('unsupported');}
    return result(warnings.length?'limited':'ready');
  }
  return {VERSION,project};
});
