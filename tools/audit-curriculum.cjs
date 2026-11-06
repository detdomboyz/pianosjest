'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {loadApp}=require('../tests/helpers/load-app.cjs'),{loadGuitarCourse}=require('./curriculum-inventory.cjs');
const A=require('../practice-assessment.js'),C=require('../curriculum.js');
const Catalog=require('../catalog-sections.js');
const ROOT=path.resolve(__dirname,'..'),GUITAR=path.resolve(process.argv[2]||path.join(ROOT,'../guitarjest'));
const context={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'curriculum-plan.js'),'utf8'),context);const plan=context.MUSIC_CURRICULUM_PLAN;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function audit(){
  const app=loadApp(),guitar=loadGuitarCourse(GUITAR),rows=[],hardErrors=[];
  const add=(instrument,l,metrics,issues)=>{
    const entry=C.entry(plan,instrument,l.id),signature=instrument==='piano'?A.pianoSignature(l):A.guitarSignature(l);
    if(!entry)hardErrors.push(instrument+': unmapped '+l.id);
    if(entry&&entry.fingerprint!==signature)hardErrors.push(instrument+': changed checked content '+l.id);
    rows.push({instrument,id:l.id,title:l.title,stage:entry?.stage,stageTitle:C.stages[entry?.stage]?.title,branch:entry?.branch,requires:C.stages[entry?.stage]?.requires||[],preparation:entry?.preparation||[],fingerprint:signature,structuralIssues:issues,metrics,assessment:instrument==='piano'&&entry?.challenge&&issues.length===0?'MIDI notes/onsets/releases; technique not certified':'practice only; performance not certified',instructionReview:l.lessonReview||l.id.startsWith('detail-')?'project-data-and-instruction-review':'outside-learning-review',pedagogicalReview:'independent-teacher-review-pending'});
  };
  for(const l of app.lessons){
    const issues=[],flat=l.steps.flatMap(app.stepMidiList),rhythm=l.rhythm;
    if(!flat.length||flat.some(m=>!Number.isInteger(m)||m<21||m>108))issues.push('INVALID_PIANO_NOTES');
    if(!rhythm)issues.push('NO_EXACT_RHYTHM');
    if(l.learning?.ending!==undefined&&!A.pianoEnding({steps:rhythm?.steps,ending:l.learning.ending,bpm:rhythm?.practiceBpm,anchorAt:0}).valid)issues.push('INVALID_ENDING_CONTRACT');
    if(rhythm){let lastStart=-Infinity,end=-Infinity;for(const t of rhythm.steps){if(!Number.isFinite(t.startBeat)||!Number.isFinite(t.durationBeats)||t.durationBeats<=0||t.startBeat<0||t.startBeat<lastStart)issues.push('INVALID_RHYTHM');if(t.startBeat<end-.005)issues.push('OVERLAPPING_VOICES_NEED_REVIEW');lastStart=t.startBeat;end=Math.max(end,t.startBeat+t.durationBeats);}}
    const fingering=app.ensureFingeringPlan(l);const unsupported=fingering.steps.filter(s=>!s.length).length;
    if(unsupported)issues.push('UNSUPPORTED_FINGERING');
    add('piano',l,{actions:l.steps.length,notes:flat.length,low:Math.min(...flat),high:Math.max(...flat),maxChord:Math.max(...l.steps.map(s=>app.stepMidiList(s).length)),bpm:rhythm?.practiceBpm||rhythm?.bpm||null,exactRhythm:!!rhythm,explicitTeaching:!!l.fingeringSpec,unsupportedActions:unsupported},[...new Set(issues)]);
  }
  const open={6:40,5:45,4:50,3:55,2:59,1:64};
  for(const l of guitar.lessons){
    const issues=[],grouped=new Map();let corrections=0;
    for(const [i,n] of l.notes.entries()){
      if(!Number.isInteger(n.midi)||!Number.isInteger(n.string)||!Number.isInteger(n.fret)||open[n.string]===undefined||n.fret<0||n.fret>24)issues.push('INVALID_GUITAR_POSITION');
      const bent=Number.isFinite(n.bendFromMidi)&&n.bendFromMidi===open[n.string]+n.fret&&n.midi===n.bendFromMidi+n.bendSemitones;
      if(Number.isFinite(n.bendFromMidi)&&!bent)issues.push('INVALID_BEND_PHYSICAL_POSITION');
      if(n.midi!==open[n.string]+n.fret&&!bent&&!/флажолет|bend|бенд/i.test(n.technique||''))issues.push('WRONG_FRETTED_PITCH');
      if(n.fret>0&&(!Number.isInteger(n.finger)||n.finger<1||n.finger>4))issues.push('INVALID_FRETTING_FINGER');
      if(!Number.isFinite(n.durationBeats)||n.durationBeats<=0)issues.push('INVALID_DURATION');
      if(!Number.isFinite(n.frequency)||Math.abs(1200*Math.log2(n.frequency/(440*2**((n.midi-69)/12))))>10)issues.push('FREQUENCY_MIDI_MISMATCH');
      if(n.pitchCorrection)corrections++;
      const key=n.group??'single-'+i;if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(n);
    }
    const maxChord=Math.max(0,...[...grouped.values()].map(g=>g.length));
    if(maxChord>1)issues.push('POLYPHONY_NOT_VERIFIED_BY_DETECTOR');
    for(const chord of grouped.values())if(chord.length>1){
      const fretted=chord.filter(n=>n.fret>0),frets=fretted.map(n=>n.fret);
      if(new Set(chord.map(n=>n.string)).size<chord.length)issues.push('GROUP_REUSES_STRING_NEEDS_REVIEW');
      if(frets.length&&Math.max(...frets)-Math.min(...frets)>4)issues.push('LARGE_CHORD_STRETCH_NEEDS_REVIEW');
    }
    const exact=l.notes.every(n=>Number.isFinite(n.startSeconds)&&Number.isFinite(n.endSeconds)||Number.isFinite(n.startBeat)&&Number.isFinite(n.endBeat));
    if(!exact)issues.push('SEQUENTIAL_ETUDE_TIMING_NOT_SOURCE_SCORE');
    add('guitar',l,{notes:l.notes.length,maxChord,bpm:l.bpm,maxFret:Math.max(...l.notes.map(n=>n.fret)),exactRhythm:exact,correctedHarmonics:corrections,techniques:[...new Set(l.notes.map(n=>n.technique).filter(Boolean))]},[...new Set(issues)]);
  }
  for(const instrument of ['piano','guitar']){
    const entries=plan[instrument],seen=new Set();for(const e of entries){if(seen.has(e.id))hardErrors.push(instrument+': duplicate '+e.id);seen.add(e.id);}
    const order=[...new Set(entries.map(e=>e.stage))];for(const [i,id] of order.entries())for(const prerequisite of C.stages[id].requires)if(order.indexOf(prerequisite)<0||order.indexOf(prerequisite)>=i)hardErrors.push('Stage dependency '+id+' -> '+prerequisite);
    for(const [i,e] of entries.entries())for(const id of e.preparation||[]){const index=entries.findIndex(p=>p.id===id);if(index<0||index>=i)hardErrors.push('Lesson preparation '+e.id+' -> '+id);}
  }
  const issueCounts={};for(const row of rows)for(const issue of row.structuralIssues)issueCounts[issue]=(issueCounts[issue]||0)+1;
  const semantic=require('./inspect-pedagogy.cjs').inspect();for(const issue of semantic.issues)hardErrors.push('Lesson instruction: '+issue.lessonId+' '+issue.code);
  for(const row of rows)for(const code of row.structuralIssues)if(/^(INVALID_|WRONG_|FREQUENCY_)/.test(code))hardErrors.push(row.instrument+': '+row.id+' '+code);
  const sources=Object.fromEntries(['index.html','fingering.js','beginner-fingering.js','chopin-theme.js','practice-assessment.js','curriculum.js','curriculum-plan.js','guitar-curriculum-quality.js','catalog-sections.js','catalog-sections.css','lesson-quality.js','lesson-review-baseline.js','lesson-development.js','piano-lesson-development.js'].map(n=>['pianosjest/'+n,hash(path.join(ROOT,n))]));
  for(const n of ['curriculum-data.js','lifes-a-gas-study.js','multi-song-studies.js','edition20-content.js','app.js','index.html','practice-assessment.js','curriculum.js','curriculum-plan.js','guitar-curriculum-quality.js','catalog-sections.js','catalog-sections.css','course-editor.js'])sources['guitarjest/'+n]=hash(path.join(GUITAR,n));
  for(const row of rows){const isPiano=row.instrument==='piano',items=isPiano?app.lessons:guitar.lessons,groups=isPiano?app.themes:guitar.topics;row.catalogSection=Catalog.sectionOf(row.instrument,items.find(l=>l.id===row.id),groups);}
  return {generatedAt:new Date().toISOString(),scope:'Bundled content; no user overrides; structural checks are not a teacher certificate',counts:{pianoLessons:app.lessons.length,pianoThemes:app.themes.length,guitarLessons:guitar.lessons.length,guitarTopics:guitar.topics.length,total:rows.length,beginnerChallenges:rows.filter(r=>r.assessment.startsWith('MIDI')).length,correctedHarmonicNotes:rows.reduce((n,r)=>n+(r.metrics.correctedHarmonics||0),0)},hardErrors,issueCounts,sources,lessons:rows};
}
function writeIndex(report){
  const escape=value=>String(value??'—').replace(/\|/g,'\\|').replace(/\r?\n/g,' ');
  const lines=['# Полный перечень проверенных уроков','', 'Порядок учебного маршрута и причины дополнительной проверки. Педагогическая экспертиза всех редакций ещё не выполнена. Термины и границы: [CURRICULUM_AUDIT.md](CURRICULUM_AUDIT.md). Этот файл формирует `npm run audit:curriculum`.',''];
  for(const instrument of ['piano','guitar']){
    lines.push('## '+(instrument==='piano'?'Пианино':'Электрогитара'),'');
    let current=null;const byId=new Map(report.lessons.filter(l=>l.instrument===instrument).map(l=>[l.id,l]));
    for(const entry of plan[instrument]){const row=byId.get(entry.id);if(!row)continue;
      if(current!==entry.stage){current=entry.stage;lines.push('','### '+C.stages[current].title,'',C.stages[current].goal+'.','', '| ID | Урок | Нот | BPM | Проверка | Ограничения / подготовка |','| --- | --- | ---: | ---: | --- | --- |');}
      const status=row.assessment.startsWith('MIDI')?'MIDI-челлендж':'Практика';
      const issues=[...row.structuralIssues,...row.preparation.map(id=>'сначала '+id)];
      lines.push('| '+[row.id,row.title,row.metrics.notes,row.metrics.bpm,status,issues.join('; ')||'Машинных замечаний нет; редактура педагогом впереди'].map(escape).join(' | ')+' |');
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(ROOT,'docs/CURRICULUM_INDEX.md'),lines.join('\n')+'\n');
}
if(require.main===module){const report=audit();fs.writeFileSync(path.join(ROOT,'docs/curriculum-audit-results.json'),JSON.stringify(report,null,2)+'\n');writeIndex(report);console.log(JSON.stringify({counts:report.counts,hardErrors:report.hardErrors,issueCounts:report.issueCounts},null,2));if(report.hardErrors.length)process.exitCode=1;}
module.exports={audit};
