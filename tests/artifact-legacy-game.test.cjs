'use strict';
const test=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
test('complete public99 and100 game archives stay readable without accepting arbitrary asset subsets',()=>{
  execFileSync(process.platform==='win32'?'python':'python3',['-B',path.join(__dirname,'artifact_legacy_game_test.py')],{cwd:path.resolve(__dirname,'..'),timeout:90000,windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});
});
