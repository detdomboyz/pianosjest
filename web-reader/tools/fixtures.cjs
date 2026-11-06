'use strict';
const fs=require('node:fs'),path=require('node:path'),Adapter=require('../../piano-catalog-adapter.js'),Staff=require('../../piano-staff-view.js');
const ROOT=path.resolve(__dirname,'../..'),copy=x=>JSON.parse(JSON.stringify(x));
function examples(){
 const backlog=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/piano-lesson-backlog.json'),'utf8'));
 function one(clef){
  const plan=backlog.lessons.find(l=>l.id==='detail-p-read-'+clef+'-01');
  const pattern=plan.targetNotes.map(n=>Object.keys(Adapter.KEY_MAP).find(k=>Adapter.KEY_MAP[k]===n.midi)).join(' ');
  const entry={id:'staff-reader-demo-'+clef,title:'Открытый пример '+clef,pattern,contentKind:'exercise',rhythm:{version:1,source:'project-reading-demonstration',bpm:56,practiceBpm:56,steps:plan.targetNotes.map(n=>({startBeat:n.startBeat,durationBeats:n.durationBeats}))},handMode:plan.hand,fingeringSpec:{version:1,pattern,steps:plan.targetNotes.map(n=>[{hand:n.hand,num:n.finger}])}};
  const projection=Adapter.project(entry),music=projection.music,notation={documentRevision:music.revision,partId:music.parts[0].id,clef,spelling:music.notes.map(n=>{const position=plan.notation.pitchPositions.find(p=>p.midi===n.pitch.value),label=clef==='treble'?{60:'C',62:'D',64:'E'}[position.midi]:{48:'C',50:'D',52:'E'}[position.midi];return {noteId:n.id,step:label,octave:clef==='treble'?4:3,alter:0};})};
  return {entry,projection,music,notation,view:Staff.project(music,notation)};
 }
 const treble=one('treble'),bass=one('bass'),unsupported=copy(treble);unsupported.music.notes[0].pitch={kind:'midi',value:61};unsupported.notation.spelling[0]={...unsupported.notation.spelling[0],alter:1};unsupported.view=Staff.project(unsupported.music,unsupported.notation);
 return {treble,bass,unsupported};
}
module.exports={examples};
