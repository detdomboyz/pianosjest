'use strict';
// Maintained teaching order. Do not infer difficulty from a title/version number.
const fs=require('node:fs'),path=require('node:path');
const {loadApp}=require('../tests/helpers/load-app.cjs');
const {loadGuitarCourse}=require('./curriculum-inventory.cjs');
const assessment=require('../practice-assessment.js');
const ROOT=path.resolve(__dirname,'..');
// Resolve after-dependencies independently of the physical catalogue order.
// A mapped anchor may itself move, so finish that anchor before inserting its child.
function insertDetails(out,lessons,instrument){
  const pending=lessons.filter(l=>l.learning?.after),known=new Set(lessons.map(l=>l.id)),pendingIds=new Set(pending.map(l=>l.id));
  for(const l of pending)if(!known.has(l.learning.after))throw Error('Missing preparation '+l.learning.after+' for '+l.id);
  while(pending.length){
    let progressed=false;
    for(let i=0;i<pending.length;){
      const l=pending[i],d=l.learning;
      if(pendingIds.has(d.after)||!out.some(e=>e.id===d.after)){i++;continue;}
      const previousIndex=out.findIndex(e=>e.id===l.id);if(previousIndex>=0)out.splice(previousIndex,1);
      const index=out.findIndex(e=>e.id===d.after),piano=instrument==='piano';
      out.splice(index+1,0,{id:l.id,stage:d.stage,branch:d.branch||'common',fingerprint:piano?assessment.pianoSignature(l):assessment.guitarSignature(l),challenge:piano&&d.machineCheck==='piano-midi',preparation:d.requires});
      pending.splice(i,1);pendingIds.delete(l.id);progressed=true;
    }
    if(!progressed)throw Error('Unresolved preparation cycle or missing route anchor: '+pending.map(l=>l.id+' after '+l.learning.after).join(', '));
  }
}
function build(guitarRoot){
  const app=loadApp(),guitar=loadGuitarCourse(guitarRoot),piano=[],g=[];
  const add=(out,lesson,stage,branch='common')=>{
    if(out.some(e=>e.id===lesson.id))throw Error('Duplicate route '+lesson.id);
    out.push({id:lesson.id,stage,branch,fingerprint:out===piano?assessment.pianoSignature(lesson):assessment.guitarSignature(lesson),challenge:out===piano&&Boolean(lesson.fingeringSpec&&lesson.learning?.machineCheck==='piano-midi')});
  };
  const ids=(course,from=1,to=8)=>Array.from({length:to-from+1},(_,i)=>`course${String(course).padStart(2,'0')}-${String(i+from).padStart(2,'0')}`);
  const p=(stage,list)=>list.forEach(id=>{const l=app.lessons.find(l=>l.id===id);if(!l)throw Error(id);add(piano,l,stage);});
  p('p1',ids(1,1,5));
  p('p2',[...ids(4,1,3),...ids(2,1,1),...ids(3,1,1),...ids(2,2,2),...ids(3,2,2),...ids(4,4,5),...Array.from({length:6},(_,i)=>[ids(2,i+3,i+3)[0],ids(3,i+3,i+3)[0]]).flat()]);
  p('p3',[...ids(9,1,2),...ids(9,4,5),...ids(5),...ids(6,1,2),...ids(4,6,8),...ids(9,3,3)]);
  p('p4',[...ids(1,6,8),...ids(7,1,6),...ids(9,6,6)]);
  p('p5',[...ids(6,3,8),...ids(8,1,6),...ids(7,7,8),...ids(8,7,8)]);
  p('p6',[...ids(9,7,8),...ids(10)]);
  const pThemes=(stage,orders)=>orders.forEach(order=>app.lessons.filter(l=>app.themes.find(t=>t.id===l.themeId)?.order===order).forEach(l=>add(piano,l,stage)));
  pThemes('p7',[37,38,39,40,41,12,30,31,23,24,13,21,19,14,27,32,18,26,16,17]);
  pThemes('p8',[28,42,35,15,22,29,36,44]);
  pThemes('p9',[11,20,25,33,34,43,...Array.from({length:26},(_,i)=>45+i)]);
  const gt=(stage,topicIds,branch='common')=>topicIds.forEach(id=>{
    const topic=guitar.topics.find(t=>t.id===id);if(!topic)throw Error(id);
    let ls=topic.lessons;
    if(id==='tech-01')ls=[ls[6],...ls.slice(0,6),ls[7]]; // tune before the playing tests
    ls.forEach(l=>add(g,l,stage,branch));
  });
  const tech=n=>'tech-'+String(n).padStart(2,'0'),mel=n=>'mel-'+String(n).padStart(2,'0');
  gt('g1',[tech(1),'topic-string-open-control']);
  gt('g1',['topic-string-pima'],'fingers');gt('g1',[tech(2)],'pick');
  gt('g2',[tech(3),'topic-string-fretted','topic-string-crossing',tech(8),'topic-string-muted']);
  const rhythm=guitar.topics.find(t=>t.id===tech(5)).lessons;
  rhythm.slice(0,5).forEach(l=>add(g,l,'g2'));
  gt('g3',[24,21,5,22,23,1,2,3,4,10,11,12,13,14,15,16].map(mel));
  gt('g4',[7,15,38,6].map(tech));
  gt('g5',[4,13,9,23,24,27,25,26,21,16,28,10,32,29].map(tech));
  gt('g5',['topic-string-dynamics']);
  rhythm.slice(5).forEach(l=>add(g,l,'g6'));
  gt('g6',[17,18,30,35,36,37,39,14,45].map(tech));
  gt('g7',[11,22,40,46,44,47,12].map(tech));
  gt('g8',[19,20,31,33,34,41,42,43,48].map(tech));
  for(const t of guitar.topics){const ls=t.lessons.filter(l=>!l.learning?.after&&!g.some(e=>e.id===l.id));ls.forEach(l=>add(g,l,'g9'));}
  insertDetails(piano,app.lessons,'piano');insertDetails(g,guitar.lessons,'guitar');
  if(piano.length!==app.lessons.length||g.length!==guitar.lessons.length)throw Error('Unmapped lessons');
  const preparation={
    'course04-04':['course02-02','course04-02'],
    'course04-05':['course02-02','course04-01'],
    'course01-07':['course02-08','course03-08'],
    'course09-03':['course05-06'],
    'course07-07':['course08-02','course07-06'],
    'course08-07':['course08-02','course07-06']
  };
  for(const e of piano)if(preparation[e.id])e.preparation=[...new Set([...(e.preparation||[]),...preparation[e.id]])];
  return {version:1,piano,guitar:g};
}
if(require.main===module){const plan=build(process.argv[2]);fs.writeFileSync(path.join(ROOT,'curriculum-plan.js'),'(function(root){root.MUSIC_CURRICULUM_PLAN='+JSON.stringify(plan,null,2)+';})(typeof window===\'object\'?window:globalThis);\n');console.log('Mapped',plan.piano.length,'piano and',plan.guitar.length,'guitar lessons');}
module.exports={build,insertDetails};
