'use strict';
// Preserve the released71 teaching edition in older cohorts. Validate both the
// archived full record and its replay through the real guarded migration.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const before=require('../fixtures/piano-before-f-upper-readiness-v1.json'),after=require('../fixtures/piano-f-upper-readiness-v1.json'),P=require('../../piano-lesson-development.js');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function project(value){
 if(!value||value.id!==before.lessonId)return value;
 if(value.learning){
  const review=value.learning.contentReview;assert.equal(review?.id,after.reviewId);
  const archived=Object.assign(copy(value),copy(review.previousInstruction));
  assert.equal(hash(archived),before.catalog.find(x=>x.id===before.lessonId).fullRecordSha256,'Upper readiness archive differs');
  const replay=copy(archived);assert.equal(P.reviewFMajorUpperReadiness([replay]),1);assert.deepEqual(copy(value),replay,'Upper readiness revision differs');return archived;
 }
 if(value.editionVersion){assert.deepEqual(copy(value),after.serverRow,'Upper readiness server edition differs');return before.server.targetRow;}
 return value;
}
module.exports={project};
