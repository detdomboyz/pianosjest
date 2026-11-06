'use strict';

// Pure validation of future specifications; this does not register lessons,
// certify distinct pedagogical goals or award performance/ear-training credit.
function validatePlannedLessons(plans,{implementedLessonIds,implementedLessonLengths={},domainIds,sourceEvidenceIds}){
 const implemented=new Set(implementedLessonIds),domains=new Set(domainIds),sources=new Set(sourceEvidenceIds),byId=new Map(),goalKeys=new Set();
 if(!Array.isArray(plans))throw Error('Future lesson plans must be an array');
 const fail=(l,message)=>{throw Error('Invalid planned lesson '+(l?.id||'<missing-id>')+': '+message);};
 for(const l of plans){
  if(!l||typeof l.id!=='string'||!l.id.trim())fail(l,'missing ID');
  if(implemented.has(l.id)||byId.has(l.id))fail(l,'ID is already implemented or duplicated');
  if(typeof l.goal!=='string'||!l.goal.trim()||!domains.has(l.coverageDomain))fail(l,'missing goal or unknown domain');
  if(typeof l.reviewStatus!=='string'||!l.reviewStatus.startsWith('planned-'))fail(l,'future status must remain planned');
  if(l.goalKey!==undefined){if(typeof l.goalKey!=='string'||!l.goalKey.trim()||goalKeys.has(l.goalKey))fail(l,'duplicate or invalid goal identity');goalKeys.add(l.goalKey);}
  byId.set(l.id,l);
 }
 const known=id=>implemented.has(id)||byId.has(id);
 function checkNotes(l,notes,label){
  if(!Array.isArray(notes)||!notes.length)fail(l,label+' needs explicit notes');
  for(const n of notes){
   if(!n||!Number.isInteger(n.midi)||n.midi<0||n.midi>127||!['left','right'].includes(n.hand)||!Number.isInteger(n.finger)||n.finger<1||n.finger>5)fail(l,label+' has invalid piano pitch, hand or finger');
   if(l.hand!=='both'&&n.hand!==l.hand)fail(l,label+' hand differs from its plan');
   if(!Number.isFinite(n.startBeat)||n.startBeat<0||!Number.isFinite(n.durationBeats)||n.durationBeats<=0)fail(l,label+' has invalid note timing');
  }
  if(notes.some((n,i)=>i&&n.startBeat<notes[i-1].startBeat))fail(l,label+' notes are not in onset order');
 }
 for(const l of plans){
  if(!Array.isArray(l.requires)||!l.requires.length||new Set(l.requires).size!==l.requires.length||l.requires.some(id=>id===l.id||!known(id)))fail(l,'unknown, repeated or self preparation');
  if(typeof l.after!=='string'||l.after===l.id||!known(l.after))fail(l,'unknown or self display anchor');
  if(l.preparationFragments!==undefined){
   if(!Array.isArray(l.preparationFragments)||!l.preparationFragments.length)fail(l,'empty preparation fragments');
   for(const f of l.preparationFragments){
    if(!f||!implemented.has(f.lessonId)||!Number.isSafeInteger(f.firstStep)||f.firstStep<0||!Number.isSafeInteger(f.lastStep)||f.lastStep<f.firstStep||!Number.isSafeInteger(implementedLessonLengths[f.lessonId])||f.lastStep>=implementedLessonLengths[f.lessonId])fail(l,'unknown or out-of-range preparation fragment');
    if(typeof f.goal!=='string'||!f.goal.trim()||f.requiredBeforeAssessment!==true)fail(l,'preparation fragment needs a goal and explicit assessment requirement');
    const a=f.adaptation;if(l.requiresModel?.includes('preparation-fragment-tempo-adaptation-v1')&&a===undefined)fail(l,'preparation fragment needs an explicit tempo adaptation');if(a!==undefined&&(!a||a.version!==1||a.kind!=='project-training-adaptation'||typeof a.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,127}$/.test(a.id)||!Number.isFinite(a.targetBpm)||a.targetBpm<=0||a.targetBpm!==l.targetBpm||typeof a.rationale!=='string'||!a.rationale.trim()))fail(l,'preparation fragment has invalid or mismatched adaptation');
   }
   if(!l.requiresModel?.includes('preparation-fragment-completion'))fail(l,'preparation fragment completion support must remain explicit');
  }
  if(!['left','right','both'].includes(l.hand))fail(l,'unknown hand');
  checkNotes(l,l.targetNotes,'target');
  if(l.hand==='both'&&new Set(l.targetNotes.map(n=>n.hand)).size!==2)fail(l,'two-hand plan needs notes for each hand');
  if(l.hand!=='both'&&(!Array.isArray(l.targetFingers)||l.targetFingers.length!==l.targetNotes.length||l.targetFingers.some((n,i)=>n!==l.targetNotes[i].finger)))fail(l,'target finger sequence differs from explicit notes');
  if(l.targetMidis!==undefined&&(!Array.isArray(l.targetMidis)||l.targetMidis.length!==l.targetNotes.length||l.targetMidis.some((n,i)=>n!==l.targetNotes[i].midi)))fail(l,'target pitch sequence differs from explicit notes');
  if(!Array.isArray(l.candidateEvidenceIds)||!l.candidateEvidenceIds.length||new Set(l.candidateEvidenceIds).size!==l.candidateEvidenceIds.length||l.candidateEvidenceIds.some(id=>!sources.has(id)))fail(l,'missing or unknown source evidence');
  if(l.assessmentProtocol!==undefined){
   const p=l.assessmentProtocol,kind=p?.kind;
   if(p?.version!==1||!['pitch-direction','melody-playback','notation-to-key'].includes(kind)||l.assessmentStatus!=='not-implemented')fail(l,'unknown protocol or premature assessment status');
   if(!['firstExposureRequired','trackExposure','excludeDemonstrationsFromAssessment','responseBeforeReveal','assistedItemsPracticeOnly','repeatedItemsPracticeOnly'].every(k=>p[k]===true))fail(l,'first-exposure protocol must protect response, demonstrations and exposure history');
   if(p.response!==(kind==='pitch-direction'?'direction-choice':'midi-pitch-sequence'))fail(l,'response type differs from its task');
   if(!Array.isArray(l.requiresModel)||!l.requiresModel.length||!l.requiresModel.includes('item-exposure-history'))fail(l,'future first-exposure support must be explicit');
   if(!l.transfer||typeof l.transfer.goal!=='string'||!l.transfer.goal.trim())fail(l,'missing transfer goal');
   checkNotes(l,l.transfer.notes,'transfer');
   if(typeof l.distinctFrom!=='string'||!l.distinctFrom.trim()||!Array.isArray(l.practiceSteps)||l.practiceSteps.length<3||!Array.isArray(l.selfCheck)||l.selfCheck.length<3)fail(l,'missing comparison, preparation, practice or self-check');
  }
 }
 const done=new Set(),active=new Set(),order=[];
 function visit(id,path){
  if(done.has(id))return;
  if(active.has(id))throw Error('Planned preparation/anchor cycle: '+[...path,id].join(' -> '));
  active.add(id);const l=byId.get(id);
  for(const dependency of new Set([...l.requires,l.after]))if(byId.has(dependency))visit(dependency,[...path,id]);
  active.delete(id);done.add(id);order.push(id);
 }
 for(const l of plans)visit(l.id,[]);
 return {planCount:plans.length,dependencyOrder:order};
}

module.exports={validatePlannedLessons};
