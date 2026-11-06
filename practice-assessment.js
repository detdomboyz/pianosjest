(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PracticeAssessment=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const VERSION=1;
  function signature(value){
    const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
    const text=JSON.stringify(canonical(value));let hash=2166136261;
    for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return (hash>>>0).toString(16).padStart(8,'0');
  }
  function pianoSignature(lesson){return signature({pattern:lesson.pattern,rhythm:lesson.rhythm,fingeringSpec:lesson.fingeringSpec,handMode:lesson.handMode,articulation:lesson.learning?.articulation,timingPrecision:lesson.learning?.timingPrecision,...(lesson.learning?.ending!==undefined?{ending:lesson.learning.ending}:{})});}
  // Opt-in ending v1: endBeat is in the same musical scale as the note starts.
  // Existing lessons have no ending and retain their signatures and release rule.
  function pianoEnding({steps,ending,bpm,anchorAt,observedUntil}){
    if(ending===undefined)return {required:false,valid:true,ready:true};
    const validSteps=Array.isArray(steps)&&steps.length>0&&steps.every((s,i)=>Number.isFinite(s.startBeat)&&s.startBeat>=0&&Number.isFinite(s.durationBeats)&&s.durationBeats>0&&(!i||s.startBeat>=steps[i-1].startBeat));
    const lastEndBeat=validSteps?Math.max(...steps.map(s=>s.startBeat+s.durationBeats)):NaN;
    // Version 1 is a short phrase contract (at most 64 quarter-note units),
    // so an invalid imported ending cannot create an overflowing browser timer.
    if(!ending||ending.version!==1||!Number.isFinite(ending.endBeat)||!validSteps||ending.endBeat<=lastEndBeat||ending.endBeat-steps[0].startBeat>64)return {required:true,valid:false,ready:false};
    const clockValid=Number.isFinite(bpm)&&bpm>0&&Number.isFinite(anchorAt),beatMs=60000/bpm;
    const endAt=clockValid?anchorAt+(ending.endBeat-steps[0].startBeat)*beatMs:null;
    return {required:true,valid:true,ready:clockValid&&Number.isFinite(observedUntil)&&observedUntil>=endAt,endBeat:ending.endBeat,lastEndBeat,restBeats:ending.endBeat-lastEndBeat,endAt,restStartAt:clockValid?anchorAt+(lastEndBeat-steps[0].startBeat)*beatMs:null};
  }
  function guitarSignature(lesson){return signature({bpm:lesson.bpm,pitchToleranceCents:lesson.learning?.pitchToleranceCents,notes:lesson.notes.map(n=>({string:n.string,fret:n.fret,midi:n.midi,finger:n.finger,technique:n.technique,durationBeats:n.durationBeats,group:n.group,startBeat:n.startBeat,endBeat:n.endBeat,startSeconds:n.startSeconds,endSeconds:n.endSeconds,bendFromMidi:n.bendFromMidi,bendStartMidi:n.bendStartMidi,bendSemitones:n.bendSemitones,pitchEffect:n.pitchEffect,vibratoCents:n.vibratoCents}))});}
  // Project tolerances, not examination-board requirements. First onset anchors
  // the pulse; all subsequent onsets and every release must be observed.
  function assessPiano({steps,events,bpm,targetBpm,errors=0,timedOut=false,supported=true,mode='challenge',profile='standard',timingPrecision,ending,observedUntil,observationInterrupted=false}){
    const reasons=[],beatMs=60000/bpm,active=new Map(),observed=[];
    if(!supported||!steps?.length)reasons.push('Нет проверенного учебного плана');
    if(!Number.isFinite(bpm)||!Number.isFinite(targetBpm)||bpm<targetBpm)reasons.push('Темп ниже учебной цели');
    if(mode==='practice')reasons.push('Свободная практика');
    const beatBoundary=timingPrecision==='beat-boundary-v1'||timingPrecision==='beat-boundary-v2';
    if(timingPrecision!==undefined&&!beatBoundary)reasons.push('Неизвестный профиль точности ритма');
    if(errors||timedOut)reasons.push(errors?'Есть ошибки нот':'Превышен лимит времени');
    const noteOns=events.filter(e=>e.type==='on');
    if(noteOns.some(e=>e.source!=='midi'))reasons.push('Нужна запись с MIDI-инструмента');
    for(const e of events){
      if(!Number.isFinite(e.at))continue;
      if(e.type==='on'){
        if(active.has(e.midi)){reasons.push('Повторное нажатие без отпускания');continue;}
        const item={midi:e.midi,on:e.at,off:null};active.set(e.midi,item);observed.push(item);
      }else if(e.type==='off'&&active.has(e.midi)){active.get(e.midi).off=e.at;active.delete(e.midi);}
    }
    const expected=steps.flatMap((s,i)=>s.midis.map(midi=>({midi,step:i,start:s.startBeat,duration:s.durationBeats})));
    if(expected.length!==observed.length)reasons.push('Количество сыгранных нот отличается');
    const queues=new Map();for(const o of observed){if(!queues.has(o.midi))queues.set(o.midi,[]);queues.get(o.midi).push(o);}
    const matched=expected.map(e=>({...e,actual:queues.get(e.midi)?.shift()}));
    const first=matched.filter(e=>e.step===0&&e.actual).map(e=>e.actual.on);
    const anchor=first.length?Math.min(...first):NaN,start=steps[0]?.startBeat||0;
    const endingWindow=pianoEnding({steps,ending,bpm,anchorAt:anchor,observedUntil});
    let restErrors=0;
    if(endingWindow.required){
      if(observationInterrupted)reasons.push('Наблюдение MIDI прервано до конца паузы');
      if(!endingWindow.valid)reasons.push('Неизвестная или неверная граница конечной паузы');
      else{
        if(!endingWindow.ready)reasons.push('Конечная пауза ещё не завершена или не наблюдалась');
        if(events.some(e=>!Number.isFinite(e.at)||!Number.isFinite(observedUntil)||e.at>observedUntil))reasons.push('Неполная запись наблюдения');
        // Small project allowance at the release boundary; it does not move
        // the ending or allow a new NoteOn anywhere inside the final rest.
        const releaseAllowance=Math.min(130,beatMs*.12);
        restErrors=observed.filter(o=>o.on<endingWindow.endAt&&(o.on>=endingWindow.restStartAt||(o.off??Infinity)>endingWindow.restStartAt+releaseAllowance)).length;
        if(restErrors)reasons.push('Конечная пауза заполнена звуком');
      }
    }
    let onsetErrors=0,durationErrors=0,chordErrors=0;
    for(const e of matched){
      const a=e.actual;if(!a){onsetErrors++;continue;}
      if(Math.abs(a.on-(anchor+(e.start-start)*beatMs))>Math.max(90,beatMs*.22))onsetErrors++;
      const duration=e.duration*beatMs;
      // Allow a small articulation gap, but reject taps and indefinite holds.
      // Long rhythm-study notes must not gain a whole beat of tolerance.
      // This opt-in contract changes the lesson fingerprint, not other lessons.
      const durationTolerance=beatBoundary?Math.max(130,Math.min(duration*.30,beatMs*.22)):Math.max(130,duration*.30);
      if(a.off===null||a.off<a.on||Math.abs(a.off-a.on-duration)>durationTolerance)durationErrors++;
    }
    let releaseErrors=0;
    for(let i=0;i<steps.length;i++){
      const chord=matched.filter(e=>e.step===i).map(e=>e.actual).filter(Boolean);
      if(chord.length>1&&(Math.max(...chord.map(e=>e.on))-Math.min(...chord.map(e=>e.on))>120||chord.some(e=>e.off===null)||Math.min(...chord.map(e=>e.off??-Infinity))<=Math.max(...chord.map(e=>e.on))))chordErrors++;
      if(timingPrecision==='beat-boundary-v2'&&chord.length>1&&chord.every(e=>e.off!==null)&&Math.max(...chord.map(e=>e.off))-Math.min(...chord.map(e=>e.off))>120)releaseErrors++;
    }
    let articulationErrors=0;
    if(profile==='legato')for(let i=1;i<steps.length;i++){
      const p=steps[i-1],n=steps[i];if(p.midis.length!==1||n.midis.length!==1||p.midis[0]===n.midis[0]||n.startBeat-p.startBeat-p.durationBeats>.05)continue;
      const a=matched.find(e=>e.step===i-1)?.actual,b=matched.find(e=>e.step===i)?.actual;
      if(a&&b&&(a.off===null||b.on-a.off>Math.min(90,beatMs*.12)||a.off-b.on>Math.min(100,beatMs*.15)))articulationErrors++;
    }
    if(profile==='staccato')for(const e of matched){const a=e.actual;if(a&&(a.off===null||a.off-a.on>beatMs*.5))articulationErrors++;}
    if(articulationErrors)reasons.push(profile==='legato'?'Нарушена связь legato':'Звук недостаточно короткий для staccato');
    if(onsetErrors)reasons.push('Есть ошибки пульса или пауз');
    if(durationErrors)reasons.push('Есть ошибки длительности или отпускания');
    if(chordErrors)reasons.push('Аккорд сыгран неодновременно');
    if(releaseErrors)reasons.push('Окончания одновременных звуков не совпали');
    return {version:VERSION,clean:reasons.length===0,reasons:[...new Set(reasons)],onsetErrors,durationErrors,chordErrors,articulationErrors,...(timingPrecision?{timingPrecision}:{}),...(timingPrecision==='beat-boundary-v2'?{releaseErrors}:{}),...(endingWindow.required?{endingVersion:ending?.version,endingObserved:endingWindow.ready&&!observationInterrupted,endingInterrupted:Boolean(observationInterrupted),restErrors}:{}),scope:'MIDI: ноты, пульс, отпускания; пальцы и качество звука требуют проверки человеком'};
  }
  function assessGuitar({notes,hits,errors,manualAttempts=0,timedOut=false,cents=[],pitchToleranceCents=35}){
    const reasons=[];
    if(!notes?.length||hits!==notes.length||errors)reasons.push('Есть пропущенные или ошибочные ноты');
    if(manualAttempts)reasons.push('Есть ручные отметки');
    if(timedOut)reasons.push('Превышен лимит времени');
    const tolerance=Number.isFinite(pitchToleranceCents)?Math.max(5,Math.min(35,pitchToleranceCents)):35;
    if(cents.length!==hits||cents.some(c=>!Number.isFinite(c)||Math.abs(c)>tolerance))reasons.push('Нет точного подтверждения всех высот');
    const groups=new Map();notes?.forEach((n,i)=>{const key=n.group??'single-'+i;groups.set(key,(groups.get(key)||0)+1);});
    if([...groups.values()].some(n=>n>1))reasons.push('Одноголосный детектор не подтверждает аккорды');
    return {version:VERSION,pitchClean:reasons.length===0,mastered:false,reasons,scope:'Проверены только высоты; ритм, струны, пальцы, глушение и приёмы требуют отдельной проверки'};
  }
  function record(previous,{instrument,lessonId,fingerprint,mode,clean,now=Date.now()}){
    const old=previous&&previous.version===VERSION&&previous.fingerprint===fingerprint&&previous.instrument===instrument&&previous.lessonId===lessonId?previous:null;
    const history=previous&&previous.instrument===instrument&&previous.lessonId===lessonId&&previous.history&&typeof previous.history==='object'?{...previous.history}:{};
    if(previous&&!old&&previous.instrument===instrument&&previous.lessonId===lessonId){const {history:ignored,...snapshot}=previous;history[previous.version+':'+previous.fingerprint]=snapshot;}
    const takes=Array.isArray(old?.takes)?old.takes.filter(t=>t&&Number.isFinite(t.at)&&t.at<=now&&['challenge','memory'].includes(t.mode)).slice(-19):[];
    if(clean)takes.push({at:now,mode});
    const first=Number.isFinite(old?.firstCleanAt)?old.firstCleanAt:takes[0]?.at;
    const retained=first!==undefined&&takes.some(t=>t.mode==='memory'&&t.at-first>=86400000);
    return {version:VERSION,instrument,lessonId,fingerprint,history,firstCleanAt:first,takes,cleanTakes:takes.length,memory:takes.some(t=>t.mode==='memory'),retained,ready:takes.length>=3&&takes.some(t=>t.mode==='memory')};
  }
  return {VERSION,signature,pianoSignature,pianoEnding,guitarSignature,assessPiano,assessGuitar,record};
});
