'use strict';
// Explicit expected grading revisions only; never regenerate historical music fixtures.
const {revisions}=require('../fixtures/piano-assessment-revisions.json');
function atHistoricalInstruction(lesson){
 const fixtures=[require('../fixtures/piano-thumb-crossings-v1.json'),require('../fixtures/piano-c-major-scales-v1.json')],fixture=fixtures.find(f=>f.lessons.some(x=>x.id===lesson.id)),old=fixture?.lessons.find(x=>x.id===lesson.id);
 const copy=x=>JSON.parse(JSON.stringify(x));if(!old)return copy(lesson);
 const review=lesson.learning?.contentReview;
 if(review?.id!==fixture.reviewId||review.sourceFingerprint!==old.instructionFingerprint||review.previousAssessmentFingerprint!==old.grade||!review.previousInstruction)throw Error('Unknown instruction history for '+lesson.id);
 const previous=Object.assign(copy(lesson),copy(review.previousInstruction));
 const hash=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
 if(hash(previous)!==fixture.catalog.find(x=>x.id===lesson.id).fullRecordSha256)throw Error('Instruction archive differs for '+lesson.id);
 return previous;
}
function expectedGrade(old){
 const revision=revisions[old.id];if(!revision)return old.grade;
 if(old.grade!==revision.previous&&old.grade!==revision.current)throw Error('Unknown historical grade for '+old.id);
 return revision.current;
}
function atHistoricalGrade(lesson,old){
 const A=require('../../practice-assessment.js'),copy=x=>JSON.parse(JSON.stringify(x));
 if(lesson.id!==old.id)throw Error('Lesson identity differs');
 if(A.pianoSignature(lesson)===old.grade)return atHistoricalInstruction(lesson);
 const revision=revisions[old.id],review=lesson.learning?.contentReview;
 if(!revision||old.grade!==revision.previous||A.pianoSignature(lesson)!==revision.current||!revision.reviewId||review?.id!==revision.reviewId||review.previousAssessmentFingerprint!==old.grade||!review.previousInstruction)throw Error('Unknown historical teaching edition for '+old.id);
 const previous=Object.assign(copy(lesson),copy(review.previousInstruction));
 if(revision.rhythmChanged){
  const digest=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if(!review.previousRhythm||digest(review.previousRhythm)!==revision.previousRhythmSha256||digest(lesson.rhythm)!==revision.currentRhythmSha256)throw Error('Unknown historical rhythm edition for '+old.id);
  previous.rhythm=copy(review.previousRhythm);
 }
 if(A.pianoSignature(previous)!==old.grade)throw Error('Archived teaching edition differs for '+old.id);
 return previous;
}
function historicalMusic(lesson,old){
 const A=require('../../practice-assessment.js'),revision=revisions[old.id];
 if(lesson.id!==old.id||A.pianoSignature(lesson)!==expectedGrade(old))throw Error('Unknown current musical edition for '+old.id);
 // Earlier assessment-only revisions retain their original score; only an explicitly
 // declared rhythm change can substitute the SHA-pinned archived rhythm here.
 const value=revision?.rhythmChanged&&old.grade===revision.previous?atHistoricalGrade(lesson,old):lesson;
 return {steps:value.steps,rhythm:value.rhythm,fingeringSpec:value.fingeringSpec,contentKind:value.contentKind};
}
module.exports={expectedGrade,atHistoricalGrade,historicalMusic,atHistoricalInstruction};
