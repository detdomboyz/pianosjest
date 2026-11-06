#!/usr/bin/env node
'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {loadApp}=require('../tests/helpers/load-app.cjs');

function auditCatalog(){
  const app=loadApp(),started=performance.now(),flagged=[],structuralFailures=[];
  let notes=0,actions=0,assignedNotes=0,unsupportedActions=0;
  const issueCounts={};
  for(const lesson of app.lessons){
    const plan=app.buildFingeringPlan(lesson);
    actions+=lesson.steps.length;
    const issuesByStep=new Set(plan.issues.map(issue=>issue.stepIndex));
    for(let i=0;i<lesson.steps.length;i++){
      const expected=app.stepMidiList(lesson.steps[i]),actual=plan.steps[i];
      notes+=expected.length;assignedNotes+=actual.length;
      if(!actual.length) unsupportedActions++;
      if(actual.length!==expected.length&&!(actual.length===0&&issuesByStep.has(i))) structuralFailures.push({lessonId:lesson.id,stepIndex:i,error:'missing assignments without warning'});
      for(let j=0;j<actual.length;j++){
        const n=actual[j];
        if(n.midi!==expected[j]||!Number.isInteger(n.num)||n.num<1||n.num>5||!['left','right'].includes(n.hand)) structuralFailures.push({lessonId:lesson.id,stepIndex:i,error:'invalid note assignment'});
      }
    }
    if(!plan.issues.length&&!app.normalizeStoredFingeringPlan(plan,lesson)) structuralFailures.push({lessonId:lesson.id,error:'generated plan fails saved-plan validation'});
    for(const issue of plan.issues) issueCounts[issue.code]=(issueCounts[issue.code]||0)+1;
    if(plan.issues.length) flagged.push({lessonId:lesson.id,title:lesson.title,actions:lesson.steps.length,issues:plan.issues.length,codes:[...new Set(plan.issues.map(i=>i.code))],firstSteps:plan.issues.slice(0,8).map(i=>i.stepIndex+1)});
  }
  return {schemaVersion:1,checkedAt:new Date().toISOString(),scope:'bundled catalog; structural checks and model limits, not a musician review',pedagogicalReview:false,lessons:app.lessons.length,actions,notes,assignedNotes,unsupportedActions,issueCounts,flaggedLessons:flagged.length,structuralFailures,beginner:app.auditBeginnerCurriculum(true),elapsedMs:Math.round(performance.now()-started),flagged};
}

if(require.main===module){
  const result=auditCatalog();
  result.sourceSha256=Object.fromEntries(['index.html','fingering.js','beginner-fingering.js','chopin-theme.js','tests/fixtures/fingering-reference.json'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',name))).digest('hex')]));
  fs.mkdirSync(path.resolve(__dirname,'../docs'),{recursive:true});
  fs.writeFileSync(path.resolve(__dirname,'../docs/fingering-audit-results.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({...result,sourceSha256:undefined,flagged:undefined},null,2));
  if(result.structuralFailures.length||!result.beginner.ok) process.exitCode=1;
}

module.exports={auditCatalog};
