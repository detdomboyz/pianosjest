'use strict';
const cp=require('node:child_process'),path=require('node:path'),BASE=path.resolve(__dirname,'..');
const build=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main',path.join(__dirname,'build.cjs'),...process.argv.slice(2)],{stdio:'inherit'});if(build.status!==0)process.exit(build.status??1);const tested=cp.spawnSync(process.execPath,['--preserve-symlinks','--preserve-symlinks-main','--test',path.join(BASE,'tests')],{stdio:'inherit'});process.exit(tested.status??1);
