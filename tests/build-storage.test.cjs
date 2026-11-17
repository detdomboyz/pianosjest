'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {assertBuildStorage}=require('../tools/build-web.cjs');

test('Windows build guard accepts physical D: and refuses a C: target before generation',{skip:process.platform!=='win32'},t=>{
  const base='D:/MelodiaJest-private/host-maintenance/workspace-artifacts';
  assertBuildStorage(path.resolve(base,'tmp','not-yet-created-storage-test'));
  const checkout=path.resolve(__dirname,'..');
  const outside=path.join(checkout,'.storage-guard-forbidden-output');
  assert.equal(fs.existsSync(outside),false);
  assert.throws(()=>assertBuildStorage(outside),/storage on D:/);
  assert.equal(fs.existsSync(outside),false);
  const scratch=fs.mkdtempSync(path.join(base,'tmp','storage-link-test-'));
  const link=path.join(scratch,'escape');
  t.after(()=>{
    if(fs.existsSync(link)){assert.ok(fs.lstatSync(link).isSymbolicLink());fs.unlinkSync(link);}
    assert.equal(fs.realpathSync(path.dirname(scratch)),fs.realpathSync(path.join(base,'tmp')));
    fs.rmSync(scratch,{recursive:true,force:true});
  });
  fs.symlinkSync(checkout,link,'junction');
  assert.throws(()=>assertBuildStorage(path.join(link,'would-create-on-C')),/storage on D:/);
});
