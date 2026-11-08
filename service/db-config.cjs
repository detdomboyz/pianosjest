'use strict';
const fs=require('node:fs'),{check,exactFields}=require('./security.cjs');
const CONFIG='/opt/melodiajest/account-data/postgres.json',PASSWORD='/opt/melodiajest/account-data/postgres-password';
function privateFile(filename){const stat=fs.lstatSync(filename);check(stat.isFile()&&!stat.isSymbolicLink()&&fs.realpathSync(filename)===filename&&stat.uid===process.getuid()&&(stat.mode&0o077)===0&&stat.size<=4096,500,'POSTGRES_CONFIG','Неверные права конфигурации БД.');return fs.readFileSync(filename,'utf8');}
function loadPostgresConfig(filename){
  check(process.platform==='linux'&&filename===CONFIG,500,'POSTGRES_CONFIG','Требуется собственный фиксированный путь конфигурации PostgreSQL.');
  const config=JSON.parse(privateFile(filename));exactFields(config,['kind','host','database','user','port','passwordFile']);
  check(config.kind==='melodiajest-postgres-v1'&&config.host==='/run/melodiajest-postgres'&&config.database==='melodiajest'&&config.user==='melodiajest_api'&&config.port===5432&&config.passwordFile===PASSWORD,500,'POSTGRES_CONFIG','Не совпала собственная конфигурация БД.');
  const password=privateFile(PASSWORD).trim();check(/^[A-Za-z0-9_-]{43,128}$/.test(password),500,'POSTGRES_CONFIG','Повреждён пароль БД.');
  return {host:config.host,port:config.port,database:config.database,user:config.user,password,ssl:false};
}
module.exports={loadPostgresConfig,CONFIG,PASSWORD};
