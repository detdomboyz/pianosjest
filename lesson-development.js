(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LessonDevelopment=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const PRACTICE='https://cml.music.utexas.edu/online-resources/intelligent-music-practice/10-tips-for-effective-practice',CZERNY='https://www.koelnklavier.de/quellen/czer-brf/brief-03.html',BENDS='https://cliffsmithguitarlessons.co.uk/guitar-lesson-videos/string-bends-lesson-2/',TRINITY='https://www.trinityrock.com/instruments/guitar/grade2';
  const tone=(midi,num,hand='right')=>({midi,num,hand});
  const line=(midis,fingers,hand='right')=>midis.map((m,i)=>[tone(m,Array.isArray(fingers)?fingers[i]:fingers,hand)]);
  const repeat=(values,n=2)=>Array.from({length:n},()=>values).flat();
  const piano=[];
  function family(key,title,stage,after,units,requirements=[]){
    units.forEach((u,i)=>{const id=`detail-p-${key}-${String(i+1).padStart(2,'0')}`;piano.push({id,group:key,groupTitle:title,title:u[0],goal:u[1],events:u[2],options:u[3]||{},stage,after:i?`detail-p-${key}-${String(i).padStart(2,'0')}`:after,requires:i?[`detail-p-${key}-${String(i).padStart(2,'0')}`]:[after,...requirements]});});
  }
  family('release','Нажатие и отпускание','p1','course01-04',[
    ['Правая: окончание одного звука','Нажми C4 большим пальцем. Отпусти до следующей доли; услышь короткую тишину.',line([60,60,60,60],1),{articulation:'nonlegato'}],
    ['Левая: окончание одного звука','На C3 работает мизинец. После отпускания оставайся близко к клавише, без высокого замаха.',line([48,48,48,48],5,'left'),{articulation:'nonlegato'}],
    ['Правая: две ноты с просветом','C4–D4 пальцами 1–2. Между звуками есть небольшой просвет, пульс не прерывается.',line([60,62,60,62,60,62], [1,2,1,2,1,2]),{articulation:'nonlegato'}],
    ['Левая: две ноты с просветом','C3–D3 пальцами 5–4. Не удерживай предыдущую клавишу после её окончания.',line([48,50,48,50,48,50],[5,4,5,4,5,4],'left'),{articulation:'nonlegato'}]
  ]);
  family('legato','Связное движение: legato','p2','course03-02',[
    ['Правая: соединить C4 и D4','Передавай звук с 1-го пальца на 2-й без слышимого провала. Старую клавишу отпускай у начала новой.',line([60,62,60,62,60,62],[1,2,1,2,1,2]),{articulation:'legato'}],
    ['Левая: соединить C3 и D3','Передавай звук с 5-го пальца на 4-й. Не держи оба звука вместе дольше перехода.',line([48,50,48,50,48,50],[5,4,5,4,5,4],'left'),{articulation:'legato'}],
    ['Правая: дуга из трёх нот','Спой C4–D4–E4–D4–C4, затем соедини пальцами 1–2–3–2–1 в одном пульсе.',line([60,62,64,62,60],[1,2,3,2,1]),{articulation:'legato'}],
    ['Левая: дуга из трёх нот','Соедини C3–D3–E3–D3–C3 пальцами 5–4–3–4–5, сохраняя свободное запястье.',line([48,50,52,50,48],[5,4,3,4,5],'left'),{articulation:'legato'}]
  ],['detail-p-release-04']);
  family('staccato','Короткий звук: staccato','p2','course03-04',[
    ['Правая: короткое C4','Извлеки короткий звук и освободи клавишу. Не ударяй жёстко и не поднимай всю руку высоко.',line([60,60,60,60],1),{articulation:'staccato'}],
    ['Левая: короткое C3','Повтори короткие звуки мизинцем. Пауза между ними длиннее звучания.',line([48,48,48,48],5,'left'),{articulation:'staccato'}],
    ['Правая: короткие соседние ноты','C4–D4–E4–D4–C4: по одному короткому звуку на долю, пальцы 1–2–3–2–1.',line([60,62,64,62,60],[1,2,3,2,1]),{articulation:'staccato'}],
    ['Левая: короткие соседние ноты','C3–D3–E3–D3–C3: вовремя отпускай каждую клавишу, не ускоряясь в тишине.',line([48,50,52,50,48],[5,4,3,4,5],'left'),{articulation:'staccato'}]
  ],['detail-p-legato-04']);
  family('rhythm','Длительности и тишина','p2','course04-05',[
    ['Длинный звук на четыре доли','C4 большим пальцем: считай 1–2–3–4, удерживая клавишу; затем отпусти перед новым звуком.',line([60,60],1),{beats:[4,4],articulation:'legato'}],
    ['Половинные и четверти','На C4 сыграй 2–1–1 доли, затем повтори. Пульс постоянен, меняется только длина звука.',line([60,60,60,60,60,60],1),{beats:[2,1,1],articulation:'legato'}],
    ['Пауза — тоже доля','На C4 после каждой ноты выдержи одну полную долю тишины. Продолжай считать во время паузы.',line([60,60,60,60],1),{beats:[1],rests:[0,1,1,1],articulation:'legato'}],
    ['Две восьмые на одну долю','Чередуй C4 и D4: считай «раз-и, два-и». Не ускоряй вторую половину доли.',line(repeat([60,62],4),repeat([1,2],4)),{beats:[.5],articulation:'legato',bpm:48}]
  ]);
  family('dyads','Две клавиши одной рукой','p2','course03-08',[
    ['Правая: терция 1–3','Нажми C4 и E4 вместе пальцами 1 и 3. Оба звука начинают и заканчивают одновременно.',repeat([[tone(60,1),tone(64,3)]],4)],
    ['Правая: терция 2–4','Нажми D4 и F4 вместе пальцами 2 и 4, не зажимая свободные пальцы.',repeat([[tone(62,2),tone(65,4)]],4)],
    ['Левая: терция 5–3','Нажми C3 и E3 вместе пальцами 5 и 3. Услышь оба звука, не переваливай руку на край.',repeat([[tone(48,5,'left'),tone(52,3,'left')]],4)],
    ['Левая: терция 4–2','Нажми D3 и F3 вместе пальцами 4 и 2; отпускай обе клавиши вместе.',repeat([[tone(50,4,'left'),tone(53,2,'left')]],4)]
  ]);
  family('relocate','Перенос без растяжения','p3','course05-07',[
    ['Правая: большой палец C4 → G4','После C4 отпусти клавишу. В паузе перенеси руку к G4 и найди новую опору большим пальцем.',line([60,67,60,67],1),{rests:[0,1,1,1]}],
    ['Левая: мизинец C3 → F3','В паузе перенеси всю левую руку с C3 к F3. Не удерживай старую клавишу растянутой рукой.',line([48,53,48,53],5,'left'),{rests:[0,1,1,1]}],
    ['Правая: новая опора G4–B4–D5','Найди G4, затем разложи G4–B4–D5 пальцами 1–3–5. Это новая позиция, а не растяжение из C4.',line([67,71,74,71,67],[1,3,5,3,1])],
    ['Левая: новая опора F3–A3–C4','Найди F3 и разложи F3–A3–C4 пальцами 5–3–1. C4 здесь играет левая рука.',line([53,57,60,57,53],[5,3,1,3,5],'left')]
  ]);
  family('black','Ориентация на чёрных клавишах','p3','course05-08',[
    ['Правая: группа из двух чёрных','C♯4–D♯4 пальцами 2–3. Найди группу на ощупь, затем спокойно сыграй её в пульсе.',line([61,63,61,63],[2,3,2,3])],
    ['Левая: группа из двух чёрных','C♯3–D♯3 пальцами 4–2. Рука немного глубже на клавиатуре, запястье свободно.',line([49,51,49,51],[4,2,4,2],'left')],
    ['Правая: группа из трёх чёрных','F♯4–G♯4–A♯4 и обратно пальцами 2–3–4–3–2. Не вытягивай пальцы к краю клавиш.',line([66,68,70,68,66],[2,3,4,3,2])],
    ['Левая: три чёрные сверху вниз','B♭3–A♭3–G♭3 пальцами 2–3–4 и обратно. Эти названия обозначают те же клавиши A♯–G♯–F♯.',line([58,56,54,56,58],[2,3,4,3,2],'left')]
  ]);
  family('hearing','Слушать интервалы в короткой фразе','p3','course09-03',[
    ['Большая терция C4–E4','Прослушай C4–E4, пропой расстояние, затем сыграй 1–3. Сравни свой звук с образцом.',line([60,64,60,64],[1,3,1,3])],
    ['Малая терция C4–E♭4','Сравни с предыдущим уроком: E♭4 ниже E4 на полутон. Сначала послушай, затем сыграй 1–3.',line([60,63,60,63],[1,3,1,3])],
    ['Кварта C4–F4','Послушай и пропой C4–F4, сыграй 1–4. Возвращайся к C4 без поиска взглядом после освоения.',line([60,65,60,65],[1,4,1,4])],
    ['Квинта C4–G4','Сравни кварту и квинту на слух. Сыграй C4–G4 пальцами 1–5, не растягивая кисть силой.',line([60,67,60,67],[1,5,1,5])]
  ],['detail-p-black-04']);
  family('hands','Согласование двух рук по шагам','p4','course01-07',[
    ['Чередование опор C3 и C4','Левая C3 (5), правая C4 (1), по очереди. Предыдущая рука отпускает звук перед новой долей.',repeat([[tone(48,5,'left')],[tone(60,1)]],3)],
    ['Два C вместе','Одновременно нажми C3 левой (5) и C4 правой (1). Одновременно отпусти, затем повтори.',repeat([[tone(48,5,'left'),tone(60,1)]],4)],
    ['Противоположное движение двух рук','Из C3/C4: левая идёт вниз B2–A2 пальцами 2–3 от большого на C3; правая вверх D4–E4 пальцами 2–3.',[[tone(48,1,'left'),tone(60,1)],[tone(47,2,'left'),tone(62,2)],[tone(45,3,'left'),tone(64,3)],[tone(47,2,'left'),tone(62,2)],[tone(48,1,'left'),tone(60,1)]]],
    ['Бас и ответ правой руки','Сыграй C3 левой (5), отпусти; правая отвечает C4–D4–E4 пальцами 1–2–3. Бас здесь не удерживается под ответом.',repeat([[tone(48,5,'left')],[tone(60,1)],[tone(62,2)],[tone(64,3)]],2)]
  ]);
  family('cross','Подготовка подкладывания и перекладывания','p5','course09-06',[
    ['Правая: 3 → 1 на E4–F4','Свяжи E4 средним и F4 большим. Большой проходит спокойно; небольшое сопровождение кисти помогает переходу.',line([64,65,64,65],[3,1,3,1]),{articulation:'legato',bpm:44}],
    ['Правая: 1 → 3 на F4–E4','Обратный переход: после F4 большим перенеси средний на E4, без резкого поворота запястья.',line([65,64,65,64],[1,3,1,3]),{articulation:'legato',bpm:44}],
    ['Левая: 1 → 3 на G3–A3','G3 большим, A3 средним: перекладывание в восходящей гамме левой руки. Не фиксируй кисть.',line([55,57,55,57],[1,3,1,3],'left'),{articulation:'legato',bpm:44}],
    ['Левая: 3 → 1 на A3–G3','A3 средним, G3 большим: обратное движение. Сохраняй связь звуков и свободное предплечье.',line([57,55,57,55],[3,1,3,1],'left'),{articulation:'legato',bpm:44}]
  ]);
  const scale=[60,62,64,65,67,69,71,72],rf=[1,2,3,1,2,3,4,5],lf=[5,4,3,2,1,3,2,1];
  family('scale','Соединить гамму после перехода','p5','course06-06',[
    ['Правая: 3 + 5 нот гаммы','Сыграй C4–D4–E4, в паузе подготовь большой на F4. Затем F4–G4–A4–B4–C5.',line(scale,rf),{rests:[0,0,0,1,0,0,0,0]}],
    ['Правая: гамма вверх и обратно','Соедини одну октаву C major без паузы. Верхнее C5 звучит один раз; вниз используй обратную аппликатуру.',line([...scale,...scale.slice(0,-1).reverse()],[...rf,...rf.slice(0,-1).reverse()]),{articulation:'legato',bpm:48}],
    ['Левая: 5 + 3 ноты гаммы','C3–G3 пальцами 5–4–3–2–1, затем пауза для подготовки A3–B3–C4 пальцами 3–2–1.',line(scale.map(m=>m-12),lf,'left'),{rests:[0,0,0,0,0,1,0,0]}],
    ['Левая: гамма вверх и обратно','Одна октава C3–C4 и обратно без паузы. Верхнюю ноту не повторяй; большой не зажимается под ладонью.',line([...scale,...scale.slice(0,-1).reverse()].map(m=>m-12),[...lf,...lf.slice(0,-1).reverse()],'left'),{articulation:'legato',bpm:48}]
  ],['detail-p-cross-04']);
  family('triads','От отдельных звуков к трезвучию','p5','course06-08',[
    ['Правая: собрать C major','C4, E4, G4 отдельно пальцами 1–3–5; затем те же клавиши вместе. Отличай разложенный аккорд от одновременного.',[...line([60,64,67],[1,3,5]),[tone(60,1),tone(64,3),tone(67,5)]]],
    ['Левая: собрать C major','C3, E3, G3 отдельно пальцами 5–3–1; затем вместе, без удара и зажатого запястья.',[...line([48,52,55],[5,3,1],'left'),[tone(48,5,'left'),tone(52,3,'left'),tone(55,1,'left')]]],
    ['Правая: собрать F major','F4–A4–C5 отдельно 1–3–5, затем вместе. Заранее перемести руку в позицию F.',[...line([65,69,72],[1,3,5]),[tone(65,1),tone(69,3),tone(72,5)]]],
    ['Правая: собрать C minor','C4–E♭4–G4 отдельно 1–3–5, затем вместе. Услышь отличие от C major; средний палец попадает на чёрную клавишу.',[...line([60,63,67],[1,3,5]),[tone(60,1),tone(63,3),tone(67,5)]]]
  ],['detail-p-black-04']);
  const chord=(root,hand='right')=>[tone(root,hand==='right'?1:5,hand),tone(root+4,3,hand),tone(root+7,hand==='right'?5:1,hand)];
  family('chordmove','Смена аккордовой позиции','p5','course08-04',[
    ['Правая: C major → F major с паузой','После аккорда отпусти все клавиши и в паузе перенеси форму 1–3–5 из C в F.',[chord(60),chord(65),chord(60),chord(65)],{rests:[0,1,1,1]}],
    ['Правая: F major → G major с паузой','Перенеси компактную форму на тон вверх. Не пытайся удерживать общий аккорд растяжением.',[chord(65),chord(67),chord(65),chord(67)],{rests:[0,1,1,1]}],
    ['Левая: C major → F major с паузой','Левая 5–3–1: весь аккорд отпускается перед переносом. Услышь все три звука.',[chord(48,'left'),chord(53,'left'),chord(48,'left'),chord(53,'left')],{rests:[0,1,1,1]}],
    ['Правая: C–F–G–C','Собери небольшую последовательность из знакомых форм. Указанные паузы оставлены для подготовки каждой позиции.',[chord(60),chord(65),chord(67),chord(60)],{rests:[0,1,1,1],beats:[2]}]
  ],['detail-p-triads-04']);
  family('transfer','Память, перенос и повторные ноты','p6','course10-04',[
    ['Правая: перенести трёхнотную фигуру','C4–D4–E4 пальцами 1–2–3, пауза, затем F4–G4–A4 теми же пальцами. Сначала услышь обе группы.',line([60,62,64,65,67,69],[1,2,3,1,2,3]),{rests:[0,0,0,1,0,0]}],
    ['Левая: перенести трёхнотную фигуру','C3–D3–E3 пальцами 5–4–3; после паузы F3–G3–A3 теми же пальцами. Затем повтори из памяти.',line([48,50,52,53,55,57],[5,4,3,5,4,3],'left'),{rests:[0,0,0,1,0,0]}],
    ['Правая: повторная нота разными пальцами','C4 пальцами 1–2–3–1. Между нажатиями клавиша полностью отпускается: это повтор звука, а не подмена пальца на удержанной клавише.',line([60,60,60,60],[1,2,3,1]),{articulation:'nonlegato'}],
    ['Левая: повторная нота разными пальцами','C3 пальцами 5–4–3–5 с отпусканием между звуками. Номера пальцев проверяй сам; MIDI видит только повторные ноты.',line([48,48,48,48],[5,4,3,5],'left'),{articulation:'nonlegato'}]
  ]);
  function registerPiano(lessons,themes,a,specifications=piano){let added=0;const keyFor=m=>Object.keys(a.keyMap).find(k=>a.keyMap[k]===m);
    for(const spec of specifications){if(lessons.some(l=>l.id===spec.id))continue;let theme=themes.find(t=>t.id==='detail-p-'+spec.group);if(!theme){theme={id:'detail-p-'+spec.group,name:spec.groupTitle,order:Math.max(0,...themes.map(t=>t.order))+1,contentKind:'exercise'};themes.push(theme);}
      const o=spec.options,bpm=o.bpm||56,articulation=o.articulation||'standard';const pattern=spec.events.map(ev=>{const keys=ev.map(n=>{const k=keyFor(n.midi);if(!k)throw Error('Unmapped teaching note '+n.midi);return k;});return keys.length>1?'['+keys.join('')+']':keys[0];}).join(' ');
      const lesson=a.makeLesson(spec.id,theme.name,spec.title,spec.goal,pattern,90,false);let cursor=0,end=0;const steps=spec.events.map((ev,i)=>{cursor+=(o.rests?.[i]||0);const interval=o.beats?.[i%o.beats.length]||1,duration=interval*(articulation==='staccato'?.3:articulation==='nonlegato'?.65:articulation==='legato'?1:.85),start=cursor;cursor+=interval;const step={startBeat:start,durationBeats:duration,restBeforeBeats:Math.max(0,start-end),measure:Math.floor(start/4)+1,beatInMeasure:start%4,sourceStartMs:Math.round(start*60000/bpm),sourceDurationMs:Math.round(duration*60000/bpm)};end=start+duration;return step;});
      lesson.rhythm=a.normalizeRhythm({version:1,source:'project-focused-study-v1',bpm,practiceBpm:bpm,timeSignature:{numerator:4,denominator:4},steps},steps.length);
      lesson.themeId=theme.id;lesson.order=lessons.filter(l=>l.themeId===theme.id).length+1;lesson.contentKind='exercise';lesson.maxErrors=1;lesson.timeLimit=Math.ceil(cursor*60/bpm*1.8+10);
      lesson.fingeringSpec={version:1,source:'focused-exercise-intent-v1',pattern,steps:spec.events.map(ev=>ev.map(n=>({hand:n.hand,num:n.num})))};const hands=new Set(spec.events.flat().map(n=>n.hand));lesson.handMode=hands.size===1?[...hands][0]:'split';
      lesson.guide=a.normalizeGuide({stage:spec.groupTitle,setup:'Найди начальные ноты и пальцы. Сядь удобно, кисть и предплечье свободны. Педаль не используется.',motion:spec.goal,blind:'После разбора послушай образец, представь фразу, затем повтори без подсказок. Не ищи дальнюю позицию вслепую до её освоения.',mastery:'Три чистые MIDI-попытки, одна из памяти; ещё одна из памяти на следующий день. Свободу движения, пальцы и звук оцени самостоятельно или с педагогом.'});
      lesson.learning={version:1,kind:'exercise',stage:spec.stage,after:spec.after,requires:spec.requires,articulation,machineCheck:'piano-midi',phraseSize:0,goal:spec.goal,practiceSteps:['Послушай образец и проговори счёт, включая паузы.','Разбери движение на двух нотах, затем сыграй короткое задание.','Сравни окончания звуков с образцом, повтори из памяти после уверенного разбора.'],selfCheck:[articulation==='legato'?'Связь звуков слышна без провалов и долгих наложений.':articulation==='staccato'?'Короткий звук заканчивается задолго до следующей доли.':'Каждый звук отпускается в своё время.','Пальцы совпадают с назначением; плечо и запястье не зажаты.','В слуховых уроках сравнение выполняется самостоятельно: автоматического теста слуха здесь нет.'],rhythmNotice:'Авторское упражнение проекта; темп и допуски являются учебной настройкой проекта.',references:[PRACTICE,CZERNY,'https://viva.pressbooks.pub/openmusictheory/chapter/triads/']};lessons.push(lesson);added++;
    }return added;
  }
  const OPEN={6:40,5:45,4:50,3:55,2:59,1:64},guitar=[];
  const gnote=(string,fret,finger,technique='обычная нота',extra={})=>({string,fret,midi:OPEN[string]+fret,finger,pick:'down',technique,durationBeats:1,...extra});
  const gl=(string,frets,fingers,extra={})=>frets.map((f,i)=>gnote(string,f,Array.isArray(fingers)?fingers[i]:fingers,'обычная нота',extra));
  function gf(key,title,stage,after,units,branch='common'){units.forEach((u,i)=>{const id=`detail-g-${key}-${String(i+1).padStart(2,'0')}`;guitar.push({id,group:key,groupTitle:title,title:u[0],goal:u[1],notes:u[2],options:u[3]||{},stage,branch,after:i?`detail-g-${key}-${String(i).padStart(2,'0')}`:after,requires:[i?`detail-g-${key}-${String(i).padStart(2,'0')}`:after]});});}
  gf('release','Извлечение и остановка звука','g1','t01-l07',[
    ['Открытая первая: звук и тишина','Извлеки E4 и останови струну после одной доли. В паузе слышна тишина, а не затухающий хвост.',gl(1,[0,0,0,0],0),{rest:1}],
    ['Открытая шестая: остановить бас','Извлеки E2 без сильного удара и заглуши по окончании доли. Не касайся соседних струн при атаке.',gl(6,[0,0,0,0],0),{rest:1}],
    ['Два регистра по очереди','E2 затем E4. Перед сменой струны останови предыдущую, не оставляй два звука вместе.',repeat([gnote(6,0,0),gnote(1,0,0)],3),{rest:1}],
    ['Короткий и длинный открытый звук','На E4 чередуй одну и две доли. Отдельно проверь слухом окончания звуков.',gl(1,[0,0,0,0],0).map((n,i)=>({...n,durationBeats:i%2?2:1})),{rest:1}]
  ]);
  gf('pick','Медиатор: от одного штриха к чередованию','g1','t01-l08',[
    ['Только штрих вниз','Четыре ровные атаки открытой первой струны вниз. Движение небольшое, хват без лишнего усилия.',gl(1,[0,0,0,0],0)],
    ['Вниз и вверх на одной струне','E4: down–up попеременно. Сравни громкость и качество двух направлений.',gl(1,[0,0,0,0,0,0,0,0],0).map((n,i)=>({...n,pick:i%2?'up':'down'}))],
    ['Восьмые без ускорения','Два удара на долю на первой струне. Считай «раз-и» и сохрани последовательность down–up.',gl(1,Array(8).fill(0),0).map((n,i)=>({...n,pick:i%2?'up':'down',durationBeats:.5})),{bpm:48}],
    ['Чередование на соседних струнах','Первая и вторая открытые струны по две атаки. Сначала медленно проверь траекторию перехода медиатора.',[1,1,2,2,1,1,2,2].map((s,i)=>gnote(s,0,0,'обычная нота',{pick:i%2?'up':'down'}))]
  ],'pick');
  gf('pima','Пальцы правой руки по одному','g1','t01-l08',[
    ['p: большой на басовой струне','Большим правой руки (p) извлекай открытую пятую. Левая не зажимает лад.',gl(5,[0,0,0,0],0,{pick:'p'})],
    ['i: указательный на первой струне','Указательным правой руки (i) извлекай открытую первую. Цифра слева относится к левой руке, буква — к правой.',gl(1,[0,0,0,0],0,{pick:'i'})],
    ['i–m на одной струне','Чередуй указательный i и средний m на открытой первой. Избегай повторного i вместо чередования.',gl(1,Array(8).fill(0),0).map((n,i)=>({...n,pick:i%2?'m':'i'}))],
    ['p–i–m–a на открытых струнах','Пятая (p), третья (i), вторая (m), первая (a). Сначала по одному звуку на долю, без аккорда.',repeat([gnote(5,0,0,'обычная нота',{pick:'p'}),gnote(3,0,0,'обычная нота',{pick:'i'}),gnote(2,0,0,'обычная нота',{pick:'m'}),gnote(1,0,0,'обычная нота',{pick:'a'})],2)]
  ],'fingers');
  gf('frets','Первое прижатие струны','g2','t02-l08',[
    ['Вторая струна: открытая → первый лад','Открытая B3 затем C4 первым пальцем. Прижимай рядом с ладовым порожком, а не на нём.',gl(2,[0,1,0,1],[0,1,0,1])],
    ['Вторая струна: первый → третий лад','C4–D4 пальцами 1–3. Третий палец опускается близко к третьему порожку.',gl(2,[1,3,1,3],[1,3,1,3])],
    ['Первая струна: первый → третий лад','F4–G4 пальцами 1–3. Проверь, что соседняя вторая струна не шумит.',gl(1,[1,3,1,3],[1,3,1,3])],
    ['Возврат к открытой струне','На второй струне 0–1–3–1–0. После отпускания лада не делай случайный pull-off; каждую ноту извлекай правой рукой.',gl(2,[0,1,3,1,0],[0,1,3,1,0])]
  ]);
  gf('mute','Паузы и лишние струны','g2','t03-l08',[
    ['Остановить прижатую ноту','C4 на второй струне: ослабь прижатие, сохраняя контакт со струной, и не дай открытой B3 прозвучать.',gl(2,[1,1,1,1],1),{rest:1}],
    ['Ладонь у подставки: palm mute','На шестой открытой слегка коснись струны ребром правой ладони у подставки. Звук короткий, но высота различима.',gl(6,[0,0,0,0],0,{technique:'palm mute'}),{rest:1}],
    ['Пауза после двух нот','На второй струне C4–D4, затем доля тишины. Лишние струны остаются заглушены.',gl(2,[1,3,1,3,1,3],[1,3,1,3,1,3]),{rests:[0,0,1,0,1,0]}],
    ['Смена струны без хвоста','Первая G4 (лад 3), вторая D4 (лад 3), пальцы 3 и 3 с перестановкой. В паузе заглуши прежнюю струну.',repeat([gnote(1,3,3),gnote(2,3,3)],3),{rest:1}]
  ]);
  gf('rhythm','Ритм перед сложными рисунками','g2','t05-l05',[
    ['Четверти и половинные на одной ноте','Открытая E4: 1–1–2 доли. Пульс не меняется при длинной ноте.',gl(1,Array(6).fill(0),0).map((n,i)=>({...n,durationBeats:[1,1,2][i%3]}))],
    ['Две восьмые и четверть','На E4 сыграй полдоли, полдоли, долю. Сначала проговори «раз-и, два».',gl(1,Array(6).fill(0),0).map((n,i)=>({...n,durationBeats:[.5,.5,1][i%3]})),{bpm:48}],
    ['Три доли: 1–2–3','На открытой E4 считай по три доли. Не добавляй четвёртую долю на границе такта.',gl(1,Array(6).fill(0),0),{numerator:3}],
    ['Четверть с точкой и восьмая','Открытая E4: полторы доли и полдоли. Считай половины доли вслух; не превращай рисунок в две равные ноты.',gl(1,Array(4).fill(0),0).map((n,i)=>({...n,durationBeats:i%2?.5:1.5})),{bpm:48}]
  ]);
  gf('chords','От звуков формы к power-аккорду','g4','m16-l04',[
    ['E5: проверить звуки по одному','Шестая открытая E2, пятая на 2-м ладу B2 первым пальцем. Проверь каждый звук отдельно.',repeat([gnote(6,0,0),gnote(5,2,1)],3)],
    ['E5: два звука одновременно','Соедини E2 и B2. Играют только шестая и пятая струны; аудиодетектор не ставит зачёт одновременному аккорду.',repeat([[gnote(6,0,0),gnote(5,2,1)]],4)],
    ['G5: подвижная форма 1–3','Шестая на 3-м (1), пятая на 5-м (3). Сначала проверь отдельно, затем вместе. Остальные струны заглушены.',[gnote(6,3,1),gnote(5,5,3),[gnote(6,3,1),gnote(5,5,3)]]],
    ['G5 → A5 с подготовительной паузой','Перенеси форму целиком на два лада вверх в паузе. Не растягивай её между двумя позициями.',[[gnote(6,3,1),gnote(5,5,3)],[gnote(6,5,1),gnote(5,7,3)],[gnote(6,3,1),gnote(5,5,3)]],{rest:1}]
  ]);
  gf('legato','Подготовка slide, hammer-on и pull-off','g5','t13-l08',[
    ['Слайд вверх одним пальцем','На третьей струне 3 → 5 одним пальцем 1. Только первая атака правой рукой; сохраняй контакт и давление при скольжении.',[gnote(3,3,1),gnote(3,5,1,'slide',{pick:'none'})]],
    ['Слайд вниз одним пальцем','На третьей струне 5 → 3 тем же пальцем 1. Не заменяй слайд двумя отдельно прижатыми нотами.',[gnote(3,5,1),gnote(3,3,1,'slide',{pick:'none'})]],
    ['Hammer-on: подготовить 1 → 3','На четвёртой струне 2-й лад пальцем 1; удар пальцем 3 на 4-й лад без новой атаки правой.',[gnote(4,2,1),gnote(4,4,3,'hammer-on',{pick:'none'})]],
    ['Pull-off: нижний палец стоит заранее','На четвёртой струне поставь 1 на лад 2 и 3 на лад 4. После первой атаки сними 3 с лёгким извлечением к заранее стоящему 1.',[gnote(4,4,3),gnote(4,2,1,'pull-off',{pick:'none'})]]
  ]);
  guitar.find(l=>l.id==='detail-g-frets-01').requires=['topic-string-open-control-l06'];
  guitar.find(l=>l.id==='detail-g-chords-01').requires=['detail-g-rhythm-04'];
  const bend=(target,release=false)=>[gnote(3,7,3,'начало bend',{durationBeats:2}),gnote(3,7,3,'bend target',{midi:62+target,pick:'none',durationBeats:2,bendFromMidi:62,bendStartMidi:62,bendSemitones:target,pitchEffect:'bend-target'}),...(release?[gnote(3,7,3,'release',{midi:62,pick:'none',durationBeats:2,bendFromMidi:62,bendStartMidi:62+target,bendSemitones:0,pitchEffect:'bend-release'})]:[])];
  gf('bend','Bend: сначала целевая высота','g5','t28-l08',[
    ['Сравнить D4 и E♭4 без bend','На третьей струне сыграй лады 7 и 8 пальцами 3 и 4. Запомни полутоновую целевую высоту; это сравнение, а не подтяжка.',gl(3,[7,8,7,8],[3,4,3,4])],
    ['Полутон: палец остаётся на ладу 7','D4 на третьей струне, лад 7 пальцем 3. Поддержи пальцами 1–2 и подтяни до E♭4; не переходи на лад 8.',bend(1)],
    ['Тон: целевая высота E4','Сначала послушай E4 в образце. На третьей струне оставайся на ладу 7, подтягивая D4 на тон. Не форсируй движение.',bend(2)],
    ['Дойти до высоты и вернуть звук','D4 → E4 → D4: лад 7 и палец 3 сохраняются. Возвращай струну плавно; правой рукой между фазами не атакуй.',bend(2,true)]
  ]);
  guitar.find(l=>l.id==='detail-g-bend-01').requires=['t09-l08','t28-l08'];
  function registerGuitar(data){let added=0;for(const spec of guitar){if(data.lessons.some(l=>l.id===spec.id))continue;let topic=data.topics.find(t=>t.id==='detail-g-'+spec.group);if(!topic){topic={id:'detail-g-'+spec.group,title:spec.groupTitle,category:'skill',order:Math.max(100,...data.topics.map(t=>t.order||0))+1,lessons:[]};data.topics.push(topic);}const o=spec.options,bpm=o.bpm||60;let cursor=0,previousEnd=0;const notes=[];spec.notes.forEach((item,i)=>{const group=Array.isArray(item)?item:[item];cursor+=o.rests?.[i]??(i?(o.rest||0):0);const duration=group[0].durationBeats||1;for(const n of group){notes.push({...n,startBeat:cursor,endBeat:cursor+duration,startSeconds:cursor*60/bpm,endSeconds:(cursor+duration)*60/bpm,...(group.length>1?{group:i}:{}),restBeforeBeats:cursor-previousEnd});}cursor+=duration;previousEnd=cursor;});
      for(const [i,n] of notes.entries()){n.id=spec.id+'-n'+String(i+1).padStart(2,'0');n.number=i+1;n.frequency=440*2**((n.midi-69)/12);n.note=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'][n.midi%12]+(Math.floor(n.midi/12)-1);}
      const lesson={id:spec.id,preset:data.lessons.find(l=>l.preset)?.preset,topicId:topic.id,title:spec.title,description:spec.goal,goal:spec.goal,category:'skill',contentKind:'exercise',difficulty:spec.stage==='g1'?1:spec.stage==='g2'?2:3,bpm,originalBpm:bpm,minBpm:30,maxBpm:120,timeLimitSec:Math.ceil(cursor*60/bpm*1.8+10),maxErrors:1,isExam:false,isFinal:false,notes,tips:['Послушай, затем разбери 2–4 события.','Проверь лишние струны и свободу движения.'],learning:{version:1,kind:'exercise',stage:spec.stage,branch:spec.branch,after:spec.after,requires:spec.requires,goal:spec.goal,techniqueConstraints:['legato','bend'].includes(spec.group),pitchToleranceCents:spec.group==='bend'?20:35,timeSignature:{numerator:o.numerator||4,denominator:4},practiceSteps:['Послушай образец и проговори счёт.','Разбери одно движение, затем короткую связку.','Запиши себя, сравни высоты и шум; повтори из памяти после уверенного разбора.'],selfCheck:[spec.goal,'Правая рука исполняет указанный штрих или буквенное обозначение.','Аудиопроверка не подтверждает ритм, пальцы, струну и способ исполнения.'],limitations:notes.some(n=>n.group!==undefined)?['Одновременный аккорд проверяется слухом или педагогом; одноголосный детектор его не подтверждает.']:[],references:[PRACTICE,TRINITY,...(spec.group==='bend'?[BENDS]:[])]}};topic.lessons.push(lesson);data.lessons.push(lesson);added++;}return added;}
  function provenanceHtml(learning,escape){
    const p=learning.provenance;if(!p||typeof p!=='object')return '';const types={'project-technical-drill':'Техническое упражнение проекта','study-or-adaptation':'Учебный этюд / адаптация','score-excerpt':'Фрагмент произведения'},e=escape;
    const paragraphs=[['Материал',types[p.type]||'Учебный материал'],['Автор / происхождение',p.author],['Зачем это движение',p.purpose],['Где пригодится',p.context],['Источник и изменения',p.sourceNote],['Историческая справка',p.history]].filter(([,value])=>typeof value==='string'&&value.trim());
    return '<div class="lesson-provenance">'+paragraphs.map(([title,value])=>'<p><b>'+e(title)+':</b> '+e(value)+'</p>').join('')+'</div>';
  }
  function materialHtml(lesson,instrument,escape){const l=lesson.learning;if(!l)return '';const e=escape,items=values=>(values||[]).map(s=>'<li>'+e(s)+'</li>').join('');return '<details class="learning-material"><summary>Разбор движения и учебные материалы</summary>'+provenanceHtml(l,e)+'<p><b>Цель:</b> '+e(l.goal||lesson.description)+'</p>'+(l.timeSignature?'<p>Размер '+l.timeSignature.numerator+'/'+l.timeSignature.denominator+' · '+lesson.bpm+' BPM</p>':'')+'<ol>'+items(l.practiceSteps)+'</ol><p><b>Проверь себя</b></p><ul>'+items(l.selfCheck)+'</ul>'+(l.rhythmNotice?'<p>'+e(l.rhythmNotice)+'</p>':'')+'<ul>'+items(l.limitations)+'</ul><p>'+(instrument==='piano'?'C4 — среднее до (MIDI 60). Пальцы 1–5: большой, указательный, средний, безымянный, мизинец. Legato — связно, staccato — коротко. Педаль в этих заданиях не используется.':'Струна 1 — тонкая E4, 6 — басовая E2 в стандартном строе. 0 — открытая струна. Левая рука: 1–4 от указательного до мизинца. Правая: p — большой, i — указательный, m — средний, a — безымянный; down/up — медиатор вниз/вверх.')+'</p><p>Четверть — одна доля, половинная — две, целая — четыре; восьмая — полдоли. Точка добавляет половину длительности. В паузе продолжай считать. Сначала качество короткого фрагмента, затем соединение и темп.</p><p>Первоисточники и дальнейшее чтение: '+(l.references||[]).filter(url=>/^https:\/\//.test(url)).map((url,i)=>'<a href="'+e(url)+'" target="_blank" rel="noopener noreferrer">'+e(l.referenceTitles?.[url]||(url.includes('utexas')?'Duke / Simmons: практика':url.includes('koeln')?'Czerny: письмо 3':url.includes('trinity')?'Trinity: технические навыки':url.includes('openmusictheory')?'Chelsey Hamm: трезвучия':url.includes('cliffsmithguitarlessons.co.uk')?'Cliff Smith: полутоновый bend':'Первоисточник '+(i+1)))+'</a>').join(' · ')+'</p><p>Это упражнения проекта на основе общих принципов; их темпы и допуски не являются требованиями этих авторов или экзаменационной программы.</p></details>';}
  return {piano,guitar,registerPiano,registerGuitar,materialHtml,provenanceHtml};
});
