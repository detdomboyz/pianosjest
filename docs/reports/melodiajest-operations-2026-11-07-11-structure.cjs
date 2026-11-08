'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(process.cwd()),raw=fs.readFileSync(path.join(root,'dist/web/web-release.json')),manifest=JSON.parse(raw);
assert.equal(manifest.version,'23.5.38');assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'6a4a36d988c0ca9d716fe03b859d7a2363427562cc5ba76422ed86dfc78cd9cd');
const app=require(path.join(root,'tests/helpers/load-app.cjs')).loadApp({appRoot:path.join(root,'dist/web'),web:true});
const snapshot=app.catalogSnapshot(),text=JSON.stringify(snapshot),fieldBytes={};
for(const lesson of snapshot.lessons)for(const[k,v]of Object.entries(lesson)){const value=JSON.stringify(v);if(value!==undefined)fieldBytes[k]=(fieldBytes[k]||0)+Buffer.byteLength(value);}
const first=app.lessons.find(x=>x.id==='course01-01'),theme=snapshot.themes.find(x=>x.id===first.themeId),lessons=snapshot.lessons.filter(x=>x.themeId===first.themeId);
const group={diagnosticGroupingOnly:true,version:1,instrument:'piano',catalogVersion:manifest.version,theme,lessons};
const groupRaw=Buffer.from(JSON.stringify(group)),groupBack=JSON.parse(groupRaw),A=require(path.join(root,'practice-assessment.js'));
assert.equal(JSON.stringify(groupBack.lessons),JSON.stringify(lessons));for(let i=0;i<lessons.length;i++){assert.equal(groupBack.lessons[i].id,lessons[i].id);assert.equal(A.pianoSignature(groupBack.lessons[i]),A.pianoSignature(lessons[i]));}
const report={checkedAt:new Date().toISOString(),version:manifest.version,catalogSnapshot:{utf8Bytes:Buffer.byteLength(text),codeUnits:text.length,utf16ValueBytes:text.length*2,lessonCount:snapshot.lessons.length,themeCount:snapshot.themes.length,largestLessonFieldsByUtf8Bytes:Object.entries(fieldBytes).map(([field,bytes])=>({field,bytes})).sort((a,b)=>b.bytes-a.bytes)},singleThemeDiagnostic:{themeId:theme.id,lessonIds:Array.from(lessons,l=>l.id),lessons:lessons.length,utf8Bytes:groupRaw.length,gzipLevel6Bytes:zlib.gzipSync(groupRaw,{level:6}).length,jsonRoundtripPreservesSerializedLessonData:true,runtimePackageContractImplemented:false,userEditsOrUserProgressRead:false},browserQuotaActuallyTested:false,userStorageWritten:false};
const out=path.join(root,'tmp/melodiajest-11-structure.json');fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
