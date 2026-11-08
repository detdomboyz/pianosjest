'use strict';
// Optional service runtime; the original trainer and npm test stay on Node 20.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),candidate=path.join(ROOT,'tmp/service-runtime/node.exe');
let node=process.execPath;
if(process.versions.node!=='24.22.2'){
  if(!fs.existsSync(candidate))throw Error('Prepare the optional service runtime: python -B tools/prepare-service-runtime.py. System Node is unchanged.');
  const sha=crypto.createHash('sha256').update(fs.readFileSync(candidate)).digest('hex');
  if(sha!=='1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9')throw Error('Portable service runtime checksum differs');
  node=candidate;
}
const files=fs.readdirSync(path.join(ROOT,'service/tests')).filter(n=>n.endsWith('.test.cjs')).sort().map(n=>path.join(ROOT,'service/tests',n));
const result=spawnSync(node,['--preserve-symlinks','--preserve-symlinks-main','--test','--test-reporter=tap',...files],{cwd:ROOT,stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
