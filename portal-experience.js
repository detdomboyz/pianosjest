(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PortalExperience=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // Same thresholds as Libreta src/lib/profile-sidebar.ts. The authoritative
  // total must come from a linked, authenticated portal identity, never email.
  function level(xp){
    if(!Number.isSafeInteger(xp)||xp<0||xp>1e12)throw new RangeError('Invalid experience total');
    const current=Math.floor(Math.sqrt(xp/120))+1,start=120*(current-1)**2,next=120*current**2;
    return {level:current,nextLevel:current+1,xp,levelStartXp:start,nextLevelXp:next,remaining:next-xp,progress:Math.max(0,Math.min(100,Math.round((xp-start)/(next-start)*100)))};
  }
  // Project policy, not an examination-board grade. No speed bonus above the
  // target tempo; no XP for unverified practice, fabricated aggregate scores,
  // user-defined lessons, fingers or an unobserved pedal/artistic result.
  function award({clean,quality}){
    if(clean!==true)return 0;
    if(!Number.isFinite(quality)||quality<0||quality>100)throw new RangeError('Invalid performance quality');
    return 60+Math.round(40*quality/100);
  }
  function improvement(previous,best){
    if(!Number.isInteger(previous)||!Number.isInteger(best)||previous<0||best<0||previous>100||best>100)throw new RangeError('Invalid lesson award');
    return {best:Math.max(previous,best),delta:Math.max(0,best-previous)};
  }
  return {VERSION:1,level,award,improvement};
});
