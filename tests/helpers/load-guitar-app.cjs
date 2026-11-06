'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadGuitarCourse}=require('../../tools/curriculum-inventory.cjs');
const ROOT=path.resolve(__dirname,'../..');
function loadGuitarApp(root=path.resolve(ROOT,'../guitarjest')){
  const saved=new Map();
  const window={GBT_CURRICULUM:loadGuitarCourse(root),addEventListener(){},setTimeout(){},clearTimeout(){},setInterval(){return 1;},clearInterval(){},dispatchEvent(){}};
  const context=vm.createContext({window,console,URLSearchParams,performance:{now:()=>1000},requestAnimationFrame(){},location:{search:''},navigator:{},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},document:{addEventListener(){},getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return [];}},setTimeout(){},clearTimeout(){},CustomEvent:class{}});
  for(const name of ['practice-assessment.js','curriculum.js','curriculum-plan.js','guitar-curriculum-quality.js','catalog-sections.js','lesson-quality.js','lesson-development.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),context,{filename:name});
  let source=fs.readFileSync(path.join(root,'app.js'),'utf8');
  const marker='  window.setTimeout(bootApplication, 40);';if(!source.includes(marker))throw Error('Guitar boot marker');
  source=source.replace(marker,`render=()=>{};updateDynamicLessonUI=()=>{};clearLessonTimer=()=>{};announce=()=>{};
    globalThis.testApp={state,completeLesson,registerAttempt,renderSessionResult,renderGuidedList,guidedLessons,lessonAllowsFingerHints,learningContractHtml,setContentSection,sectionLessons,selectLesson,nextLesson,previousLesson,renderSidebarListOnly,piecePracticeHtml,scheduleSynthVoice};`);
  vm.runInContext(source,context,{filename:'app.js'});return {...context.testApp,saved};
}
module.exports={loadGuitarApp};
