'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{once}=require('node:events'),{makeReaderServer}=require('../tools/serve.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'dist','reader'),fixtures=JSON.parse(fs.readFileSync(path.join(ROOT,'web-reader/.build/fixtures.json'),'utf8'));

test('first-mode real TSX output keeps the same note heads but has no named answers, fingers or source data attributes',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{StaffReader}=require('../.build/StaffReader.js');
 for(const key of ['treble','bass']){const s=fixtures[key],props={view:s.view,title:'Первая проба',idPrefix:'first-'+key,execution:s.projection.execution},study=renderToStaticMarkup(React.createElement(StaffReader,props)),first=renderToStaticMarkup(React.createElement(StaffReader,{...props,mode:'first'}));assert.equal((first.match(/class="note-head"/g)||[]).length,4);assert.equal((first.match(/class="staff-line"/g)||[]).length,5);assert.deepEqual([...first.matchAll(/<ellipse[^>]+cy="([^"]+)"/g)].map(m=>m[1]),[...study.matchAll(/<ellipse[^>]+cy="([^"]+)"/g)].map(m=>m[1]));assert.doesNotMatch(first,/\b[CDЕE][34]\b|data-midi|data-note-id|data-staff-position|data-start-beat|data-duration-beats|<details\b|Правая,|Левая,/);assert.match(first,/первая проба без подсказки/);assert.match(study,/Названия, пальцы и время нот/);}
});

test('first-mode unsupported view suppresses the whole phrase without inventing a replacement note',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{StaffReader}=require('../.build/StaffReader.js'),s=fixtures.unsupported,before=JSON.stringify(s),html=renderToStaticMarkup(React.createElement(StaffReader,{view:s.view,title:'Неподдержанная запись',idPrefix:'first-unsupported',mode:'first'}));assert.match(html,/Эту запись пока нельзя показать/);assert.doesNotMatch(html,/class="note-head"|data-midi|<details/);assert.equal(JSON.stringify(s),before);
});

test('actual TSX server output retains each projected note ID, pitch, timing and separate hand assignment',()=>{
 for(const[file,key]of [['index.html','treble'],['bass.html','bass']]){const html=fs.readFileSync(path.join(OUT,file),'utf8'),s=fixtures[key];assert.equal((html.match(/class="staff-line"/g)||[]).length,5);assert.equal((html.match(/class="note-head"/g)||[]).length,4);assert.ok(html.includes('data-view-status="ready"'));for(const n of s.view.notes){assert.ok(html.includes('data-note-id="'+n.noteId.replaceAll('"','&quot;')+'"'));assert.ok(html.includes('data-midi="'+n.midi+'"'));assert.ok(html.includes('data-staff-position="'+n.staffPosition+'"'));assert.ok(html.includes('data-start-beat="'+n.startBeat+'"'));assert.ok(html.includes('data-duration-beats="'+n.durationBeats+'"'));}assert.ok(html.includes(key==='treble'?'Правая, 1':'Левая, 5'));assert.match(html,/Названия, пальцы и время нот/);assert.doesNotMatch(html,/<script\b|localStorage|\/api\//i);}
});

test('an unsupported sharp is not silently removed or respelled into a shorter displayed melody',()=>{
 const html=fs.readFileSync(path.join(OUT,'limitations.html'),'utf8');assert.equal(fixtures.unsupported.music.notes[0].pitch.value,61);assert.equal(fixtures.unsupported.view.status,'unsupported');assert.equal(fixtures.unsupported.view.notes.length,0);assert.match(html,/Эту запись пока нельзя показать/);assert.match(html,/SPELLING_UNSUPPORTED/);assert.doesNotMatch(html,/class="note-head"/);
});

test('isolated reader export is exactly its allowlist with authentic licensed local font and content hashes',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(OUT,'reader-release.json'),'utf8'));assert.equal(manifest.runtimeScripts,0);assert.equal(manifest.registeredLessons,0);assert.equal(manifest.storageWrites,false);assert.equal(manifest.react,'19.3.0');assert.equal(manifest.typescript,'5.8.3');assert.equal(Object.keys(manifest.files).length,6);assert.deepEqual(fs.readdirSync(OUT).sort(),[...Object.keys(manifest.files),'reader-release.json'].sort());for(const[p,spec]of Object.entries(manifest.files)){const bytes=fs.readFileSync(path.join(OUT,p));assert.equal(bytes.length,spec.bytes);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),spec.sha256);}assert.equal(manifest.files['Bravura.woff2'].sha256,'e68df66446e3ffa6f474ce9eb2949e938102406f12d8f40ad8754398c50f55d4');assert.match(fs.readFileSync(path.join(OUT,'OFL-Bravura.txt'),'utf8'),/SIL OPEN FONT LICENSE Version 1\.1/);
});

test('reader preview serves only exported files and denies private APIs, mutations, source and traversal',async t=>{
 const server=makeReaderServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const base='http://127.0.0.1:'+server.address().port;
 for(const p of ['/','/bass.html','/limitations.html','/reader.css'])assert.equal((await fetch(base+p)).status,200,p);const font=await fetch(base+'/Bravura.woff2');assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2');assert.match(font.headers.get('content-security-policy'),/default-src 'none'/);
 for(const p of ['/api/content','/api/midi-keyboard/launch','/api/midi-bridge/events','/server.cjs','/trainer-content.json','/StaffReader.tsx','/piano-staff-view.js','/%2e%2e%2fpackage.json'])assert.equal((await fetch(base+p)).status,404,p);assert.equal((await fetch(base+'/',{method:'POST',body:'{}'})).status,405);const head=await fetch(base+'/bass.html',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});
