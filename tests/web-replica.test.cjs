'use strict';
const test=require('node:test'),{execFileSync}=require('node:child_process'),path=require('node:path');
test('external recovery kit verifies a complete cold restore and rejects changed or unsafe inputs',()=>{
  execFileSync('python',[path.join(__dirname,'web_replica_test.py')],{
    cwd:path.resolve(__dirname,'..'),timeout:90000,windowsHide:true,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'
  });
});
