(function(root){
  'use strict';
  function create({client,readTrainer,prepareTrainer,render}){
    let course=null,learning=null,result=null,notice='',preparing=false,focusResult=false;
    const openingQuery=new URLSearchParams(root.location.search);
    let catalogVisible=openingQuery.get('challenge')!=='1'&&!/^[a-f0-9-]{36}$/.test(openingQuery.get('attempt')||''),advancedOpen=false;
    const capture=root.MelodiaLearning.create({client,requireLocks:true,onChange(){mount();}}),escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const current=()=>course?.lessons.find(row=>row.id===readTrainer().lessonId);
    function active(){const saved=capture.status().pending,t=readTrainer();return capture.status().ready&&saved?.attempt.lessonId===t.lessonId&&saved.attempt.gradeFingerprint===t.fingerprint;}
    async function load(){course=await client.api('/course',{publicRequest:true});if(client.status().user){learning=await client.api('/learning/state');try{capture.read();const id=new URLSearchParams(root.location.search).get('attempt');if(id&&/^[a-f0-9-]{36}$/.test(id)){const saved=await client.api('/learning/attempts/'+id);if(saved.lessonId===readTrainer().lessonId&&saved.result)result=saved.result;}}catch(error){notice=error.message;}}root.document.body.classList.add('game-player');mount();}
    async function start(){
      if(!client.status().user){root.location.href='account.html';return;}
      if(capture.status().pending){notice='Есть предыдущая запись. Проверь сохранение или отмени незавершённую попытку.';mount();return;}
      if(!readTrainer().midiConnected)throw Error('Подключи MIDI-пианино для испытания. Виртуальные клавиши доступны для предварительного разбора.');
      const row=current(),trainer=readTrainer();if(!row?.challengeReady)throw Error('Этот материал пока доступен для практики.');if(row.gradeFingerprint!==trainer.fingerprint)throw Error('В личной редакции изменены ноты или учебные параметры. Для XP открой исходный урок из маршрута.');
      preparing=true;notice='Открываем попытку на сервере…';mount();
      try{const attempt=await capture.start(row,trainer.mode==='memory'?'memory':'challenge');result=null;prepareTrainer(attempt);notice='Готово. Первая нота запускает пульс. После фразы дождись сохранения.';}
      finally{preparing=false;mount();}
    }
    async function complete(input){
      if(!active())return null;notice='Проверяем запись и сохраняем результат…';mount();
      try{result=await capture.submit(input);notice='Результат сохранён в аккаунте.';focusResult=true;try{learning=await client.api('/learning/state');}catch{notice='Результат сохранён; обновление маршрута пока недоступно.';}return result;}
      catch(error){notice=error.message+' Запись сохранена для повтора отправки.';throw error;}finally{mount();}
    }
    function resetLocal(){if(preparing||!capture.status().ready)return;notice='Незавершённая попытка отменяется…';void capture.cancel().then(()=>{notice='Можно открыть новую попытку.';mount();}).catch(error=>{notice=error.message;mount();});}
    async function recover(){const restored=await capture.recover();if(restored?.result){result=restored.result;focusResult=true;notice='Сохранение подтверждено сервером.';learning=await client.api('/learning/state');}else if(restored?.expired){notice='Срок попытки закончился; сервер подтвердил, что результата нет. Можно скачать запись и отменить попытку.';}else if(restored?.attempt){const t=readTrainer();if(restored.attempt.lessonId===t.lessonId&&restored.attempt.gradeFingerprint===t.fingerprint){preparing=true;try{prepareTrainer(restored.attempt);}finally{preparing=false;}notice='Попытка восстановлена. Начни фразу сначала.';}else notice='Незавершённая попытка относится к другому уроку. Можно отменить её.';}mount();}
    function exportCopy(){const text=capture.exportPending(),url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='melodiajest-private-attempt.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    function panelHtml(){
      const t=readTrainer(),row=current(),pending=capture.status().pending,working=preparing||capture.status().busy,blind=t.mode==='memory'&&!t.completed;
      let html='<a class="player-course-return" href="/">← К моему маршруту</a>';
      if(result&&result.lessonId===t.lessonId){
        const xp=result.xp,metrics=result.metrics,passed=result.passed;
        html+='<section class="game-result" aria-label="Результат серверной проверки"><p class="eyebrow">'+(result.cancelled?'ПОПЫТКА ОТМЕНЕНА':'СОХРАНЕНО В АККАУНТЕ')+'</p><h2 class="result-heading" id="game-result-title" tabindex="-1">'+(passed?'Ещё один чистый звук.':result.cancelled?'Начни в своём ритме.':'Музыка любит повторение.')+'</h2><p class="reward-number">'+('+'+escape(xp.earned)+' XP')+'</p>';
        if(xp.earned>0)html+='<span class="level-up-notes" aria-hidden="true">♪ ♫</span>';
        if(metrics)html+='<div class="result-metrics">'+[['Ноты',metrics.notes],['Пульс',metrics.pulse],['Удержания',metrics.holds]].map(([title,value])=>'<div><span>'+title+'</span><strong>'+escape(value)+'%</strong></div>').join('')+'</div>';
        if(row&&result.musicVersion!==row.musicVersion)html+='<p class="result-note">Это результат прежней музыкальной редакции. История и полученный опыт сохранены; текущая редакция проверяется отдельно.</p>';
        html+='<p class="result-note">'+escape(result.assessment?.reasons?.join('. ')||(xp.earned?'Опыт зависит от точности пульса и отпусканий.':'Повтор этой цели уже учтён. Улучшение даёт только разницу до лучшего результата.'))+'</p><p class="result-note">MIDI не определяет пальцы, свободу движения и художественное качество. Общий LVL портала появится после SSO-связи.</p><div class="result-actions">';
        const next=learning?learning.nextLessonId:result.nextLessonId;if(passed&&next)html+='<a class="primary-action" href="trainer.html?lesson='+encodeURIComponent(next)+'&challenge=1">Продолжить маршрут ↗</a>';
        html+='<button type="button" class="small-action" id="game-try-again">Сыграть ещё раз</button><a href="/?lessonDiscussion='+encodeURIComponent(t.lessonId)+'">Оценить и обсудить урок ↗</a></div></section>';
      }else if(row){
        html+='<section class="game-status-panel" aria-label="Серверное испытание"><div><h2>'+(blind?'Игра из памяти':row.challengeReady?'Играй. Получай опыт. Расти.':'Практика нового навыка')+'</h2><p>'+escape(notice||(row.challengeReady?readTrainer().midiConnected?'Открой попытку: результат и опыт сохранятся в аккаунте.':'Подключи MIDI-пианино для испытания. Виртуальные клавиши — для разбора.':'Для этого материала ещё готовится автоматическая проверка.'))+'</p></div>';
        if(row.challengeReady&&!active())html+='<button type="button" class="'+(readTrainer().midiConnected?'primary-action':'small-action')+'" id="game-start" '+(working||pending||client.status().user&&!readTrainer().midiConnected?'disabled':'')+'>'+(client.status().user?'Начать испытание':'Войти для испытания')+'</button>';
        if(active())html+='<span class="form-note">'+(blind?'Запись из памяти готова':'Серверная попытка открыта')+'</span>';
        if(!blind&&row.gradeFingerprint!==t.fingerprint)html+='<a href="trainer.html?lesson='+encodeURIComponent(t.lessonId)+'&challenge=1">Открыть исходную учебную редакцию ↗</a>';
        html+='</section>';
      }
      if(pending&&!active())html+='<section class="game-status-panel"><div><h2>Есть незавершённая запись</h2><p>'+escape(notice||'Проверь результат до новой попытки. Смена аккаунта не переносит запись другому пользователю.')+'</p></div><div class="small-actions"><button type="button" id="game-recover" class="small-action" '+(working?'disabled':'')+'>Проверить / восстановить</button><button type="button" id="game-export" class="quiet-action">Скачать запись</button>'+(pending.kind!=='submitting'||pending.expiredConfirmed?'<button type="button" id="game-cancel" class="quiet-action" '+(working?'disabled':'')+'>Отменить попытку</button>':'')+'</div></section>';
      return html;
    }
    function mount(){
      const main=document.querySelector('main.main');if(!main||!course)return;
      let header=document.getElementById('player-site-head');
      if(!header){header=document.createElement('header');header.id='player-site-head';header.className='site-head';header.innerHTML='<a href="/" class="melodia-brand" translate="no"><svg viewBox="0 0 34 34" aria-hidden="true"><path d="M6 25V9h6v10h5V6h6v19h5V13"/></svg><span>Melodia<span class="brand-light">Jest</span></span></a><nav aria-label="Музыкальный сервис"><a href="/">Мой маршрут</a><a href="trainer.html?section=pieces">Произведения</a><button type="button" class="quiet-action" id="player-catalog-toggle" aria-controls="player-catalog">Каталог</button></nav><a class="account-link" href="account.html" id="player-identity"></a>';document.body.prepend(header);}
      document.getElementById('player-identity').textContent=client.status().user?.displayName||'Войти ↗';
      const sidebar=document.querySelector('.sidebar');if(sidebar){sidebar.id='player-catalog';sidebar.hidden=!catalogVisible;}const layout=document.querySelector('.layout');layout?.classList.toggle('catalog-closed',!catalogVisible);
      const toggle=document.getElementById('player-catalog-toggle');toggle.setAttribute('aria-expanded',String(catalogVisible));toggle.onclick=()=>{catalogVisible=!catalogVisible;mount();};
      const account=document.querySelector('#app > .catalog-save-notice'),status=client.status();if(account)account.hidden=!status.pending&&!status.locked&&(!status.notice||status.notice==='Сохранено в аккаунте');
      let settings=document.getElementById('player-advanced');if(!settings){settings=document.createElement('details');settings.id='player-advanced';settings.className='player-advanced';settings.open=advancedOpen;settings.innerHTML='<summary>Звук, MIDI и внешний вид тренажёра</summary>';settings.ontoggle=()=>{advancedOpen=settings.open;};for(const section of Array.from(main.children).filter(child=>child.matches('section.box')))settings.append(section);main.append(settings);}
      let node=document.getElementById('game-player-root');if(!node){node=document.createElement('div');node.id='game-player-root';main.prepend(node);}node.innerHTML=panelHtml();
      if(!readTrainer().midiConnected&&!readTrainer().completed){const target=node.querySelector('.game-status-panel');if(target&&!document.getElementById('game-midi-connect')){const button=document.createElement('button');button.type='button';button.id='game-midi-connect';button.className='primary-action';button.textContent='Подключить MIDI';target.append(button);button.onclick=()=>document.getElementById('midi-btn')?.click();}}
      function bind(id,fn){const button=document.getElementById(id);if(button)button.onclick=()=>void Promise.resolve().then(fn).catch(error=>{notice=error.message;mount();});}
      bind('game-start',start);bind('game-try-again',async()=>{result=null;await start();});bind('game-recover',recover);bind('game-export',exportCopy);bind('game-cancel',async()=>{const saved=await capture.cancel();if(saved?.result){result=saved.result;focusResult=true;}notice=saved?.result?.passed?'Результат уже был сохранён сервером.':'Незавершённая попытка отменена.';mount();});
      if(focusResult){document.getElementById('game-result-title')?.focus({preventScroll:false});focusResult=false;}
    }
    return {load,mount,active,complete,resetLocal,invalidateAccount:()=>capture.releaseOwnership(),status:()=>({learning,result,pending:capture.status().pending}),start};
  }
  root.PianoGamePlayer={create};
})(typeof window==='object'?window:globalThis);
