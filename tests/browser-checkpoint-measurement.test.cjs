'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../tools/measure-browser-checkpoint.cjs'),Progress=require('../piano-progress-store.js'),Preparation=require('../piano-preparation-store.js');
test('checkpoint measurement distinguishes code units, encoded bytes and non-lossless UTF8',()=>{
 const x=M.textSize('Aя🎹');assert.equal(x.codeUnits,4);assert.equal(x.utf8Bytes,7);assert.equal(x.utf16CodeUnitBytes,8);assert.equal(x.utf8RoundtripExact,true);
 const orphan=M.textSize('\ud800');assert.equal(orphan.utf8RoundtripExact,false);assert.notEqual(orphan.utf16leSha256,M.textSize('\ufffd').utf16leSha256);assert.throws(()=>M.textSize(null),TypeError);
});
test('synthetic seven-key fixture keeps full catalog editions and uses real valid progress reducers',()=>{
 const f=M.buildFixture(),catalog=JSON.parse(f.catalogRaw),counts=require('./fixtures/piano-curriculum-counts.json');assert.equal(catalog.version,7);assert.equal(catalog.lessons.length,counts.catalogRecords);assert.equal(catalog.themes.length,counts.themes);assert.equal(catalog.savedAt,M.STAMP);assert.equal(f.entries.length,7);
 assert.ok(catalog.lessons.some(l=>l.learning?.contentReview?.previousInstruction));assert.ok(catalog.lessons.some(l=>l.lessonReview));assert.deepEqual(JSON.parse(f.diagnosticEnvelope).entries,f.entries);
 const p=Progress.inspect(f.entries[3].raw,M.NOW);assert.equal(p.progressRecords,counts.checkedMidiRouteLessons);assert.equal(p.receiptOperations.length,p.progressRecords*4);Preparation.parse(f.entries[4].raw,M.NOW);Preparation.fragments.parse(f.entries[5].raw,M.NOW);
});
test('bounded report validates compression and source pins without exporting raw learning or personal values',async()=>{
 const base=path.resolve(__dirname,'../tmp');fs.mkdirSync(base,{recursive:true});const webRoot=fs.mkdtempSync(path.join(base,'checkpoint-measure-test-')),Builder=require('../tools/build-web.cjs');let report;
 try{Builder.buildWeb({outDir:webRoot});report=await M.measure({rounds:1,webRoot});}finally{assert.equal(path.dirname(path.resolve(webRoot)),base);assert.ok(path.basename(webRoot).startsWith('checkpoint-measure-test-'));const allowed=new Set([...Builder.ASSETS,'web-runtime.js','web-release.json']);for(const name of fs.readdirSync(webRoot)){assert.ok(allowed.has(name));const file=path.join(webRoot,name);assert.ok(fs.lstatSync(file).isFile());fs.unlinkSync(file);}fs.rmdirSync(webRoot);}
 assert.equal(report.release,require('../package.json').version);assert.equal(report.compression.roundtripExact,true);assert.equal(report.timings.jsonParse.rounds,1);assert.equal(report.sevenKeyValues.length,7);assert.ok(report.catalog.utf8Bytes>report.compression.gzipLevel6.bytes);assert.equal(report.browserRecoveryImplemented,false);assert.equal(report.globalWriterBarrierImplemented,false);assert.equal(report.pendingIncluded,false);assert.equal(report.timings.nativeBrowserStorageMeasured,false);
 assert.ok(!JSON.stringify(report).includes('Полностью отпусти прежнюю'));assert.ok(!Object.hasOwn(report,'catalogRaw'));for(const [name,pin]of Object.entries(report.sourcePins))assert.equal(fs.statSync(name).size,pin.bytes);await assert.rejects(M.measure({rounds:16}),RangeError);
});
