(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const items=new Map();let authKind='login',editing=null,draftEntry=null,imported=null,publishItem=null,dirty=false,recoveryCode='',publicOffset=0,preferenceBase=null,loadedAccount=null,melodyOperation=crypto.randomUUID(),feedbackOperation=crypto.randomUUID();
  const client=window.MelodiaService.create({fetch:window.fetch.bind(window),storage:window.localStorage,locks:navigator.locks,channelFactory:typeof BroadcastChannel==='function'?()=>new BroadcastChannel('melodiajest-auth-v1'):null,
    onStatus:s=>{if(s.notice)message(s.notice);$('pending-export').hidden=!s.pending||s.locked;},onAccountChange:()=>{
      $('private-workspace').hidden=true;$('recovery-result').hidden=true;$('recovery-code').value='';$('identity').textContent='Нужно войти заново';
      $('auth').hidden=false;$('logout').hidden=true;clearPrivateView();loadedAccount=null;
    }});
  function element(tag,text,attrs={}){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const[key,value]of Object.entries(attrs)){if(key==='class')node.className=value;else node.setAttribute(key,String(value));}return node;}
  function message(text,error=false){$('status').textContent=text;$('status').className='status'+(error?' error':'');}
  function errorMessage(error){message(error.message||'Не удалось выполнить действие. Сохрани черновик и повтори.',true);$('status').focus();}
  async function busy(form,fn){const buttons=[...form.querySelectorAll('button')];buttons.forEach(x=>x.disabled=true);form.setAttribute('aria-busy','true');try{await fn();}catch(error){errorMessage(error);}finally{buttons.forEach(x=>x.disabled=false);form.removeAttribute('aria-busy');}}
  function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=element('a',undefined,{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function showRecovery(code){if(!code)return;recoveryCode=code;$('recovery-code').value=code;$('recovery-result').hidden=false;$('recovery-title').setAttribute('tabindex','-1');$('recovery-title').focus();}
  function setAuth(kind){authKind=kind;for(const value of ['login','register','recover'])$('show-'+value).setAttribute('aria-pressed',String(value===kind));
    $('auth-form-title').textContent=kind==='register'?'Регистрация':kind==='recover'?'Восстановление доступа':'Вход';
    $('auth-submit').textContent=kind==='register'?'Создать аккаунт':kind==='recover'?'Восстановить доступ':'Войти';
    $('name-label').hidden=kind!=='register';$('display-name').required=kind==='register';$('recovery-label').hidden=kind!=='recover';$('recovery-input').required=kind==='recover';
    $('registration-note').hidden=kind!=='register';$('password-label').textContent=kind==='recover'?'Новый пароль':'Пароль';$('password').autocomplete=kind==='login'?'current-password':'new-password';$('password').minLength=kind==='login'?1:15;
  }
  function clearPrivateView(){items.clear();$('melody-list').replaceChildren();$('feedback-list').replaceChildren();$('feedback-form').reset();$('password-form').reset();$('preferences-form').reset();clearEditor();$('composer').hidden=true;preferenceBase=null;}
  async function workspace(){const state=client.status();$('auth').hidden=Boolean(state.user)&&!state.locked;$('private-workspace').hidden=true;$('logout').hidden=!state.user||state.locked;
    $('identity').textContent=state.user&&!state.locked?'Вход: '+state.user.displayName:'Гость';
    if(loadedAccount!==(state.user?.id||null)){clearPrivateView();loadedAccount=state.user?.id||null;}
    if(state.user&&!state.locked){await Promise.all([loadLibrary(),loadFeedback(),loadPreferences()]);if(!client.status().locked&&client.status().user?.id===state.user.id)$('private-workspace').hidden=false;}
  }
  async function loadLibrary(){const result=await client.api('/library');items.clear();$('melody-list').replaceChildren();for(const item of result.items){items.set(item.id,item);$('melody-list').append(melodyCard(item));}
    if(!result.items.length)$('melody-list').append(element('p','Пока нет своих мелодий. Добавь короткую фразу или перенеси запись из JSON каталога.'));
  }
  function action(text,fn){const button=element('button',text,{type:'button'});button.addEventListener('click',()=>void Promise.resolve().then(fn).catch(errorMessage));return button;}
  function melodyCard(item){const entry=item.data.entry,card=element('article',undefined,{class:'melody'});card.append(element('h3',entry.title));card.append(element('p',entry.description));
    card.append(element('p',item.publication?.visible?'Опубликована версия '+item.publication.melodyRevision+(item.publication.melodyRevision!==item.revision?' · есть новые личные правки':''):'Личная мелодия · версия '+item.revision,{class:'meta'}));
    const actions=element('div',undefined,{class:'actions'});actions.append(element('a','Играть',{href:'/?privateMelody='+encodeURIComponent(item.id)}),action('Редактировать',()=>openEditor(item)),action('Скачать JSON',()=>download('melodiajest-melody-'+item.id+'.json',JSON.stringify({version:1,kind:'melodiajest-private-melody',data:item.data},null,2)+'\n')),
      action(item.publication?.visible?'Обновить публикацию':'Опубликовать для всех',()=>openPublish(item)));
    if(item.publication?.visible)actions.append(action('Снять публикацию',async()=>{
      if(!confirm('Снять эту мелодию с общего доступа? Личная мелодия и история сохранятся.'))return;
      await client.api('/library/'+item.id+'/unpublish',{method:'POST',data:{expectedPublicationRevision:item.publication.revision}});await loadLibrary();await loadPublic(true);message('Публикация снята. Личная мелодия сохранена.');
    }));card.append(actions);return card;
  }
  function clearEditor(){editing=null;draftEntry=null;imported=null;melodyOperation=crypto.randomUUID();dirty=false;$('melody-form').reset();$('replace-notes-label').hidden=true;$('import-choice').replaceChildren();$('import-choice-label').hidden=true;$('use-import').hidden=true;}
  function openEditor(item=null){if(dirty&&!confirm('Оставить текущий черновик? Сначала можно скачать его JSON.'))return;clearEditor();editing=item;draftEntry=item?JSON.parse(JSON.stringify(item.data.entry)):null;
    $('composer-title').textContent=item?'Редактировать личную мелодию':'Новая мелодия';$('melody-title').value=draftEntry?.title||'';$('melody-description').value=draftEntry?.description||'';$('melody-pattern').value=draftEntry?.pattern||'';
    $('melody-origin').value=item?.data.origin||'original';$('melody-source').value=item?.data.source||'';$('composer').hidden=false;$('melody-title').focus();
  }
  function collectDraft({allowUnconfirmed=false}={}){
    const pattern=$('melody-pattern').value,changed=Boolean(draftEntry&&pattern!==draftEntry.pattern);
    if(changed&&!$('replace-notes').checked&&!allowUnconfirmed)throw Error('Подтверди замену нот без прежнего ритма и аппликатуры или верни исходные ноты.');
    let entry=draftEntry?JSON.parse(JSON.stringify(draftEntry)):{id:crypto.randomUUID(),themeId:'personal-melodies',contentKind:'piece',order:1,timeLimit:90,maxErrors:3,exam:false};
    if(changed){for(const key of ['rhythm','fingeringSpec','fingeringPlan','guide','learning','lessonReview'])delete entry[key];}
    Object.assign(entry,{title:$('melody-title').value.trim(),description:$('melody-description').value,pattern,contentKind:'piece'});
    return {entry,origin:$('melody-origin').value,source:$('melody-source').value};
  }
  function openPublish(item){publishItem=item;$('publication-preview').textContent=JSON.stringify(item.data,null,2);$('publication-rights').value='';$('publication-confirm').checked=false;$('publish-status').textContent='';$('publish-dialog').showModal();}
  async function loadPreferences(){const saved=await client.getObject('preferences');preferenceBase=saved;let raw={};try{raw=JSON.parse(saved.raw||'{}');}catch{}
    $('material-mode').value=['compact','expanded','hidden'].includes(raw.learningMaterialMode)?raw.learningMaterialMode:'compact';
  }
  async function loadFeedback(){const result=await client.api('/feedback');$('feedback-list').replaceChildren();for(const item of result.items){const entry=element('article',undefined,{class:'feedback-entry'});entry.append(element('h3',item.title),element('p',({received:'Получено',reviewing:'На проверке',resolved:'Исправлено',declined:'Отклонено'})[item.status]||'Получено'),element('p',item.body));$('feedback-list').append(entry);}}
  async function loadPublic(reset=false){if(reset){publicOffset=0;$('public-list').replaceChildren();}const result=await client.api('/publications?offset='+publicOffset,{publicRequest:true});
    if(reset&&!result.items.length)$('public-list').append(element('p','Пока нет опубликованных мелодий. Первые авторские версии появятся здесь.'));
    for(const item of result.items){const card=element('article',undefined,{class:'melody'});card.append(element('h3',item.data.entry.title),element('p','Опубликовал: '+item.author,{class:'meta'}),element('p',item.data.entry.description),element('a','Открыть и играть',{href:'/?publication='+encodeURIComponent(item.id)}));$('public-list').append(card);}publicOffset=result.nextOffset;$('more-public').hidden=result.items.length<20;
  }
  for(const kind of ['login','register','recover'])$('show-'+kind).addEventListener('click',()=>setAuth(kind));
  $('auth-form').addEventListener('submit',event=>{event.preventDefault();void busy(event.currentTarget,async()=>{
    const data={username:$('username').value,password:$('password').value};if(authKind==='register')data.displayName=$('display-name').value;if(authKind==='recover')data.recoveryCode=$('recovery-input').value;
    const result=await client.auth(authKind,data);$('password').value='';$('recovery-input').value='';showRecovery(result.recoveryCode);await workspace();message(authKind==='register'?'Аккаунт создан. Сохрани резервный код.':'Вход выполнен.');
  });});
  $('logout').addEventListener('click',()=>void busy($('auth-form'),async()=>{
    if(dirty)throw Error('Сначала сохрани или скачай черновик мелодии.');await client.logout();recoveryCode='';$('recovery-result').hidden=true;$('recovery-code').value='';clearEditor();$('composer').hidden=true;await workspace();message('Вы вышли из аккаунта. Личные данные сохранены.');
  }));
  $('download-recovery').addEventListener('click',()=>download('melodiajest-recovery.txt','MelodiaJest\nЛогин: '+client.status().user.username+'\nРезервный код: '+recoveryCode+'\nНе публикуйте этот файл.\n'));
  $('recovery-done').addEventListener('click',()=>{$('recovery-result').hidden=true;$('recovery-code').value='';recoveryCode='';});
  $('new-melody').addEventListener('click',()=>openEditor());$('cancel-melody').addEventListener('click',()=>{if(dirty&&!confirm('Закрыть черновик? Несохранённое можно сначала скачать в JSON.'))return;clearEditor();$('composer').hidden=true;$('new-melody').focus();});
  $('melody-form').addEventListener('input',()=>{dirty=true;$('replace-notes-label').hidden=!draftEntry||$('melody-pattern').value===draftEntry.pattern;});
  $('melody-form').addEventListener('submit',event=>{event.preventDefault();void busy(event.currentTarget,async()=>{
    const data=collectDraft();const saved=await client.api(editing?'/library/'+editing.id:'/library',{method:editing?'PUT':'POST',data:editing?{expectedRevision:editing.revision,data}:{data,operationId:melodyOperation}});
    dirty=false;editing=saved;draftEntry=JSON.parse(JSON.stringify(saved.data.entry));$('replace-notes').checked=false;$('replace-notes-label').hidden=true;await loadLibrary();message('Личная мелодия сохранена в аккаунте. Публикация — отдельное действие.');
  });});
  $('export-draft').addEventListener('click',()=>{try{download('melodiajest-private-draft.json',JSON.stringify({version:1,kind:'melodiajest-private-melody',data:collectDraft({allowUnconfirmed:true})},null,2)+'\n');}catch(error){errorMessage(error);}});
  $('catalog-file').addEventListener('change',()=>void busy($('melody-form'),async()=>{
    const file=$('catalog-file').files[0];if(!file)return;if(file.size>5*1024*1024)throw Error('Для импорта одной мелодии выбери JSON до 5 МБ.');const text=await file.text();let value;
    try{value=JSON.parse(text);}catch{throw Error('Файл не удалось прочитать как JSON.');}
    if(value.kind==='melodiajest-private-melody'&&value.version===1&&value.data?.entry){imported=[value.data];}
    else{const catalog=window.CatalogTransfer.read(text);imported=catalog.lessons.map(entry=>({entry,origin:'adaptation',source:'Импорт из личной копии каталога. Уточни исходный источник перед публикацией.'}));}
    $('import-choice').replaceChildren();imported.forEach((item,index)=>$('import-choice').append(element('option',item.entry.title,{value:index})));$('import-choice-label').hidden=false;$('use-import').hidden=false;
  }));
  $('use-import').addEventListener('click',()=>{const value=imported?.[Number($('import-choice').value)];if(!value)return;if(editing){errorMessage(Error('Импорт открывается как новая личная мелодия. Нажми «Добавить мелодию».'));return;}
    draftEntry=JSON.parse(JSON.stringify(value.entry));draftEntry.contentKind='piece';$('melody-title').value=draftEntry.title;$('melody-description').value=draftEntry.description;$('melody-pattern').value=draftEntry.pattern;$('melody-origin').value=value.origin;$('melody-source').value=value.source;dirty=true;message('Запись вставлена в черновик. Проверь её перед сохранением.');
  });
  $('publish-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;void busy(form,async()=>{
    const item=publishItem;if(!item)return;try{await client.api('/library/'+item.id+'/publish',{method:'POST',data:{expectedRevision:item.revision,expectedPublicationRevision:item.publication?.revision||0,rightsConfirmed:$('publication-confirm').checked,rights:$('publication-rights').value}});}
    catch(error){$('publish-status').textContent=error.message;throw error;}
    $('publish-dialog').close();await loadLibrary();await loadPublic(true);message('Мелодия опубликована для всех.');
  });});$('cancel-publish').addEventListener('click',()=>$('publish-dialog').close());
  $('preferences-form').addEventListener('submit',event=>{event.preventDefault();void busy(event.currentTarget,async()=>{
    const value=JSON.parse(preferenceBase?.raw||'{}');value.learningMaterialMode=$('material-mode').value;preferenceBase=await client.saveObject('preferences',JSON.stringify(value));message('Настройки сохранены в аккаунте.');
  });});
  $('feedback-form').addEventListener('submit',event=>{event.preventDefault();void busy(event.currentTarget,async()=>{
    await client.api('/feedback',{method:'POST',data:{title:$('feedback-title-input').value,body:$('feedback-body').value,target:$('feedback-target').value,operationId:feedbackOperation}});feedbackOperation=crypto.randomUUID();$('feedback-form').reset();await loadFeedback();message('Предложение получено. Оно доступно тебе и очереди проверки.');
  });});
  $('password-form').addEventListener('submit',event=>{event.preventDefault();void busy(event.currentTarget,async()=>{
    const result=await client.auth('password',{currentPassword:$('current-password').value,password:$('new-password').value});$('password-form').reset();showRecovery(result.recoveryCode);message('Пароль изменён. Старые сеансы завершены; сохрани новый резервный код.');
  });});
  $('more-public').addEventListener('click',()=>void loadPublic().catch(errorMessage));
  $('pending-export').addEventListener('click',()=>download('melodiajest-private-pending.json',client.pendingExport()));
  window.addEventListener('beforeunload',event=>{if(dirty||client.status().pending){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void client.checkSession();});
  (async()=>{setAuth('login');try{await client.init();await workspace();await loadPublic(true);if(!client.status().user)message('Войди или зарегистрируйся для личной библиотеки.');}catch(error){$('auth').hidden=true;$('identity').textContent='Вход временно недоступен';errorMessage(error);}})();
})();
