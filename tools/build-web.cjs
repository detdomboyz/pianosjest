'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const ASSETS=Object.freeze(require('../deploy/shared-host/public-assets.json'));
function buildWeb({outDir=path.join(ROOT,'dist','web'),service=false}={}){
  outDir=path.resolve(outDir);
  const allowed=[path.join(ROOT,'dist'),path.join(ROOT,'tmp')];
  if(!allowed.some(base=>outDir.startsWith(base+path.sep)))throw Error('Build output must be a subdirectory of dist or tmp');
  fs.mkdirSync(outDir,{recursive:true});
  // Refuse stale/unexpected files: a public directory is an allowlist, never the project root.
  const names=[...ASSETS,'web-runtime.js','web-release.json'];
  const extra=fs.readdirSync(outDir).filter(name=>!names.includes(name));
  if(extra.length)throw Error('Unexpected files in web output; choose a clean output directory: '+extra.join(', '));
  for(const name of ASSETS){
    const sourceName=name==='trainer.html'?'index.html':name==='index.html'&&service?'learn.html':name;
    const source=fs.readFileSync(path.join(ROOT,sourceName));
    let output=source;
    if(name==='index.html'||name==='trainer.html'){
      let html=source.toString('utf8');
      const localAssets=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"?#]+)"/g)].map(m=>m[1]);
      if(localAssets.some(asset=>!ASSETS.includes(asset)&&asset!=='web-runtime.js'))throw Error('Unlisted asset in '+sourceName);
      if(sourceName==='index.html'){
        if(!html.includes('<script src="chopin-theme.js">'))throw Error('Runtime insertion anchor missing');
        html=html.replace('<script src="chopin-theme.js">','<script src="web-runtime.js"></script>\n<script src="chopin-theme.js">');
      }
      output=Buffer.from(html);
    }
    fs.writeFileSync(path.join(outDir,name),output);
  }
  fs.writeFileSync(path.join(outDir,'web-runtime.js'),service?"window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'account',serviceVersion:1,gameVersion:1,version:"+JSON.stringify(require('../package.json').version)+"});\n":"window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'browser'});\n");
  const manifest={version:require('../package.json').version,targetDomain:'melodiajest.ru',domainStatus:'registered',mode:'web',storage:service?'account':'browser',nativeCompanion:false,...(service?{serviceVersion:1,gameVersion:1,personalProgress:'database-and-versioned-browser-history',sourceEntries:{'index.html':'learn.html','trainer.html':'index.html'}}:{}),files:{}};
  for(const name of [...ASSETS,'web-runtime.js']){
    const bytes=fs.readFileSync(path.join(outDir,name));
    manifest.files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  }
  fs.writeFileSync(path.join(outDir,'web-release.json'),JSON.stringify(manifest,null,2)+'\n');
  return {outDir,...manifest};
}
if(require.main===module){const r=buildWeb({service:process.argv.includes('--service')});console.log('Web release '+r.version+': '+r.outDir+' ('+Object.keys(r.files).length+' public assets; storage: '+r.storage+')');}
module.exports={buildWeb,ASSETS};
