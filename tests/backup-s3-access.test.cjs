'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('S3 access proposal preserves existing policy and confines the future service to its own backup prefix',()=>{
 const run=spawnSync('python',['tests/backup_s3_access_test.py'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.match(run.stderr,/Ran 10 tests/);assert.match(run.stderr,/OK/);
});
