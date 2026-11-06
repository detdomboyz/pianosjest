'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {ASSETS}=require('./build-web.cjs');
const DEFAULT_ROOT=path.resolve(__dirname,'../dist/web');
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
// Local preview of the exact export. No API handlers or access to the source directory.
function makeWebServer({root=DEFAULT_ROOT}={}){
  const allowed=new Set([...ASSETS,'web-runtime.js','web-release.json']);
  return http.createServer((req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end('Method not allowed');}
    let name;try{name=decodeURIComponent((req.url||'/').split('?')[0]);}catch{res.writeHead(400);return res.end('Bad request');}
    name=name==='/'?'index.html':name.slice(1);
    if(!allowed.has(name)){res.writeHead(404);return res.end('Not found');}
    fs.readFile(path.join(root,name),(error,bytes)=>{
      if(error){res.writeHead(404);return res.end('Build the web release first: npm run build:web');}
      res.writeHead(200,{'Content-Type':TYPES[path.extname(name)]||'application/octet-stream','Content-Length':bytes.length});
      res.end(req.method==='HEAD'?undefined:bytes);
    });
  });
}
if(require.main===module){
  const server=makeWebServer();
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  server.listen(Number(process.env.MELODIA_PREVIEW_PORT)||4173,'127.0.0.1',()=>console.log('MelodiaJest web preview: http://127.0.0.1:'+server.address().port));
}
module.exports={makeWebServer};
