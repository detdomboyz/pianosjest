'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function build(){
  const source=fs.readFileSync(path.join(root,'service/store.cjs'),'utf8');
  const base=source.slice(source.indexOf('      CREATE TABLE users('),source.indexOf('      PRAGMA user_version=1;'));
  if(!base.startsWith('      CREATE TABLE users(')||!base.includes('CREATE TABLE operation_receipts('))throw Error('SQLite schema marker changed');
  return '-- Generated from the executed SQLite schema and game-schema.sql.\nBEGIN;\n'
    +(base+'\n'+fs.readFileSync(path.join(root,'service/game-schema.sql'),'utf8')).replace(/\bINTEGER\b/g,'BIGINT').replace(/ COLLATE NOCASE/g,'').replace(/\) STRICT;/g,');')
    +'\nCREATE UNIQUE INDEX IF NOT EXISTS users_username_folded ON users(lower(username));\nCOMMIT;\n';
}
if(require.main===module){fs.writeFileSync(path.join(root,'service/schema.pg.sql'),build());console.log('PostgreSQL schema generated');}
module.exports={build};
