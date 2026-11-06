(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./practice-assessment.js'),require('./piano-preparation.js')):factory(root.PracticeAssessment,root.PianoPreparation);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoPreparationFragment=api;})(typeof window==='object'?window:globalThis,function(Assessment,Preparation){
 'use strict';
 const TARGET_IDS=Object.freeze(['course02-06','course03-06']);
 const profiles={
  'course02-06':{fingerprint:'28c4e84b',hand:'right',planId:'detail-p-read-treble-01',preparationIds:['course02-02','detail-p-release-01'],position:'C4–E4',fingers:'1–2–2–3–3'},
  'course03-06':{fingerprint:'ff3e5665',hand:'left',planId:'detail-p-read-bass-01',preparationIds:['course03-02','detail-p-release-02'],position:'C3–E3',fingers:'5–4–4–3–3'}
 };
 function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
 function prepare(lesson){
  const p=profiles[lesson?.id];if(!p||Assessment.pianoSignature(lesson)!==p.fingerprint)return null;
  try{const f={lessonId:lesson.id,firstStep:0,lastStep:4,goal:'Новые атаки повторных D и E без смены позиции.',requiredBeforeAssessment:true,adaptation:{version:1,id:'three-note-repeat-preparation-v1',kind:'project-training-adaptation',targetBpm:56,rationale:'Знакомая моторная подготовка к чтению трёх высот: сохранить исходные ноты, длительности и пальцы, отдельно сыграть пять атак в учебном темпе 56 BPM.'}};
   const requirement=Preparation.compile({id:p.planId,hand:p.hand,requires:[lesson.id],preparationFragments:[f]},[lesson]).requirements[1];
   return freeze({requirement,planId:p.planId,hand:p.hand,preparationIds:[...p.preparationIds],title:'Подготовка повторных нот: пять звуков',goal:'Сыграй C–D–D–E–E в позиции '+p.position+' пальцами '+p.fingers+'. Повтор D/E требует отпускания и новой атаки.',practiceSteps:['Сначала повтори трёхнотную позицию и отпускания своей руки. Вторая рука отдыхает; педаль не используй.','Послушай пять равных четвертей. Пропой: до — ре — ре — ми — ми; представь две отдельные атаки каждой повторной ноты.','Разбери D–D и E–E медленно. Отпусти клавишу перед новым нажатием; не дави в удержанную клавишу и не зажимай кисть.','Соедини C–D–D–E–E. Считай четверти: раз, два, три, четыре | раз; последний звук длится ещё одну четверть. Цель проверки — 56 BPM.','После чистой попытки повтори без подсказок, затем вернись после перерыва. Для переноса позже потребуется другая подготовленная фраза.'],selfCheck:['Слышны пять отдельных атак одинакового пульса, повторные D и E не сливаются в один длинный звук.','Длительности ровные; последний звук отпущен. Рука свободна, без боли; номера пальцев сверены самостоятельно.','Это знакомая техническая адаптация проекта. Она не доказывает чтение/слух нового материала и не даёт зачёт всех 16 действий исходного упражнения.']});
  }catch{return null;}
 }
 return {TARGET_IDS,prepare};
});
