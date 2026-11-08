'use strict';
const Assessment=require('../practice-assessment.js'),{check,exactFields}=require('./security.cjs');
const clamp=value=>Math.max(0,Math.min(100,Math.round(value)));
function eventsInput(value,observedUntil){
  check(Number.isFinite(observedUntil)&&observedUntil>=0&&observedUntil<=600000,400,'OBSERVATION','Неверная длительность наблюдения.');
  check(Array.isArray(value)&&value.length>0&&value.length<=512,400,'MIDI_EVENTS','Ожидается запись до 512 MIDI-событий.');
  let last=-1;
  return value.map(event=>{
    exactFields(event,['type','midi','at','source']);
    check(['on','off'].includes(event.type)&&Number.isInteger(event.midi)&&event.midi>=0&&event.midi<=127&&Number.isFinite(event.at)&&event.at>=last&&event.at>=0&&event.at<=observedUntil&&['midi','keyboard','pointer'].includes(event.source),400,'MIDI_EVENTS','Повреждена последовательность MIDI-событий.');
    last=event.at;return {type:event.type,midi:event.midi,at:event.at,source:event.source};
  });
}
function grade(plan,events,mode,observedUntil,interrupted){
  const assessment=Assessment.assessPiano({steps:plan.steps,events,bpm:plan.bpm,targetBpm:plan.bpm,mode,profile:plan.profile,timingPrecision:plan.timingPrecision,ending:plan.ending,observedUntil,observationInterrupted:interrupted});
  if(interrupted){assessment.clean=false;assessment.reasons.push('Попытка прерывалась или использовала помощь после начала.');}
  const active=new Map(),played=[];
  for(const event of events){if(event.type==='on'){const item={midi:event.midi,on:event.at,off:null};played.push(item);active.set(event.midi,item);}else if(active.has(event.midi)){active.get(event.midi).off=event.at;active.delete(event.midi);}}
  const queues=new Map();for(const item of played){if(!queues.has(item.midi))queues.set(item.midi,[]);queues.get(item.midi).push(item);}
  const expected=plan.steps.flatMap((s,index)=>s.midis.map(midi=>({midi,start:s.startBeat,duration:s.durationBeats,index})));
  const matched=expected.map(item=>({...item,actual:queues.get(item.midi)?.shift()}));
  const first=matched.filter(x=>x.index===0&&x.actual).map(x=>x.actual.on),anchor=first.length?Math.min(...first):0,beat=60000/plan.bpm,start=plan.steps[0].startBeat;
  if(Number.isFinite(plan.timeLimit)&&observedUntil-anchor>plan.timeLimit*1000+100){assessment.clean=false;assessment.reasons.push('Превышен лимит времени учебной фразы.');}
  const count=expected.length,matchedCount=matched.filter(x=>x.actual).length;
  const onset=matched.reduce((sum,x)=>sum+(x.actual?Math.min(1,Math.abs(x.actual.on-anchor-(x.start-start)*beat)/Math.max(90,beat*.22)):1),0)/count;
  const hold=matched.reduce((sum,x)=>sum+(x.actual?.off!==null&&x.actual?.off!==undefined?Math.min(1,Math.abs(x.actual.off-x.actual.on-x.duration*beat)/Math.max(130,plan.timingPrecision?Math.min(x.duration*beat*.30,beat*.22):x.duration*beat*.30)):1),0)/count;
  const metrics={notes:clamp(100*Math.max(0,matchedCount-Math.abs(played.length-count))/count),pulse:clamp(100*(1-onset)),holds:clamp(100*(1-hold)),chords:assessment.chordErrors?0:100};
  return {assessment,metrics,quality:assessment.clean?clamp(.45*metrics.pulse+.45*metrics.holds+.10*metrics.chords):0};
}
module.exports={eventsInput,grade};
