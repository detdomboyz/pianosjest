'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.cwd(),file=path.join(root,'service/course-registry.json'),before=JSON.parse(fs.readFileSync(file,'utf8'));
const built=JSON.parse(JSON.stringify(require('../tools/build-service-curriculum.cjs').build()));
assert.equal(before.sourceVersion,'23.5.78');assert.equal(built.sourceVersion,'23.5.79');
assert.equal(built.contentSha256,'334e7971ea614a6dd155e94cd9deb074ebd0d15b13befaaed4351319e09d94ee');
assert.deepEqual({...built,sourceVersion:before.sourceVersion},before);assert.equal(built.lessons.length,450);
for(const [from,to] of [['tmp/melodiajest-57-npm-final.tap','tmp/melodiajest-57-npm-initial-version-mismatch.tap'],['tmp/melodiajest-57-runtime-freeze.json','tmp/melodiajest-57-runtime-freeze-initial.json'],['tmp/melodiajest-57-runtime-delta.json','tmp/melodiajest-57-runtime-delta-initial.json']]){
 const a=path.resolve(root,from),b=path.resolve(root,to);assert.ok(a.startsWith(root+path.sep)&&b.startsWith(root+path.sep));assert.ok(fs.statSync(a).isFile());assert.ok(!fs.existsSync(b));fs.renameSync(a,b);
}
fs.writeFileSync(file,JSON.stringify(built,null,2)+'\n');
const prior=JSON.parse(fs.readFileSync('tmp/melodiajest-55-runtime-freeze.json','utf8')),sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const current=Object.fromEntries(Object.keys(prior).map(f=>[f,sha(f)])),changed=Object.keys(prior).filter(f=>prior[f]!==current[f]);
assert.deepEqual([...changed].sort(),['learning-game.css','package.json','piano-game-player.js','service/course-registry.json'].sort());
current['tests/player-account-status.test.cjs']=sha('tests/player-account-status.test.cjs');assert.equal(Object.keys(current).length,457);
fs.writeFileSync('tmp/melodiajest-57-runtime-freeze.json',JSON.stringify(current,null,2)+'\n');
const proof={unchangedOldFiles:452,changed,newTest:'tests/player-account-status.test.cjs',currentFiles:457,registryMetadataOnly:true,changedRegistryField:'sourceVersion',musicalContentChanged:false,courseContentSha256:built.contentSha256,learningRecords:450,oldRegistrySha256:'491c96c11694ec684fc904dbf54f5d585c56e7390a1ef8ae13825aa6b6dea8b9',newRegistrySha256:sha(file)};
fs.writeFileSync('tmp/melodiajest-57-runtime-delta.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
