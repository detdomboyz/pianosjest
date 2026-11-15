(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PianoOpenResponse=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // This declares unscored practice. It never judges a played response.
  function declared(lesson){
    const learning=lesson?.learning,kind=learning?.practiceProtocol?.kind;
    return Boolean(learning&&(learning.practiceType==='open-response'||
      typeof kind==='string'&&(kind==='open-response'||kind.startsWith('open-response-'))));
  }
  function prepare(lesson){
    if(!declared(lesson))return null;
    const learning=lesson.learning,p=learning.practiceProtocol;
    const unsupported=()=>Object.freeze({kind:'open-response-v1',manualOnly:true,supported:false,reason:'OPEN_RESPONSE_UNSUPPORTED'});
    if(learning.practiceType!=='open-response'||learning.machineCheck!=='practice'||
      p?.kind!=='open-response-v1'||p.version!==1||!['right','left'].includes(p.hand)||lesson.handMode!==p.hand)return unsupported();
    if(!Array.isArray(p.midis)||p.midis.length<2||p.midis.length>5||
      !p.midis.every((m,i)=>Number.isInteger(m)&&m>=21&&m<=108&&(i===0||m>p.midis[i-1]))||
      !Array.isArray(p.fingers)||p.fingers.length!==p.midis.length||
      !p.fingers.every(n=>Number.isInteger(n)&&n>=1&&n<=5)||new Set(p.fingers).size!==p.fingers.length||
      !p.midis.includes(p.targetMidi))return unsupported();
    for(const name of ['questionBeats','restBeats','answerBeats'])if(!Number.isFinite(p[name])||p[name]<=0||p[name]>16)return unsupported();
    return Object.freeze({kind:'open-response-v1',manualOnly:true,supported:true,hand:p.hand,
      midis:Object.freeze(Array.from(p.midis)),fingers:Object.freeze(Array.from(p.fingers)),targetMidi:p.targetMidi,
      questionBeats:p.questionBeats,restBeats:p.restBeats,answerBeats:p.answerBeats});
  }
  return {declared,prepare};
});
