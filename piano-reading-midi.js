(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoReadingMidi=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function decode(data){if(!data||data.length<3||!Number.isInteger(data[0])||data[0]<128||data[0]>255)return null;const status=data[0]&240,midi=data[1],velocity=data[2];if(!Number.isInteger(midi)||midi<0||midi>127||!Number.isInteger(velocity)||velocity<0||velocity>127)return null;if(status===128||status===144&&velocity===0)return {type:'note-off',midi,source:'midi'};if(status===144)return {type:'note-on',midi,source:'midi'};return null;}
  function create({requestAccess,onInput=()=>{},onInterrupted=()=>{},onPorts=()=>{}}={}){
    let access=null,port=null,disposed=false,selection=0,pendingAccess=null;const held=new Set();
    const list=()=>[...(access?.inputs.values()||[])].filter(p=>p.state==='connected').map(p=>({id:p.id,name:p.name||'Вход MIDI'}));
    function message(event){const data=event.data,decoded=decode(data);if(decoded){const key=(data[0]&15)+':'+decoded.midi;if(decoded.type==='note-on')held.add(key);else held.delete(key);onInput(decoded);}else if(data?.length>=3&&(data[0]&240)===176&&[120,123].includes(data[1])){held.clear();onInterrupted();}}
    function detach(){if(port){port.removeEventListener('midimessage',message);const old=port;port=null;Promise.resolve(old.close()).catch(()=>{});}held.clear();}
    function stateChange(){if(disposed)return;if(port&&(port.state!=='connected'||port.connection&&port.connection!=='open')){detach();onInterrupted();}onPorts(list());}
    return {
      ports:list,
      heldCount:()=>held.size,
      async connect(){if(disposed)throw Error('MIDI_DISPOSED');if(access)return list();if(typeof requestAccess!=='function')throw Error('MIDI_UNAVAILABLE');if(!pendingAccess)pendingAccess=(async()=>{access=await requestAccess({sysex:false});if(disposed){access=null;return [];}access.addEventListener('statechange',stateChange);onPorts(list());return list();})();const pending=pendingAccess;try{return await pending;}finally{if(pendingAccess===pending)pendingAccess=null;}},
      async select(id){if(disposed)throw Error('MIDI_DISPOSED');const next=access?.inputs.get(id);if(!next||next.state!=='connected')throw Error('MIDI_INPUT_MISSING');if(port?.id===id)return;const token=++selection,hadPort=!!port;detach();if(hadPort)onInterrupted();await next.open();if(disposed||token!==selection){await next.close();return;}if(next.state!=='connected'||next.connection&&next.connection!=='open'){await next.close();throw Error('MIDI_INPUT_MISSING');}port=next;port.addEventListener('midimessage',message);},
      dispose(){disposed=true;selection++;access?.removeEventListener('statechange',stateChange);detach();access=null;}
    };
  }
  return {decode,create};
});
