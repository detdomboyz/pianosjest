'use strict';
const test=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
test('account deployment sources, runtime pins, payload allowlist and rollback',()=>{
  execFileSync(process.platform==='win32'?'python':'python3',['-B',path.join(__dirname,'account_deployment_test.py')],{cwd:path.resolve(__dirname,'..'),timeout:90000,windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});
});
