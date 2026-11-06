/* Explicit exercise intent, not inference from prose or an expert certification.
 * These assignments encode the instructions of this project's first 80 lessons.
 * Musical reference patterns and independent tests: docs/FINGERING_AUDIT.md.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.BeginnerFingering=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const R={60:1,62:2,64:3,65:4,67:5};
  const L={48:5,50:4,52:3,53:2,55:1};
  const RG={67:1,69:2,71:3,72:4,74:5};
  const LF={53:5,55:4,57:3,59:2,60:1};
  const SCALE_R=[1,2,3,1,2,3,4,5],SCALE_L=[5,4,3,2,1,3,2,1];
  function build(lesson,stepMidiList){
    const match=/^course(\d{2})-(\d{2})$/.exec(lesson.id);
    if(!match) return null;
    const course=Number(match[1]),unit=Number(match[2]);
    const steps=lesson.steps.map((step,index)=>{
      const midis=stepMidiList(step);
      return midis.map((midi,noteIndex)=>{
        let hand=midi<60?'left':'right',num=(midi<60?L:R)[midi];
        if(course===1&&unit===5){ hand='right'; num=1; } // relocate C -> F
        if(course===2||course===4){ hand='right'; num=R[midi]; }
        if(course===3){ hand='left'; num=L[midi]; }
        if(course===5&&unit===6){ hand='right'; num=(index<5?R:RG)[midi]; }
        if(course===5&&unit===7){ hand='left'; num=(index<5?L:LF)[midi]; }
        if(course===6){
          if(unit===1){ hand='right'; num=R[midi]; }
          if(unit===2){ hand='left'; num=L[midi]; }
          if(unit>=3&&unit<=6){ hand=unit<=4?'right':'left'; const scale=hand==='right'?SCALE_R:SCALE_L; num=(unit%2===0?scale.slice().reverse():scale)[index]; }
          if(unit===7){ hand='right'; num=[1,2,3,5,5,3,2,1][index]; }
          if(unit===8){ hand=index>=8&&index<16?'left':'right'; num=index<8?SCALE_R[index]:index<16?SCALE_L.slice().reverse()[index-8]:[1,2,3,5][index-16]; }
        }
        if((course===8||course===10&&unit===6)&&midis.length===3){
          hand=midi<60?'left':'right';
          const order=midis.slice().sort((a,b)=>a-b).indexOf(midi);
          num=(hand==='right'?[1,3,5]:[5,3,1])[order];
        }
        if(course===8&&(unit===6||unit===8)&&midis.length===1){
          hand='right';
          const group=unit===6?Math.floor(index/6):Math.floor((index-4)/3);
          if(index>=4||unit===6) num=[{60:1,64:3,67:5},{65:1,69:3,72:5},{67:1,71:3,74:5}][group]?.[midi]||R[midi];
          if(midi<60){ hand='left'; num=L[midi]; }
        }
        // Twinkle's six-note range: use 4 on G and 5 on A, then return to C position.
        if(course===9&&(unit===3||unit===8&&index>=9&&index<16)){
          hand='right'; num=({60:1,62:2,64:3,65:4,67:4,69:5})[midi];
        }
        if(course===10&&unit===3){
          hand=index<10?'right':'left';
          num=(index<5?R:index<10?RG:index<15?L:LF)[midi];
        }
        if(!Number.isInteger(num)) throw new Error(`Missing teaching assignment: ${lesson.id} step ${index+1} note ${midi}`);
        return {hand,num};
      });
    });
    return {version:1,source:'beginner-exercise-intent-v1',pattern:lesson.pattern,steps};
  }
  return {build};
});
