'use strict';
// Two declared prerequisite-only revisions. Old test cohorts retain their exact
// fixtures; reconstruct and validate the archived edition through the real code.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const before=require('../fixtures/piano-before-right-legato-preparation-v1.json');
const after=require('../fixtures/piano-right-legato-preparation-v2.json');
const P=require('../../piano-lesson-development.js');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function project(value){
 if(!value||typeof value!=='object'||!Object.hasOwn(before.targets,value.id))return value;
 if(value.learning){
  const review=value.learning.contentReview;
  assert.equal(review?.id,'right-legato-prerequisites-v2','Unknown prerequisite history '+value.id);
  const archived=Object.assign(copy(value),copy(review.previousInstruction));
  assert.equal(hash(archived),before.catalog.find(x=>x.id===value.id).fullRecordSha256,'Prerequisite archive differs '+value.id);
  const replay=copy(archived);assert.equal(P.reviewRightLegatoPrerequisites([replay]),1);
  assert.deepEqual(copy(value),replay,'Current prerequisite revision differs '+value.id);
  return archived;
 }
 if(value.editionVersion){
  assert.deepEqual(copy(value),after.serverRows[value.id],'Current server prerequisite revision differs '+value.id);
  return before.server.targetRows[value.id];
 }
 return value;
}
module.exports={project};
