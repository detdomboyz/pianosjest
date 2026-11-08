'use strict';
const test=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
test('read-only retention plan preserves pinned recovery paths and bounds candidates',()=>{
  execFileSync('python',['-B',path.join(__dirname,'retention_plan_test.py')],{
    cwd:path.resolve(__dirname,'..'),timeout:30000,windowsHide:true,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'
  });
});
