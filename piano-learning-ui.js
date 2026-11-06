(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PianoLearningUI=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const MODES=Object.freeze(['compact','expanded','hidden']);
  const actionNumber=new Intl.NumberFormat('ru-RU'),actionPlural=new Intl.PluralRules('ru-RU');
  function actionCountText(value){
    if(!Number.isSafeInteger(value)||value<0)return '';
    return actionNumber.format(value)+' '+({one:'действие',few:'действия',many:'действий',other:'действия'}[actionPlural.select(value)]);
  }
  const beatNumber=new Intl.NumberFormat('ru-RU',{maximumSignificantDigits:6}),beatPlural=new Intl.PluralRules('ru-RU',{maximumSignificantDigits:6});
  // Stored durationBeats are quarter-note units, independently of the meter denominator.
  // These are duration equivalences, not notation/quantization inferred from performance.
  const namedDurations=[
    [.125,'𝅘𝅥𝅰 тридцать вторая'],[.1875,'𝅘𝅥𝅰· тридцать вторая с точкой'],
    [.25,'𝅘𝅥𝅯 шестнадцатая'],[.375,'𝅘𝅥𝅯· шестнадцатая с точкой'],
    [.5,'♪ восьмая'],[.75,'♪· восьмая с точкой'],
    [1,'♩ четверть'],[1.5,'♩· четверть с точкой'],
    [2,'𝅗𝅥 половинная'],[3,'𝅗𝅥· половинная с точкой'],
    [4,'𝅝 целая'],[6,'𝅝· целая с точкой']
  ];
  function rhythmDurationView(value){
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return {label:'Длительность не задана',beatsText:'',symbol:null,named:false,valid:false};
    // Permit floating-point arithmetic noise only, never a pedagogical timing tolerance.
    const named=namedDurations.find(([beats])=>Math.abs(beats-value)<=Number.EPSILON*8*Math.max(1,beats,value));
    const shown=named?named[0]:value,approximate=!named&&Number(shown.toPrecision(6))!==shown;
    const unit={one:'доля',few:'доли',many:'долей',other:'доли'}[beatPlural.select(shown)];
    const beatsText=(approximate?'≈':'')+beatNumber.format(shown)+' '+unit;
    return {label:named?named[1]:beatsText,beatsText,symbol:named?named[1].split(' ')[0]:null,named:!!named,valid:true};
  }
  function rhythmTimingView(step,previous,sourceBpm,practiceBpm){
    const positive=v=>Number.isFinite(v)&&v>0,nonnegative=v=>Number.isFinite(v)&&v>=0;
    const bpm=positive(practiceBpm)?practiceBpm:positive(sourceBpm)?sourceBpm:null,beatMs=bpm?60000/bpm:null;
    if(!step||typeof step!=='object'||!bpm)return {bpm,beatMs,durationMs:null,restMs:null};
    const ratio=positive(sourceBpm)?sourceBpm/bpm:null;
    const durationMs=positive(step.durationBeats)?Math.max(1,Math.round(step.durationBeats*beatMs)):positive(step.sourceDurationMs)&&ratio?Math.max(1,Math.round(step.sourceDurationMs*ratio)):null;
    let sourceRest=null;
    if(nonnegative(step.sourceStartMs)){
      if(!previous)sourceRest=step.sourceStartMs;
      else if(nonnegative(previous.sourceStartMs)&&nonnegative(previous.sourceDurationMs))sourceRest=Math.max(0,step.sourceStartMs-previous.sourceStartMs-previous.sourceDurationMs);
    }
    const restMs=nonnegative(step.restBeforeBeats)?Math.round(step.restBeforeBeats*beatMs):sourceRest!==null&&ratio?Math.round(sourceRest*ratio):null;
    return {bpm,beatMs,durationMs,restMs};
  }
  function normalizeMode(value){return MODES.includes(value)?value:'compact';}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function controlsHtml(value,memory=false){
    const mode=normalizeMode(value);
    return '<label class="learning-view-choice" for="learning-material-mode">Разбор <select id="learning-material-mode" name="learningMaterialMode" aria-label="Вид учебного разбора"'+(memory?' disabled title="В попытке из памяти подсказки скрыты"':'')+'>'+MODES.map((m,i)=>'<option value="'+m+'"'+(mode===m?' selected':'')+'>'+['Кратко','Развёрнуто','Скрыто'][i]+'</option>').join('')+'</select></label>';
  }
  // renderBody is deliberately lazy: hidden/compact modes do not construct long lesson HTML.
  function materialHtml({mode,memory=false,preview='',renderBody}){
    mode=normalizeMode(mode);
    if(memory||mode==='hidden') return '';
    if(mode==='compact') return '<section class="piano-learning-card" aria-label="Краткий разбор урока"><button type="button" id="learning-material-toggle" class="learning-preview-button" data-learning-material-toggle aria-expanded="false" aria-controls="learning-material-body"><span class="learning-preview-text">'+escapeHtml(preview||'Разбери короткую группу медленно, затем соедини фразу. Открой подготовку и рекомендации к уроку.')+'</span><span class="learning-disclosure-label">Развернуть разбор <span aria-hidden="true">↗</span></span></button><div id="learning-material-body" hidden></div></section>';
    return '<section class="piano-learning-card is-expanded" aria-label="Полный разбор урока"><button type="button" id="learning-material-toggle" class="learning-collapse-button" data-learning-material-toggle aria-expanded="true" aria-controls="learning-material-body">Свернуть разбор <span aria-hidden="true">↑</span></button><div class="learning-material-body" id="learning-material-body">'+renderBody()+'</div></section>';
  }
  // Reuse the existing, escaped shared presenter without changing the guitar contract.
  function unwrapMaterial(html){return html.replace(/^<details class="learning-material"><summary>[^<]*<\/summary>/,'').replace(/<\/details>$/,'');}
  function preparationHtml(items){
    if(!items.length)return '';
    return '<nav class="learning-preparations" aria-label="Подготовка к уроку"><p>Открыть подготовительный урок</p><div>'+items.map(item=>'<button type="button" data-learning-prerequisite="'+escapeHtml(item.id)+'">'+escapeHtml(item.title)+'</button>').join('')+'</div></nav>';
  }
  function repeatedNoteHtml(currentMidis,previousMidis){
    if(currentMidis.length!==1||previousMidis.length!==1||currentMidis[0]!==previousMidis[0])return '';
    return '<p class="hint repeated-note-hint"><b>Повтор звука:</b> отпусти клавишу и нажми заново. Удержание не заменяет новый звук.</p>';
  }
  function sameGoalHtml(item){
    if(!item)return '';
    return '<nav class="learning-preparations learning-goal-relation" aria-label="Повторение навыка"><p>Здесь закрепляется тот же навык. Открыть основной разбор:</p><button type="button" data-learning-prerequisite="'+escapeHtml(item.id)+'">'+escapeHtml(item.title)+'</button></nav>';
  }
  function checkpointHtml(role){
    return role==='checkpoint-only'?'<p class="hint learning-checkpoint-note"><b>Контроль знакомых навыков.</b> Здесь соединяются подготовленные задания. Эта запись не добавляет новую самостоятельную цель; начни с подготовки той части, которая пока не получается.</p>':'';
  }
  function dottedQuarterHtml(durationBeats,beatDenominator){
    if(beatDenominator!==4||Math.abs(durationBeats-1.5)>1e-6||!Number.isFinite(durationBeats))return '';
    return '<p class="hint dotted-quarter-hint"><b>Четверть с точкой:</b> полторы доли, как три равные восьмые. Продолжай ровный счёт.</p>';
  }
  function memoryAssistanceText(assisted){
    return assisted?'В этой попытке использована подсказка. Зачёт памяти не записывается; начни заново без подсказок.':'';
  }
  function positionChangeHtml(cues,stepIndex){
    if(!Array.isArray(cues)||!Number.isInteger(stepIndex)||stepIndex<0)return '';
    const cue=cues.find(c=>c&&c.stepIndex===stepIndex&&typeof c.text==='string'&&c.text.trim());
    return cue?'<p class="hint position-change-hint"><b>Смена позиции:</b> '+escapeHtml(cue.text)+'</p>':'';
  }
  function wholeNoteHtml(durationBeats,numerator,denominator){
    if(numerator!==4||denominator!==4||!Number.isFinite(durationBeats)||Math.abs(durationBeats-4)>1e-6)return '';
    return '<p class="hint whole-note-hint"><b>Целая в 4/4:</b> один звук на «раз, два, три, четыре». Отпусти у следующего «раз»; новые удары внутри удержания не нужны.</p>';
  }
  function handHandoffHtml(profile,previousHand,currentHand){
    if(profile!=='sequential-release'||!['left','right'].includes(previousHand)||!['left','right'].includes(currentHand)||previousHand===currentHand)return '';
    const names={left:'левая',right:'правая'};
    return '<p class="hint hand-handoff-hint"><b>Смена рук: '+names[previousHand]+' → '+names[currentHand]+'.</b> Закончи звук прежней руки у вступления новой. Здесь руки играют по очереди, без удержания прежней клавиши.</p>';
  }
  function chordReleaseHtml(timingPrecision,midis){
    if(timingPrecision!=='beat-boundary-v2'||!Array.isArray(midis)||midis.length<2||midis.length>10||new Set(midis).size!==midis.length||midis.some(n=>!Number.isInteger(n)||n<0||n>127))return '';
    return '<p class="hint chord-release-hint"><b>Созвучие целиком:</b> удерживай все звуки до указанного конца и отпусти вместе. Один оставшийся или рано снятый звук меняет окончание.</p>';
  }
  function flatNameHtml(profile,midis){
    if(profile!=='flat-alias-v1'||!Array.isArray(midis)||midis.length!==1||!Number.isInteger(midis[0])||midis[0]<0||midis[0]>127)return '';
    const names={1:['D♭','C#'],3:['E♭','D#'],6:['G♭','F#'],8:['A♭','G#'],10:['B♭','A#']}[midis[0]%12];if(!names)return '';
    const octave=Math.floor(midis[0]/12)-1;
    return '<p class="hint flat-name-hint"><b>Название ноты:</b> '+names[0]+octave+' и '+names[1]+octave+' — одна клавиша в этом упражнении.</p>';
  }
  function blindPracticeHtml(enabled,mode,eligible){
    if(enabled!==true||!['practice','challenge'].includes(mode))return '';
    return '<div class="blind-practice-notice"><p role="status" aria-live="polite">Без взгляда на руки: экранные подсказки остаются. '+(eligible===true?'Для памяти выбери отдельный режим по MIDI.':'Зачёт памяти станет доступен после подготовки учебных данных.')+'</p>'+(eligible===true?'<button type="button" class="mini-btn" id="start-memory-check">Проверить память по MIDI</button>':'')+'</div>';
  }
  return {MODES,normalizeMode,actionCountText,rhythmDurationView,rhythmTimingView,controlsHtml,materialHtml,unwrapMaterial,preparationHtml,repeatedNoteHtml,sameGoalHtml,checkpointHtml,dottedQuarterHtml,memoryAssistanceText,positionChangeHtml,wholeNoteHtml,handHandoffHtml,chordReleaseHtml,flatNameHtml,blindPracticeHtml};
});
