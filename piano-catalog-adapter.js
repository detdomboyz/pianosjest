(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./music-document.js'),require('./practice-assessment.js')):factory(root.MusicDocument,root.PracticeAssessment);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoCatalogAdapter=api;})(typeof window==='object'?window:globalThis,function(Music,Assessment){
  'use strict';
  const VERSION=1;
  const KEY_MAP=Object.freeze({
    '1':36,'2':38,'3':40,'4':41,'5':43,'6':45,'7':47,'8':48,'9':50,'0':52,
    'q':53,'w':55,'e':57,'r':59,'t':60,'y':62,'u':64,'i':65,'o':67,'p':69,
    'a':71,'s':72,'d':74,'f':76,'g':77,'h':79,'j':81,'k':83,'l':84,
    'z':86,'x':88,'c':89,'v':91,'b':93,'n':95,'m':96,
    '!':37,'@':39,'$':42,'%':44,'^':46,'*':49,'(':51,
    'Q':54,'W':56,'E':58,'T':61,'Y':63,'I':66,'O':68,'P':70,
    'S':73,'D':75,'G':78,'H':80,'J':82,'L':85,'Z':87,'C':90,'V':92,'B':94
  });
  // Extracted from the shipped parser. Keep spacing, unknown characters and quick groups.
  function parsePattern(pattern){
    const steps=[]; const display=[]; let i=0;
    while(i<pattern.length){
      const ch=pattern[i];
      if(ch===' '){ display.push({kind:'space'}); i++; continue; }
      if(ch==='['){
        const end=pattern.indexOf(']', i+1); const raw=pattern.slice(i+1, end>i?end:pattern.length);
        const keys=[...raw].filter(k=>KEY_MAP[k] !== undefined);
        if(keys.length){ const step={type:'chord',keys,raw:'['+raw+']',displayIndex:display.length}; steps.push(step); display.push({kind:'step', stepIndex:steps.length-1, raw:step.raw, type:'chord'}); }
        i=(end>i?end+1:pattern.length); continue;
      }
      if(ch==='{'){
        const end=pattern.indexOf('}', i+1); const raw=pattern.slice(i+1, end>i?end:pattern.length);
        for(const k of raw){
          if(KEY_MAP[k] !== undefined){ const step={type:'single',keys:[k],key:k,raw:k,quick:true,displayIndex:display.length}; steps.push(step); display.push({kind:'step', stepIndex:steps.length-1, raw:k, type:'quick'}); }
        }
        i=(end>i?end+1:pattern.length); continue;
      }
      if(KEY_MAP[ch] !== undefined){ const step={type:'single',keys:[ch],key:ch,raw:ch,displayIndex:display.length}; steps.push(step); display.push({kind:'step', stepIndex:steps.length-1, raw:ch, type:'single'}); }
      else display.push({kind:'unknown', raw:ch});
      i++;
    }
    return {steps,display};
  }
  const clone=value=>JSON.parse(JSON.stringify(value));
  function canonical(v){return Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;}
  function project(entry){
    if(!entry||typeof entry.id!=='string'||!entry.id||typeof entry.pattern!=='string')throw Error('Нужны ID и исходная строка пианистической записи.');
    // A serialized catalog omits runtime timing indices. Its revision must never be used as performance credit.
    const source=clone(entry),parsed=parsePattern(source.pattern),revision='piano-catalog-v7:'+Assessment.pianoSignature(source),partId=JSON.stringify(['piano',source.id,'part']),warnings=[],notes=[],assignments=[];
    const rhythm=source.rhythm,hasRhythm=Array.isArray(rhythm?.steps)&&rhythm.steps.length===parsed.steps.length;
    if(!hasRhythm)warnings.push({code:'EXACT_TIME_UNAVAILABLE'});
    const spec=source.fingeringSpec,hasSpec=spec?.pattern===source.pattern&&Array.isArray(spec.steps)&&spec.steps.length===parsed.steps.length;
    if(spec&&!hasSpec)warnings.push({code:'FINGERING_SPEC_UNMAPPED'});
    for(const[i,step]of parsed.steps.entries()){
      const r=hasRhythm?rhythm.steps[i]:null,known=Number.isFinite(r?.startBeat)&&r.startBeat>=0&&Number.isFinite(r?.durationBeats)&&r.durationBeats>0;
      if(hasRhythm&&!known)warnings.push({code:'INVALID_STEP_TIME',stepIndex:i});
      if(step.keys.length>1)warnings.push({code:'LEGACY_SHARED_CHORD_TIME',stepIndex:i});
      for(const[j,key]of step.keys.entries()){
        const noteId=JSON.stringify(['piano',source.id,revision,i,j]);
        notes.push({id:noteId,partId,pitch:{kind:'midi',value:KEY_MAP[key]},span:known?{kind:'known',start:r.startBeat,duration:r.durationBeats}:{kind:'unknown'}});
        const intent=hasSpec&&spec.steps[i]?.length===step.keys.length?spec.steps[i][j]:null;
        if(intent&&['left','right'].includes(intent.hand)&&Number.isInteger(intent.num)&&intent.num>=1&&intent.num<=5)assignments.push({noteId,hand:intent.hand,finger:intent.num});
        else if(hasSpec)warnings.push({code:'FINGERING_ASSIGNMENT_UNMAPPED',stepIndex:i,noteIndex:j});
      }
    }
    const music={schemaVersion:1,id:source.id,revision,timeUnit:'quarter',bpm:Number.isFinite(rhythm?.bpm)&&rhythm.bpm>0?rhythm.bpm:null,parts:[{id:partId}],notes};Music.assertValid(music);
    return {schemaVersion:VERSION,kind:'piano-catalog-projection',music,execution:{instrument:'piano',documentRevision:revision,assignments},warnings,compatibility:{format:'piano-catalog-v7',entry:source}};
  }
  function restore(projection){
    if(projection?.schemaVersion!==VERSION||projection.kind!=='piano-catalog-projection'||projection.compatibility?.format!=='piano-catalog-v7')throw Error('Неизвестная версия пианистического адаптера.');
    Music.assertValid(projection.music);
    const expected=project(projection.compatibility.entry);
    if(JSON.stringify(canonical(expected))!==JSON.stringify(canonical(projection)))throw Error('Представление изменено: обратное редактирование музыкального документа пока не поддерживается. Исходная запись сохранена.');
    return clone(projection.compatibility.entry);
  }
  function roundTripCatalog(snapshot){
    if(snapshot?.version!==7||!Array.isArray(snapshot.lessons)||!Array.isArray(snapshot.themes))throw Error('Адаптер ожидает каталог версии 7.');
    const result=clone(snapshot);result.lessons=result.lessons.map(entry=>restore(project(entry)));return result;
  }
  return {VERSION,KEY_MAP,parsePattern,project,restore,roundTripCatalog};
});
