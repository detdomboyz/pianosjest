'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const Parts=require('../piano-lesson-parts.js'),A=require('../practice-assessment.js'),{loadApp}=require('./helpers/load-app.cjs');
const copy=x=>JSON.parse(JSON.stringify(x)),hash=b=>crypto.createHash('sha256').update(b).digest('hex'),app=loadApp(),snapshot=copy(app.catalogSnapshot());
const themeIds=[app.lessons.find(l=>l.id==='course01-03').themeId],options={release:'23.5.39',webManifestSha256:'e8e1815f46f3f13e43dd191249decce1f7e8bd74920fd3342993c59ecf71443d',themeIds};
const bundle=Parts.build(snapshot,options);
test('same serialized source produces identical immutable topic and manifest bytes, excluding only save timestamp',()=>{
 const again=Parts.build({...copy(snapshot),savedAt:'2099-01-01T00:00:00Z'},options);assert.ok(bundle.manifestBytes.equals(again.manifestBytes));assert.equal(bundle.manifestSha256,hash(bundle.manifestBytes));assert.equal(bundle.manifestKey,'manifests/v1/'+bundle.manifestSha256+'.json');assert.equal(bundle.files.size,1);
 for(const [key,bytes]of bundle.files){assert.ok(bytes.equals(again.files.get(key)));assert.equal(key,'parts/v1/'+hash(bytes)+'.json');}
 const manifest=Parts.readManifest(bundle.manifestBytes,bundle.manifestSha256),partial=Parts.assemble(manifest,bundle.files);assert.deepEqual(partial,{version:7,themes:snapshot.themes.filter(t=>themeIds.includes(t.id)),lessons:snapshot.lessons.filter(l=>themeIds.includes(l.themeId))});assert.equal(partial.lessons.length,8);assert.equal(Object.hasOwn(partial,'savedAt'),false);assert.equal(snapshot.version,7);
});
test('reassembling real topic through the shipped v7 importer preserves all 572 runtime musical versions and instruction histories',()=>{
 const restored=Parts.assemble(bundle.manifest,bundle.files),byId=new Map(restored.lessons.map(l=>[l.id,l])),all=copy(snapshot);all.lessons=all.lessons.map(l=>byId.get(l.id)||l);const a=loadApp();assert.equal(a.applyCatalogSnapshot(all),true);
 for(const old of app.lessons){const fresh=a.lessons.find(l=>l.id===old.id),serialized=snapshot.lessons.find(l=>l.id===old.id);assert.equal(A.pianoSignature(fresh),A.pianoSignature(old),old.id);assert.deepEqual(copy({steps:fresh.steps,rhythm:fresh.rhythm,fingeringSpec:fresh.fingeringSpec}),copy({steps:old.steps,rhythm:old.rhythm,fingeringSpec:old.fingeringSpec}),old.id);assert.equal(fresh.contentKind,serialized.contentKind);assert.equal(fresh.order,old.order);}
 for(const id of ['course01-03','course01-04'])assert.deepEqual(copy(a.lessons.find(l=>l.id===id).learning.contentReview),copy(app.lessons.find(l=>l.id===id).learning.contentReview));
});
test('bad bytes, stale hashes, missing/extra files and unsupported identities fail before assembly',()=>{
 const d=bundle.manifest.parts[0],raw=bundle.files.get(d.key);assert.throws(()=>Parts.readManifest(bundle.manifestBytes,'0'.repeat(64)),/SHA256/);assert.throws(()=>Parts.readManifest(Buffer.alloc(Parts.MAX_MANIFEST_BYTES+1),'0'.repeat(64)),/limit/);
 const corrupt=Buffer.from(raw);corrupt[20]^=1;assert.throws(()=>Parts.readPart(bundle.manifest,d.key,corrupt),/SHA256/);assert.throws(()=>Parts.readPart(bundle.manifest,d.key,raw.subarray(1)),/size/);assert.throws(()=>Parts.readPart(bundle.manifest,'unlisted.json',raw),/unlisted/);
 for(const files of [new Map(),new Map([...bundle.files,['extra',Buffer.from('{}')]])])assert.throws(()=>Parts.assemble(bundle.manifest,files),/files/);
 for(const edit of [m=>m.version=2,m=>m.instrument='guitar',m=>m.catalogFormat=8,m=>m.source.release='../../other',m=>m.parts[0].key='../private.json',m=>m.parts[0].bytes=Parts.MAX_PART_BYTES+1,m=>m.parts[0].lessonIds.push(m.parts[0].lessonIds[0]),m=>m.lessonOrder.push('not-in-topic')]){const m=copy(bundle.manifest);edit(m);assert.throws(()=>Parts.validateManifest(m));}
});
test('even rehashed data cannot change source identity, theme, exercise kind or declared lesson order',()=>{
 const d=bundle.manifest.parts[0],original=JSON.parse(bundle.files.get(d.key));
 for(const edit of [p=>p.source.release='23.5.40',p=>p.theme.id='other',p=>p.lessons[0].contentKind='piece',p=>p.lessons[0].themeId='other',p=>p.lessons.reverse(),p=>p.version=2,p=>p.privateProgress={}]){const payload=copy(original);edit(payload);const raw=Buffer.from(JSON.stringify(payload)),m=copy(bundle.manifest),sha256=hash(raw);Object.assign(m.parts[0],{key:'parts/v1/'+sha256+'.json',sha256,bytes:raw.length});assert.throws(()=>Parts.readPart(m,m.parts[0].key,raw));}
});
test('build keeps separate serialized revisions and musical versions without mutating a caller catalog',()=>{
 const personal=copy(snapshot),entry=personal.lessons.find(l=>l.id==='course01-03');entry.learning.practiceSteps[0]='Личная редакция';entry.order=123;const before=copy(personal),privateBundle=Parts.build(personal,options),partial=Parts.assemble(privateBundle.manifest,privateBundle.files);assert.deepEqual(personal,before);assert.equal(partial.lessons.find(l=>l.id===entry.id).learning.practiceSteps[0],'Личная редакция');assert.equal(partial.lessons.find(l=>l.id===entry.id).order,123);assert.notEqual(privateBundle.manifestSha256,bundle.manifestSha256);
 for(const bad of [{...copy(snapshot),privateProgress:{}},{...copy(snapshot),lessons:[...snapshot.lessons,snapshot.lessons[0]]}])assert.throws(()=>Parts.build(bad,options));assert.throws(()=>Parts.build(snapshot,{...options,themeIds:['unknown']}));
 // A private caller snapshot is round-tripped only in memory. The CLI uses published built-ins.
});
test('multiple themes retain the original flat lesson order rather than imposing grouping order',()=>{
 const other=app.lessons.find(l=>l.id==='course02-01').themeId,allThemes=[...themeIds,other],mixed=copy(snapshot);mixed.lessons.reverse();const b=Parts.build(mixed,{...options,themeIds:allThemes}),restored=Parts.assemble(b.manifest,b.files);assert.deepEqual(restored.lessons.map(l=>l.id),mixed.lessons.filter(l=>allThemes.includes(l.themeId)).map(l=>l.id));assert.equal(b.files.size,2);
});
test('invalid UTF-8 and inconsistent teaching-theme metadata fail even with matching declared byte hashes',()=>{
 const d=bundle.manifest.parts[0],bad=Buffer.from([123,34,120,34,58,34,255,34,125]),m=copy(bundle.manifest);Object.assign(m.parts[0],{sha256:hash(bad),key:'parts/v1/'+hash(bad)+'.json',bytes:bad.length});assert.throws(()=>Parts.readPart(m,m.parts[0].key,bad),/encoded data|encoding/);
 const original=JSON.parse(bundle.files.get(d.key));for(const edit of [p=>p.theme.contentKind='piece',p=>p.theme.order=0,p=>p.lessons[0].order=0]){const value=copy(original);edit(value);const raw=Buffer.from(JSON.stringify(value)),v=copy(bundle.manifest);Object.assign(v.parts[0],{sha256:hash(raw),key:'parts/v1/'+hash(raw)+'.json',bytes:raw.length});assert.throws(()=>Parts.readPart(v,v.parts[0].key,raw));}
});
test('writer rejects a linked parent before creating any child at the link target',t=>{
 const root=path.resolve(__dirname,'..'),tmp=path.join(root,'tmp'),dir=fs.mkdtempSync(path.join(tmp,'lesson-parts-link-test-')),target=path.join(dir,'target'),link=path.join(dir,'link');fs.mkdirSync(target);
 t.after(()=>{const actual=process.platform==='win32'?fs.realpathSync.native(dir):fs.realpathSync(dir);assert.equal(path.dirname(actual),tmp);assert.ok(path.basename(actual).startsWith('lesson-parts-link-test-'));fs.rmSync(actual,{recursive:true,force:false});});
 fs.symlinkSync(target,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>Parts.write(bundle,path.join(link,'new-child')),/linked/);assert.deepEqual(fs.readdirSync(target),[]);
});
test('immutable writer reuses exact bytes and refuses collisions, inconsistent bundle metadata and output escape',t=>{
 const root=path.resolve(__dirname,'..'),tmp=path.join(root,'tmp'),dir=fs.mkdtempSync(path.join(tmp,'lesson-parts-test-'));t.after(()=>{const actual=process.platform==='win32'?fs.realpathSync.native(dir):fs.realpathSync(dir);assert.equal(path.dirname(actual),tmp);assert.ok(path.basename(actual).startsWith('lesson-parts-test-'));fs.rmSync(actual,{recursive:true,force:false});});
 assert.equal(Parts.write(bundle,dir).created,2);assert.equal(Parts.write(bundle,dir).reused,2);const manifest=fs.readFileSync(path.join(dir,bundle.manifestKey));assert.equal(hash(manifest),bundle.manifestSha256);
 assert.throws(()=>Parts.write({...bundle,manifestKey:'manifests/v1/'+'0'.repeat(64)+'.json'},dir),/inconsistent/);assert.throws(()=>Parts.write(bundle,path.join(root,'outside-lesson-parts')),/outside/);
 const d=bundle.manifest.parts[0];fs.writeFileSync(path.join(dir,d.key),'corrupt isolated fixture');assert.throws(()=>Parts.write(bundle,dir),/collision/);assert.equal(fs.readFileSync(path.join(dir,d.key),'utf8'),'corrupt isolated fixture');assert.ok(fs.readFileSync(path.join(dir,bundle.manifestKey)).equals(manifest));
});
