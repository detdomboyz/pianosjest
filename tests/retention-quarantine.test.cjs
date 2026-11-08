'use strict';
const test=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');

test('bounded quarantine validates immutable recovery intent and refuses unsafe or stale moves',()=>{
  execFileSync('python',['-B',path.join(__dirname,'retention_quarantine_test.py')],{
    cwd:path.resolve(__dirname,'..'),timeout:30000,windowsHide:true,
    env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:'pipe'
  });
});
