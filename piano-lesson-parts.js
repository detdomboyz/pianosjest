'use strict';
// Offline producer and filesystem writer. The data validator is shared with browsers.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Codec=require('./piano-lesson-parts-codec.js');
const {VERSION,MAX_PART_BYTES,MAX_MANIFEST_BYTES,validateManifest}=Codec;
const {clone,requireValue,isObject,id,sha,source,ids,same}=Codec.helpers;
const encoded=(value,max)=>Buffer.from(Codec.helpers.encoded(value,max));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function readManifest(bytes,expectedSha256){requireValue(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=MAX_MANIFEST_BYTES,'manifest byte limit exceeded');const raw=Buffer.from(bytes);requireValue(sha(expectedSha256)&&hash(raw)===expectedSha256,'manifest SHA256 mismatch');return Codec.readManifestData(raw);}
function readPart(manifest,key,bytes){validateManifest(manifest);const d=manifest.parts.find(p=>p.key===key);requireValue(d,'unlisted part');requireValue(bytes instanceof Uint8Array&&bytes.byteLength===d.bytes,'part size/SHA256 mismatch');const raw=Buffer.from(bytes);requireValue(hash(raw)===d.sha256,'part size/SHA256 mismatch');return Codec.readPartData(manifest,key,raw);}
function build(snapshot,{release,webManifestSha256,themeIds}){
  requireValue(isObject(snapshot)&&snapshot.version===7&&Array.isArray(snapshot.themes)&&Array.isArray(snapshot.lessons),'catalog v7 required');
  requireValue(Object.keys(snapshot).every(k=>['version','savedAt','themes','lessons'].includes(k)),'private or unknown catalog root fields');ids(themeIds);requireValue(themeIds.length<=64,'too many themes');
  requireValue(snapshot.themes.every(t=>isObject(t)&&id(t.id))&&new Set(snapshot.themes.map(t=>t.id)).size===snapshot.themes.length,'invalid catalog themes');
  requireValue(snapshot.lessons.every(l=>isObject(l)&&id(l.id))&&new Set(snapshot.lessons.map(l=>l.id)).size===snapshot.lessons.length,'duplicate catalog lessons');
  const selected=snapshot.themes.filter(t=>themeIds.includes(t.id));requireValue(selected.length===themeIds.length,'unknown theme');const origin={release,webManifestSha256};source(origin);
  const parts=[],files=new Map();
  for(const theme of selected){const lessons=snapshot.lessons.filter(l=>l.themeId===theme.id);ids(lessons.map(l=>l.id));const payload={schema:'melodiajest-piano-topic',version:VERSION,instrument:'piano',catalogFormat:7,source:origin,theme,lessons};
    const bytes=encoded(payload,MAX_PART_BYTES),sha256=hash(bytes),key='parts/v1/'+sha256+'.json';parts.push({themeId:theme.id,key,sha256,bytes:bytes.length,lessonIds:lessons.map(l=>l.id)});files.set(key,bytes);}
  const manifest={schema:'melodiajest-piano-parts',version:VERSION,instrument:'piano',catalogFormat:7,source:origin,themeOrder:selected.map(t=>t.id),lessonOrder:snapshot.lessons.filter(l=>themeIds.includes(l.themeId)).map(l=>l.id),parts};
  validateManifest(manifest);for(const [key,bytes]of files)readPart(manifest,key,bytes);const manifestBytes=encoded(manifest,MAX_MANIFEST_BYTES),manifestSha256=hash(manifestBytes);
  return {manifest,manifestBytes,manifestSha256,manifestKey:'manifests/v1/'+manifestSha256+'.json',files};
}
function assemble(manifest,files){
  validateManifest(manifest);requireValue(files instanceof Map&&files.size===manifest.parts.length,'missing or extra package files');const themes=new Map(),lessons=new Map();
  for(const d of manifest.parts){const part=readPart(manifest,d.key,files.get(d.key));themes.set(part.theme.id,part.theme);for(const l of part.lessons)lessons.set(l.id,l);}
  return {version:7,themes:manifest.themeOrder.map(id=>clone(themes.get(id))),lessons:manifest.lessonOrder.map(id=>clone(lessons.get(id)))};
}
function write(bundle,outDir){
  requireValue(same(readManifest(bundle.manifestBytes,bundle.manifestSha256),bundle.manifest)&&bundle.manifestKey==='manifests/v1/'+bundle.manifestSha256+'.json','inconsistent bundle manifest');assemble(bundle.manifest,bundle.files);
  const root=path.resolve(__dirname),dest=path.resolve(outDir),allowed=[path.join(root,'dist','lesson-parts'),path.join(root,'tmp')];requireValue(allowed.some(base=>dest===base||dest.startsWith(base+path.sep)),'output outside lesson-parts or tmp');
  const real=p=>process.platform==='win32'?fs.realpathSync.native(p):fs.realpathSync(p);
  function directory(dir){let at=root;for(const segment of path.relative(root,dir).split(path.sep)){at=path.join(at,segment);try{const stat=fs.lstatSync(at);requireValue(stat.isDirectory()&&!stat.isSymbolicLink(),'linked or non-directory parent');}catch(error){if(error.code!=='ENOENT')throw error;fs.mkdirSync(at);}requireValue(real(at)===at,'linked output directory');}}
  directory(dest);
  let created=0,reused=0;
  for(const [key,bytes]of [...bundle.files,[bundle.manifestKey,bundle.manifestBytes]]){
    requireValue(/^(parts|manifests)\/v1\/[a-f0-9]{64}\.json$/.test(key),'unsafe artifact key');const file=path.join(dest,...key.split('/')),parent=path.dirname(file);directory(parent);
    try{fs.writeFileSync(file,bytes,{flag:'wx'});created++;}catch(error){if(error.code!=='EEXIST')throw error;const stat=fs.lstatSync(file);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===bytes.length&&fs.readFileSync(file).equals(bytes),'immutable artifact collision');reused++;}
    requireValue(fs.readFileSync(file).equals(bytes),'written artifact verification failed');
  }
  return {outDir:dest,created,reused,manifestKey:bundle.manifestKey,manifestSha256:bundle.manifestSha256};
}
module.exports={VERSION,MAX_PART_BYTES,MAX_MANIFEST_BYTES,build,validateManifest,readManifest,readPart,assemble,write};
