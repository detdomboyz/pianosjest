'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash}=require('./canonical.cjs'),{check}=require('./security.cjs');
function loadCourse(filename=path.join(__dirname,'course-registry.json')){
  const course=JSON.parse(fs.readFileSync(filename,'utf8'));
  check(course.kind==='melodiajest-canonical-course'&&course.version===1&&course.policyVersion===1&&Array.isArray(course.lessons)&&course.lessons.length<=5000&&course.contentSha256===hash({route:course.route,lessons:course.lessons}),500,'COURSE_CONTRACT','Не совпал контракт учебного курса.');
  const byId=new Map(course.lessons.map(row=>[row.id,Object.freeze(row)]));
  check(byId.size===course.lessons.length&&new Set(course.route).size===course.route.length&&course.route.every(id=>byId.get(id)?.challengeReady),500,'COURSE_ROUTE','Неверный учебный маршрут.');
  return {course,byId,lesson(id){const row=byId.get(id);check(row,404,'LESSON_NOT_FOUND','Урок не найден.');return row;},publicLesson(row){const {steps,...metadata}=row;return metadata;}};
}
module.exports={loadCourse};
