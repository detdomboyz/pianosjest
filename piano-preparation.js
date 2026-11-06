(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./practice-assessment.js'),require('./piano-catalog-adapter.js')):factory(root.PracticeAssessment,root.PianoCatalogAdapter);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoPreparation=api;})(typeof window==='object'?window:globalThis,function(Assessment,Adapter){
 'use strict';
 const VERSION=1,LEGACY_PROGRESS_VERSION=1,POLICY='three-clean-one-memory-v1',MAX_LEGACY_CHARS=2000000;
 const copy=x=>JSON.parse(JSON.stringify(x)),object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),integer=x=>Number.isSafeInteger(x)&&x>=0;
 function fail(code){throw Object.assign(Error(code),{code});}
 function key(r){return JSON.stringify(['piano-preparation',VERSION,r.assessmentVersion,r.lessonId,r.fingerprint,r.range.kind,r.range.firstStep,r.range.lastStep,Assessment.signature({steps:r.steps,targetBpm:r.targetBpm,articulation:r.articulation,timingPrecision:r.timingPrecision,ending:r.ending,...(r.adaptation===undefined?{}:{adaptation:r.adaptation})})]);}
 function adaptationShape(a,targetBpm){return object(a)&&a.version===1&&a.kind==='project-training-adaptation'&&typeof a.id==='string'&&/^[a-z0-9][a-z0-9-]{0,127}$/.test(a.id)&&Number.isFinite(a.sourceBpm)&&a.sourceBpm>0&&targetBpm<=a.sourceBpm;}
 function hydrated(l){return l&&typeof l.id==='string'&&typeof l.pattern==='string'&&Array.isArray(l.rhythm?.steps)&&l.rhythm.steps.every((s,i)=>s.stepIndex===i&&Number.isFinite(s.sourceStartMs)&&Number.isFinite(s.sourceDurationMs));}
 // Input is the actual hydrated local lesson, not a v7 JSON projection whose
 // omitted runtime timing fields would silently change its assessment edition.
 function compile(plan,lessons){
  if(!plan||typeof plan.id!=='string'||!plan.id.trim()||!['right','left'].includes(plan.hand)||!Array.isArray(plan.requires)||!plan.requires.length||!Array.isArray(lessons))fail('PREPARATION_PLAN_INVALID');
  const byId=new Map();for(const l of lessons){if(!l||typeof l.id!=='string'||byId.has(l.id))fail('PREPARATION_SOURCE_ID');byId.set(l.id,l);}
  const requests=plan.requires.map(lessonId=>({lessonId,kind:'whole'}));
  if(plan.preparationFragments!==undefined){if(!Array.isArray(plan.preparationFragments))fail('PREPARATION_FRAGMENT_INVALID');for(const f of plan.preparationFragments){if(!f||f.requiredBeforeAssessment!==true||typeof f.goal!=='string'||!f.goal.trim())fail('PREPARATION_FRAGMENT_INVALID');requests.push({...f,kind:'fragment'});}}
  const requirements=requests.map(request=>{
   const l=byId.get(request.lessonId);if(!hydrated(l))fail('PREPARATION_HYDRATED_SOURCE_REQUIRED');
   if(l.contentKind==='piece'||l.learning?.kind!=='exercise')fail('PREPARATION_EXERCISE_REQUIRED');
   const source=Adapter.parsePattern(l.pattern).steps,firstStep=request.kind==='whole'?0:request.firstStep,lastStep=request.kind==='whole'?source.length-1:request.lastStep;
   if(!integer(firstStep)||!integer(lastStep)||lastStep<firstStep||lastStep>=source.length||lastStep-firstStep>=64)fail('PREPARATION_RANGE_INVALID');
   if(l.learning?.machineCheck!=='piano-midi'||source.length!==l.rhythm.steps.length||l.fingeringSpec?.pattern!==l.pattern||l.fingeringSpec.steps?.length!==source.length)fail('PREPARATION_SOURCE_UNSUPPORTED');
   const sourceBpm=l.rhythm.practiceBpm;if(!Number.isFinite(sourceBpm)||sourceBpm<=0)fail('PREPARATION_TEMPO_INVALID');
   let targetBpm=sourceBpm,adaptation;
   if(request.adaptation!==undefined){const a=request.adaptation;if(request.kind!=='fragment'||!object(a)||!Number.isFinite(a.targetBpm)||a.targetBpm<=0||typeof a.rationale!=='string'||!a.rationale.trim())fail('PREPARATION_ADAPTATION_INVALID');targetBpm=a.targetBpm;adaptation={version:a.version,id:a.id,kind:a.kind,sourceBpm};if(!adaptationShape(adaptation,targetBpm))fail('PREPARATION_ADAPTATION_INVALID');}
   const steps=[];for(let i=firstStep;i<=lastStep;i++){const s=source[i],r=l.rhythm.steps[i],f=l.fingeringSpec.steps[i];if(s.keys.length!==1||f?.length!==1||f[0].hand!==plan.hand||!Number.isInteger(f[0].num)||f[0].num<1||f[0].num>5)fail('PREPARATION_MONOPHONIC_HAND_REQUIRED');if(!Number.isFinite(r.startBeat)||r.startBeat<0||!Number.isFinite(r.durationBeats)||r.durationBeats<=0||(steps.length&&r.startBeat<steps.at(-1).startBeat+steps.at(-1).durationBeats-1e-9))fail('PREPARATION_TIMING_UNSUPPORTED');steps.push({midis:[Adapter.KEY_MAP[s.keys[0]]],startBeat:r.startBeat,durationBeats:r.durationBeats});}
   const requirement={lessonId:l.id,assessmentVersion:Assessment.VERSION,fingerprint:Assessment.pianoSignature(l),range:{kind:request.kind,firstStep,lastStep},steps,targetBpm,...(adaptation===undefined?{}:{adaptation}),articulation:l.learning.articulation||'standard',...(l.learning.timingPrecision!==undefined?{timingPrecision:l.learning.timingPrecision}:{}),...(request.kind==='whole'&&l.learning.ending!==undefined?{ending:copy(l.learning.ending)}:{})};
   if(!['standard','nonlegato','legato','staccato'].includes(requirement.articulation)||(requirement.timingPrecision!==undefined&&!['beat-boundary-v1','beat-boundary-v2'].includes(requirement.timingPrecision))||!Assessment.pianoEnding({...requirement,bpm:targetBpm,anchorAt:0,observedUntil:0}).valid)fail('PREPARATION_PROFILE_UNSUPPORTED');return {...requirement,key:key(requirement)};
  });
  if(new Set(requirements.map(r=>r.key)).size!==requirements.length)fail('PREPARATION_DUPLICATE_REQUIREMENT');
  return {schemaVersion:VERSION,kind:'piano-preparation-contract',planId:plan.id,policy:POLICY,requirements};
 }
 function requirementShape(r){
  if(!object(r)||r.assessmentVersion!==Assessment.VERSION||typeof r.lessonId!=='string'||!r.lessonId.trim()||!/^[a-f0-9]{8}$/.test(r.fingerprint||'')||!object(r.range))return false;
  if(!['whole','fragment'].includes(r.range.kind)||!integer(r.range.firstStep)||!integer(r.range.lastStep)||r.range.lastStep<r.range.firstStep||(r.range.kind==='whole'&&r.range.firstStep!==0))return false;
  if(!Array.isArray(r.steps)||!r.steps.length||r.steps.length>64||r.steps.length!==r.range.lastStep-r.range.firstStep+1)return false;
  if(!r.steps.every((s,i)=>object(s)&&Array.isArray(s.midis)&&s.midis.length===1&&integer(s.midis[0])&&s.midis[0]<=127&&Number.isFinite(s.startBeat)&&s.startBeat>=0&&Number.isFinite(s.durationBeats)&&s.durationBeats>0&&(!i||s.startBeat>=r.steps[i-1].startBeat+r.steps[i-1].durationBeats-1e-9)))return false;
  if(!Number.isFinite(r.targetBpm)||r.targetBpm<=0||!['standard','nonlegato','legato','staccato'].includes(r.articulation)||(r.timingPrecision!==undefined&&!['beat-boundary-v1','beat-boundary-v2'].includes(r.timingPrecision)))return false;
  if(r.adaptation!==undefined&&(r.range.kind!=='fragment'||!adaptationShape(r.adaptation,r.targetBpm)))return false;
  if((r.range.kind==='fragment'&&r.ending!==undefined)||!Assessment.pianoEnding({...r,bpm:r.targetBpm,anchorAt:0,observedUntil:0}).valid)return false;
  return r.key===key(r);
 }
 function validateContract(contract){
  if(contract?.schemaVersion!==VERSION||contract.kind!=='piano-preparation-contract'||contract.policy!==POLICY||typeof contract.planId!=='string'||!contract.planId.trim()||!Array.isArray(contract.requirements)||!contract.requirements.length||contract.requirements.length>128)fail('PREPARATION_CONTRACT_INVALID');
  for(const r of contract.requirements)if(!requirementShape(r))fail('PREPARATION_CONTRACT_CHANGED');
  if(new Set(contract.requirements.map(r=>r.key)).size!==contract.requirements.length)fail('PREPARATION_DUPLICATE_REQUIREMENT');
 }
 function attemptShape(t,now){
  if(!object(t)||t.schemaVersion!==VERSION||typeof t.attemptId!=='string'||!t.attemptId.trim()||t.attemptId.length>256||typeof t.requirementKey!=='string'||t.requirementKey.length>4096)return false;
  if(!integer(t.capturedAt)||t.capturedAt>now||!Number.isFinite(t.bpm)||t.bpm<=0||!Number.isFinite(t.observedUntil)||t.observedUntil<0)return false;
  if(!['practice','challenge','memory'].includes(t.mode)||typeof t.assisted!=='boolean'||typeof t.observationInterrupted!=='boolean'||typeof t.timedOut!=='boolean'||!integer(t.errors))return false;
  if(!Array.isArray(t.events)||!t.events.length||t.events.length>256)return false;
  return t.events.every((e,i)=>object(e)&&['on','off'].includes(e.type)&&integer(e.midi)&&e.midi<=127&&Number.isFinite(e.at)&&e.at>=0&&e.at<=t.observedUntil&&(!i||e.at>=t.events[i-1].at)&&(e.source===undefined||['midi','pointer','keyboard'].includes(e.source)));
 }
 function assessAttempt(requirement,attempt,{now}){
  if(!integer(now))fail('PREPARATION_CLOCK_INVALID');if(!requirementShape(requirement))fail('PREPARATION_CONTRACT_CHANGED');if(!attemptShape(attempt,now))return {status:'invalid',code:'PREPARATION_ATTEMPT_INVALID'};
  if(attempt.requirementKey!==requirement.key)return {status:'unrelated-or-stale',code:'PREPARATION_VERSION_OR_RANGE_DIFFERS'};
  if(attempt.mode==='practice'||attempt.assisted||attempt.observationInterrupted)return {status:'rejected',code:'PREPARATION_PRACTICE_OR_ASSISTED'};
  const result=Assessment.assessPiano({steps:requirement.steps,events:attempt.events,bpm:attempt.bpm,targetBpm:requirement.targetBpm,errors:attempt.errors,timedOut:attempt.timedOut,supported:true,mode:attempt.mode,profile:requirement.articulation,timingPrecision:requirement.timingPrecision,ending:requirement.ending,observedUntil:attempt.observedUntil,observationInterrupted:attempt.observationInterrupted});
  return {status:result.clean?'matched':'rejected',code:result.clean?null:'PREPARATION_MIDI_MISMATCH',assessment:result};
 }
 function evaluate(contract,attempts,{now}){
  validateContract(contract);if(!integer(now))fail('PREPARATION_CLOCK_INVALID');if(!Array.isArray(attempts)||attempts.length>512)fail('PREPARATION_ATTEMPTS_INVALID');
  const ids=new Map(),seen=new Set(),accepted=[],ignored=[];let blocked=null;
  for(const t of attempts){if(!attemptShape(t,now)){blocked='PREPARATION_ATTEMPT_INVALID';break;}const serialized=JSON.stringify(t),previous=ids.get(t.attemptId);if(previous!==undefined){if(previous!==serialized){blocked='PREPARATION_ATTEMPT_ID_CONFLICT';break;}continue;}ids.set(t.attemptId,serialized);const r=contract.requirements.find(r=>r.key===t.requirementKey);if(!r){ignored.push({attemptId:t.attemptId,status:'unrelated-or-stale'});continue;}
   // A copied performance with a new label/date is still one observation.
   const performance=Assessment.signature({requirementKey:t.requirementKey,events:t.events.map(e=>({type:e.type,midi:e.midi,at:e.at,source:e.source}))});if(seen.has(performance))continue;seen.add(performance);const result=assessAttempt(r,t,{now});if(result.status==='matched')accepted.push(t);else ignored.push({attemptId:t.attemptId,status:result.status,code:result.code});
  }
  const requirements=contract.requirements.map(r=>{let progress;for(const t of accepted.filter(t=>t.requirementKey===r.key).sort((a,b)=>a.capturedAt-b.capturedAt))progress=Assessment.record(progress,{instrument:'piano',lessonId:r.lessonId,fingerprint:r.fingerprint,mode:t.mode,clean:true,now:t.capturedAt});return {key:r.key,lessonId:r.lessonId,range:copy(r.range),status:!blocked&&progress?.ready?'met':'pending',cleanTakes:blocked?0:progress?.cleanTakes||0,memory:!blocked&&Boolean(progress?.memory),retained:!blocked&&Boolean(progress?.retained)};});
  return {schemaVersion:VERSION,planId:contract.planId,status:blocked?'invalid-evidence':requirements.every(r=>r.status==='met')?'met':'pending',code:blocked,requirements,ignored,scope:'local-midi-data-only',fingeringVerified:false,physicalPerformanceVerified:false,teacherReviewed:false};
 }
 // Informational transfer only. No storage APIs, merge, normalization, badge
 // changes or conversion of legacy summary booleans into event evidence.
 function inspectLegacy(raw,lessons){
  const result={schemaVersion:VERSION,kind:'legacy-piano-progress-inspection',status:'missing',raw,records:[],grantsPreparation:false};if(raw===null)return result;if(typeof raw!=='string'||raw.length>MAX_LEGACY_CHARS)return {...result,status:'invalid'};
  let data;try{data=JSON.parse(raw);}catch{return {...result,status:'invalid'};}if(!object(data)||Object.keys(data).length>2000||typeof data.schemaVersion==='number'||typeof data.format==='string')return {...result,status:'unsupported'};
  const byId=new Map(lessons.map(l=>[l.id,l]));for(const [id,row]of Object.entries(data)){let status='invalid-record';if(object(row)&&row.version===LEGACY_PROGRESS_VERSION&&row.instrument==='piano'&&row.lessonId===id&&/^[a-f0-9]{8}$/.test(row.fingerprint||'')&&Array.isArray(row.takes)&&row.takes.every(t=>object(t)&&integer(t.at)&&['challenge','memory'].includes(t.mode))&&integer(row.cleanTakes)&&row.cleanTakes===row.takes.length&&['memory','retained','ready'].every(k=>typeof row[k]==='boolean')){const l=byId.get(id);status=!l?'unknown-lesson':!hydrated(l)?'needs-hydration':row.fingerprint===Assessment.pianoSignature(l)?'matching-summary':'other-edition';}else if(object(row)&&Number.isInteger(row.version)&&row.version>LEGACY_PROGRESS_VERSION)status='unsupported-version';result.records.push({lessonId:id,status,preparationCredit:false});}
  return {...result,status:'read-only'};
 }
 return {VERSION,POLICY,MAX_LEGACY_CHARS,compile,evaluate,assessAttempt,inspectLegacy};
});
