(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LessonRating=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Valid-value conversion policy verified against Libreta src/lib/ratings.ts.
  // Missing values are explicitly distinct from a legitimate zero rating.
  const SYSTEMS=Object.freeze(['ten','ten_decimal','hundred','five','three','two']);
  const META=Object.freeze({ten:{label:'10 баллов',min:0,max:10,step:1},ten_decimal:{label:'10 баллов с дробью',min:0,max:10,step:.01},hundred:{label:'100 баллов',min:0,max:100,step:1},five:{label:'5 баллов',min:1,max:5,step:1},three:{label:'Три уровня',values:['bad','normal','good']},two:{label:'Лайк / дизлайк',values:['dislike','like']}});
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function roundHalfDown(value){const lower=Math.floor(value);return value-lower<=.5+Number.EPSILON?lower:Math.ceil(value);}
  function normalize(system,value){
    if(!SYSTEMS.includes(system)||value===null||value===undefined||typeof value==='boolean')return null;
    if(META[system].values)return META[system].values.includes(value)?value:null;
    if(typeof value==='string'){value=value.trim().replace(',','.');if(!value)return null;}
    if(typeof value!=='number'&&typeof value!=='string')return null;
    const n=Number(value),m=META[system];
    if(!Number.isFinite(n)||n<m.min||n>m.max)return null;
    return system==='ten_decimal'?Math.round(n*100)/100:Number.isInteger(n)?n:null;
  }
  function toCanonical(system,value){
    const n=normalize(system,value);if(n===null)return null;
    if(system==='ten'||system==='ten_decimal')return Number(n)*10;
    if(system==='hundred')return n;
    if(system==='five')return [null,10,25,50,75,95][n];
    if(system==='three')return {bad:20,normal:50,good:80}[n];
    return n==='like'?80:20;
  }
  function fromCanonical(system,value){
    if(!SYSTEMS.includes(system)||typeof value!=='number'||!Number.isFinite(value))return null;
    const n=clamp(value,0,100);
    if(system==='ten')return roundHalfDown(n/10);
    if(system==='ten_decimal')return Math.round(n*10)/100;
    if(system==='hundred')return roundHalfDown(n);
    if(system==='five')return n<20?1:n<40?2:n<70?3:n<90?4:5;
    if(system==='three')return n<40?'bad':n<70?'normal':'good';
    return n<=50?'dislike':'like';
  }
  function record(system,value){const canonical=toCanonical(system,value);return canonical===null?null:{system,value:normalize(system,value),canonicalUnits:Math.round(canonical*100)};}
  function valueFor(saved,system){
    if(!saved||!Number.isInteger(saved.canonicalUnits)||saved.canonicalUnits<0||saved.canonicalUnits>10000)return null;
    return saved.system===system&&normalize(system,saved.value)!==null?normalize(system,saved.value):fromCanonical(system,saved.canonicalUnits/100);
  }
  function format(system,value){
    if(value===null||value===undefined)return 'Без оценки';
    if(system==='ten_decimal')return new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value))+'/10';
    if(system==='ten')return value+'/10';if(system==='hundred')return value+'/100';if(system==='five')return value+'/5';
    return {bad:'Плохо',normal:'Нормально',good:'Хорошо',like:'Нравится',dislike:'Не нравится'}[value]||'Без оценки';
  }
  function average(sumUnits,count){return Number.isSafeInteger(count)&&count>0&&Number.isSafeInteger(sumUnits)&&sumUnits>=0&&sumUnits<=count*10000?{canonical:sumUnits/count/100,decimalTen:Math.round(sumUnits/count/10)/100,count}:null;}
  return {VERSION:1,DEFAULT:'ten',SYSTEMS,META,roundHalfDown,normalize,toCanonical,fromCanonical,record,valueFor,format,average};
});
