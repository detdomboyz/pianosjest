'use strict';
// Explicit offline experiment from the verified published built-in catalog.
// Does not read browser storage or trainer-content.json; never writes dist/web.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {performance}=require('node:perf_hooks'),{loadApp}=require('../tests/helpers/load-app.cjs'),Parts=require('../piano-lesson-parts.js');
const ROOT=path.resolve(__dirname,'..'),WEB=path.join(ROOT,'dist/web'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function main(){
  const raw=fs.readFileSync(path.join(WEB,'web-release.json')),manifest=JSON.parse(raw),product=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/product-development-state.json'),'utf8'));
  if(hash(raw)!==product.release.serverDeployment.manifestSha256||manifest.version!==product.release.version)throw Error('Build must match the verified published release');
  for(const [name,item]of Object.entries(manifest.files)){if(path.basename(name)!==name)throw Error('Unexpected asset path');const bytes=fs.readFileSync(path.join(WEB,name));if(bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw Error('Source asset mismatch: '+name);}
  for(const name of ['piano-catalog-adapter.js','music-document.js'])if(hash(fs.readFileSync(path.join(ROOT,name)))!==manifest.files[name].sha256)throw Error('Local data adapter differs from published source');
  const start=performance.now(),app=loadApp({appRoot:WEB,web:true}),catalog=app.catalogSnapshot(),themeId=app.lessons.find(l=>l.id==='course01-03').themeId,sourceBefore=JSON.stringify(catalog),prepared=performance.now();
  const bundle=Parts.build(catalog,{release:manifest.version,webManifestSha256:hash(raw),themeIds:[themeId]}),built=performance.now(),verified=Parts.assemble(bundle.manifest,bundle.files);
  const expected=JSON.parse(JSON.stringify({version:7,themes:catalog.themes.filter(t=>t.id===themeId),lessons:catalog.lessons.filter(l=>l.themeId===themeId)}));
  if(JSON.stringify(verified)!==JSON.stringify(expected))throw Error('Topic reconstruction differs from serialized source');
  if(JSON.stringify(catalog)!==sourceBefore)throw Error('Source catalog mutated during preparation');
  const output=Parts.write(bundle,path.join(ROOT,'dist/lesson-parts',manifest.version));
  const stored=Parts.readManifest(fs.readFileSync(path.join(output.outDir,bundle.manifestKey)),bundle.manifestSha256),storedParts=new Map(stored.parts.map(d=>[d.key,fs.readFileSync(path.join(output.outDir,d.key))]));Parts.assemble(stored,storedParts);
  const part=bundle.manifest.parts[0],partBytes=bundle.files.get(part.key);
  const result={checkedAt:new Date().toISOString(),release:manifest.version,sourceWebManifestSha256:hash(raw),themeId,lessons:verified.lessons.length,manifestBytes:bundle.manifestBytes.length,partBytes:partBytes.length,partGzipLevel6Bytes:zlib.gzipSync(partBytes,{level:6}).length,partSha256:part.sha256,partKey:part.key,manifestSha256:bundle.manifestSha256,manifestKey:bundle.manifestKey,output,dataPreparationAndSnapshotMs:prepared-start,packageBuildMs:built-prepared,savedBytesReadAndReassembled:true,sourceCatalogUnchanged:true,webArtifactUnchanged:hash(fs.readFileSync(path.join(WEB,'web-release.json')))===hash(raw),browserRuntimeConnected:false,realBrowserTiming:false,networkRequests:0,s3Requests:0,userStorageReadOrWritten:false};
  console.log(JSON.stringify(result));return result;
}
if(require.main===module)main();
module.exports={main};
