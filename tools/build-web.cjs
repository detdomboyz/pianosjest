'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const ASSETS=Object.freeze([
  'index.html','chopin-theme.js','audio-transcriber.js','fingering.js','beginner-fingering.js',
  'practice-assessment.js','piano-progress-store.js','piano-preparation.js','piano-preparation-store.js','piano-preparation-fragment.js','piano-preparation-capture.js','piano-preparation-transfer.js','piano-preparation-import.js','curriculum.js','curriculum-plan.js','catalog-sections.js',
  'lesson-review-baseline.js','lesson-quality.js','lesson-development.js','piano-lesson-development.js',
  'piano-learning-ui.js','catalog-transfer.js','music-document.js','piano-catalog-adapter.js','catalog-sections.css','piano-learning-ui.css'
]);
function buildWeb({outDir=path.join(ROOT,'dist','web')}={}){
  outDir=path.resolve(outDir);
  const allowed=[path.join(ROOT,'dist'),path.join(ROOT,'tmp')];
  if(!allowed.some(base=>outDir.startsWith(base+path.sep)))throw Error('Build output must be a subdirectory of dist or tmp');
  fs.mkdirSync(outDir,{recursive:true});
  // Refuse stale/unexpected files: a public directory is an allowlist, never the project root.
  const names=[...ASSETS,'web-runtime.js','web-release.json'];
  const extra=fs.readdirSync(outDir).filter(name=>!names.includes(name));
  if(extra.length)throw Error('Unexpected files in web output; choose a clean output directory: '+extra.join(', '));
  for(const name of ASSETS){
    const source=fs.readFileSync(path.join(ROOT,name));
    let output=source;
    if(name==='index.html'){
      let html=source.toString('utf8');
      const localAssets=[...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"?#]+)"/g)].map(m=>m[1]);
      if(localAssets.some(asset=>!ASSETS.includes(asset)))throw Error('Unlisted asset in index.html');
      if(!html.includes('<script src="chopin-theme.js">'))throw Error('Runtime insertion anchor missing');
      html=html.replace('<script src="chopin-theme.js">','<script src="web-runtime.js"></script>\n<script src="chopin-theme.js">');
      output=Buffer.from(html);
    }
    fs.writeFileSync(path.join(outDir,name),output);
  }
  fs.writeFileSync(path.join(outDir,'web-runtime.js'),"window.PBT_RUNTIME=Object.freeze({mode:'web',storage:'browser'});\n");
  const manifest={version:require('../package.json').version,targetDomain:'melodiajest.ru',domainStatus:'not-purchased',mode:'web',storage:'browser',nativeCompanion:false,files:{}};
  for(const name of [...ASSETS,'web-runtime.js']){
    const bytes=fs.readFileSync(path.join(outDir,name));
    manifest.files[name]={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  }
  fs.writeFileSync(path.join(outDir,'web-release.json'),JSON.stringify(manifest,null,2)+'\n');
  return {outDir,...manifest};
}
if(require.main===module){const r=buildWeb();console.log('Web release '+r.version+': '+r.outDir+' ('+Object.keys(r.files).length+' public assets; browser-only private data)');}
module.exports={buildWeb,ASSETS};
