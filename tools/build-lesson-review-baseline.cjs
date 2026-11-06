'use strict';
const fs=require('node:fs'),path=require('node:path');const {loadApp}=require('../tests/helpers/load-app.cjs'),{loadGuitarCourse}=require('./curriculum-inventory.cjs'),C=require('../catalog-sections.js'),Q=require('../lesson-quality.js');
const root=path.resolve(__dirname,'..'),target=path.join(root,'lesson-review-baseline.js');if(fs.existsSync(target))throw Error('The pre-review baseline already exists. Do not rebuild it from corrected data.');
const piano=loadApp(),guitar=loadGuitarCourse(),data={version:1,piano:{},guitar:{},themes:{}};
for(const l of C.available('piano','learning',piano.lessons,piano.themes))data.piano[l.id]={fingerprint:Q.pianoFingerprint(l),themeOrder:piano.themes.find(t=>t.id===l.themeId).order};
for(const l of C.available('guitar','learning',guitar.lessons,guitar.topics))data.guitar[l.id]={fingerprint:Q.guitarFingerprint(l)};
for(const t of piano.themes){if(t.order===28)data.themes[t.id]={name:t.name,correctedName:'Октавы и ориентиры C2–C7'};if(t.order===40)data.themes[t.id]={name:t.name,correctedName:'Регистр C5–C♯6: полная отработка'};}
fs.writeFileSync(target,'(function(root){const data='+JSON.stringify(data,null,2)+';if(typeof module===\'object\'&&module.exports)module.exports=data;else root.LessonReviewBaseline=data;})(typeof window===\'object\'?window:globalThis);\n');
fs.copyFileSync(path.join(root,'tmp/pedagogy-before.json'),path.join(root,'docs/lesson-review-before.json'));console.log('Frozen baseline:',Object.keys(data.piano).length,Object.keys(data.guitar).length);
