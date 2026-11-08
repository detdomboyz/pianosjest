'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn,execFileSync}=require('node:child_process');
const {PostgresDatabase}=require('./database.cjs'),{exportPostgres,describe}=require('./migration.cjs'),{check,sha}=require('./security.cjs');
async function consistentSnapshot(database,exporter){
  return database.transaction(async()=>{
    const dataset=await exportPostgres(database),snapshot=(await database.execute('get','SELECT pg_export_snapshot() AS snapshot')).snapshot;
    check(/^[A-Fa-f0-9-]+$/.test(snapshot),500,'SNAPSHOT_ID','Некорректный PostgreSQL snapshot.');
    const exported=await exporter(snapshot);return {...describe(dataset.tables,{excludeVolatile:true}),exported,consistentSnapshot:true,restoredUsersMustSignIn:true};
  },'pg-backup',{snapshot:true});
}
async function ownSnapshot(target){
  check(process.platform==='linux'&&process.getuid()===0,500,'BACKUP_CONTEXT','Нужен собственный maintenance-контекст.');
  target=path.resolve(target);check(target.startsWith('/opt/melodiajest/account-backup-work/')&&fs.realpathSync(path.dirname(target))===path.dirname(target)&&!fs.existsSync(target),500,'BACKUP_TARGET','Ожидается новый собственный файл копии.');
  const pin=require('./postgres-runtime.json'),container=JSON.parse(execFileSync('docker',['inspect','melodiajest-postgres-1'],{encoding:'utf8',timeout:10000}))[0];
  check(container.Image===pin.imageId&&container.Config.Labels['com.melodiajest.role']==='postgres'&&container.HostConfig.NetworkMode==='none'&&container.Mounts.some(item=>item.Source==='/opt/melodiajest/postgres-data'&&item.Destination==='/var/lib/postgresql'),500,'POSTGRES_IDENTITY','Не совпал собственный контейнер PostgreSQL.');
  const database=new PostgresDatabase({host:'/run/melodiajest-postgres',database:'melodiajest',user:'melodiajest_owner',ssl:false});
  try{return await consistentSnapshot(database,async snapshot=>{
    const fd=fs.openSync(target,'wx',0o600);
    try{await new Promise((resolve,reject)=>{const child=spawn('docker',['exec','--user','postgres','melodiajest-postgres-1','pg_dump','-h','/run/melodiajest-postgres','-U','melodiajest_owner','-d','melodiajest','--format=custom','--compress=3','--no-owner','--no-acl','--snapshot='+snapshot],{stdio:['ignore',fd,'pipe']});let bytes=0;child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)child.kill();});child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Own PostgreSQL dump failed')));});fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const bytes=fs.readFileSync(target);check(bytes.length>0&&bytes.length<=256*1024*1024,500,'BACKUP_SIZE','Неверный размер дампа.');return {bytes:bytes.length,sha256:sha(bytes)};
  });}finally{await database.close();}
}
if(require.main===module){ownSnapshot(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({status:'failed',code:error.code||error.name}));process.exitCode=1;});}
module.exports={consistentSnapshot,ownSnapshot};
