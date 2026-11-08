(function(){
  'use strict';
  if(window.PBT_RUNTIME?.serviceVersion!==1){location.replace('trainer.html'+location.search);return;}
  const query=new URLSearchParams(location.search);
  if(['privateMelody','publication','section','lesson'].some(key=>query.has(key))){location.replace('trainer.html'+location.search);return;}
  const $=id=>document.getElementById(id),R=window.LessonRating;
  let course=null,learning=null,chapter='',shown=20,selected=null,myRating=null,detailRequest=0;
  const commentPages=new Map();
  function element(tag,text,attributes={}){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;}
  function message(text,bad=false){$('page-status').textContent=text;$('page-status').style.color=bad?'var(--coral)':'var(--mint)';}
  const client=window.MelodiaService.create({fetch:window.fetch.bind(window),storage:window.localStorage,locks:navigator.locks,
    channelFactory:typeof BroadcastChannel==='function'?()=>new BroadcastChannel('melodiajest-auth-v1'):null,
    onAccountChange(){learning=null;for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();renderProgress();renderRoute();message('Аккаунт изменился. Перезагрузи страницу, чтобы продолжить в новом аккаунте.',true);}});
  const signedIn=()=>Boolean(client.status().user&&!client.status().locked);
  const row=id=>course?.lessons.find(item=>item.id===id);
  const passed=item=>learning?.progress.some(value=>value.lessonId===item.id&&value.musicVersion===item.musicVersion);
  function available(item){if(!item.challengeReady)return false;if(!signedIn())return false;if(learning?.preferences.courseMode==='free')return true;return passed(item)||item.id===learning?.nextLessonId;}
  const playUrl=item=>'trainer.html?lesson='+encodeURIComponent(item.id)+(available(item)?'&challenge=1':'');
  const plural=(n,one,few,many)=>n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many;
  const average=value=>value?new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value.decimalTen)+' / 10 · '+value.count+' '+plural(value.count,'оценка','оценки','оценок'):'Пока без оценок';
  async function busy(form,fn,statusId){const buttons=[...form.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);form.setAttribute('aria-busy','true');try{await fn();}catch(error){if(statusId)$(statusId).textContent=error.message;else message(error.message,true);}finally{buttons.forEach(button=>button.disabled=false);form.removeAttribute('aria-busy');}}
  function renderProgress(){
    const user=client.status().user;$('account-link').replaceChildren(document.createTextNode(signedIn()?user.displayName:'Войти'),element('span','↗',{'aria-hidden':'true'}));
    if(learning){
      const portal=learning.experience.portal,linked=portal.totalXp!==null;$('level-kind').textContent=linked?'LVL':'XP';$('music-level').textContent=linked?String(portal.level):'♪';$('xp-heading').textContent=linked?'Общий опыт портала':'Твой музыкальный вклад';$('xp-total').textContent=(linked?portal.totalXp:learning.experience.musicXp)+' XP';$('xp-progress').hidden=!linked;
      if(linked)$('xp-progress').value=window.PortalExperience.level(portal.totalXp).progress;
      $('xp-caption').textContent=linked?'Последнее подтверждение общего уровня: '+new Date(portal.checkedAt).toLocaleString('ru-RU'):'Опыт за уроки сохранён. Общий LVL станет доступен после явной SSO-связи аккаунтов.';
      $('completed-count').textContent=learning.completed+' / '+learning.total;$('completed-caption').textContent='шагов пройдено';
      $('mode-description').textContent=learning.preferences.courseMode==='free'?'Свободный маршрут: выбирай нужный навык.':'По порядку: каждый шаг готовит следующий.';
    }else{$('level-kind').textContent='XP';$('music-level').textContent='♪';$('xp-heading').textContent='Твоя музыкальная история';$('xp-total').textContent='Прогресс в аккаунте';$('xp-progress').hidden=true;$('xp-caption').textContent='Войди: сохраняй результаты, возвращайся к ним с другого устройства.';$('completed-count').textContent='—';$('completed-caption').textContent='шагов пройдено';}
    const next=row(learning?.nextLessonId||course?.route[0]);if(next){$('continue-link').href=playUrl(next);$('continue-link').firstChild.textContent=signedIn()?'Продолжить игру ':'Попробовать пианино ';$('hero-foot').textContent=(learning?.completed?'Следующий шаг: ':'Начни здесь: ')+next.title+' · '+(next.bpm||'—')+' BPM';}
    $('history-open').disabled=!signedIn();
  }
  function routeIds(){return course?.route.filter(id=>row(id)?.stage===chapter)||[];}
  function renderRoute(){
    if(!course)return;const ids=routeIds(),first=row(ids[0]),list=$('route-list');list.replaceChildren();$('chapter-title').textContent=first?.stageTitle?.replace(/^\d+\.\s*/,'')||'Выбери главу';
    const stageIndex=[...new Set(course.route.map(id=>row(id).stage))].indexOf(chapter)+1;$('chapter-number').textContent='ГЛАВА '+String(stageIndex).padStart(2,'0');
    for(const id of ids.slice(0,shown)){
      const item=row(id),complete=passed(item),current=id===learning?.nextLessonId||(!learning&&id===course.route[0]),open=available(item),index=course.route.indexOf(id)+1;
      const li=element('li',undefined,{class:'route-step '+(complete?'passed':current?'current':open?'available':'locked')});if(current)li.setAttribute('aria-current','step');
      const symbol=complete?'✓':String(index).padStart(2,'0');li.append(element('span',symbol,{class:'route-note','aria-label':complete?'Пройден':current?'Следующий шаг':'Шаг '+index}));
      const card=element('article',undefined,{class:'route-card'}),copy=element('div'),title=element('h3'),detail=element('button',item.title,{type:'button',class:'lesson-detail-button'});detail.onclick=()=>void openLesson(item);title.append(detail);copy.append(title);
      const meta=element('div',undefined,{class:'route-meta'});meta.append(element('span',item.bpm+' BPM'),element('span',complete?'Пройдено':current?'Твой следующий звук':open?'Доступен':'Впереди'),element('span',item.rating?average(item.rating):'Без оценок'));copy.append(meta);card.append(copy);
      if(open||(!signedIn()&&current)){card.append(element('a',complete?'Повторить':'Играть ↗',{class:'route-play',href:playUrl(item)}));}
      else{const locked=element('button','♧',{class:'route-play',type:'button',disabled:'','aria-label':'Урок откроется после предыдущего шага',title:'Сначала пройди предыдущий шаг'});locked.textContent='Закрыт';card.append(locked);}
      li.append(card);list.append(li);
    }
    $('route-more').hidden=shown>=ids.length;
  }
  function populateChapters(){
    const seen=new Set();$('chapter-select').replaceChildren();
    for(const id of course.route){const item=row(id);if(seen.has(item.stage))continue;seen.add(item.stage);$('chapter-select').append(element('option',item.stageTitle,{value:item.stage}));}
    chapter=chapter||row(learning?.nextLessonId||course.route[0]).stage;$('chapter-select').value=chapter;
    $('course-count').textContent=course.counts.learning+' '+plural(course.counts.learning,'урок','урока','уроков')+' в курсе · '+course.counts.graded+' MIDI-испытаний';
  }
  async function refresh(){
    const [catalog]=await Promise.all([client.api('/course',{publicRequest:true}),client.init()]);course=catalog;
    learning=signedIn()?await client.api('/learning/state'):null;populateChapters();renderProgress();renderRoute();
  }
  async function showSettings(){
    if(!signedIn()){location.href='account.html';return;}
    const prefs=learning.preferences;$('settings-form').elements.courseMode.value=prefs.courseMode;$('rating-system').value=prefs.ratingSystem;$('settings-status').textContent='';$('settings-dialog').showModal();
  }
  function showRatingInput(){
    const system=learning?.preferences.ratingSystem||'ten',meta=R.META[system],value=R.valueFor(myRating?.rating,system);let input;
    if(meta.values){input=element('select',undefined,{id:'rating-value',name:'value',required:''});input.append(element('option','Выбери оценку',{value:''}));for(const v of meta.values)input.append(element('option',R.format(system,v),{value:v}));}
    else input=element('input',undefined,{id:'rating-value',name:'value',type:'number',min:meta.min,max:meta.max,step:meta.step,required:'',inputmode:system==='ten_decimal'?'decimal':'numeric'});
    input.value=value===null?'':String(value);input.disabled=!signedIn();$('rating-input-wrap').replaceChildren(input);
    for(const button of $('rating-form').querySelectorAll('button'))button.disabled=!signedIn();$('rating-remove').disabled=!myRating?.rating||!signedIn();
  }
  async function openLesson(item){
    selected=item;myRating=null;const request=++detailRequest;$('detail-title').textContent=item.title;$('detail-goal').textContent=item.goal||item.description;$('detail-average').textContent=average(item.rating);$('lesson-social-status').textContent='';
    const open=available(item)||(!signedIn()&&item.id===course.route[0]);$('detail-play').hidden=!open;$('detail-play').href=playUrl(item);$('detail-state').textContent=passed(item)?'Пройдено. Повтор развивает навык; опыт даётся только за улучшение.':open?'Один чистый дубль открывает следующий шаг.':'Пройди предыдущий шаг. Свободный маршрут можно выбрать в настройках.';
    showRatingInput();$('lesson-comment-form').hidden=!signedIn();$('lesson-comments').replaceChildren();if(!$('lesson-dialog').open)$('lesson-dialog').showModal();
    try{
      const [rating]=await Promise.all([signedIn()?client.api('/lessons/'+encodeURIComponent(item.id)+'/rating'):null,loadComments('lesson',item.id,true)]);
      if(request!==detailRequest)return;myRating=rating;showRatingInput();
    }catch(error){if(request===detailRequest)$('lesson-social-status').textContent=error.message;}
  }
  async function saveRating(remove=false){
    if(!selected||!signedIn()||!myRating)throw Error('Сначала дождись загрузки своей оценки.');
    const item=selected,system=learning.preferences.ratingSystem,input=$('rating-value'),value=remove?null:input.value;
    const saved=await client.api('/lessons/'+encodeURIComponent(item.id)+'/rating',{method:'PUT',data:{editionVersion:item.editionVersion,expectedRevision:myRating.revision,system,value,operationId:crypto.randomUUID()}});
    if(selected?.id!==item.id)return;myRating=saved;item.rating=saved.average;$('detail-average').textContent=average(saved.average);$('lesson-social-status').textContent=remove?'Оценка убрана. История сохранена.':'Оценка сохранена.';showRatingInput();renderRoute();
  }
  function commentCard(item,topic){
    const card=element('article',undefined,{class:'comment-card'}),meta=element('div',undefined,{class:'comment-meta'});meta.append(element('strong',item.author),element('time',new Date(item.createdAt).toLocaleString('ru-RU'),{datetime:new Date(item.createdAt).toISOString()}));if(item.revision>1)meta.append(element('span',item.deleted?'Удалён':'Изменён'));card.append(meta);if(item.parentId)card.append(element('span','Ответ в обсуждении',{class:'reply-label'}));card.append(element('p',item.body));
    if(item.mine&&signedIn()&&!item.deleted){const actions=element('div',undefined,{class:'small-actions'}),edit=element('button','Изменить',{type:'button',class:'quiet-action'}),remove=element('button','Удалить',{type:'button',class:'quiet-action'});actions.append(edit,remove);card.append(actions);
      edit.onclick=()=>{
        const form=element('form'),label=element('label','Редакция комментария'),input=element('textarea',undefined,{maxlength:4000,rows:3,required:'','aria-label':'Новый текст комментария'}),save=element('button','Сохранить',{type:'submit',class:'small-action'}),cancel=element('button','Отмена',{type:'button',class:'quiet-action'});input.value=item.body;form.append(label,input,save,cancel);card.append(form);actions.hidden=true;input.focus();cancel.onclick=()=>{form.remove();actions.hidden=false;edit.focus();};form.onsubmit=event=>{event.preventDefault();void busy(form,async()=>{await updateComment(item,input.value,false,topic);});};
      };
      remove.onclick=()=>{if(confirm('Удалить свой комментарий из обсуждения? История редакций сохранится.'))void busy(actions,()=>updateComment(item,'',true,topic));};
    }
    return card;
  }
  async function updateComment(item,body,deleted,topic){await client.api('/comments/'+item.id,{method:'PUT',data:{body,deleted,expectedRevision:item.revision,operationId:crypto.randomUUID()}});await loadComments(topic.scope,topic.lessonId,true);}
  async function loadComments(scope,lessonId='',reset=false){
    const key=scope+':'+lessonId,container=scope==='global'?$('global-comments'):$('lesson-comments'),more=scope==='global'?$('global-more'):$('lesson-comments-more'),page=reset?{cursor:null}:commentPages.get(key)||{cursor:null};
    const result=await client.api('/comments?scope='+scope+'&lessonId='+encodeURIComponent(lessonId)+(page.cursor?'&cursor='+encodeURIComponent(page.cursor):''),{publicRequest:true});
    if(scope==='lesson'&&selected?.id!==lessonId)return;
    if(reset)container.replaceChildren();for(const item of result.items)container.append(commentCard(item,{scope,lessonId}));if(!container.childNodes.length)container.append(element('p','Пока тихо. Начни разговор с вопроса или своим открытием.',{class:'form-note'}));commentPages.set(key,{cursor:result.nextCursor});more.hidden=!result.nextCursor;
  }
  async function postComment(scope){
    client.requireUser();const lessonId=scope==='lesson'?selected.id:'',input=scope==='lesson'?$('lesson-comment-body'):$('global-comment-body'),text=input.value;
    await client.api('/comments',{method:'POST',data:{scope,lessonId,parentId:null,body:text,operationId:crypto.randomUUID()}});if(input.value===text)input.value='';await loadComments(scope,lessonId,true);
    if(scope==='lesson')$('lesson-social-status').textContent='Комментарий опубликован.';else $('global-comment-note').textContent='Комментарий опубликован.';
  }
  async function history(){
    if(!signedIn())return;const result=await client.api('/learning/history');$('history-list').replaceChildren();for(const item of result.items){const card=element('article',undefined,{class:'history-item'});card.append(element('h3',row(item.lessonId)?.title||item.lessonId),element('p',new Date(item.startedAt).toLocaleString('ru-RU')+' · '+(item.result?.cancelled?'Отменена':item.status==='passed'?'Чистая попытка':item.status==='issued'?'Не завершена':'Нужен повтор')));
      if(item.result?.metrics){const metrics=item.result.metrics;card.append(element('p','Ноты '+metrics.notes+'% · пульс '+metrics.pulse+'% · удержания '+metrics.holds+'%'));}if(item.result?.xp){card.append(element('span','+'+item.result.xp.earned+' XP',{class:'earned'}),element('a','Открыть результат ↗',{class:'text-link',href:'trainer.html?lesson='+encodeURIComponent(item.lessonId)+'&attempt='+item.id}));}$('history-list').append(card);}
    if(!result.items.length)$('history-list').append(element('p','Твоя первая попытка ещё впереди.',{class:'form-note'}));$('history-dialog').showModal();
  }
  function setSection(){const community=location.hash==='#community';$('course-view').hidden=community;$('community-view').hidden=!community;for(const [id,active]of [['nav-course',!community],['nav-community',community]]){if(active)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');}if(community)void loadComments('global','',true).catch(error=>message(error.message,true));}
  for(const system of R.SYSTEMS)$('rating-system').append(element('option',R.META[system].label,{value:system}));
  for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
  $('settings-open').onclick=()=>void showSettings();$('history-open').onclick=()=>void history().catch(error=>message(error.message,true));
  $('chapter-select').onchange=event=>{chapter=event.target.value;shown=20;renderRoute();};$('route-more').onclick=()=>{shown+=20;renderRoute();};
  $('settings-form').onsubmit=event=>{event.preventDefault();void busy(event.currentTarget,async()=>{const prefs=await client.api('/learning/preferences',{method:'PUT',data:{courseMode:event.target.elements.courseMode.value,ratingSystem:$('rating-system').value,expectedRevision:learning.preferences.revision,operationId:crypto.randomUUID()}});learning.preferences=prefs;$('settings-status').textContent='Сохранено в аккаунте.';renderProgress();renderRoute();},'settings-status');};
  $('rating-form').onsubmit=event=>{event.preventDefault();void busy(event.currentTarget,()=>saveRating(false),'lesson-social-status');};$('rating-remove').onclick=()=>void busy($('rating-form'),()=>saveRating(true),'lesson-social-status');
  $('global-comment-form').onsubmit=event=>{event.preventDefault();void busy(event.currentTarget,()=>postComment('global'));};$('lesson-comment-form').onsubmit=event=>{event.preventDefault();void busy(event.currentTarget,()=>postComment('lesson'),'lesson-social-status');};
  $('global-more').onclick=()=>void loadComments('global').catch(error=>message(error.message,true));$('lesson-comments-more').onclick=()=>void loadComments('lesson',selected.id).catch(error=>{$('lesson-social-status').textContent=error.message;});
  window.addEventListener('hashchange',setSection);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void client.checkSession();});
  void refresh().then(()=>{$('global-comment-form').hidden=!signedIn();$('global-comment-note').textContent=signedIn()?'Публичный комментарий от '+client.status().user.displayName+'.':'Для комментария нужно войти в аккаунт.';setSection();const discussion=row(query.get('lessonDiscussion'));if(discussion)void openLesson(discussion);if(query.get('settings')==='1')void showSettings();}).catch(error=>{message(error.message+' Обнови страницу, чтобы повторить загрузку.',true);setSection();});
})();
