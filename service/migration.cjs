'use strict';
// Explicit, lossless import into an empty OWN database. Never drops a table or
// restores an existing production dataset. The old SQLite snapshot is retained.
const fs=require('node:fs'),path=require('node:path');
const {TABLES,VERSION}=require('./data-model.cjs'),{hash}=require('./canonical.cjs'),{check}=require('./security.cjs'),{openStore}=require('./store.cjs');
function describe(tables,{excludeVolatile=false}={}){
  const ordered=Object.fromEntries(Object.entries(TABLES).map(([table,order])=>[table,excludeVolatile&&['sessions','rate_limits'].includes(table)?[]:[...(tables[table]||[])].sort((a,b)=>{for(const key of order.split(',')){const x=a[key],y=b[key],difference=typeof x==='number'&&typeof y==='number'?x-y:Buffer.compare(Buffer.from(String(x)),Buffer.from(String(y)));if(difference)return difference;}return 0;})]));
  return {dataModelVersion:VERSION,digest:hash(ordered),rows:Object.values(ordered).reduce((n,rows)=>n+rows.length,0),counts:Object.fromEntries(Object.entries(ordered).map(([name,rows])=>[name,rows.length]))};
}
function exportSqlite(filename){
  const store=openStore(filename,{readOnly:true});try{
    store.db.exec('BEGIN');const names=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name);check(names.every(name=>name in TABLES||name==='service_metadata'),500,'MIGRATION_SOURCE','В исходной БД найдены неизвестные таблицы; они не пропускаются молча.');
    check(store.db.prepare('PRAGMA integrity_check').get().integrity_check==='ok'&&store.db.prepare('PRAGMA foreign_key_check').all().length===0,500,'MIGRATION_SOURCE','Исходная копия не прошла проверку целостности.');
    const tables=Object.fromEntries(Object.entries(TABLES).map(([table,order])=>[table,store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?store.db.prepare('SELECT * FROM '+table+' ORDER BY '+order).all():[]]));
    return {kind:'melodiajest-private-dataset',version:VERSION,...describe(tables),tables};
  }finally{store.close();}
}
async function exportPostgres(database){
  return database.transaction(async()=>{
    const tables={};for(const [table,order]of Object.entries(TABLES))tables[table]=await database.execute('all','SELECT * FROM '+table+' ORDER BY '+order);
    return {kind:'melodiajest-private-dataset',version:VERSION,...describe(tables),tables};
  },'data-inspection',{snapshot:true});
}
function validate(dataset,expectedDigest){
  check(dataset?.kind==='melodiajest-private-dataset'&&dataset.version===VERSION&&dataset.digest===expectedDigest&&JSON.stringify(Object.keys(dataset.tables).sort())===JSON.stringify(Object.keys(TABLES).sort()),400,'MIGRATION_INPUT','Неверный набор данных миграции.');
  let cells=0;for(const rows of Object.values(dataset.tables)){
    check(Array.isArray(rows)&&rows.length<=1000000,400,'MIGRATION_INPUT','Превышен размер таблицы.');
    for(const row of rows){check(row&&typeof row==='object'&&!Array.isArray(row),400,'MIGRATION_INPUT','Неверная строка данных.');for(const [key,value]of Object.entries(row))check(/^[a-z_]+$/.test(key)&&++cells<=2000000&&(value===null||Number.isSafeInteger(value)||typeof value==='string'&&Buffer.byteLength(value)<=6*1024*1024),400,'MIGRATION_INPUT','Неверное поле данных.');}
  }
  check(describe(dataset.tables).digest===expectedDigest,400,'MIGRATION_DIGEST','Не совпал отпечаток исходных данных.');return dataset;
}
function commentOrder(rows){const byId=new Map(rows.map(row=>[row.id,row])),visiting=new Set(),done=new Set(),result=[];function visit(row){if(done.has(row.id))return;check(!visiting.has(row.id),400,'MIGRATION_PARENT','Цикл ответов в обсуждении.');visiting.add(row.id);if(row.parent_id){check(byId.has(row.parent_id),400,'MIGRATION_PARENT','Нет исходного комментария.');visit(byId.get(row.parent_id));}visiting.delete(row.id);done.add(row.id);result.push(row);}for(const row of rows)visit(row);return result;}
async function importPostgres(dataset,database,{expectedDigest}={}){
  validate(dataset,expectedDigest);check(database.kind==='postgres',500,'MIGRATION_TARGET','Ожидается PostgreSQL.');
  await database.transaction(async()=>{
    for(const table of Object.keys(TABLES))check((await database.execute('get','SELECT count(*) AS n FROM '+table)).n===0,409,'MIGRATION_NOT_EMPTY','Целевая база содержит данные. Импорт остановлен без замены.');
    const meta=await database.execute('get','SELECT * FROM service_metadata');check(meta?.app_key==='melodiajest'&&meta.schema_version===2,500,'MIGRATION_TARGET','Не совпала схема собственной БД.');
    for(const [table,sourceRows]of Object.entries(dataset.tables)){
      const rows=table==='discussion_comments'?commentOrder(sourceRows):sourceRows;if(!rows.length)continue;
      const columns=(await database.execute('all','SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position',[database.schema,table])).map(x=>x.column_name),sorted=[...columns].sort().join(',');
      for(const row of rows)check(Object.keys(row).sort().join(',')===sorted,400,'MIGRATION_COLUMNS','Не совпали поля таблицы '+table+'.');
      for(let index=0;index<rows.length;index+=100){const batch=rows.slice(index,index+100),placeholder='('+columns.map(()=>'?').join(',')+')';await database.execute('run','INSERT INTO '+table+'('+columns.join(',')+') VALUES '+batch.map(()=>placeholder).join(','),batch.flatMap(row=>columns.map(key=>row[key])));}
    }
    const observed={};for(const [table,order]of Object.entries(TABLES))observed[table]=await database.execute('all','SELECT * FROM '+table+' ORDER BY '+order);
    check(describe(observed).digest===expectedDigest,500,'MIGRATION_READBACK','Повторное чтение не совпало. Транзакция отменена.');
  },'data-migration');
  return {status:'verified',...describe(dataset.tables),target:'own-postgres',sourceUnchanged:true};
}
if(require.main===module){
  const [command,source,target,expected]=process.argv.slice(2);
  (async()=>{
    if(command==='export-sqlite'){const dataset=exportSqlite(path.resolve(source));fs.writeFileSync(target,JSON.stringify(dataset)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(describe(dataset.tables)));return;}
    if(command==='import-own-postgres'||command==='inspect-own-postgres'){
      check(process.platform==='linux'&&process.getuid()===0,500,'MIGRATION_CONTEXT','Нужен собственный maintenance-контекст.');
      const {PostgresDatabase}=require('./database.cjs'),db=new PostgresDatabase({host:'/run/melodiajest-postgres',database:'melodiajest',user:'melodiajest_owner',ssl:false});
      try{console.log(JSON.stringify(command==='import-own-postgres'?await importPostgres(JSON.parse(fs.readFileSync(source,'utf8')),db,{expectedDigest:expected}):describe((await exportPostgres(db)).tables)));}finally{await db.close();}return;
    }
    throw Error('Usage: export-sqlite <copy> <new-private-json> | import-own-postgres <private-json> unused <expected-digest> | inspect-own-postgres');
  })().catch(error=>{console.error(JSON.stringify({status:'failed',code:error.code||error.name}));process.exitCode=1;});
}
module.exports={exportSqlite,exportPostgres,importPostgres,validate,describe};
