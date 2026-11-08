'use strict';
// ExecStartPre for our dedicated daemon, never a general socket remover.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const socket='/run/melodiajest-account/api.sock',parent=path.dirname(socket);
if(process.platform!=='linux'||fs.realpathSync(parent)!==parent||!fs.statSync(parent).isDirectory()||fs.statSync(parent).uid!==process.getuid())throw Error('Unsafe owned socket directory');
if(fs.existsSync(socket)){
  const info=fs.lstatSync(socket);if(!info.isSocket()||info.isSymbolicLink()||info.uid!==process.getuid())throw Error('Refuse unowned or non-socket path');
  const client=net.createConnection(socket);client.setTimeout(2000);
  client.once('connect',()=>{client.destroy();console.error('An API process still owns this socket');process.exitCode=1;});
  client.once('timeout',()=>{client.destroy();console.error('Socket state is unknown; cleanup refused');process.exitCode=1;});
  client.once('error',error=>{if(error.code!=='ECONNREFUSED'&&error.code!=='ENOENT'){console.error('Socket cleanup refused:',error.code);process.exitCode=1;return;}if(fs.existsSync(socket)){const fresh=fs.lstatSync(socket);if(!fresh.isSocket()||fresh.ino!==info.ino||fresh.uid!==process.getuid())throw Error('Socket changed during inspection');fs.unlinkSync(socket);}});
}
