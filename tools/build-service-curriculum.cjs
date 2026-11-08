'use strict';
// Derive the server contract from the exact code/catalog used by the trainer.
// This does not edit notes, the curriculum route, or the immutable baseline.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadApp}=require('../tests/helpers/load-app.cjs'),Assessment=require('../practice-assessment.js');
const ROOT=path.resolve(__dirname,'..');
const {hash}=require('../service/canonical.cjs');
function build(){
  const app=loadApp({events:true}),context={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'curriculum-plan.js'),'utf8'),context);
  const plan=context.MUSIC_CURRICULUM_PLAN.piano,byId=new Map(app.lessons.map(l=>[l.id,l])),learningIds=new Set(app.sectionLessons().map(l=>l.id)),rows=[];
  function goalFor(lesson){const seen=new Set();while(lesson.learning?.sameGoalAs){if(seen.has(lesson.id))throw Error('Goal cycle');seen.add(lesson.id);lesson=byId.get(lesson.learning.sameGoalAs);if(!lesson)throw Error('Missing shared goal');}return lesson.id;}
  const stages={};const curriculum={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'curriculum.js'),'utf8'),curriculum);Object.assign(stages,curriculum.MusicCurriculum.stages);
  for(const e of plan){
    const lesson=byId.get(e.id);if(!lesson||!learningIds.has(lesson.id))continue;
    const rhythm=app.normalizeLessonRhythm(lesson.rhythm,lesson.steps.length);app.setTestLesson(lesson);
    const ready=Boolean(e.challenge&&e.fingerprint===Assessment.pianoSignature(lesson)&&rhythm&&lesson.fingeringSpec);
    const body={pattern:lesson.pattern,rhythm:lesson.rhythm,fingeringSpec:lesson.fingeringSpec,handMode:lesson.handMode,articulation:lesson.learning?.articulation,timingPrecision:lesson.learning?.timingPrecision,ending:lesson.learning?.ending,timeLimit:lesson.timeLimit};
    const musicVersion=hash(body),editionVersion=hash({id:lesson.id,title:lesson.title,description:lesson.description,learning:lesson.learning,musicVersion,timeLimit:lesson.timeLimit});
    const steps=ready?rhythm.steps.map((step,index)=>({midis:Array.from(app.stepMidiList(lesson.steps[index])),startBeat:step.startBeat,durationBeats:step.durationBeats})):null;
    rows.push({id:lesson.id,title:lesson.title,description:lesson.description||'',stage:e.stage,stageTitle:stages[e.stage]?.title||e.stage,optional:Boolean(stages[e.stage]?.optional),goal:lesson.learning?.goal||'',requires:Array.from(e.preparation||[]),goalKey:goalFor(lesson),challengeReady:ready,gradeFingerprint:Assessment.pianoSignature(lesson),musicVersion,editionVersion,...(ready?{bpm:Math.round(rhythm.practiceBpm||rhythm.bpm),timeLimit:lesson.timeLimit,steps,profile:lesson.learning?.articulation||'standard',timingPrecision:lesson.learning?.timingPrecision,ending:lesson.learning?.ending}:{})});
  }
  const route=rows.filter(x=>!x.optional&&x.challengeReady).map(x=>x.id),known=new Set(rows.map(x=>x.id));
  for(const row of rows)for(const id of row.requires)if(!known.has(id))throw Error('Unknown course prerequisite '+id);
  const value={kind:'melodiajest-canonical-course',version:1,policyVersion:1,sourceVersion:require('../package.json').version,route,lessons:rows,counts:{learning:rows.length,graded:rows.filter(x=>x.challengeReady).length,sequential:route.length,practice:rows.filter(x=>!x.challengeReady).length}};
  value.contentSha256=hash({route,lessons:rows});return value;
}
if(require.main===module){const value=build();fs.writeFileSync(path.join(ROOT,'service/course-registry.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify({counts:value.counts,sha256:value.contentSha256,first:value.lessons[0],sampleRequirements:value.lessons.filter(x=>x.requires.length).slice(0,2).map(x=>({id:x.id,requires:x.requires}))}));}
module.exports={build,hash};
