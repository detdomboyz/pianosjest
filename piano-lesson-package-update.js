'use strict';
// Synchronous offline wrapper; policy is shared with the browser planner.
const crypto=require('node:crypto'),Parts=require('./piano-lesson-parts.js'),Core=require('./piano-lesson-package-plan-core.js');
const planner=Core.create({hash:raw=>crypto.createHash('sha256').update(raw).digest('hex')});
function verified(input){
  if(!input||typeof input!=='object')throw new Error('Lesson package update: package input required');
  const source=Core.validatePin(input.pin),manifest=Parts.readManifest(input.manifestBytes,source.manifestSha256);
  if(manifest.source.release!==source.release||manifest.source.webManifestSha256!==source.webManifestSha256)throw new Error('Lesson package update: package source pin mismatch');
  return {source,catalog:Parts.assemble(manifest,input.files)};
}
function prepare({active,previous,incoming,catalog}){return planner.prepare({active,previous:verified(previous),incoming:verified(incoming),catalog});}
module.exports={VERSION:Core.VERSION,MAX_CATALOG_BYTES:Core.MAX_CATALOG_BYTES,MAX_STRING_BYTES:Core.MAX_STRING_BYTES,MAX_JSON_NODES:Core.MAX_JSON_NODES,MAX_DEPTH:Core.MAX_DEPTH,compareRelease:Core.compareRelease,prepare,materialize:planner.materialize};
