'use strict';
const fs=require('node:fs'),path=require('node:path');
const {loadApp}=require('../tests/helpers/load-app.cjs'),{loadGuitarCourse}=require('./curriculum-inventory.cjs'),Catalog=require('../catalog-sections.js');
function inspect({before=false}={}){
  const piano=loadApp({unreviewed:before}),guitar=loadGuitarCourse(undefined,{correct:!before}),issues=[];
  const add=(instrument,lesson,code,detail)=>issues.push({instrument,lessonId:lesson.id,title:lesson.title,code,detail});
  for(const lesson of piano.lessons.filter(l=>Catalog.sectionOf('piano',l,piano.themes)==='learning')){
    if(!lesson.rhythm)add('piano',lesson,'NO_TIMED_ETUDE','Для собственного упражнения не заданы длительности и паузы');
    if(lesson.steps.length>64&&!lesson.learning?.phraseSize)add('piano',lesson,'LONG_PRACTICE','Более 64 действий: '+lesson.steps.length);
    if(lesson.rhythm&&/без останов|без пауз/i.test(lesson.title+' '+lesson.description)&&lesson.rhythm.steps.some(s=>s.restBeforeBeats>.05))add('piano',lesson,'CONTINUOUS_WITH_RESTS','Инструкция непрерывной игры расходится с паузами ритма');
    if(/неподвиж|без движения кисти|двигается только/i.test([lesson.description,lesson.guide?.motion].join(' ')))add('piano',lesson,'RIGID_MOTION_WORDING','Уточнить свободу кисти вместо требования полной неподвижности');
    const pitchClasses=new Set(lesson.steps.flatMap(piano.stepMidiList).map(m=>m%12));
    if(/^Am:/.test(lesson.title)&&lesson.steps.some(s=>piano.stepMidiList(s).length===3&&piano.stepMidiList(s).some(m=>![9,0,4].includes(m%12))))add('piano',lesson,'WRONG_AM_TRIAD','В A minor должны быть A–C–E, в исходнике A–C–D');
    if(/гамм/i.test(lesson.title)&&pitchClasses.size===5)add('piano',lesson,'FIVE_NOTES_CALLED_SCALE','Пятипальцевая фигура названа гаммой');
    if(/(?:более|больше|максимум)\s+одн\S*\s+ошиб\S*\s+ритм/i.test(lesson.guide?.mastery||''))add('piano',lesson,'PASS_RULE_CONFLICT','Инструкция разрешает ошибку ритма, а зачёт требует чистой попытки');
  }
  for(const lesson of guitar.lessons.filter(l=>Catalog.sectionOf('guitar',l,guitar.topics)==='learning')){
    for(let i=1;i<lesson.notes.length;i++){
      const n=lesson.notes[i],p=lesson.notes[i-1],t=n.technique||'';
      if(/^(slide|слайд)$/i.test(t)&&p.string===n.string&&p.finger!==n.finger)add('guitar',lesson,'SLIDE_CHANGES_FINGER',{index:i,from:p.finger,to:n.finger});
      if(n.pick==='none'&&/hammer-on/i.test(t)&&p.string===n.string&&(n.fret<=p.fret||n.finger<=p.finger))add('guitar',lesson,'INVALID_HAMMER_FINGERS',{index:i,from:[p.fret,p.finger],to:[n.fret,n.finger]});
      if(n.pick==='none'&&/pull-off/i.test(t)&&p.string===n.string&&(n.fret>=p.fret||n.finger>=p.finger))add('guitar',lesson,'INVALID_PULL_FINGERS',{index:i,from:[p.fret,p.finger],to:[n.fret,n.finger]});
      if(/bend target|полутоновый target|vibrato на bend/i.test(t)&&!Number.isFinite(n.bendFromMidi))add('guitar',lesson,'BEND_USES_TARGET_FRET',{index:i,fret:n.fret,midi:n.midi});
    }
    if(lesson.id==='t09-l03'&&/безымянн/i.test(lesson.description)&&lesson.notes.some(n=>/hammer-on/.test(n.technique||'')&&n.finger!==3))add('guitar',lesson,'HAMMER_TEXT_FINGER','Написано безымянный, показан мизинец');
  }
  const summary={};for(const issue of issues)summary[issue.code]=(summary[issue.code]||0)+1;
  return {checked:{piano:Catalog.available('piano','learning',piano.lessons,piano.themes).length,guitar:Catalog.available('guitar','learning',guitar.lessons,guitar.topics).length},summary,issues};
}
if(require.main===module){const before=inspect({before:true}),after=inspect(),result={generatedAt:new Date().toISOString(),before,after};fs.writeFileSync(path.resolve(__dirname,'../docs/lesson-review-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({before:{checked:before.checked,summary:before.summary},after:{checked:after.checked,summary:after.summary}},null,2));if(after.issues.length)process.exitCode=1;}
module.exports={inspect};
