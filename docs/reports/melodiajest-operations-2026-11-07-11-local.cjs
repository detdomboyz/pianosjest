'use strict';
// Read-only diagnostic of the published allowlist and isolated copies. No app boot.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict'),cp=require('node:child_process'),{performance}=require('node:perf_hooks');
const realPath=p=>process.platform==='win32'?fs.realpathSync.native(p):fs.realpathSync(p);
const ROOT=path.resolve(process.cwd()),WEB=path.join(ROOT,'dist','web'),TMP=realPath(path.join(ROOT,'tmp'));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const raw=fs.readFileSync(path.join(WEB,'web-release.json')),manifest=JSON.parse(raw),product=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/product-development-state.json'),'utf8'));
assert.equal(manifest.version,'23.5.38');assert.equal(hash(raw),product.release.serverDeployment.manifestSha256);
const stats=values=>({samples:values,min:Math.min(...values),median:[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)],max:Math.max(...values)});
if(process.argv.includes('--app-sample')){
  assert.equal(typeof global.gc,'function');global.gc();const before=process.memoryUsage(),cpu=process.cpuUsage(),start=performance.now();
  const app=require(path.join(ROOT,'tests/helpers/load-app.cjs')).loadApp({appRoot:WEB,web:true});
  const initMs=performance.now()-start,usedCpu=process.cpuUsage(cpu),beforeGc=process.memoryUsage();global.gc();const retained=process.memoryUsage();
  const A=require(path.join(ROOT,'practice-assessment.js')),fixture=JSON.parse(fs.readFileSync(path.join(ROOT,'tests/fixtures/piano-before-eighth-pairs-triple-meter-v1.json'),'utf8'));
  assert.equal(app.lessons.length,572);
  for(const old of fixture.lessons){const l=app.lessons.find(l=>l.id===old.id);assert.equal(A.pianoSignature(l),old.grade);assert.equal(hash(JSON.stringify({steps:l.steps,rhythm:l.rhythm,fingeringSpec:l.fingeringSpec,contentKind:l.contentKind})),old.musicSha256);}
  const snapStart=performance.now(),snapshot=JSON.stringify(app.catalogSnapshot()),snapshotMs=performance.now()-snapStart;
  const sideStart=performance.now(),sidebar=app.sidebarHtml(),sidebarMs=performance.now()-sideStart;
  console.log(JSON.stringify({initMs,cpuUserMs:usedCpu.user/1000,cpuSystemMs:usedCpu.system/1000,heapBefore:before.heapUsed,heapAtEndBeforeGc:beforeGc.heapUsed,retainedHeap:retained.heapUsed,retainedHeapDelta:retained.heapUsed-before.heapUsed,rssAtEnd:retained.rss,snapshotBytes:Buffer.byteLength(snapshot),snapshotMs,sidebarBytes:Buffer.byteLength(sidebar),sidebarMs,sidebarLessonButtons:(sidebar.match(/data-lesson="/g)||[]).length,lessons:app.lessons.length,musicalVersionsVerified:fixture.lessons.length,realBrowser:false,bootNetworkAndUserStorageWrites:false}));
  process.exit(0);
}
const assets=[];
for(const name of [...Object.keys(manifest.files),'web-release.json']){
  assert.equal(path.basename(name),name);const bytes=fs.readFileSync(path.join(WEB,name));
  if(name!=='web-release.json'){assert.equal(bytes.length,manifest.files[name].bytes);assert.equal(hash(bytes),manifest.files[name].sha256);}
  const gzip=zlib.gzipSync(bytes,{level:6});assert.ok(zlib.gunzipSync(gzip).equals(bytes));assets.push({name,bytes:bytes.length,gzipLevel6Bytes:gzip.length,sha256:hash(bytes)});
}
assert.equal(assets.length,28);
const {buildWeb}=require(path.join(ROOT,'tools/build-web.cjs')),builds=[];
for(let i=0;i<3;i++){
  const directory=fs.mkdtempSync(path.join(TMP,'web-baseline-11-'));let result;
  try{const cpu=process.cpuUsage(),start=performance.now();result=buildWeb({outDir:directory});const wallMs=performance.now()-start,used=process.cpuUsage(cpu);assert.deepEqual(result.files,manifest.files);assert.equal(hash(fs.readFileSync(path.join(directory,'web-release.json'))),hash(raw));builds.push({wallMs,cpuUserMs:used.user/1000,cpuSystemMs:used.system/1000,publicFiles:Object.keys(result.files).length});}
  finally{const absolute=realPath(directory);assert.equal(path.dirname(absolute).toLowerCase(),TMP.toLowerCase());assert.ok(path.basename(absolute).startsWith('web-baseline-11-'));fs.rmSync(absolute,{recursive:true,force:false});}
}
const appSamples=[];
for(let i=0;i<3;i++){const sample=JSON.parse(cp.execFileSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main','--expose-gc',__filename,'--app-sample'],{cwd:ROOT,encoding:'utf8',timeout:45000}));appSamples.push(sample);}
assert.equal(new Set(appSamples.map(x=>x.snapshotBytes)).size,1);assert.equal(hash(fs.readFileSync(path.join(WEB,'web-release.json'))),hash(raw));
const groupNames=['piano-lesson-development.js','lesson-development.js','lesson-quality.js','lesson-review-baseline.js','curriculum-plan.js'];
const sum=(items,key)=>items.reduce((n,x)=>n+x[key],0),group=assets.filter(x=>groupNames.includes(x.name));
const report={checkedAt:new Date().toISOString(),version:manifest.version,manifestSha256:hash(raw),runtime:{node:process.version,platform:process.platform,arch:process.arch},scope:'allowlisted local bytes, three isolated buildWeb calls and three fresh Node/VM app-data samples; no browser boot/layout/paint, no user catalog or progress',assets,totals:{files:assets.length,bytes:sum(assets,'bytes'),gzipLevel6Bytes:sum(assets,'gzipLevel6Bytes')},lessonCodeAndMap:{names:groupNames,bytes:sum(group,'bytes'),gzipLevel6Bytes:sum(group,'gzipLevel6Bytes')},buildSamples:builds,buildWallMs:stats(builds.map(x=>x.wallMs)),appSamples,appInitMs:stats(appSamples.map(x=>x.initMs)),appCpuMs:stats(appSamples.map(x=>x.cpuUserMs+x.cpuSystemMs)),sidebarMs:stats(appSamples.map(x=>x.sidebarMs)),retainedHeapDeltaBytes:stats(appSamples.map(x=>x.retainedHeapDelta)),canonicalDistUnchanged:true,temporaryBuildsRemoved:true,newDependenciesInstalled:false};
const output=path.join(TMP,'melodiajest-11-local.json');fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,version:report.version,totals:report.totals,buildWallMs:report.buildWallMs,appInitMs:report.appInitMs,sidebarMs:report.sidebarMs,snapshotBytes:appSamples[0].snapshotBytes,retainedHeapDeltaBytes:report.retainedHeapDeltaBytes}));
