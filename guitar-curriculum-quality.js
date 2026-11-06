(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else {root.GuitarCurriculumQuality=api;api.correctBuiltins(root.GBT_CURRICULUM);if(root.GBT_APP_READY&&root.dispatchEvent&&typeof CustomEvent==='function')root.dispatchEvent(new CustomEvent('gbt:course-data-updated'));}})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const OPEN={6:40,5:45,4:50,3:55,2:59,1:64},HARMONIC={12:{offset:12,partial:2},7:{offset:19,partial:3},5:{offset:24,partial:4}};
  const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function correctBuiltins(data){
    let corrected=0;const topic=data?.topics.find(t=>t.id==='tech-31');if(!topic)return corrected;
    for(const lesson of topic.lessons){
      if(!/^t31-l0[1-8]$/.test(lesson.id))continue;
      for(const collection of [lesson.notes,lesson.sourceNotes].filter(Array.isArray))for(const note of collection){
        const harmonic=HARMONIC[note.fret],open=OPEN[note.string];
        // Only the known shipped fretted-pitch error; never rewrite user edits.
        if(!harmonic||open===undefined||!/флажолет/i.test(note.technique||'')||note.midi!==open+note.fret||note.fret===12)continue;
        note.pitchCorrection={version:1,oldMidi:note.midi,reason:'Натуральный флажолет: звучащая высота обертона, а не зажатого лада',source:'https://phys.unsw.edu.au/jw/strings.html'};
        note.midi=open+harmonic.offset;note.note=names[note.midi%12]+(Math.floor(note.midi/12)-1);
        note.frequency=440*2**((open-69)/12)*harmonic.partial;corrected++;
      }
    }
    return corrected;
  }
  function inspectLesson(lesson){
    const groups=new Map();for(const [i,n] of (lesson.notes||[]).entries()){const key=n.group??'single-'+i;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n);}
    const wideGroups=[...groups].filter(([,notes])=>{const frets=notes.filter(n=>n.fret>0).map(n=>n.fret);return notes.length>1&&frets.length>1&&Math.max(...frets)-Math.min(...frets)>4;}).map(([id])=>id);
    return {wideGroups,hideFingerHints:wideGroups.length>0};
  }
  return {correctBuiltins,inspectLesson};
});
