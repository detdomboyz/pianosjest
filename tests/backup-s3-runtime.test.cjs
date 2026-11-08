'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('external restic runtime confines credentials, repository, mounts, commands and the Windows password envelope',()=>{
 const r=spawnSync('python',['tests/backup_s3_runtime_test.py'],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 20 tests/);assert.match(r.stderr,/OK/);
});
