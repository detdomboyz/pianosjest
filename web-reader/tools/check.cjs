'use strict';
const cp=require('node:child_process'),path=require('node:path'),BASE=path.resolve(__dirname,'..');
const built=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(__dirname,'build.cjs'),...process.argv.slice(2)],{stdio:'inherit'});if(built.status!==0)process.exit(built.status??1);
const at=process.argv.indexOf('--dependencies-dir'),external=at>=0?path.resolve(process.argv[at+1]):null;
const checked=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main','--test',path.join(BASE,'tests')],{stdio:'inherit',env:{...process.env,...(external?{NODE_PATH:external}:{})}});process.exit(checked.status??1);
