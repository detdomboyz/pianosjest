(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MelodiaService=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const API='/api/service/v1', UI_KEY='piano-blind-trainer-ui-v20';
  function create({fetch:request,storage,onStatus=()=>{},onAccountChange=()=>{},timeoutMs=15000,channelFactory=null,locks=null}){
    let user=null,csrf='',initialized=false,locked=false,notice='',jobs=0;
    const memory=new Map(),objects=new Map(),queues=new Map(),pending=new Map();
    const channel=channelFactory?channelFactory():null;
    if(channel)channel.onmessage=()=>{void checkSession();};
    const status=()=>({user,initialized,locked,notice,pending:pending.size>0,saving:jobs>0});
    const notify=()=>onStatus(status());
    const sessionLock=fn=>locks&&typeof locks.request==='function'?locks.request('melodiajest:account-session-v1',{mode:'exclusive'},fn):fn();
    function fail(code,message){const error=new Error(message);error.code=code;return error;}
    function lock(message){locked=true;notice=message;notify();onAccountChange(status());}
    async function api(route,{method='GET',data,publicRequest=false,account=user?.id}={}){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await request(API+route,{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
          headers:{...(method==='GET'?{}:{'Content-Type':'application/json','X-Melodiajest-CSRF':csrf}),...(!publicRequest&&account?{'X-Melodiajest-Account':account}:{})},body:data===undefined?undefined:JSON.stringify(data)});
        let result;try{result=await response.json();}catch{throw fail('BAD_RESPONSE','Сервис вернул неполный ответ. Сохрани свой вариант и повтори позже.');}
        if(!response.ok){
          const error=fail(result.error?.code||'SERVICE_ERROR',result.error?.message||'Не удалось выполнить действие.');error.status=response.status;
          if(user&&(response.status===401||error.code==='ACCOUNT_CHANGED'))lock('Аккаунт или сессия изменились. Войди заново; личные изменения не передаются другому пользователю.');
          throw error;
        }
        if(!publicRequest&&account&&(locked||user?.id!==account))throw fail('ACCOUNT_CHANGED','Ответ относится к прежнему аккаунту. Личные данные не подменяются.');
        return result;
      }catch(error){if(error.name==='AbortError')throw fail('TIMEOUT','Нет подтверждения сервера. Не закрывай страницу: сохрани свою копию и проверь соединение.');throw error;}
      finally{clearTimeout(timer);}
    }
    function adopt(result){
      user=result.user||null;csrf=result.csrfToken||'';initialized=true;locked=false;notice='';memory.clear();objects.clear();notify();return result;
    }
    async function init(){
      if(initialized)return status();
      try{adopt(await sessionLock(()=>api('/session',{publicRequest:true})));if(user)await getObject('preferences');}
      catch(error){initialized=true;locked=true;notice=error.message;notify();throw error;}
      return status();
    }
    async function checkSession(){
      if(!initialized||locked)return;
      try{const current=await sessionLock(()=>api('/session',{publicRequest:true}));if((current.user?.id||null)!==(user?.id||null))lock('Аккаунт изменился в другой вкладке. Перезагрузи страницу для входа в новый аккаунт.');else csrf=current.csrfToken;}
      catch(error){notice=error.message;notify();}
    }
    async function auth(kind,data){
      if(pending.size)throw fail('PENDING_CHANGES','Сначала сохрани или скачай ожидающие изменения.');
      const result=await sessionLock(async()=>{const current=await api('/session',{publicRequest:true});csrf=current.csrfToken;return adopt(await api('/auth/'+kind,{method:'POST',data,publicRequest:kind!=='password'}));});
      // Registration/recovery already committed and returned a one-time code.
      // A later preferences failure must never hide that successful response.
      if(user)try{await getObject('preferences');}catch(error){notice=error.message;notify();}
      channel?.postMessage({kind:'session-changed'});
      return result;
    }
    async function logout(){
      if(pending.size)throw fail('PENDING_CHANGES','Сначала сохрани или скачай ожидающие изменения.');
      const result=await sessionLock(async()=>{
        const current=await api('/session',{publicRequest:true});csrf=current.csrfToken;
        await api('/auth/logout',{method:'POST',data:{}});user=null;csrf='';initialized=false;locked=false;objects.clear();memory.clear();
        return adopt(await api('/session',{publicRequest:true}));
      });channel?.postMessage({kind:'session-changed'});return result;
    }
    function requireUser(){if(!user||locked)throw fail('SIGN_IN_REQUIRED','Войди, чтобы сохранить личные изменения.');return user;}
    async function getObject(kind){
      requireUser();const result=await api('/'+kind);objects.set(kind,result);return result;
    }
    async function saveObject(kind,raw){
      const owner=requireUser().id;pending.set(kind,raw);notice='Сохранение в аккаунт…';notify();
      const job=(queues.get(kind)||Promise.resolve()).catch(()=>{}).then(async()=>{
        if(requireUser().id!==owner)throw fail('ACCOUNT_CHANGED','Аккаунт изменился; запись остановлена.');
        const previous=objects.get(kind);if(!previous)throw fail('OBJECT_NOT_LOADED','Сначала нужно загрузить сохранённые данные аккаунта. Изменения не заменяют неизвестную серверную версию.');
        jobs++;notify();
        try{
          let response;
          try{response=await api('/'+kind,{method:'PUT',data:{expectedRevision:previous.revision,raw}});}
          catch(error){
            // A timeout may follow a committed transaction. Read back this exact
            // value once, without rebasing or replacing another device's edit.
            if(error.status===409||error.status===401||error.status===403)throw error;
            const readback=await api('/'+kind);
            if(readback.raw!==raw)throw error;response=readback;
          }
          const readback=await api('/'+kind);
          if(response.raw!==raw||readback.raw!==raw||response.revision!==readback.revision)throw fail('SAVE_NOT_CONFIRMED','Сохранение не подтверждено: данные уже изменились. Сохрани свою копию.');
          objects.set(kind,readback);if(pending.get(kind)===raw)pending.delete(kind);
          notice=pending.size?'Есть ожидающие изменения':'Сохранено в аккаунте';return readback;
        }catch(error){notice=error.message;throw error;}finally{jobs--;notify();}
      });
      queues.set(kind,job);return job;
    }
    const scoped=key=>'melodiajest:user:'+user.id+':'+key;
    const accountStorage={
      getItem(key){
        if(!user)return memory.get(key)??null;
        // Progress writers require a fresh read under their Web Lock. A memory
        // cache would hide another tab's committed receipt and lose its result.
        if(key===UI_KEY){if(memory.has(key))return memory.get(key);if(objects.has('preferences'))return objects.get('preferences').raw;}
        return storage.getItem(scoped(key));
      },
      setItem(key,value){
        value=String(value);
        if(!user){memory.set(key,value);return;} // Guest practice is ephemeral.
        if(key===UI_KEY){
          memory.set(key,value);try{storage.setItem(scoped(key),value);}catch{notice='Браузер не сохраняет локальную копию настроек.';notify();}
          if(!locked)void saveObject('preferences',value).catch(()=>{});
        }else{
          // A queued writer from the old account may finish locally after
          // logout. Its namespace stays fixed; it never writes to the new user.
          // Errors must propagate so the actual progress store retains pending.
          storage.setItem(scoped(key),value);
        }
      }
    };
    function pendingExport(){return JSON.stringify({version:1,kind:'melodiajest-account-pending',accountId:user?.id||null,objects:Object.fromEntries(pending)},null,2)+'\n';}
    return {api,init,auth,logout,checkSession,getObject,saveObject,requireUser,storage:accountStorage,status,pendingExport,UI_KEY};
  }
  return Object.freeze({create,API,UI_KEY});
});
