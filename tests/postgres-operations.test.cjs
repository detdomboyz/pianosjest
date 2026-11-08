'use strict';
const test=require('node:test'),{execFileSync}=require('node:child_process'),path=require('node:path');
test('own PostgreSQL configuration, image digest verification and closed backup payload',()=>{execFileSync(process.platform==='win32'?'python':'python3',['-B',path.join(__dirname,'postgres_operations_test.py')],{cwd:path.resolve(__dirname,'..'),timeout:90000,windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'}});});
