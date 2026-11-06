/* Piano fingering heuristics. See docs/FINGERING_AUDIT.md for evidence and limits.
 * Shared production module: browser global + CommonJS, without DOM or network.
 */
(function(root, factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PianoFingering=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function createEngine({stepMidiList,lessonHandMode,phraseGap}){
    function hashText(value){ let hash=2166136261; for(const ch of String(value)){ hash^=ch.charCodeAt(0); hash=Math.imul(hash,16777619); } return (hash>>>0).toString(36); }
  const WHITE_DEGREES=[0,2,4,5,7,9,11]; const PC_TO_WHITE_DEGREE={0:0,2:1,4:2,5:3,7:4,9:5,11:6};
  function whiteCoord(m){ const oct=(Math.floor(m/12)-1),pc=((m%12)+12)%12; if(PC_TO_WHITE_DEGREE[pc]!==undefined) return oct*7+PC_TO_WHITE_DEGREE[pc]; const lower={1:0,3:1,6:3,8:4,10:5}[pc]; return oct*7+lower+0.55; }
  function midiFromWhiteCoord(w){ const n=Math.max(0,Math.round(w)); const oct=Math.floor(n/7); const deg=((n%7)+7)%7; return (oct+1)*12+WHITE_DEGREES[deg]; }
  const VERSION=4;
  function fingeringSignature(lesson){
    return hashText('fingering-v4|'+JSON.stringify({pattern:lesson.pattern,notes:lesson.steps.map(stepMidiList),mode:lessonHandMode(lesson),spec:lesson.fingeringSpec||null,rhythm:lesson.rhythm||null}));
  }
  function fixedNote(lesson,stepIndex,noteIndex){ return lesson.fingeringSpec?.steps?.[stepIndex]?.[noteIndex]||null; }
  function validSpec(lesson){
    const spec=lesson.fingeringSpec;
    if(!spec) return true;
    return spec.version===1&&spec.pattern===lesson.pattern&&Array.isArray(spec.steps)&&spec.steps.length===lesson.steps.length&&spec.steps.every((step,i)=>Array.isArray(step)&&step.length===stepMidiList(lesson.steps[i]).length&&step.every(note=>note===null||(note&&['left','right'].includes(note.hand)&&Number.isInteger(note.num)&&note.num>=1&&note.num<=5)));
  }
  function overlappingSteps(lesson){
    const found=new Set();let activeUntil=-Infinity;
    lesson.rhythm?.steps?.forEach((timing,i)=>{
      if(Number(timing.startBeat)<activeUntil-1e-6) found.add(i);
      activeUntil=Math.max(activeUntil,Number(timing.startBeat)+Number(timing.durationBeats));
    });
    return found;
  }
  function validateStep(lesson,index,assigned){
    const expected=stepMidiList(lesson.steps[index]),mode=lessonHandMode(lesson);
    if(!Array.isArray(assigned)||assigned.length!==expected.length) return false;
    if(new Set(expected).size!==expected.length||expected.some(m=>!Number.isInteger(m)||m<21||m>108)) return false;
    for(let i=0;i<expected.length;i++){
      const n=assigned[i],fixed=fixedNote(lesson,index,i);
      if(!n||n.midi!==expected[i]||!['left','right'].includes(n.hand)||!Number.isInteger(n.num)||n.num<1||n.num>5) return false;
      if(fixed&&((fixed.hand&&n.hand!==fixed.hand)||(fixed.num&&n.num!==fixed.num))) return false;
      if(!fixed?.hand&&['left','right'].includes(mode)&&n.hand!==mode) return false;
    }
    for(const hand of ['left','right']){
      const group=assigned.filter(n=>n.hand===hand).sort((a,b)=>a.midi-b.midi);
      if(!Number.isFinite(fingerLayoutReachCost(hand,group.map(n=>n.midi),group.map(n=>n.num)))) return false;
    }
    return true;
  }
  function serializeFingeringPlan(plan){
    if(!plan||plan.version!==VERSION||!Array.isArray(plan.steps)||plan.issues?.length) return null;
    return {version:VERSION,signature:String(plan.signature||''),generatedAt:String(plan.generatedAt||''),steps:plan.steps.map(step=>step.map(item=>({midi:item.midi,hand:item.hand,num:item.num}))),stats:plan.stats||null};
  }
  function normalizeStoredFingeringPlan(raw,lesson){
    if(!raw||raw.version!==VERSION||raw.signature!==fingeringSignature(lesson)||!Array.isArray(raw.steps)||raw.steps.length!==lesson.steps.length) return null;
    if(!validSpec(lesson)) return null;
    if(overlappingSteps(lesson).size) return null;
    if(!raw.steps.every((step,index)=>validateStep(lesson,index,step))) return null;
    const steps=raw.steps.map(step=>step.map(item=>({midi:item.midi,hand:item.hand,num:item.num})));
    return {version:VERSION,signature:raw.signature,generatedAt:String(raw.generatedAt||''),steps,issues:[],stats:raw.stats||null};
  }
  function hasValidStoredFingering(lesson){ return Boolean(lesson&&lesson.fingeringPlan&&normalizeStoredFingeringPlan(lesson.fingeringPlan,lesson)); }
  const WHITE_PCS=new Set([0,2,4,5,7,9,11]);
  function isBlackMidi(midi){ return !WHITE_PCS.has(((midi%12)+12)%12); }
  function combinations(values,count,start=0,prefix=[],out=[]){
    if(prefix.length===count){ out.push(prefix.slice()); return out; }
    for(let i=start;i<=values.length-(count-prefix.length);i++){ prefix.push(values[i]); combinations(values,count,i+1,prefix,out); prefix.pop(); }
    return out;
  }
  // Conservative project limits in white-key widths, not anatomical guarantees.
  // In particular 3-4 is less mobile than 1-2: finger-number gap alone is insufficient.
  const MAX_HAND_CHORD_SPAN=7;
  const REACH_BY_PAIR={'1-2':3.6,'1-3':5.2,'1-4':6.2,'1-5':7,'2-3':2.35,'2-4':3.5,'2-5':5,'3-4':1.8,'3-5':3.5,'4-5':2.35};
  function chordSpanLimit(){ return MAX_HAND_CHORD_SPAN; }
  function fingerReachLimit(a,b){
    return REACH_BY_PAIR[[a,b].sort((x,y)=>x-y).join('-')]||0;
  }
  function fingerLayoutReachCost(hand,midis,fingers){
    if(!['left','right'].includes(hand)||midis.length!==fingers.length||midis.length>5) return Infinity;
    if(midis.some(m=>!Number.isInteger(m)||m<21||m>108)||fingers.some(f=>!Number.isInteger(f)||f<1||f>5)) return Infinity;
    if(!midis.length) return 0;
    const pairs=midis.map((m,i)=>({m,f:fingers[i]})).sort((a,b)=>a.m-b.m);
    const sorted=pairs.map(p=>p.m); fingers=pairs.map(p=>p.f); let cost=0;
    if(new Set(sorted).size!==sorted.length||new Set(fingers).size!==fingers.length) return Infinity;
    if(fingers.some((f,i)=>i>0&&(hand==='right'?f<=fingers[i-1]:f>=fingers[i-1]))) return Infinity;
    const span=whiteCoord(sorted[sorted.length-1])-whiteCoord(sorted[0]);
    const spanLimit=chordSpanLimit(sorted.length);
    if(span>spanLimit+1e-9) return Infinity;
    for(let i=0;i<sorted.length;i++) for(let j=i+1;j<sorted.length;j++){
      const distance=whiteCoord(sorted[j])-whiteCoord(sorted[i]);
      const limit=fingerReachLimit(fingers[i],fingers[j],sorted.length);
      if(!limit) return Infinity;
      if(distance>limit+1e-9) return Infinity;
      else{
        const ratio=distance/limit;
        if(ratio>.70) cost+=Math.pow(ratio-.70,2)*22;
        if(Math.abs(fingers[j]-fingers[i])===1&&distance>1.45) cost+=Math.pow(distance-1.45,2)*2.4;
      }
    }
    return cost;
  }
  function fingerLayouts(hand,midis){
    const sorted=midis.slice().sort((a,b)=>a-b); const out=[];
    if(sorted.length>5) return out;
    for(const combo of combinations([1,2,3,4,5],sorted.length)){
      const fingers=hand==='right'?combo:combo.slice().reverse();
      const reachCost=fingerLayoutReachCost(hand,sorted,fingers);
      if(Number.isFinite(reachCost)) out.push({fingers,reachCost});
    }
    out.sort((a,b)=>a.reachCost-b.reachCost);
    return out;
  }
  function playableFingerLayouts(hand,midis){ return fingerLayouts(hand,midis); }
  function isPlayableHandChord(midis,hand){ return midis.length<=1||playableFingerLayouts(hand,midis).length>0; }

  function handRegisterCost(midi,hand,mode){
    let cost=0;
    if(hand==='left') cost+=Math.pow(Math.max(0,midi-60),2)*0.46+Math.pow(Math.max(0,43-midi),2)*0.04;
    else cost+=Math.pow(Math.max(0,60-midi),2)*0.46+Math.pow(Math.max(0,midi-88),2)*0.04;
    if(mode==='split'){
      if(hand==='left'&&midi>=67) cost+=18+(midi-67)*2;
      if(hand==='right'&&midi<=53) cost+=18+(53-midi)*2;
    }
    if(mode==='left'&&hand==='right') cost+=90;
    if(mode==='right'&&hand==='left') cost+=90;
    return cost;
  }
  function handCandidatesForStep(lesson,index){
    const mids=stepMidiList(lesson.steps[index]); const mode=lessonHandMode(lesson);
    if(new Set(mids).size!==mids.length||mids.some(m=>!Number.isInteger(m)||m<21||m>108)) return [];
    const accepts=hands=>hands.every((hand,i)=>{
      const fixed=fixedNote(lesson,index,i);
      return fixed?.hand?fixed.hand===hand:!['left','right'].includes(mode)||mode===hand;
    });
    if(mode==='left'&&accepts(mids.map(()=>'left'))&&isPlayableHandChord(mids,'left')){ const center=mids.length?mids.reduce((a,b)=>a+b,0)/mids.length:null; return [{hands:mids.map(()=> 'left'),localCost:0,leftCenter:center,rightCenter:null}]; }
    if(mode==='right'&&accepts(mids.map(()=>'right'))&&isPlayableHandChord(mids,'right')){ const center=mids.length?mids.reduce((a,b)=>a+b,0)/mids.length:null; return [{hands:mids.map(()=> 'right'),localCost:0,leftCenter:null,rightCenter:center}]; }
    const indexed=mids.map((midi,i)=>({midi,i})).sort((a,b)=>a.midi-b.midi||a.i-b.i);
    const adjacentGaps=indexed.slice(1).map((item,pos)=>whiteCoord(item.midi)-whiteCoord(indexed[pos].midi));
    const largestGap=adjacentGaps.length?Math.max(...adjacentGaps):0;
    const collect=()=>{
      const out=[];
      for(let split=0;split<=indexed.length;split++){
        if(split>5||indexed.length-split>5) continue;
        const hands=Array(indexed.length).fill('right');
        indexed.forEach((item,pos)=>{ hands[item.i]=pos<split?'left':'right'; });
        if(!accepts(hands)) continue;
        let cost=0; const left=indexed.slice(0,split).map(x=>x.midi),right=indexed.slice(split).map(x=>x.midi);
        if(!isPlayableHandChord(left,'left')||!isPlayableHandChord(right,'right')) continue;
        mids.forEach((midi,i)=>{ cost+=handRegisterCost(midi,hands[i],mode); });
        let boundaryGap=null;
        if(left.length&&right.length){
          boundaryGap=whiteCoord(right[0])-whiteCoord(left[left.length-1]);
          cost+=Math.pow(Math.max(0,largestGap-boundaryGap),2)*8;
          cost+=Math.max(0,2.4-boundaryGap)*10;
        }
        if(left.length&&right.length&&Math.max(...left)>=Math.min(...right)) cost+=1000;
        out.push({hands,localCost:cost,leftCenter:left.length?left.reduce((a,b)=>a+b,0)/left.length:null,rightCenter:right.length?right.reduce((a,b)=>a+b,0)/right.length:null,boundaryGap});
      }
      return out;
    };
    const strict=collect();
    if(strict.length){
      const wholeHand=strict.some(candidate=>candidate.leftCenter===null||candidate.rightCenter===null);
      if(!wholeHand&&mids.length>=3){
        const maxBoundary=Math.max(...strict.map(candidate=>Number(candidate.boundaryGap)||0));
        if(maxBoundary>=3.5){
          const clustered=strict.filter(candidate=>(Number(candidate.boundaryGap)||0)>=maxBoundary-.2);
          if(clustered.length) return clustered;
        }
      }
      return strict;
    }
    return [];
  }
  function assignHandsGlobally(lesson){
    let beam=[{cost:0,leftCenter:null,rightCenter:null,lastSingleHand:'',lastSingleMidi:null,previous:null}];
    lesson.steps.forEach((step,index)=>{
      const mids=stepMidiList(step),candidates=handCandidatesForStep(lesson,index),next=[];
      if(!candidates.length){ beam=beam.map(item=>({...item,previous:item,hands:[]})); return; }
      for(const stateItem of beam) for(const candidate of candidates){
        let cost=stateItem.cost+(candidate.localCost||0); const gap=phraseGap(lesson,index-1,index);
        for(const hand of ['left','right']){
          const center=hand==='left'?candidate.leftCenter:candidate.rightCenter;
          const previous=hand==='left'?stateItem.leftCenter:stateItem.rightCenter;
          if(center!==null&&previous!==null){ const distance=Math.abs(center-previous); cost+=gap*(distance<=7?distance*distance*0.075:3.7+(distance-7)*(distance-7)*0.42); }
        }
        const usedLeft=candidate.leftCenter!==null,usedRight=candidate.rightCenter!==null;
        const nextLeft=usedLeft?candidate.leftCenter:stateItem.leftCenter,nextRight=usedRight?candidate.rightCenter:stateItem.rightCenter;
        if(nextLeft!==null&&nextRight!==null&&nextLeft>nextRight-3) cost+=120+Math.pow(nextLeft-(nextRight-3),2)*8;
        let lastSingleHand=stateItem.lastSingleHand,lastSingleMidi=stateItem.lastSingleMidi;
        if(mids.length===1){
          const currentHand=candidate.hands[0],currentMidi=mids[0];
          if(lastSingleHand&&lastSingleHand!==currentHand){ const distance=Math.abs(currentMidi-lastSingleMidi); const quick=Boolean(step.quick||(lesson.steps[index-1]&&lesson.steps[index-1].quick)); cost+=(quick?11:5.5)*Math.max(0,1-distance/18); }
          lastSingleHand=currentHand; lastSingleMidi=currentMidi;
        }
        next.push({cost,leftCenter:nextLeft,rightCenter:nextRight,lastSingleHand,lastSingleMidi,previous:stateItem,hands:candidate.hands});
      }
      next.sort((a,b)=>a.cost-b.cost);
      const unique=[]; const seen=new Set();
      for(const item of next){ const key=[item.leftCenter===null?'x':Math.round(item.leftCenter),item.rightCenter===null?'x':Math.round(item.rightCenter),item.lastSingleHand,item.lastSingleMidi===null?'x':item.lastSingleMidi].join('|'); if(seen.has(key)) continue; seen.add(key); unique.push(item); if(unique.length>=64) break; }
      beam=unique.length?unique:next.slice(0,64);
    });
    const path=[]; let best=beam[0];
    while(best?.previous){ path.push(best.hands); best=best.previous; }
    return path.reverse();
  }
  function fingerCandidatesForEvent(hand,event){
    const notes=event.notes.slice().sort((a,b)=>a.midi-b.midi||a.noteIndex-b.noteIndex); const n=notes.length;
    const out=[],layouts=playableFingerLayouts(hand,notes.map(note=>note.midi));
    for(const layout of layouts){
      const fingers=layout.fingers; const roots=[]; let localCost=layout.reachCost;
      if(notes.some((note,i)=>note.fixed?.num&&note.fixed.num!==fingers[i])) continue;
      const chordSpan=notes.length>1?whiteCoord(notes[notes.length-1].midi)-whiteCoord(notes[0].midi):0;
      if(n>=3){
        const lowTarget=hand==='right'?1:5,highTarget=hand==='right'?5:1;
        const outerWeight=chordSpan>=3?24:6;
        localCost+=Math.abs(fingers[0]-lowTarget)*outerWeight+Math.abs(fingers[n-1]-highTarget)*outerWeight;
        if(n===3) localCost+=Math.abs(fingers[1]-3)*10;
      }
      notes.forEach((note,i)=>{ const finger=fingers[i]; const offset=hand==='right'?finger-1:5-finger; roots.push(whiteCoord(note.midi)-offset); if(isBlackMidi(note.midi)&&finger===1) localCost+=4.5; if(isBlackMidi(note.midi)&&finger===5) localCost+=0.9; });
      const root=roots.reduce((a,b)=>a+b,0)/roots.length; localCost+=roots.reduce((sum,value)=>sum+Math.pow(value-root,2)*4,0);
      out.push({root,localCost,assignments:notes.map((note,i)=>({midi:note.midi,noteIndex:note.noteIndex,num:fingers[i]})),low:notes[0].midi,high:notes[notes.length-1].midi});
    }
    return out;
  }
  function fingerTransitionCost(hand,previous,current,gap){
    let cost=Math.pow(Math.abs(current.root-previous.root),2)*0.55*gap;
    for(const now of current.assignments){ const same=previous.assignments.find(old=>old.midi===now.midi); if(same) cost+=Math.abs(same.num-now.num)*3; }
    if(previous.assignments.length===1&&current.assignments.length===1){
      const a=previous.assignments[0],b=current.assignments[0],delta=whiteCoord(b.midi)-whiteCoord(a.midi),fingerDelta=b.num-a.num;
      if(delta===0) cost+=a.num===b.num?0:6;
      else if(Math.abs(delta)<=6){
        const natural=hand==='right'?fingerDelta:-fingerDelta;
        if(Math.sign(natural)===Math.sign(delta)&&natural!==0) cost+=Math.abs(Math.abs(delta)-Math.abs(natural))*0.8;
        else{
          const crossing=(a.num===1||b.num===1)&&a.num!==b.num;
          const preferredCrossing=hand==='right'
            ? (delta>0&&a.num===3&&b.num===1)||(delta<0&&a.num===1&&b.num===3)
            : (delta>0&&a.num===1&&b.num===3)||(delta<0&&a.num===3&&b.num===1);
          cost+=crossing?(preferredCrossing ? .6 : 3.8):24;
        }
      }
    }
    return cost;
  }
  // Recognize ONLY complete isolated monotonic scale runs. Do not force scale
  // fingering onto arbitrary melodies, partial runs, or author-assigned fingers.
  // One standard variant per key; Hanon no.39 provides the repeating crossings.
  const MAJOR_SCALES={
    0:['12312345','54321321'],1:['23123412','32143213'],
    2:['12312345','54321321'],3:['31234123','32143213'],
    4:['12312345','54321321'],5:['12341234','54321321'],
    6:['23412312','43213214'],7:['12312345','54321321'],
    8:['34123123','32143213'],9:['12312345','54321321'],
    10:['21231234','32143213'],11:['12312345','43214321']
  };
  function scalePreferences(hand,events,lesson){
    if(events.length<4||events.some(e=>e.notes.length!==1||e.notes[0].fixed)) return null;
    if(events.some((e,i)=>i>0&&(e.stepIndex!==events[i-1].stepIndex+1||phraseGap(lesson,events[i-1].stepIndex,e.stepIndex)<1))) return null;
    const notes=events.map(e=>e.notes[0].midi),descending=notes[1]<notes[0],ascending=descending?notes.slice().reverse():notes;
    if(ascending.some((m,i)=>i>0&&m<=ascending[i-1])) return null;
    const fingers=[];
    if([0,5,7].includes(ascending[0]%12)&&(ascending.length-1)%3===0&&ascending.every((m,i)=>m===ascending[0]+12*Math.floor(i/3)+[0,4,7][i%3])){
      // Root-position C/F/G major arpeggios, Hanon no.41 (C/F on p.65).
      const base=hand==='right'?[1,2,3]:[1,4,2];
      for(let i=0;i<ascending.length;i++) fingers.push(i===0&&hand==='left'?5:i===ascending.length-1?(hand==='right'?5:1):base[i%3]);
    }else if(ascending.length>=13&&ascending.every((m,i)=>m===ascending[0]+i)){
      // Hanon no.40: third finger on black keys; second bridges E-F / B-C.
      for(const m of ascending){ const pc=m%12; fingers.push(isBlackMidi(m)?3:hand==='right'?(pc===5||pc===0?2:1):(pc===4||pc===11?2:1)); }
      // An isolated run may begin/end without a preceding/following white key.
      if(hand==='right'&&ascending[0]%12===0) fingers[0]=1;
      if(hand==='left'&&ascending.at(-1)%12===0) fingers[fingers.length-1]=1;
    }else{
      if(ascending.length<8||(ascending.length-1)%7!==0) return null;
      const degrees=[0,2,4,5,7,9,11];
      if(ascending.some((m,i)=>m!==ascending[0]+12*Math.floor(i/7)+degrees[i%7])) return null;
      const base=MAJOR_SCALES[ascending[0]%12][hand==='right'?0:1].split('').map(Number);
      for(let i=0;i<ascending.length;i++){
        let f=base[i%7];
        if(i===ascending.length-1) f=base[7];
        else if(i>0&&i%7===0) f=hand==='left'?base[7]:base[0]===2&&ascending[0]%12===10?4:base[0];
        fingers.push(f);
      }
    }
    return descending?fingers.reverse():fingers;
  }
  function optimizeHandFingers(lesson,hand,handAssignments){
    const events=[];
    lesson.steps.forEach((step,stepIndex)=>{ const mids=stepMidiList(step),notes=[]; mids.forEach((midi,noteIndex)=>{ if(handAssignments[stepIndex][noteIndex]===hand) notes.push({midi,noteIndex,fixed:fixedNote(lesson,stepIndex,noteIndex)}); }); if(notes.length) events.push({stepIndex,notes}); });
    if(!events.length) return new Map();
    const preferredScale=scalePreferences(hand,events,lesson);
    // Viterbi: retain the best predecessor PER candidate, then backtrack once.
    // The former 80-path beam retained duplicate ending states and copied full
    // histories at each note, losing useful candidates and scaling quadratically.
    const result=new Map(),layers=[];
    let previousEvent=null;
    const flush=()=>{
      if(!layers.length) return;
      let best=layers.at(-1).reduce((a,b)=>a.cost<=b.cost?a:b);
      for(let i=layers.length-1;i>=0;i--){ result.set(layers[i][0].stepIndex,best.candidate.assignments); best=best.previous; }
      layers.length=0;
    };
    for(let eventIndex=0;eventIndex<events.length;eventIndex++){
      const event=events[eventIndex];
      const candidates=fingerCandidatesForEvent(hand,event).filter(candidate=>!preferredScale||candidate.assignments[0].num===preferredScale[eventIndex]);
      if(!candidates.length){ flush(); previousEvent=null; continue; }
      const previousLayer=layers.at(-1),gap=previousEvent?phraseGap(lesson,previousEvent.stepIndex,event.stepIndex):0;
      const layer=candidates.map(candidate=>{
        let best=null,bestCost=Infinity;
        for(const previous of previousLayer||[]){
          const cost=previous.cost+fingerTransitionCost(hand,previous.candidate,candidate,gap);
          if(cost<bestCost){ bestCost=cost; best=previous; }
        }
        return {cost:candidate.localCost+(best?bestCost:0),candidate,previous:best,stepIndex:event.stepIndex};
      });
      layers.push(layer); previousEvent=event;
    }
    flush();
    return result;
  }
  function buildFingeringPlan(lesson){
    if(!validSpec(lesson)) return {version:VERSION,signature:fingeringSignature(lesson),steps:lesson.steps.map(()=>[]),issues:lesson.steps.map((_,stepIndex)=>({stepIndex,code:'invalid-spec',message:'Учебные назначения не соответствуют нотам урока.'})),stats:{actions:lesson.steps.length,leftNotes:0,rightNotes:0,pedagogicalReview:false,status:'needs-review'}};
    const handAssignments=assignHandsGlobally(lesson),left=optimizeHandFingers(lesson,'left',handAssignments),right=optimizeHandFingers(lesson,'right',handAssignments); let leftNotes=0,rightNotes=0;
    const issues=[];
    const overlaps=overlappingSteps(lesson);
    const steps=lesson.steps.map((step,index)=>{ const mids=stepMidiList(step),combined=[]; for(const hand of ['left','right']){ const source=(hand==='left'?left:right).get(index)||[]; source.forEach(item=>combined.push({midi:item.midi,hand,num:item.num,noteIndex:item.noteIndex})); }
      if(overlaps.has(index)){ issues.push({stepIndex:index,code:'held-voices',message:'Здесь продолжается предыдущий звук. Автоматический расчёт пока не моделирует удержанные голоса и замену пальцев.'}); return []; }
      const byIndex=new Map(combined.map(item=>[item.noteIndex,item]));
      const assigned=mids.map((midi,noteIndex)=>{ const item=byIndex.get(noteIndex); return item?{midi:item.midi,hand:item.hand,num:item.num}:null; });
      if(!validateStep(lesson,index,assigned)){ issues.push({stepIndex:index,code:'unsupported',message:'Не удалось подобрать аппликатуру в пределах ограничений. Проверь распределение рук и размах с преподавателем.'}); return []; }
      assigned.forEach(item=>{ if(item.hand==='left') leftNotes++; else rightNotes++; }); return assigned;
    });
    return {version:VERSION,signature:fingeringSignature(lesson),generatedAt:new Date().toISOString(),steps,issues,stats:{actions:lesson.steps.length,leftNotes,rightNotes,method:'constrained-viterbi-v4',status:issues.length?'needs-review':'structurally-checked',pedagogicalReview:false}};
  }
    return {whiteCoord,midiFromWhiteCoord,fingeringSignature,serializeFingeringPlan,normalizeStoredFingeringPlan,hasValidStoredFingering,fingerLayoutReachCost,buildFingeringPlan,fingerTransitionCost,fingerLayouts};
  }
  return {createEngine};
});
