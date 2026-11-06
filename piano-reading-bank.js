(function(root,factory){const api=typeof module==='object'&&module.exports?factory(require('./piano-reading-session.js')):factory(root.PianoReadingSession);if(typeof module==='object'&&module.exports)module.exports=api;else root.PianoReadingBank=api;})(typeof window==='object'?window:globalThis,function(Session){
  'use strict';
  const VERSION=2,TEMPLATES=Object.freeze([[0,0,1,2],[0,1,1,2],[0,1,2,2],[2,2,1,0],[2,1,1,0],[2,1,0,0]].map(Object.freeze));
  function candidates(specification){
    if(specification?.schemaVersion!==1||!Array.isArray(specification.entries)||specification.entries.length!==2)throw Error('READING_SPEC_INVALID');
    const items=[],publishedExamples=[],hands={},seen=new Set();
    for(const entry of specification.entries){
      const {clef,lessonId,hand}=entry||{},octave=clef==='treble'?4:clef==='bass'?3:null,base=12*(octave+1),pitches=[base,base+2,base+4],fingers=hand==='right'?[1,2,3]:hand==='left'?[5,4,3]:null;
      if(octave===null||seen.has(clef)||typeof lessonId!=='string'||!lessonId||!fingers||(clef==='treble'?hand!=='right':hand!=='left'))throw Error('READING_SPEC_INVALID');seen.add(clef);hands[clef]=hand;
      for(const [role,notes]of [['demonstration',entry.demonstration],['transfer',entry.transfer]]){
        if(!Array.isArray(notes)||notes.length!==4||notes.some((n,i)=>!pitches.includes(n.midi)||n.hand!==hand||n.finger!==fingers[pitches.indexOf(n.midi)]||n.startBeat!==i||n.durationBeats!==1))throw Error('READING_SPEC_NOTES');
        publishedExamples.push(make(notes.map(n=>pitches.indexOf(n.midi)),role));
      }
      for(const template of TEMPLATES)items.push(make(template,'bank'));
      function make(template,role){
        const token=template.join(''),id='reading-'+clef+'-'+token,revision='pitch-reading-v1',music={schemaVersion:1,id:'score:'+id,revision,timeUnit:'quarter',bpm:56,parts:[{id:'melody'}],notes:template.map((index,i)=>({id:'note-'+i,partId:'melody',pitch:{kind:'midi',value:pitches[index]},span:{kind:'known',start:i,duration:1}}))},notation={documentRevision:revision,partId:'melody',clef,spelling:template.map((index,i)=>({noteId:'note-'+i,step:['C','D','E'][index],octave,alter:0}))};
        const item={schemaVersion:1,instrument:'piano',itemId:id,itemVersion:'2',lessonId,music,notation};Session.contentKey(item);return {...item,role,hand,fingers:template.map(index=>fingers[index])};
      }
    }
    return {schemaVersion:VERSION,items,publishedExamples,hands};
  }
  function build(specification){
    const bank=candidates(specification),audit=specification.catalogAudit;
    if(audit?.version!==1||audit.scope!=='builtin-piano-monophonic-windows-v1'||!Number.isSafeInteger(audit.catalogRecords)||audit.catalogRecords<1||!/^[a-f0-9]{64}$/.test(audit.catalogHash||'')||!Array.isArray(audit.items)||audit.items.length!==bank.items.length)throw Error('READING_CATALOG_AUDIT_REQUIRED');
    const seen=new Set();
    for(const row of audit.items){const item=bank.items.find(i=>i.itemId===row?.itemId);if(!item||seen.has(row.itemId)||row.contentKey!==Session.contentKey(item)||!Number.isSafeInteger(row.occurrences)||row.occurrences<0)throw Error('READING_CATALOG_AUDIT_INVALID');seen.add(row.itemId);if(row.occurrences>0)bank.publishedExamples.push({...item,role:'catalog-exclusion'});}
    return {...bank,catalogAudit:JSON.parse(JSON.stringify(audit))};
  }
  return {VERSION,candidates,build};
});
