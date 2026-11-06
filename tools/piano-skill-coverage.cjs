'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadApp}=require('../tests/helpers/load-app.cjs'),Catalog=require('../catalog-sections.js');
const Quality=require('../lesson-quality.js');
const {validatePlannedLessons}=require('./piano-lesson-plan.cjs');
const ROOT=path.resolve(__dirname,'..');
// Capacity is a design budget, not individually specified or implemented lesson IDs.
const domains=[
 ['orientation','Ориентиры и положение руки',40,'Группы чёрных клавиш, C/F, октавы, отдельные опоры, удобная посадка','Начало курса'],
 ['reading','Высота и нотная запись',60,'Два ключа, линии/промежутки, среднее C, добавочные линии, связь символа со звуком','Ориентиры; чтение вводится рано'],
 ['fingers','Пальцевые сочетания и контроль нажатия',60,'Каждый палец, соседние/несоседние пары, повторы со сменой пальца, мягкое отпускание','Одна опора → короткая позиция'],
 ['rhythm','Ритм и паузы',80,'Доли/деление, длительности, паузы, размеры, пунктир, триоль, синкопа','От простого пульса к подготовленным веткам'],
 ['articulation','Штрихи и музыкальная фраза',60,'Non-legato, legato, staccato, акценты, динамика, начало/окончание фразы','Отдельные звуки и пульс'],
 ['positions','Позиции и переносы',60,'Пять пальцев, ближние/дальние опоры, чёрные клавиши, подготовка перемещения','Отпускание и соседние ноты'],
 ['crossings','Подкладывание и перекладывание',50,'Переходы 3–1/4–1 в обе стороны, соединение частей, удобное сопровождение кистью','Позиция и перенос'],
 ['major-scales','Мажорные гаммы',72,'Тональности, обе руки/направления, особые переходы, соединение октавы','Изолированные переходы'],
 ['minor-scales','Минорные формы',84,'Натуральная, гармоническая, мелодическая формы; разные аппликатурные задачи','Подготовленные гаммы и знаки'],
 ['collections','Хроматика и пентатоника',48,'Чёрные/белые пары, хроматические переходы, ограниченный набор для свободной игры','Знаки, позиции, подготовленные переходы'],
 ['intervals','Интервалы и двойные ноты',64,'Последовательные/одновременные интервалы, компактные терции/сексты, варианты рук','Отдельные пальцы и две клавиши'],
 ['triads','Строение трезвучий',64,'Мажор/минор, звуки отдельно → аккорд, корень/терция/квинта, контроль всех звуков','Интервалы и компактный охват'],
 ['inversions','Обращения, функции и каденции',72,'Обращения, общие звуки, короткое голосоведение, I–IV–V, подготовленные септаккорды','Трезвучия и подготовка смены'],
 ['arpeggios','Арпеджио и классическое сопровождение',80,'Короткие/длинные арпеджио, бас–аккорд, вальс, бас Альберти, фигурации','Аккорд, перенос, простой ритм'],
 ['coordination','Руки и голоса',80,'Чередование → вместе, параллельное/противоположное движение, разные ритмы, удержанный голос','Отдельно освоенные партии; нужна модель удержания'],
 ['pedal','Педаль и соединение звучания',32,'Без педали → момент смены, слуховая чистота, координация ноги/рук','Отпускания и гармония; нужна поддержка событий педали'],
 ['popular-accompaniment','Популярные фактуры',64,'Баллада, поп/рок, басовые формулы, аккордовые обозначения, разнообразие рисунка','Аккорды и координация'],
 ['blues-jazz','Блюз и джазовые основы',64,'Свинг, блюзовый материал, вопрос–ответ, подготовленные аккордовые краски','Ритм и гармония; отдельная ветка'],
 ['ear-transfer','Слух, чтение с листа и память',96,'Эхо, неизвестный образец, короткое чтение, пропевание, повтор после перерыва','Начинается рано; трудность растёт вместе с курсом'],
 ['creative','Импровизация и самостоятельная музыка',80,'Мотив, вариация, ответная фраза, перенос тональности, сопровождение, маленькая форма','От ограниченного материала к самостоятельным связкам']
].map(([id,title,targetSlots,scope,preparation])=>({id,title,targetSlots,scope,preparation,status:'capacity-draft-needs-individual-goals-and-sources'}));
function validateMappedLessons(lessons){
 for(const l of lessons)if(l.coverageDomain&&!domains.some(d=>d.id===l.coverageDomain))throw Error('Unknown implemented coverage domain: '+l.id+' / '+l.coverageDomain);
}
// Explicit pedagogical relations only. Similar titles or a new BPM do not establish a new goal.
function sameGoalGroups(lessons){
 const byId=new Map(lessons.map(l=>[l.id,l]));
 if(byId.size!==lessons.length)throw Error('Duplicate lesson ID in goal relations');
 for(const l of lessons)if(l.sameGoalAs!=null&&(typeof l.sameGoalAs!=='string'||!byId.has(l.sameGoalAs)))throw Error('Unknown same-goal target: '+l.id+' / '+l.sameGoalAs);
 const groups=new Map();
 for(const l of lessons){
  let root=l;const seen=new Set();
  while(root.sameGoalAs!=null){if(seen.has(root.id))throw Error('Cyclic same-goal relation: '+l.id);seen.add(root.id);root=byId.get(root.sameGoalAs);}
  if(!groups.has(root.id))groups.set(root.id,{primaryId:root.id,lessonIds:[root.id]});
  if(l.id!==root.id)groups.get(root.id).lessonIds.push(l.id);
 }
 return [...groups.values()].filter(g=>g.lessonIds.length>1);
}
// A multi-skill checkpoint is not a new motor goal or an alias for just one component.
function goalAccounting(lessons){
 const groups=sameGoalGroups(lessons),byId=new Map(lessons.map(l=>[l.id,l]));
 for(const l of lessons)if(l.goalCounting!=null&&l.goalCounting!=='checkpoint-only')throw Error('Unknown goal counting role: '+l.id);
 const checkpoints=lessons.filter(l=>l.goalCounting==='checkpoint-only');
 for(const l of checkpoints){
  if(l.sameGoalAs!=null)throw Error('Checkpoint cannot also be a same-goal variant: '+l.id);
  if(!Array.isArray(l.requires)||!l.requires.length||new Set(l.requires).size!==l.requires.length||l.requires.some(id=>id===l.id||!byId.has(id)))throw Error('Checkpoint needs known distinct preparations: '+l.id);
 }
 const checkpointIds=new Set(checkpoints.map(l=>l.id));
 if(groups.some(g=>checkpointIds.has(g.primaryId)))throw Error('A same-goal relation cannot target a checkpoint');
 const variants=groups.reduce((n,g)=>n+g.lessonIds.length-1,0);
 return {sameGoalGroups:groups,explicitSameGoalVariants:variants,explicitCheckpoints:checkpoints.length,checkpointLessonIds:[...checkpointIds],goalGroupUpperBound:lessons.length-variants-checkpoints.length};
}
function build(){
 const app=loadApp(),context={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'curriculum-plan.js'),'utf8'),context);
 const route=context.MUSIC_CURRICULUM_PLAN.piano,items=Catalog.available('piano','learning',app.lessons,app.themes);
 const lessons=items.map(l=>{const entry=route.find(e=>e.id===l.id);return {id:l.id,title:l.title,themeId:l.themeId,stage:entry?.stage,actions:l.steps.length,explicitFingers:!!l.fingeringSpec,exactTiming:!!l.rhythm,challenge:!!entry?.challenge,structuredProvenance:!!l.learning?.provenance,coverageDomain:l.learning?.coverageDomain||null,goal:l.learning?.provenance?.purpose||l.learning?.goal||null,requires:l.learning?.requires||[],nextLessonId:l.learning?.nextLessonId||null,sourceEvidenceIds:l.learning?.sourceEvidenceIds||[],sameGoalAs:l.learning?.sameGoalAs??null,goalCounting:l.learning?.goalCounting??null,independentTeacherReview:false};});
 validateMappedLessons(lessons);
 for(const l of lessons)l.sameGoalAs=items.find(item=>item.id===l.id).learning?.sameGoalAs??null;
 const accounting=goalAccounting(lessons),goalGroups=accounting.sameGoalGroups,sameGoalVariants=accounting.explicitSameGoalVariants;
 const plannedLessons=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/piano-lesson-backlog.json'),'utf8')).lessons;
 const sourceLedger=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/piano-curriculum-sources.json'),'utf8'));
 validatePlannedLessons(plannedLessons,{implementedLessonIds:lessons.map(l=>l.id),implementedLessonLengths:Object.fromEntries(lessons.map(l=>[l.id,l.actions])),domainIds:domains.map(d=>d.id),sourceEvidenceIds:sourceLedger.entries.map(e=>e.id)});
 for(const plan of plannedLessons.filter(l=>l.assessmentProtocol?.kind==='notation-to-key'))require('../piano-preparation.js').compile(plan,app.lessons);
 const mappedDomains=domains.map(d=>({...d,lessonIds:lessons.filter(l=>l.coverageDomain===d.id).map(l=>l.id),plannedLessonIds:plannedLessons.filter(l=>l.coverageDomain===d.id).map(l=>l.id)}));
 const checkpoint=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/piano-curriculum-state.json'),'utf8'));
 return {version:5,generatedAt:new Date().toISOString(),scope:'piano-only',targetMinimum:1000,capacitySlots:domains.reduce((n,d)=>n+d.targetSlots,0),capacityStatus:'Preliminary topic budgets, not individual specified lesson IDs; refine with sources and deduplication.',counts:{plannedFutureLessons:plannedLessons.length,implementedLearningLessons:lessons.length,checkedMidiRouteLessons:lessons.filter(l=>l.challenge).length,withStructuredProvenance:lessons.filter(l=>l.structuredProvenance).length,individuallyMappedToDomain:lessons.filter(l=>l.coverageDomain).length,independentTeacherReviewed:0,explicitSameGoalVariants:sameGoalVariants,explicitCheckpoints:accounting.explicitCheckpoints,goalGroupUpperBound:accounting.goalGroupUpperBound,verifiedDistinctGoalCount:null},sameGoalGroups:goalGroups,checkpointLessonIds:accounting.checkpointLessonIds,domains:mappedDomains,plannedLessons,lessons,nextAction:checkpoint.nextWork.action};
}
function plannedFingering(lesson){
 if(lesson.hand==='both'){
  if(!Array.isArray(lesson.targetNotes)||!lesson.targetNotes.length||lesson.targetNotes.some(n=>!['left','right'].includes(n.hand)||!Number.isInteger(n.finger)||n.finger<1||n.finger>5||!Number.isInteger(n.midi)||n.midi<0||n.midi>127))throw Error('Invalid planned two-hand fingering: '+lesson.id);
  return lesson.targetNotes.map(n=>(n.hand==='left'?'левая ':'правая ')+Quality.name(n.midi)+'/'+n.finger).join('; ');
 }
 if(!['left','right'].includes(lesson.hand)||!Array.isArray(lesson.targetFingers)||!lesson.targetFingers.length)throw Error('Missing planned hand or fingers: '+lesson.id);
 return (lesson.hand==='right'?'правая ':'левая ')+lesson.targetFingers.join('–');
}
function write(report){
 fs.writeFileSync(path.join(ROOT,'docs/piano-skill-coverage.json'),JSON.stringify(report,null,2)+'\n');
 const escape=s=>String(s??'—').replaceAll('|','\\|').replace(/\r?\n/g,' '),lines=['# Покрытие курса пианино','',`В каталоге реализовано **${report.counts.implementedLearningLessons}** учебных записей, из них **${report.counts.checkedMidiRouteLessons}** с текущим контрактом MIDI-челленджа. Поля происхождения заполнены в **${report.counts.withStructuredProvenance}** уроках; независимая редактура преподавателем не выполнена.`,``,`Целевой минимум — **1000 содержательных микроуроков**. Ниже — предварительный каркас на **${report.capacitySlots} учебных мест**, а не готовые описания такого количества уроков. Каждый бюджет уточняется по отдельным целям, источникам и отсутствию дублей. Число учебных записей с направлением и подробным объяснением — **${report.counts.individuallyMappedToDomain}**; остальные требуют отдельной редакции. Автоматическая стадия не доказывает полное покрытие навыка.`,``,`| Направление | Предварительных мест | Сопоставлено уроков | Содержание | Подготовка |`,`| --- | ---: | ---: | --- | --- |`,...report.domains.map(d=>'| '+[d.title,d.targetSlots,d.lessonIds.length,d.scope,d.preparation].map(escape).join(' | ')+' |'),'','## Сопоставленные учебные задачи','','Это подробные описания существующих учебных записей с задачей и источниками. Повторения одной цели отмечены явно и не увеличивают количество самостоятельных целей. Содержание ещё не прошло независимую редактуру преподавателем.','','| ID | Направление | Задача | Подготовка по ID |','| --- | --- | --- | --- |',...report.lessons.filter(l=>l.coverageDomain).map(l=>'| '+[l.id,l.coverageDomain,(l.sameGoalAs?'Повторение '+l.sameGoalAs+': ':'')+l.goal,l.requires.join(', ')].map(escape).join(' | ')+' |'),'','## Текущий исполняемый каталог','','Таблица — полный перечень существующих упражнений и наблюдаемых данных. Подробное происхождение проверяется небольшими партиями; наличие истории не является обязательным признаком качества.','', '| ID | Урок | Этап | Действий | Явные пальцы | MIDI-челлендж | Происхождение |','| --- | --- | --- | ---: | --- | --- | --- |',...report.lessons.map(l=>'| '+[l.id,l.title,l.stage,l.actions,l.explicitFingers?'да':'автоматическая рекомендация',l.challenge?'доступен':'практика',l.structuredProvenance?'описано':'нужна редактура'].map(escape).join(' | ')+' |'),'','Следующая партия: '+report.nextAction,'','Удержанные голоса и педаль требуют расширения модели до зачёта.',''];
 const insertAt=lines.indexOf('## Текущий исполняемый каталог');
 lines.splice(insertAt,0,'## Контрольные записи','',`Явных составных контролей: **${report.counts.explicitCheckpoints}**. Они соединяют уже подготовленные компоненты, сохраняются в каталоге и прогрессе, но не прибавляются к числу самостоятельных целей. Верхняя граница учитывает и повторения одной цели, и эти контрольные записи.`,'','| Контроль | Подготовка по ID |','| --- | --- |',...report.checkpointLessonIds.map(id=>{const l=report.lessons.find(l=>l.id===id);return '| '+[id,l.requires.join(', ')].map(escape).join(' | ')+' |';}),'');
 lines.splice(insertAt,0,'## Повторения одной цели','',`Явных вариантов повторения основного урока: **${report.counts.explicitSameGoalVariants}**. С учётом этих связей и явных контрольных записей в каталоге не более **${report.counts.goalGroupUpperBound}** групп целей; это верхняя граница, не проверенное число самостоятельных уроков. Дальнейшее сравнение может выявить другие совпадения. Число подтверждённых различных целей пока не установлено. ID, редакции и результаты вариантов сохраняются отдельно.`,'','| Основной разбор | Записи той же цели |','| --- | --- |',...report.sameGoalGroups.map(g=>'| '+[g.primaryId,g.lessonIds.join(', ')].map(escape).join(' | ')+' |'),'');
 lines.splice(insertAt,0,'## Конкретные будущие уроки','',`Отдельно спланировано **${report.counts.plannedFutureLessons}** будущих упражнений. Они не зарегистрированы в приложении, не включены в ${report.counts.implementedLearningLessons} готовых и требуют проверки источников, нот, движений, ритма и переноса перед внедрением. Наличие в плане не означает проверенного статуса.`,'','| ID | Задача | Пальцы и рука | Подготовка |','| --- | --- | --- | --- |',...report.plannedLessons.map(l=>'| '+[l.id,l.goal,plannedFingering(l),l.requires.join(', ')].map(escape).join(' | ')+' |'),'');
 fs.writeFileSync(path.join(ROOT,'docs/PIANO_SKILL_COVERAGE.md'),lines.join('\n'));
}
if(require.main===module){const r=build();write(r);console.log(JSON.stringify({counts:r.counts,capacitySlots:r.capacitySlots,targetMinimum:r.targetMinimum}));}
module.exports={build,write,validateMappedLessons,plannedFingering,sameGoalGroups,goalAccounting};
