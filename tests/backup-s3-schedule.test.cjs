'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),path=require('node:path');
test('existing backup services add bounded external work, resume failed restores and reuse unchanged payloads',()=>{
 const r=spawnSync('python',['-B','tests/backup_s3_schedule_test.py'],{cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stderr);assert.match(r.stderr,/Ran 15 tests/);assert.match(r.stderr,/OK/);
});
