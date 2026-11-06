'use strict';
const fs=require('node:fs'),path=require('node:path'),ROOT=path.resolve(__dirname,'../..');
function baseSpecification(){const backlog=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/piano-lesson-backlog.json'),'utf8'));return {schemaVersion:1,entries:['treble','bass'].map(clef=>{const plan=backlog.lessons.find(p=>p.id==='detail-p-read-'+clef+'-01');if(!plan)throw Error('Reading plan missing: '+clef);return {lessonId:plan.id,clef,hand:plan.hand,demonstration:plan.targetNotes,transfer:plan.transfer.notes};})};}
let builtinCatalog;
function specification(){const base=baseSpecification(),Bank=require('../../piano-reading-bank.js'),Audit=require('../../tools/piano-reading-catalog-audit.cjs');if(!builtinCatalog)builtinCatalog=require('../../tests/helpers/load-app.cjs').loadApp().catalogSnapshot().lessons;const result=Audit.audit(builtinCatalog,Bank.candidates(base).items);return {...base,catalogAudit:{version:result.version,scope:result.scope,catalogRecords:result.catalogRecords,catalogHash:result.catalogHash,items:result.items.map(({itemId,contentKey,occurrences})=>({itemId,contentKey,occurrences}))}};}
function write(){const spec=specification();require('../../piano-reading-bank.js').build(spec);const dir=path.join(ROOT,'web-app/generated');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'reading-spec.json'),JSON.stringify(spec,null,2)+'\n');return spec;}
if(require.main===module){write();console.log('Bounded reading specification prepared from current plans.');}
module.exports={baseSpecification,specification,write};
