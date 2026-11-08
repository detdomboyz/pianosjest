'use strict';
const test=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');

test('server backup verifies actual archive, freshness, recovery and own unit contracts',()=>{
  execFileSync('python',[path.join(__dirname,'web_backup_test.py')],{
    cwd:path.resolve(__dirname,'..'),timeout:60000,windowsHide:true,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'
  });
});
