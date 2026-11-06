'use strict';
// Applies only the reviewed artifacts, after checking that no sibling files
// have changed since staging. User course files and browser storage are untouched.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),target=path.resolve(root,'../guitarjest'),staged=path.join(root,'tmp/guitar-update');
if(target.toLowerCase()!=='c:\\users\\alexander\\documents\\web\\guitarjest')throw Error('Unexpected target directory');
const files=['app.js','index.html','course-editor.js','practice-assessment.js','curriculum.js','curriculum-plan.js','guitar-curriculum-quality.js','catalog-sections.js','catalog-sections.css','lesson-review-baseline.js','lesson-quality.js','lesson-development.js','lesson-quality-apply.js'];
const expected=JSON.parse(fs.readFileSync(path.join(staged,'source-hashes.json'),'utf8'));
const hash=file=>fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
for(const name of files){if(path.dirname(path.resolve(target,name))!==target)throw Error('Path escaped target');if(hash(path.join(target,name))!==expected[name])throw Error('Sibling changed after staging: '+name);if(!fs.existsSync(path.join(staged,name)))throw Error('Missing artifact: '+name);}
const backup=path.join(root,'tmp/guitar-before-curriculum-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(backup,{recursive:true});
for(const name of files)if(fs.existsSync(path.join(target,name)))fs.copyFileSync(path.join(target,name),path.join(backup,name));
fs.copyFileSync(path.join(staged,'source-hashes.json'),path.join(backup,'source-hashes.json'));
for(const name of files)fs.copyFileSync(path.join(staged,name),path.join(target,name));
for(const name of files)if(hash(path.join(target,name))!==hash(path.join(staged,name)))throw Error('Copy verification failed: '+name);
console.log(JSON.stringify({updated:files,target,backup}));
