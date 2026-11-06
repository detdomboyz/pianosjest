(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./practice-assessment.js'):root.PracticeAssessment);if(typeof module==='object'&&module.exports)module.exports=api;else root.LessonQuality=api;})(typeof window==='object'?window:globalThis,function(A){
  'use strict';
  const VERSION=1,OPEN={6:40,5:45,4:50,3:55,2:59,1:64};
  const names=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
  const name=m=>names[m%12]+(Math.floor(m/12)-1);
  function pianoFingerprint(l){return A.signature({id:l.id,title:l.title,description:l.description,pattern:l.pattern,rhythm:l.rhythm||null,guide:l.guide||null,fingeringSpec:l.fingeringSpec||null,handMode:l.handMode||null,timeLimit:l.timeLimit,maxErrors:l.maxErrors,exam:!!l.exam});}
  function guitarFingerprint(l){return A.signature({id:l.id,title:l.title,description:l.description,goal:l.goal,notes:l.notes,sourceNotes:l.sourceNotes||null,bpm:l.bpm,originalBpm:l.originalBpm||null,tips:l.tips||[]});}
  function allowed(l,b,fingerprint){const entry=b?.[l.id];if(!entry)return false;const now=fingerprint(l);return now===entry.fingerprint&&!(l.lessonReview?.version===VERSION&&l.lessonReview.reviewedFingerprint===now);}
  function mark(l,sourceFingerprint,fingerprint){l.lessonReview={version:VERSION,scope:'instruction-and-data-review; not a teacher performance certificate',sourceFingerprint,reviewedFingerprint:fingerprint(l)};}
  function removePhraseRests(rhythm){let removed=0;for(const [i,s] of rhythm.steps.entries()){removed+=i?Number(s.restBeforeBeats)||0:0;s.startBeat-=removed;s.restBeforeBeats=0;s.measure=Math.floor(s.startBeat/(rhythm.timeSignature.numerator*4/rhythm.timeSignature.denominator))+1;s.beatInMeasure=s.startBeat%(rhythm.timeSignature.numerator*4/rhythm.timeSignature.denominator);s.sourceStartMs=Math.round(s.startBeat*60000/rhythm.practiceBpm);}return rhythm;}
  function timedEtude(lesson,spacesBefore){const bpm=60;let cursor=0,end=0;const steps=lesson.steps.map((step,i)=>{const rest=i&&spacesBefore(lesson,i)>=2?1:0;cursor+=rest;const interval=step.type==='quick'?.5:1,startBeat=cursor,durationBeats=interval*.85;cursor+=interval;const item={startBeat,durationBeats,restBeforeBeats:Math.max(0,startBeat-end),measure:Math.floor(startBeat/4)+1,beatInMeasure:startBeat%4,sourceStartMs:Math.round(startBeat*1000),sourceDurationMs:Math.round(durationBeats*1000)};end=startBeat+durationBeats;return item;});return {version:1,source:'project-technical-etude-v1',bpm,practiceBpm:bpm,timeSignature:{numerator:4,denominator:4},steps};}
  function repairPiano(lesson,baseline,adapter){
    if(lesson.contentKind==='piece'||!allowed(lesson,baseline?.piano,pianoFingerprint))return false;
    const before=pianoFingerprint(lesson),entry=baseline.piano[lesson.id],originalGuide=lesson.guide||{},legacy=!lesson.rhythm;
    if(['chordx04','chordx05'].includes(lesson.id)){
      lesson.pattern=lesson.pattern.replaceAll('[psd]','[psf]');if(lesson.id==='chordx04')lesson.pattern=lesson.pattern.replaceAll('p s d s p','p s f s p');
      const parsed=adapter.parsePattern(lesson.pattern);lesson.steps=parsed.steps;lesson.display=parsed.display;delete lesson.fingeringPlan;
    }
    if(legacy)lesson.rhythm=adapter.normalizeRhythm(timedEtude(lesson,adapter.spacesBefore),lesson.steps.length);
    if(['course02-05','course03-05'].includes(lesson.id))lesson.rhythm=adapter.normalizeRhythm(removePhraseRests(JSON.parse(JSON.stringify(lesson.rhythm))),lesson.steps.length);
    if(lesson.id==='course09-08')lesson.description='Соедини знакомые мелодические фразы в одном пульсе. Между фразами выдерживай указанные паузы для спокойной подготовки следующей позиции.';
    lesson.description=lesson.description.replace(/сохраняя ладонь неподвижной/gi,'сохраняя опору и свободную кисть').replace(/без движения кисти/gi,'без лишнего размаха, со свободной кистью');
    const left=[17,24,31,37,38].includes(entry.themeOrder),right=[16,23,30,39,40,41].includes(entry.themeOrder);
    if(legacy&&left)lesson.handMode='left';if(legacy&&right)lesson.handMode='right';
    const notes=lesson.steps.flatMap(adapter.midis),low=Math.min(...notes),high=Math.max(...notes);
    if([37,38,39].includes(entry.themeOrder)&&/^Гамма(?:\s|$)/.test(lesson.title))lesson.title='Семь ступеней '+name(low)+'–'+name(high);
    if(entry.themeOrder===40&&/^Гамма(?:\s|$)/.test(lesson.title))lesson.title='Гаммообразный ход '+name(low)+'–'+name(high);
    const titles={r201:'Пятипальцевая фигура C4–G4',l201:'Пятипальцевая фигура C3–G3',fgr02:'Расширение и перенос до B4',hands01:'Повтор C3: бас и ответ правой',hands05:'Параллельная лесенка двух рук',pos01:'C вверх через несколько регистров',pos02:'C вниз через несколько регистров',oct201:'C через несколько регистров'};
    if(titles[lesson.id])lesson.title=titles[lesson.id];
    if(/^black30[1-5]$/.test(lesson.id))lesson.title='Чёрные ориентиры и хроматический проход '+name(low)+'–'+name(high);
    if(legacy)lesson.title=lesson.title.replace(/Финальный экзамен/gi,'Итоговая практика').replace(/Экзамен/gi,'Контрольная практика');
    const motion=/неподвиж|без движения кисти|двигается только/i.test(originalGuide.motion||'')?'Кисть остаётся свободной над позицией. Двигайся экономно, допускай небольшое естественное сопровождение рукой; не фиксируй запястье и не поднимай пальцы высоко.':originalGuide.motion;
    lesson.guide=adapter.normalizeGuide({stage:originalGuide.stage||'Техническая практика',setup:originalGuide.setup||((left?'Левая рука. ':right?'Правая рука. ':'Руки распределяются по подсказкам. ')+'Диапазон '+name(low)+'–'+name(high)+'. Сначала спокойно найди опоры; дальние позиции готовь переносом кисти, не растяжением пальцев.'),motion:motion||'Сначала разбери короткую группу. Освобождай лишнее усилие после нажатия, вовремя отпускай звук, сохраняй свободное запястье. При переносе перемещай руку целиком.',blind:originalGuide.blind||'Сначала играй с подсказками. Лишь после уверенного разбора повтори короткую фразу без взгляда на руки; при потере ориентира остановись в паузе и восстанови позицию.',mastery:legacy?'Сначала 8–16 действий без спешки, затем следующий фрагмент. Соедини части после уверенных повторов. Для длинного задания используй режим коротких фрагментов; качество движений и пальцы проверь самостоятельно.':'Чистая MIDI-попытка: без ошибок нот, пульса, длительностей и отпусканий в пределах допусков проекта. Цель — три чистых повтора, один из памяти, затем повтор из памяти через сутки. Пальцы и качество движения проверь отдельно.'});
    lesson.learning={version:1,kind:'exercise',articulation:'standard',machineCheck:lesson.fingeringSpec?'piano-midi':'practice',phraseSize:lesson.steps.length>32?16:0,goal:lesson.description,practiceSteps:['Послушай короткую фразу и проговори счёт.','Медленно найди ноты и пальцы, затем сыграй в указанном пульсе.','Повтори небольшой фрагмент чисто; после этого соединяй части.'],selfCheck:['Кисть и предплечье остаются свободными.','Пальцы соответствуют подсказкам; MIDI не проверяет номера пальцев.','Слышны окончания нот и тишина в паузах.'],rhythmNotice:legacy?'Ритм авторского технического этюда; это не ритм оригинального музыкального произведения.':'Учебный ритм начального курса.',references:['https://cml.music.utexas.edu/online-resources/intelligent-music-practice/10-tips-for-effective-practice','https://www.koelnklavier.de/quellen/czer-brf/brief-03.html']};
    const last=lesson.rhythm.steps.at(-1),seconds=(last.startBeat+last.durationBeats)*60/lesson.rhythm.practiceBpm;lesson.timeLimit=Math.max(lesson.timeLimit,Math.ceil(seconds*1.5+8));
    mark(lesson,before,pianoFingerprint);return true;
  }
  function repairPianoThemes(themes,baseline){for(const t of themes){const rule=baseline?.themes?.[t.id];if(rule&&t.name===rule.name&&rule.correctedName)t.name=rule.correctedName;}}
  function repairLegato(notes){
    let changed=0;
    const edge=i=>{if(i<1||notes[i].string!==notes[i-1].string)return null;const n=notes[i];if(/^(slide|слайд)$/i.test(n.technique||''))return 'slide';return n.pick==='none'&&/hammer-on/i.test(n.technique||'')?'hammer':n.pick==='none'&&/pull-off/i.test(n.technique||'')?'pull':null;};
    for(let i=1;i<notes.length;i++){
      if(!edge(i))continue;const start=i-1;let end=i;while(end+1<notes.length&&edge(end+1))end++;
      const first=edge(i),preferred=first==='pull'?Math.min(4,Math.abs(notes[i].fret-notes[start].fret)+1):1;
      let paths=[1,2,3,4].map(f=>({f,cost:Math.abs(f-preferred),values:[f]}));
      for(let j=i;j<=end;j++){
        const kind=edge(j),delta=notes[j].fret-notes[j-1].fret,next=[];
        for(let f=1;f<=4;f++){let best=null;for(const p of paths){if(kind==='slide'&&f!==p.f||kind==='hammer'&&(delta<=0||f<=p.f)||kind==='pull'&&(delta>=0||f>=p.f))continue;const cost=p.cost+(kind==='slide'?0:Math.abs(Math.abs(f-p.f)-Math.min(3,Math.abs(delta)))*2);if(!best||cost<best.cost)best={f,cost,values:[...p.values,f]};}if(best)next.push(best);}paths=next;
      }
      const best=paths.sort((a,b)=>a.cost-b.cost)[0];if(best)for(let j=start;j<=end;j++){const f=best.values[j-start];if(notes[j].finger!==f){notes[j].finger=f;changed++;}}i=end;
    }return changed;
  }
  function repairBends(notes){let origin=null,changed=0;
    for(let i=0;i<notes.length;i++){
      const n=notes[i],t=n.technique||'';
      if(/начало bend/i.test(t)){origin={midi:n.midi,string:n.string,fret:n.fret,finger:n.finger};continue;}
      if(origin&&origin.string===n.string&&/target|vibrato на bend|release/i.test(t)){
        const previous=notes[i-1];n.notatedTargetFret=n.fret;n.fret=origin.fret;n.finger=origin.finger;n.bendFromMidi=origin.midi;n.bendSemitones=n.midi-origin.midi;n.bendStartMidi=previous?.midi??origin.midi;n.pitchEffect=/release/i.test(t)?'bend-release':/vibrato/i.test(t)?'bend-hold':'bend-target';changed++;
      }else if(!/vibrato/i.test(t))origin=null;
      if(/vibrato/i.test(t)){n.pitchEffect=n.pitchEffect||'vibrato';n.vibratoCents=/широк/i.test(t)?55:25;n.vibratoRateHz=/медленн/i.test(t)?3:4;}
    }return changed;
  }
  function repairGuitar(data,baseline){let count=0;
    for(const lesson of data.lessons){if(lesson.contentKind==='piece'||lesson.category==='melody'||!allowed(lesson,baseline?.guitar,guitarFingerprint))continue;
      const before=guitarFingerprint(lesson),legato=repairLegato(lesson.notes),bends=repairBends(lesson.notes);
      if(lesson.sourceNotes){for(const [i,n] of lesson.sourceNotes.entries()){const fixed=lesson.notes[i];if(fixed&&n.midi===fixed.midi){n.finger=fixed.finger;if(Number.isFinite(fixed.bendFromMidi))for(const key of ['fret','string','bendFromMidi','bendSemitones','bendStartMidi','pitchEffect','vibratoCents','vibratoRateHz','notatedTargetFret'])if(fixed[key]!==undefined)n[key]=fixed[key];}}}
      if(lesson.id==='t09-l03')lesson.description='Первый палец держит 2-й лад, безымянный (3) извлекает ноту 4-го лада ударом без нового щипка правой руки.';
      if(lesson.id==='t10-l01')lesson.title='Полутоновый bend на 7-м ладу: D4 → E♭4';
      if(lesson.id==='t10-l02')lesson.title='Тоновый bend на 7-м ладу: D4 → E4';
      if(lesson.id==='t10-l04')lesson.description='На выбранном ладу слегка повышай высоту и возвращайся к исходной ноте. Сравни равномерность колебаний на слух; не перемещай палец вдоль грифа.';
      if(lesson.id==='t29-l07')lesson.title='Корень, квинта и верхние ноты формы';
      const chordWords=/аккорд|power/i.test(lesson.title+' '+lesson.description),poly=lesson.notes.some((n,i,ns)=>n.group!=null&&ns.some((p,j)=>j!==i&&p.group===n.group));
      lesson.goal=lesson.goal.replace(/Завершить фразу до конца; ошибки.*$/i,'Разбери фразу чисто. Автоматически проверяются высоты; ритм, штрих и движение пальцев проверь отдельно.');
      lesson.learning={version:1,kind:'exercise',goal:lesson.goal,phraseSize:lesson.notes.length>32?16:0,techniqueConstraints:!!(legato||bends||lesson.notes.some(n=>/slide|hammer-on|pull-off|bend|vibrato/i.test(n.technique||''))),pitchToleranceCents:/^t10-/.test(lesson.id)?20:35,practiceSteps:['Прослушай короткий образец и проговори счёт.','Разбери 2–4 нотных события в спокойном темпе.','Повтори без лишнего шума, затем соедини небольшие фразы.'],selfCheck:[bends?'Во время bend палец остаётся на исходном ладу; соседний лад задаёт только целевую высоту.':'Левая рука прижимает струну близко к ладовому порожку, без лишнего усилия.',legato?'Слайд выполняет тот же палец; hammer-on идёт к более высокому пальцу, pull-off — к заранее поставленному нижнему.':'Правой рукой останови лишние струны; не увеличивай темп ценой шума.','Аудиодетектор не подтверждает струну, пальцы, ритм и качество приёма.'],limitations:chordWords&&!poly?['Здесь звуки формы записаны по одному. Это подготовка, а не автоматическая проверка одновременного аккорда.']:[],references:['https://www.trinityrock.com/instruments/guitar/grade2','https://cliffsmithguitarlessons.co.uk/guitar-lesson-videos/string-bends-lesson-2/']};
      const duration=lesson.notes.reduce((sum,n)=>sum+(Number(n.durationBeats)||1),0)*60/lesson.bpm;lesson.timeLimitSec=Math.max(lesson.timeLimitSec,Math.ceil(duration*1.4+8));
      mark(lesson,before,guitarFingerprint);count++;
    }return count;
  }
  function pitchEnvelope(note,duration){const target=Number(note.frequency)||440*2**((note.midi-69)/12),points=[{at:0,frequency:target}];
    if(Number.isFinite(note.bendStartMidi)&&['bend-target','bend-release'].includes(note.pitchEffect)){points[0].frequency=440*2**((note.bendStartMidi-69)/12);points.push({at:Math.min(.6,duration*.45),frequency:target});}
    if(Number.isFinite(note.vibratoCents)){const begin=points.at(-1).at,rate=note.vibratoRateHz||4;for(let t=begin+.025;t<duration;t+=.025){const cents=note.vibratoCents*(1-Math.cos((t-begin)*Math.PI*2*rate))/2;points.push({at:t,frequency:target*2**(cents/1200)});}}
    points.push({at:duration,frequency:target});return points;
  }
  function preserveTechniqueNotes(original,edited){
    if(original.length!==edited.length)throw Error('Количество событий связано с учебным приёмом. Новую музыкальную последовательность создай как отдельное упражнение.');
    const keys=['bendFromMidi','bendStartMidi','bendSemitones','pitchEffect','vibratoCents','vibratoRateHz','notatedTargetFret'];
    const result=edited.map((n,i)=>{const old=original[i];if(n.midi!==old.midi||n.string!==old.string||n.fret!==old.fret)throw Error('Высота и позиция связаны с учебным приёмом. Для нового варианта создай отдельное упражнение; здесь можно уточнить пальцы и длительности.');const copy={...n};for(const key of keys)if(old[key]!==undefined)copy[key]=old[key];return copy;});
    let bendOrigin=null;
    for(let i=0;i<result.length;i++){const n=result[i],p=result[i-1],t=n.technique||'';if(/начало bend/i.test(t))bendOrigin=n;if(Number.isFinite(n.bendFromMidi)&&bendOrigin&&n.finger!==bendOrigin.finger)throw Error('В фазах bend сохраняется один палец на исходном ладу.');if(!p||n.string!==p.string)continue;if(/^slide$/i.test(t)&&n.finger!==p.finger)throw Error('Слайд в этом упражнении выполняется одним пальцем.');if(n.pick==='none'&&/hammer-on/i.test(t)&&n.finger<=p.finger)throw Error('Для hammer-on нужен подготовленный более высокий палец.');if(n.pick==='none'&&/pull-off/i.test(t)&&n.finger>=p.finger)throw Error('Для pull-off нижний палец ставится заранее.');}
    return result;
  }
  return {VERSION,pianoFingerprint,guitarFingerprint,repairPiano,repairPianoThemes,repairGuitar,repairLegato,repairBends,pitchEnvelope,preserveTechniqueNotes,name};
});
