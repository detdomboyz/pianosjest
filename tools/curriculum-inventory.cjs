'use strict';

const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {loadApp}=require('../tests/helpers/load-app.cjs');
const ROOT=path.resolve(__dirname,'..');
const DEFAULT_GUITAR_ROOT=path.resolve(ROOT,'../guitarjest');

function loadGuitarCourse(root=DEFAULT_GUITAR_ROOT,{correct=true}={}){
  const window={dispatchEvent(){}};
  const context=vm.createContext({window,console,CustomEvent:class{}});
  for(const name of ['curriculum-data.js','lifes-a-gas-study.js','multi-song-studies.js','edition20-content.js']){
    vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,''),context,{filename:name,timeout:15000});
  }
  if(correct){require(path.join(root,'guitar-curriculum-quality.js')).correctBuiltins(window.GBT_CURRICULUM);require(path.join(root,'lesson-quality.js')).repairGuitar(window.GBT_CURRICULUM,require(path.join(root,'lesson-review-baseline.js')));require(path.join(root,'lesson-development.js')).registerGuitar(window.GBT_CURRICULUM);}
  return window.GBT_CURRICULUM;
}

function summarizePiano(app){
  return app.themes.map(theme=>{
    const lessons=app.lessons.filter(l=>l.themeId===theme.id);
    return {id:theme.id,order:theme.order,title:theme.name,lessons:lessons.map(l=>{
      const notes=l.steps.map(app.stepMidiList),flat=notes.flat();
      return {id:l.id,title:l.title,description:l.description,actions:notes.length,notes:flat.length,exam:l.exam,guide:!!l.guide,rhythm:!!l.rhythm,bpm:l.rhythm?.practiceBpm||null,maxChord:Math.max(0,...notes.map(n=>n.length)),blackNotes:flat.filter(m=>![0,2,4,5,7,9,11].includes(m%12)).length,low:Math.min(...flat),high:Math.max(...flat),seconds:l.timeLimit};
    })};
  });
}

function summarizeGuitar(data){
  return data.topics.map(topic=>({id:topic.id,order:topic.order,title:topic.title,lessons:(topic.lessons||[]).map(l=>{
    const notes=l.notes||[],byGroup=new Map();
    for(let i=0;i<notes.length;i++){const n=notes[i],key=n.group??i;byGroup.set(key,(byGroup.get(key)||0)+1);}
    return {id:l.id,title:l.title,description:l.description,goal:l.goal,category:l.category||topic.category,notes:notes.length,exam:!!l.isExam,final:!!l.isFinal,difficulty:l.difficulty,bpm:l.bpm,minBpm:l.minBpm,maxBpm:l.maxBpm,hasExactTime:notes.some(n=>Number.isFinite(n.startSeconds)||Number.isFinite(n.startBeat)),maxChord:Math.max(0,...byGroup.values()),maxFret:Math.max(0,...notes.map(n=>Number(n.fret)||0)),techniques:[...new Set(notes.map(n=>n.technique).filter(Boolean))],sample:notes[0]||null};
  })}));
}

function inventory(guitarRoot){const app=loadApp();return{piano:summarizePiano(app),guitar:summarizeGuitar(loadGuitarCourse(guitarRoot))};}

if(require.main===module){
  const report=inventory(process.argv[2]);
  fs.mkdirSync(path.join(ROOT,'tmp'),{recursive:true});
  fs.writeFileSync(path.join(ROOT,'tmp/curriculum-inventory.json'),JSON.stringify(report,null,2)+'\n');
  for(const [instrument,themes] of Object.entries(report)){
    console.log(instrument.toUpperCase(),themes.length,'themes',themes.reduce((n,t)=>n+t.lessons.length,0),'lessons');
    for(const t of themes)console.log(t.order+' | '+t.id+' | '+t.title+' | '+t.lessons.length+' | '+t.lessons.slice(0,2).map(l=>l.title).join(' / '));
  }
}
module.exports={loadGuitarCourse,inventory};
