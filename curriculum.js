(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MusicCurriculum=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // These are project learning stages, not RCM/Trinity grades or certificates.
  const stages={
    p1:{title:'1. Ориентиры и отдельные пальцы',goal:'Найти опоры C/F, спокойно нажать и отпустить звук каждой рукой отдельно',requires:[]},
    p2:{title:'2. Пять пальцев и простой пульс',goal:'Соседние ноты, возврат, повтор и пауза без смещения кисти',requires:['p1']},
    p3:{title:'3. Простые мелодии и перенос позиции',goal:'Короткие знакомые фразы, отдельно каждой рукой; переносить кисть после отпускания',requires:['p2']},
    p4:{title:'4. Согласование рук',goal:'Сначала чередовать руки, затем соединять простые одновременные движения',requires:['p3']},
    p5:{title:'5. Гамма, арпеджио и трезвучие',goal:'Подкладывание, поворот кисти и компактный аккорд после освоения позиции',requires:['p4']},
    p6:{title:'6. Закрепление начального курса',goal:'Соединить знакомые движения; повторить без подсказок и на следующий день',requires:['p5']},
    p7:{title:'Расширение техники · дополнительная практика',goal:'Новые позиции, чёрные клавиши, бас и мелодия, аккордовый аккомпанемент',requires:['p6'],optional:true},
    p8:{title:'8. Большие перемещения · дополнительная ветка',goal:'Далёкие регистры и длинные комбинации после ближних позиций',requires:['p7'],optional:true},
    p9:{title:'Репертуар · отдельная ветка',goal:'Выбирать пьесу по её требованиям, разбирать короткими фразами; название не задаёт сложность',requires:['p6'],optional:true},
    g1:{title:'1. Настройка, открытые струны и звукоизвлечение',goal:'Настроить инструмент; чисто извлечь и остановить один звук. Выбрать медиатор или пальцы',requires:[]},
    g2:{title:'2. Первые лады, смена струн и пульс',goal:'Ближняя позиция, простой пульс и пауза; без скачков по всему грифу',requires:['g1']},
    g3:{title:'3. Короткие мелодии и риффы',goal:'Знакомые одноголосные фразы, равномерный штрих и контроль лишних струн',requires:['g2']},
    g4:{title:'4. Аккорды и сопровождение',goal:'Power-аккорды, открытые формы, перебор и переход одиночная нота ↔ аккорд',requires:['g3']},
    g5:{title:'5. Позиции, гаммы и выразительность',goal:'Ближние переносы, интервалы, гаммы; отдельно слайд, hammer/pull, затем bend и vibrato',requires:['g4']},
    g6:{title:'6. Сложный ритм и связки',goal:'Синкопа, триоль, шестнадцатые и длинное легато после устойчивого простого пульса',requires:['g5']},
    g7:{title:'7. Закрепление и длинная форма',goal:'Повтор без подсказок, запись целой формы и повтор на следующий день',requires:['g6']},
    g8:{title:'Специальные приёмы · дополнительная ветка',goal:'Флажолеты, крайний регистр, перкуссия и специальные фактуры по выбору',requires:['g7'],optional:true},
    g9:{title:'Репертуар · отдельная ветка',goal:'Разбор по фразам после нужной техники; учебный этюд не равен оригинальной записи',requires:['g4'],optional:true}
  };
  function entry(plan,instrument,id){return plan?.[instrument]?.find(e=>e.id===id)||null;}
  function route(plan,instrument,lessons){const byId=new Map(lessons.map(l=>[l.id,l]));return (plan?.[instrument]||[]).filter(e=>!stages[e.stage]?.optional).map(e=>byId.get(e.id)).filter(Boolean);}
  function next(plan,instrument,lessons,id){const path=route(plan,instrument,lessons),index=path.findIndex(l=>l.id===id);return index>=0?path[index+1]||null:path[0]||null;}
  return {stages,entry,route,next};
});
