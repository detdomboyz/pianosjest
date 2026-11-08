'use strict';
// Loopback-only integration preview. Static files use the exact web allowlist.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {createService}=require('./server.cjs');
const {ASSETS}=require('../tools/build-web.cjs');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
async function createPreview({root,dataDir,port=0}){
  root=path.resolve(root);const allowed=new Set([...ASSETS,'web-runtime.js','web-release.json']);
  const api=await createService({dataDir,origin:'http://127.0.0.1:'+port,development:true});
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/service/v1/'))return api.server.emit('request',req,res);
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    if(req.url==='/__qa__/mobile.html'){
      const bytes=fs.readFileSync(path.join(__dirname,'fixtures/mobile-preview.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':bytes.length});return res.end(req.method==='HEAD'?undefined:bytes);
    }
    let name;try{name=decodeURIComponent(req.url.split('?')[0]);}catch{res.writeHead(400);return res.end();}
    name=name==='/'?'index.html':name.slice(1);if(!allowed.has(name)){res.writeHead(404);return res.end();}
    fs.readFile(path.join(root,name),(error,bytes)=>{if(error){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':TYPES[path.extname(name)],'Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});api.options.origin.port=String(server.address().port);
  return {server,api,origin:api.options.origin.origin,close:async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await api.close();}};
}
if(require.main===module){
  if(!process.env.MELODIA_SERVICE_DATA_DIR)throw Error('An explicit isolated data directory is required');
  createPreview({root:process.env.MELODIA_SERVICE_PREVIEW_ROOT||path.resolve(__dirname,'../tmp/account-service-web-21'),dataDir:process.env.MELODIA_SERVICE_DATA_DIR,port:Number(process.env.MELODIA_SERVICE_PREVIEW_PORT||63366)}).then(preview=>{
    console.log('Isolated MelodiaJest account preview: '+preview.origin);
    let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(!closing){closing=true;void preview.close().then(()=>process.exit(0));}});
  }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
module.exports={createPreview};
