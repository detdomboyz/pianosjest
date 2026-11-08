'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const {openStore}=require('./store.cjs');
const {check,ServiceError}=require('./security.cjs');

// One query/transaction interface. A transaction owns one PostgreSQL client;
// SQLite serializes the whole transaction, including reads from other requests.
class SqliteDatabase{
  constructor(filename){this.legacy=openStore(filename);this.native=this.legacy.db;this.filename=filename;this.kind='sqlite';this.context=new AsyncLocalStorage();this.tail=Promise.resolve();}
  async exclusive(fn){
    if(this.context.getStore()?.database===this)return fn();
    const previous=this.tail;let release;this.tail=new Promise(resolve=>{release=resolve;});
    await previous;
    try{return await this.context.run({database:this,inTransaction:false},fn);}finally{release();}
  }
  async execute(method,sql,params=[]){return this.exclusive(()=>this.native.prepare(sql)[method](...params));}
  async transaction(fn){
    if(this.context.getStore()?.inTransaction)return fn();
    return this.exclusive(async()=>{const context=this.context.getStore();context.inTransaction=true;this.native.exec('BEGIN IMMEDIATE');try{const value=await fn();this.native.exec('COMMIT');return value;}catch(error){this.native.exec('ROLLBACK');throw error;}finally{context.inTransaction=false;}});
  }
  async lock(){}
  async exec(sql){return this.exclusive(()=>this.native.exec(sql));}
  async close(){await this.tail;this.legacy.close();}
}

class PostgresDatabase{
  constructor(config){
    const pg=require('pg');this.kind='postgres';this.context=new AsyncLocalStorage();
    const schema=config.schema||'public';check(schema==='public'||/^melodiajest_test_[a-f0-9]{32}$/.test(schema),500,'DATABASE_SCHEMA','Неверный namespace базы.');
    this.schema=schema;
    this.pool=new pg.Pool({...config,schema:undefined,max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:5000,statement_timeout:10000,query_timeout:12000,application_name:'melodiajest-account',options:'-c search_path='+schema+',pg_catalog',types:{getTypeParser(oid,format){if(oid===20)return raw=>{const n=Number(raw);if(!Number.isSafeInteger(n))throw new RangeError('Unsafe database integer');return n;};return pg.types.getTypeParser(oid,format);}}});
    this.pool.on('error',()=>{});
  }
  sql(text){let index=0;return text.replace(/\?/g,()=>'$'+(++index)).replace(/length\(CAST\(([a-z_.]+) AS BLOB\)\)/g,'octet_length($1)').replace(/ AS (createdAt|updatedAt)\b/g,' AS "$1"');}
  async execute(method,sql,params=[]){
    try{const result=await(this.context.getStore()||this.pool).query(this.sql(sql),params);return method==='get'?result.rows[0]:method==='all'?result.rows:{changes:result.rowCount};}
    catch(error){if(error.code==='23505')throw new ServiceError(409,'REVISION_CONFLICT','Такая запись уже появилась. Обнови данные и повтори действие.');throw error;}
  }
  async transaction(fn,key='session-mutation',{snapshot=false}={}){
    if(this.context.getStore())return fn();
    const client=await this.pool.connect();
    try{
      await client.query(snapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');if(!snapshot)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['melodiajest:'+key]);
      const result=await this.context.run(client,fn);await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async lock(key){const client=this.context.getStore();check(client,500,'TRANSACTION','Нужна транзакция.');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['melodiajest:'+key]);}
  async exec(sql){return(this.context.getStore()||this.pool).query(sql);}
  async close(){await this.pool.end();}
}
function statement(database,sql){return {get:(...params)=>database.execute('get',sql,params),all:(...params)=>database.execute('all',sql,params),run:(...params)=>database.execute('run',sql,params)};}
module.exports={SqliteDatabase,PostgresDatabase,statement};
