'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

// A small DOM contract for the shipped player's mount, not a copy of its logic.
// CSS/layout and assistive-tech exposure are checked separately in the browser.
function fixture(options={}){
  const ids=new Map();
  class Element{
    constructor(id=''){this.id=id;this.children=[];this.parentNode=null;this.hidden=false;this.textContent='';this.innerHTML='';this.attributes={};this.classList={add(){},toggle(){}};if(id)ids.set(id,this);}
    get nextSibling(){const siblings=this.parentNode?.children||[];return siblings[siblings.indexOf(this)+1]||null;}
    get previousElementSibling(){const siblings=this.parentNode?.children||[];return siblings[siblings.indexOf(this)-1]||null;}
    get parentElement(){return this.parentNode;}
    setAttribute(k,v){this.attributes[k]=String(v);}
    getAttribute(k){return this.attributes[k]??null;}
    append(child){if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);this.children.push(child);child.parentNode=this;}
    prepend(child){this.insertBefore(child,this.children[0]||null);}
    insertBefore(child,reference){if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);const index=reference?this.children.indexOf(reference):this.children.length;assert.ok(index>=0);this.children.splice(index,0,child);child.parentNode=this;}
    querySelector(){return null;}
  }
  const app=new Element('app'),main=new Element(),account=new Element(),status=options.noStatus?null:new Element('service-account-status'),player=new Element('game-player-root'),heading=new Element('test-lesson-heading');
  new Element('player-site-head');new Element('player-identity');new Element('player-catalog-toggle');new Element('player-advanced');
  status?.setAttribute('role','status');status?.setAttribute('aria-live','polite');if(status)account.append(status);app.append(account);app.append(main);main.append(player);main.append(heading);
  const state={user:options.guest?null:{id:'fixture-owner',displayName:'Fixture'},notice:options.notice||'',pending:false,saving:false,locked:false};
  const trainer={lessonId:'fixture-lesson',fingerprint:'fixture-fingerprint',mode:options.memory?'memory':'practice',completed:false,midiConnected:true};
  const capture={status:()=>({pending:null,ready:false,busy:false}),read(){},releaseOwnership(){}};
  const doc={body:new Element(),getElementById:id=>ids.get(id)||null,querySelector:selector=>selector==='main.main'?main:selector==='#app > .catalog-save-notice'?account:null,createElement:()=>new Element()};
  const context=vm.createContext({document:doc,location:{search:''},URLSearchParams,MelodiaLearning:{create:()=>capture}});
  vm.runInContext(fs.readFileSync('piano-game-player.js','utf8'),context,{filename:'piano-game-player.js'});
  const client={status:()=>({...state}),api:async path=>path==='/course'?{lessons:[{id:trainer.lessonId,gradeFingerprint:trainer.fingerprint,challengeReady:true}]}:{nextLessonId:null}};
  const ui=context.PianoGamePlayer.create({client,readTrainer:()=>trainer,prepareTrainer(){throw Error('This test must not start an attempt');},render(){}});
  const visible=element=>{for(let n=element;n;n=n.parentNode)if(n.hidden)return false;return !!element;};
  return{ui,state,trainer,status,account,main,player,heading,visible,ids};
}

test('confirmed account save is visible in main outside the hidden legacy account panel',async()=>{
  const f=fixture({notice:'Сохранено в аккаунте'});await f.ui.load();assert.equal(f.account.hidden,true);assert.equal(f.status.parentNode,f.main);assert.equal(f.visible(f.status),true);assert.equal(f.status.textContent,'Сохранено в аккаунте');assert.equal(f.status.id,'service-account-status');
});
test('guest gets a visible sign-in policy without changing the guest or attempt state',async()=>{
  const f=fixture({guest:true});await f.ui.load();assert.equal(f.status.parentNode,f.main);assert.match(f.status.textContent,/Войди.*сохранять/);assert.match(f.status.textContent,/настройки/);assert.equal(f.state.user,null);assert.equal(f.trainer.mode,'practice');assert.equal(f.visible(f.status),true);
});
test('the same live node stays after the server panel across repeated mounts',async()=>{
  const f=fixture({notice:'Сохранено в аккаунте'}),node=f.status;await f.ui.load();for(let i=0;i<5;i++)f.ui.mount();assert.equal(f.status,node);assert.equal(f.main.children.filter(x=>x===node).length,1);assert.equal(f.player.nextSibling,node);assert.equal(node.nextSibling,f.heading);assert.equal(node.getAttribute('role'),'status');assert.equal(node.getAttribute('aria-live'),'polite');assert.equal(node.getAttribute('aria-atomic'),'true');
});
test('pending,error and real acknowledgement replace text without claiming an early save',async()=>{
  const f=fixture();await f.ui.load();f.state.pending=true;f.state.notice='Сохранение в аккаунт…';f.ui.mount();assert.equal(f.status.textContent,f.state.notice);assert.equal(f.visible(f.status),true);
  f.state.notice='Сеть недоступна. Изменения ожидают отправки.';f.ui.mount();assert.equal(f.status.textContent,f.state.notice);assert.equal(f.visible(f.status),true);
  f.state.pending=false;f.state.notice='Сохранено в аккаунте';f.ui.mount();assert.equal(f.status.textContent,f.state.notice);assert.equal(f.visible(f.status),true);
});
test('locked account keeps the actual message and recovery controls in their existing panel',async()=>{
  const f=fixture();await f.ui.load();f.state.locked=true;f.state.notice='Сессия изменилась. Войди заново.';f.ui.mount();assert.equal(f.status.textContent,f.state.notice);assert.equal(f.visible(f.status),true);assert.equal(f.account.hidden,false);assert.equal(f.account.parentNode.id,'app');
});
test('authenticated idle fallback describes settings without claiming a checked performance',async()=>{
  const f=fixture();await f.ui.load();assert.match(f.status.textContent,/Настройки.*личные правки/);assert.doesNotMatch(f.status.textContent,/Сохранено|попытка пройдена|XP|LVL/);assert.equal(f.visible(f.status),true);
});
test('account status in memory contains no musical hints and treats a notice as plain text',async()=>{
  const notice='<img src=x onerror=alert(1)> Сеть недоступна';const f=fixture({memory:true,notice});await f.ui.load();assert.equal(f.status.textContent,notice);assert.equal(f.status.innerHTML,'');assert.equal(f.visible(f.status),true);assert.doesNotMatch(f.status.textContent,/fixture-lesson|fixture-fingerprint/);
});
test('a page without the account notice keeps the existing player contract',async()=>{
  const f=fixture({noStatus:true});await assert.doesNotReject(f.ui.load());f.ui.mount();assert.equal(f.ids.has('service-account-status'),false);assert.equal(f.main.children[0],f.player);
});
