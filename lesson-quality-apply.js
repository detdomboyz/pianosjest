(function(){
  'use strict';
  const data=window.GBT_CURRICULUM;
  window.LessonQuality.repairGuitar(data,window.LessonReviewBaseline);
  window.LessonDevelopment.registerGuitar(data);
  Object.assign(data.totals,{lessons:data.lessons.length,topics:data.topics.length,skillLessons:data.lessons.filter(l=>l.category!=='melody').length,noteEvents:data.lessons.reduce((s,l)=>s+l.notes.length,0),notes:data.lessons.reduce((s,l)=>s+l.notes.length,0)});
  window.dispatchEvent(new CustomEvent('gbt:course-data-updated'));
})();
