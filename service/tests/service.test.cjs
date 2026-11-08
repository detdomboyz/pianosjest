'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const http = require('node:http');
const {randomUUID} = require('node:crypto');
const {createService} = require('../server.cjs');
const {openStore} = require('../store.cjs');
const S = require('../security.cjs');
const Backup = require('../backup.cjs');
const Adapter = require('../../piano-catalog-adapter.js');
const ROOT = path.resolve(__dirname, '../..');
const PASSWORD = 'a separate piano phrase 2026';
function fixture() {
  return {entry: {id: 'original-piece-id', themeId: 'original-theme-id', title: 'Моя фраза', description: 'Авторская короткая фраза.', pattern: 't y u', contentKind: 'piece', order: 4,
    rhythm: {version: 1, source: 'author', bpm: 48, practiceBpm: 48, timeSignature: {numerator: 4, denominator: 4}, steps: [{startBeat: 0, durationBeats: 1, restBeforeBeats: 0}, {startBeat: 1, durationBeats: 1, restBeforeBeats: 0}, {startBeat: 3, durationBeats: 2, restBeforeBeats: 1}]},
    handMode: 'right', fingeringSpec: {kind: 'explicit', hand: 'right', fingers: [1, 2, 3]}, personalExtension: {note: 'сохранить точную редакцию'}}, origin: 'original', source: ''};
}
async function setup(t, {dataDir, clock, serviceOptions={}} = {}) {
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp', 'account-service-test-'));
  const service = await createService({dataDir: dataDir || path.join(root, 'data'), origin: 'http://127.0.0.1:0', development: true, now: clock,...serviceOptions});
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  service.options.origin.port = String(service.server.address().port);
  const origin = service.options.origin.origin;
  const clients = [];
  async function client() {
    let cookie = '', csrf = '', account = '';
    const request = async (route, {method = 'GET', data, headers = {}} = {}) => {
      if(method==='POST'&&['/library','/feedback'].includes(route)&&data&&!data.operationId)data={...data,operationId:randomUUID()};
      // This in-process fixture also evaluates the complete browser catalog.
      // On a throttled Linux CPU that can exceed the server's five-second idle
      // timeout. Avoid reusing its idle test socket while the event loop is
      // blocked by that browser work; real browser/API processes are separate.
      const response = await fetch(origin + '/api/service/v1' + route, {method, headers: {Connection:'close', ...(cookie ? {Cookie: cookie} : {}), ...(account ? {'X-Melodiajest-Account': account} : {}), ...(method !== 'GET' ? {Origin: origin, 'Content-Type': 'application/json', 'X-Melodiajest-CSRF': csrf} : {}), ...headers}, body: data === undefined ? undefined : JSON.stringify(data)});
      const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      const result = await response.json(); if (result.csrfToken) csrf = result.csrfToken; if ('user' in result) account = result.user?.id || '';
      return {status: response.status, data: result, headers: response.headers};
    };
    const initial = await request('/session'); assert.equal(initial.status, 200);
    const result = {request, get cookie() { return cookie; }, get csrf() { return csrf; }, initial}; clients.push(result); return result;
  }
  t.after(async () => { await service.close(); fs.rmSync(root, {recursive: true, force: true}); });
  return {service, root, origin, client};
}
async function register(client, username = 'pianist_one') {
  const result = await client.request('/auth/register', {method: 'POST', data: {username, displayName: 'Пианист ' + username, password: PASSWORD}});
  assert.equal(result.status, 200, JSON.stringify(result.data)); assert.ok(result.data.user.id); assert.match(result.data.recoveryCode, /^[\w-]{43}$/); return result.data;
}
test('password hashing uses versioned scrypt, random salts and full Unicode passwords', async () => {
  const password = 'три любимых такта 🎹 2026';
  const a = await S.hashPassword(password), b = await S.hashPassword(password);
  assert.notEqual(a, b); assert.match(a, /^scrypt\$32768\$8\$3\$/); assert.ok(await S.verifyPassword(password, a));
  assert.equal(await S.verifyPassword(password + 'x', a), false); assert.equal(await S.verifyPassword('x'.repeat(1000), a), false);
  assert.throws(() => S.password('123456789012345'), /предсказуем/); assert.throws(() => S.password('short'), /15/);
});
test('registration rotates anonymous session, stores no raw secrets, and exposes no fake SSO', async t => {
  const {service, client} = await setup(t); const one = await client(); const anonymous = one.cookie;
  const user = await register(one); assert.notEqual(one.cookie, anonymous); assert.equal(user.sso.enabled, false);
  assert.equal(user.personalProgress, 'database-and-versioned-browser-history');
  const rows = service.store.db.prepare('SELECT * FROM sessions').all();
  assert.ok(rows.every(row => !one.cookie.includes(row.token_hash))); assert.equal(rows.length, 1);
  const credentials = await service.store.credentials('PIANIST_ONE'); assert.notEqual(credentials.password_hash, PASSWORD); assert.notEqual(credentials.recovery_hash, user.recoveryCode);
  const raw = fs.readFileSync(service.store.filename); assert.equal(raw.includes(Buffer.from(PASSWORD)), false); assert.equal(raw.includes(Buffer.from(user.recoveryCode)), false);
  assert.equal((await one.request('/auth/register', {method: 'POST', data: {username: 'pianist_one', displayName: 'Другой', password: PASSWORD}})).status, 409);
});
test('anonymous writes, cross-site writes, absent CSRF and forged owners fail closed', async t => {
  const {client} = await setup(t); const one = await client();
  for (const route of ['/catalog', '/preferences', '/library', '/feedback']) assert.equal((await one.request(route, {method: route === '/catalog' || route === '/preferences' ? 'PUT' : 'POST', data: {}})).status, 401);
  assert.equal((await one.request('/auth/register', {method: 'POST', data: {}, headers: {Origin: 'https://evil.invalid'}})).status, 403);
  assert.equal((await one.request('/auth/register', {method: 'POST', data: {}, headers: {'X-Melodiajest-CSRF': ''}})).status, 403);
  assert.equal((await one.request('/auth/register', {method: 'POST', data: {}, headers: {'Sec-Fetch-Site': 'cross-site'}})).status, 403);
  await register(one);
  assert.equal((await one.request('/preferences', {method: 'PUT', data: {ownerId: 'somebody', expectedRevision: 0, raw: '{}'}})).status, 400);
});
test('private settings and catalog use authenticated owner and optimistic revisions', async t => {
  const {client} = await setup(t); const one = await client(), two = await client(); await register(one); await register(two, 'pianist_two');
  const raw = JSON.stringify({mode: 'expanded', extension: {unchanged: '🎹'}});
  const first = await one.request('/preferences', {method: 'PUT', data: {expectedRevision: 0, raw}}); assert.equal(first.status, 200); assert.equal(first.data.raw, raw);
  assert.equal((await two.request('/preferences')).data.raw, null);
  assert.equal((await one.request('/preferences', {method: 'PUT', data: {expectedRevision: 0, raw: '{}'}})).status, 409);
  assert.equal((await one.request('/preferences')).data.raw, raw);
  const catalog = JSON.stringify({version: 7, themes: [{id: 'original-theme-id', name: 'Мои ноты', order: 7}], lessons: [fixture().entry], extension: {order: [9, 3]}});
  const result = await one.request('/catalog', {method: 'PUT', data: {expectedRevision: 0, raw: catalog}});
  assert.equal(result.status, 200); assert.equal(result.data.raw, catalog); assert.equal(result.data.sha256, S.sha(catalog)); assert.equal((await two.request('/catalog')).data.raw, null);
});
test('private melody round-trips all notes, timing, fingers, IDs and metadata; another user cannot read or edit it', async t => {
  const {client} = await setup(t); const one = await client(), two = await client(); await register(one); await register(two, 'pianist_two');
  const data = fixture(); const created = await one.request('/library', {method: 'POST', data: {data}}); assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.deepEqual(created.data.data, data); assert.deepEqual(Adapter.project(created.data.data.entry), Adapter.project(data.entry));
  const id = created.data.id;
  assert.equal((await two.request('/library/' + id)).status, 404);
  assert.equal((await two.request('/library/' + id, {method: 'PUT', data: {expectedRevision: 1, data}})).status, 404);
  assert.deepEqual((await two.request('/library')).data.items, []);
  assert.deepEqual((await one.request('/publications')).data.items, []);
  assert.equal((await one.request('/library/' + id, {method: 'PUT', data: {expectedRevision: 0, data}})).status, 409);
});
test('publishing requires the owner, explicit rights, exact revisions; private edits never silently update the public snapshot', async t => {
  const {client} = await setup(t); const one = await client(), two = await client(), guest = await client(); await register(one); await register(two, 'pianist_two');
  const data = fixture(); const created = await one.request('/library', {method: 'POST', data: {data}}); const id = created.data.id;
  const publish = {expectedRevision: 1, expectedPublicationRevision: 0, rightsConfirmed: true, rights: 'Это моя авторская фраза, разрешаю её публикацию.'};
  assert.equal((await two.request('/library/' + id + '/publish', {method: 'POST', data: publish})).status, 404);
  assert.equal((await one.request('/library/' + id + '/publish', {method: 'POST', data: {...publish, rightsConfirmed: false}})).status, 400);
  const published = await one.request('/library/' + id + '/publish', {method: 'POST', data: publish}); assert.equal(published.status, 200);
  const pubId = published.data.publication.id;
  const before = await guest.request('/publications/' + pubId); assert.deepEqual(before.data.data, data); assert.equal(before.data.ownerId, undefined); assert.equal(before.data.username, undefined);
  const changed = {...data, entry: {...data.entry, title: 'Новая личная редакция', pattern: 'u y t'}};
  assert.equal((await one.request('/library/' + id, {method: 'PUT', data: {expectedRevision: 1, data: changed}})).status, 200);
  assert.deepEqual((await guest.request('/publications/' + pubId)).data.data, data);
  assert.equal((await one.request('/library/' + id + '/publish', {method: 'POST', data: publish})).status, 409);
  assert.equal((await one.request('/library/' + id + '/publish', {method: 'POST', data: {...publish, expectedRevision: 2, expectedPublicationRevision: 1}})).status, 200);
  assert.deepEqual((await guest.request('/publications/' + pubId)).data.data, changed);
  assert.equal((await two.request('/library/' + id + '/unpublish', {method: 'POST', data: {expectedPublicationRevision: 2}})).status, 404);
  assert.equal((await one.request('/library/' + id + '/unpublish', {method: 'POST', data: {expectedPublicationRevision: 2}})).status, 200);
  assert.equal((await guest.request('/publications/' + pubId)).status, 404); assert.deepEqual((await guest.request('/publications')).data.items, []);
});
test('feedback is private, tied to its author and cannot overwrite a lesson or gain a reviewer role', async t => {
  const {client} = await setup(t); const one = await client(), two = await client(); await register(one); await register(two, 'pianist_two');
  const data = {title: 'Уточнить аппликатуру', body: 'В этом месте хочу предложить другой удобный вариант.', target: 'detail-p-scale-04'};
  assert.equal((await one.request('/feedback', {method: 'POST', data: {...data, status: 'resolved'}})).status, 400);
  const created = await one.request('/feedback', {method: 'POST', data}); assert.equal(created.status, 201); assert.equal(created.data.status, 'received');
  assert.equal((await one.request('/feedback')).data.items.length, 1); assert.deepEqual((await two.request('/feedback')).data.items, []);
});
test('login errors do not distinguish a missing account from a wrong password; logout revokes the current session', async t => {
  const {client} = await setup(t); const one = await client(); await register(one); const other = await client();
  const unknown = await other.request('/auth/login', {method: 'POST', data: {username: 'nobody_here', password: 'wrong password'} });
  const wrong = await other.request('/auth/login', {method: 'POST', data: {username: 'pianist_one', password: 'wrong password'} });
  assert.equal(unknown.status, 401); assert.deepEqual(unknown.data, wrong.data);
  assert.equal((await other.request('/auth/login', {method: 'POST', data: {username: 'PIANIST_ONE', password: PASSWORD}})).status, 200);
  const oldCookie = other.cookie;
  assert.equal((await other.request('/auth/logout', {method: 'POST', data: {}})).status, 200);
  assert.equal((await other.request('/preferences', {headers: {Cookie: oldCookie}})).status, 401);
  assert.equal((await one.request('/preferences')).status, 200);
});
test('recovery is one-use, rotates the code, revokes all old sessions and preserves the permanent account/data', async t => {
  const {client} = await setup(t); const one = await client(), recovery = await client(); const user = await register(one);
  await one.request('/preferences', {method: 'PUT', data: {expectedRevision: 0, raw: '{"mode":"hidden"}'}});
  const reset = {username: 'pianist_one', recoveryCode: user.recoveryCode, password: 'another long piano phrase'};
  const result = await recovery.request('/auth/recover', {method: 'POST', data: reset}); assert.equal(result.status, 200); assert.equal(result.data.user.id, user.user.id); assert.notEqual(result.data.recoveryCode, user.recoveryCode);
  assert.equal((await one.request('/preferences')).status, 401); assert.equal((await recovery.request('/preferences')).data.raw, '{"mode":"hidden"}');
  assert.equal((await recovery.request('/auth/recover', {method: 'POST', data: reset})).status, 401);
});
test('session expiration and persisted authentication throttling work without depending on process memory', async t => {
  let current = Date.now(); const {service, client} = await setup(t, {clock: () => current}); const one = await client(); await register(one);
  current += 12 * 3600000 + 1; assert.equal((await one.request('/preferences')).status, 401);
  const guest = await client();
  for (let i = 0; i < 12; i++) assert.equal((await guest.request('/auth/login', {method: 'POST', data: {username: 'missing_user', password: PASSWORD}})).status, 401);
  assert.equal((await guest.request('/auth/login', {method: 'POST', data: {username: 'missing_user', password: PASSWORD}})).status, 429);
  assert.ok(service.store.db.prepare('SELECT count(*) AS n FROM rate_limits').get().n > 0);
});
test('future SSO identities are separate from accounts and unique by issuer plus subject; no linking endpoint is enabled', async t => {
  const {service, client} = await setup(t); const one = await client(), two = await client(); const a = await register(one), b = await register(two, 'pianist_two');
  service.store.db.prepare('INSERT INTO identities VALUES(?,?,?,?)').run('https://id.example', 'subject-one', a.user.id, Date.now());
  assert.throws(() => service.store.db.prepare('INSERT INTO identities VALUES(?,?,?,?)').run('https://id.example', 'subject-one', b.user.id, Date.now()), /UNIQUE/);
  assert.equal((await two.request('/auth/sso/link', {method: 'POST', data: {issuer: 'https://id.example', subject: 'subject-one'}})).status, 404);
  assert.equal((await service.store.getUser(a.user.id)).id, a.user.id);
});
test('SQLite online backup, SHA256 verification and isolated restore preserve real login and ownership without production files', async t => {
  const {service, root, client} = await setup(t); const one = await client(), two = await client(); const a = await register(one); await register(two, 'pianist_two');
  const data = fixture(); const item = await one.request('/library', {method: 'POST', data: {data}});
  const raw = '{"mode":"expanded","custom":"точная строка"}'; await one.request('/preferences', {method: 'PUT', data: {expectedRevision: 0, raw}});
  const backups = path.join(root, 'backups'), isolated = path.join(root, 'isolated'); fs.mkdirSync(backups); fs.mkdirSync(isolated);
  const before = fs.statSync(service.store.filename).mtimeMs;
  const bundle = await Backup.createBackup({dataDir: service.options.dataDir, backupRoot: backups}); assert.equal(bundle.manifest.sqliteOnlineBackup, true); assert.equal(bundle.manifest.encrypted, false);
  const restored = Backup.restoreIsolated({bundle: bundle.directory, isolatedRoot: isolated, productionDataDir: service.options.dataDir}); assert.equal(restored.productionDataUsed, false);
  const cold = await setup(t, {dataDir: restored.directory}); const login = await cold.client(), stranger = await cold.client();
  assert.equal((await login.request('/auth/login', {method: 'POST', data: {username: 'pianist_one', password: PASSWORD}})).data.user.id, a.user.id);
  assert.equal((await stranger.request('/auth/login', {method: 'POST', data: {username: 'pianist_two', password: PASSWORD}})).status, 200);
  assert.equal((await login.request('/preferences')).data.raw, raw); assert.deepEqual((await login.request('/library/' + item.data.id)).data.data, data);
  assert.equal((await stranger.request('/library/' + item.data.id)).status, 404);
  await cold.service.close();
  assert.equal(fs.statSync(service.store.filename).mtimeMs, before);
  fs.appendFileSync(path.join(bundle.directory, 'session-secret'), 'changed'); assert.throws(() => Backup.verifyBackup(bundle.directory), /SHA256/);
});
test('production configuration requires HTTPS and Secure host-only cookies; foreign schema is refused', async t => {
  const root = fs.mkdtempSync(path.join(ROOT, 'tmp', 'account-config-test-')); let service;
  t.after(async () => { if (service) await service.close(); fs.rmSync(root, {recursive: true, force: true}); });
  await assert.rejects(() => createService({dataDir: path.join(root, 'bad'), origin: 'http://melodiajest.ru'}), /HTTPS/);
  service = await createService({dataDir: path.join(root, 'good'), origin: 'https://melodiajest.ru'});
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const response = await new Promise((resolve, reject) => {
    http.get({host: '127.0.0.1', port: service.server.address().port, path: '/api/service/v1/session', headers: {Host: 'melodiajest.ru'}}, result => { result.resume(); result.on('end', () => resolve(result)); }).on('error', reject);
  });
  const cookie = response.headers['set-cookie'][0];
  assert.equal(response.statusCode, 200); assert.match(cookie, /^__Host-melodiajest-session=/); assert.match(cookie, /; Secure/); assert.doesNotMatch(cookie, /Domain=/);
  const {DatabaseSync} = require('node:sqlite'); const foreign = path.join(root, 'foreign.sqlite'); const db = new DatabaseSync(foreign); db.exec('CREATE TABLE other(value TEXT)'); db.close();
  assert.throws(() => openStore(foreign), /Неподдерживаемая/);
});
test('an old tab cannot read or replace data through another account’s cookie',async t=>{
  const {client}=await setup(t),one=await client(),two=await client();const a=await register(one),b=await register(two,'pianist_two');
  await two.request('/preferences',{method:'PUT',data:{expectedRevision:0,raw:'{"private":"second"}'}});
  const result=await two.request('/preferences',{headers:{'X-Melodiajest-Account':a.user.id}});
  assert.equal(result.status,409);assert.equal(result.data.error.code,'ACCOUNT_CHANGED');assert.equal(result.data.raw,undefined);
  const write=await two.request('/preferences',{method:'PUT',headers:{'X-Melodiajest-Account':a.user.id},data:{expectedRevision:1,raw:'{"wrong":"first"}'}});
  assert.equal(write.status,409);assert.equal((await two.request('/preferences')).data.raw,'{"private":"second"}');assert.notEqual(a.user.id,b.user.id);
});
test('retries of the same create request do not duplicate a melody or correction proposal',async t=>{
  const {client}=await setup(t),one=await client();await register(one);const operationId=randomUUID(),data={data:fixture(),operationId};
  const first=await one.request('/library',{method:'POST',data}),second=await one.request('/library',{method:'POST',data});assert.equal(first.status,201);assert.equal(second.status,201);assert.equal(first.data.id,second.data.id);assert.equal((await one.request('/library')).data.items.length,1);
  assert.equal((await one.request('/library',{method:'POST',data:{...data,data:{...fixture(),source:'Different request'}}})).status,409);
  const proposal={title:'Повтор запроса',body:'Синтетическая проверка повторного сохранения.',target:'course01-01',operationId:randomUUID()};
  const a=await one.request('/feedback',{method:'POST',data:proposal}),b=await one.request('/feedback',{method:'POST',data:proposal});assert.equal(a.data.id,b.data.id);assert.equal((await one.request('/feedback')).data.items.length,1);
});
test('private and public musical histories survive edits and unpublishing is idempotent',async t=>{
  const {service,client}=await setup(t),one=await client();await register(one);const original=fixture(),item=await one.request('/library',{method:'POST',data:{data:original}}),id=item.data.id;
  const changed={...original,entry:{...original.entry,pattern:'u t y'}};await one.request('/library/'+id,{method:'PUT',data:{expectedRevision:1,data:changed}});
  const rows=service.store.db.prepare('SELECT revision,raw FROM melody_revisions WHERE melody_id=? ORDER BY revision').all(id);assert.equal(rows.length,2);assert.deepEqual(JSON.parse(rows[0].raw),original);assert.deepEqual(JSON.parse(rows[1].raw),changed);
  const published=await one.request('/library/'+id+'/publish',{method:'POST',data:{expectedRevision:2,expectedPublicationRevision:0,rightsConfirmed:true,rights:'Своя учебная фраза для проверки.'}});assert.equal(published.status,200);
  const first=await one.request('/library/'+id+'/unpublish',{method:'POST',data:{expectedPublicationRevision:1}});assert.equal(first.status,200);
  const again=await one.request('/library/'+id+'/unpublish',{method:'POST',data:{expectedPublicationRevision:2}});assert.equal(again.status,200);assert.equal(again.data.publication.revision,2);
  assert.equal(service.store.db.prepare('SELECT count(*) AS n FROM publication_revisions WHERE publication_id=?').get(published.data.publication.id).n,2);
});
test('large authentication bodies are rejected before password work',async t=>{
  const {client}=await setup(t),one=await client();const result=await one.request('/auth/login',{method:'POST',data:{username:'pianist_one',password:'x'.repeat(9000)}});assert.equal(result.status,413);
});
test('personal catalog patches restore the actual shipped corpus without changing its notes, rhythm or grading versions',async t=>{
  const {client}=await setup(t),one=await client();await register(one);
  const baseline=JSON.parse(JSON.stringify(require('../../tests/helpers/load-app.cjs').loadApp().catalogSnapshot())),changed=JSON.parse(JSON.stringify(baseline));changed.lessons.find(x=>x.id==='course01-01').title='Личная подпись';
  const P=require('../../catalog-personalization.js'),delta=P.create(baseline,changed,{baseRelease:'23.5.61'}),raw=JSON.stringify(delta);assert.ok(Buffer.byteLength(raw)<20000);
  const saved=await one.request('/catalog',{method:'PUT',data:{expectedRevision:0,raw}});assert.equal(saved.status,200);const result=P.apply(baseline,JSON.parse((await one.request('/catalog')).data.raw));assert.ok(result.ok);assert.ok(P.equivalent(result.snapshot,changed));
  const Assessment=require('../../practice-assessment.js');assert.deepEqual(result.snapshot.lessons.map(x=>Assessment.pianoSignature(x)),baseline.lessons.map(x=>Assessment.pianoSignature(x)));
});

test('read-only maintenance preserves reads and rejects durable writes before account creation',async t=>{
  const {service,client}=await setup(t,{serviceOptions:{maintenanceReadOnly:true}}),visitor=await client();
  assert.equal((await visitor.request('/course')).status,200);assert.equal((await visitor.request('/health')).data.maintenanceReadOnly,true);
  const write=await visitor.request('/auth/register',{method:'POST',data:{username:'maintenance_fixture',displayName:'Fixture',password:PASSWORD}});assert.equal(write.status,503);assert.equal(write.data.error.code,'MAINTENANCE_READ_ONLY');assert.equal((await service.store.statement('SELECT count(*) AS n FROM users').get()).n,0);
});
test('low available disk stops account writes while the saved service remains readable',async t=>{
  const {service,client}=await setup(t,{serviceOptions:{diskFreeBytes:()=>511*1024*1024}}),visitor=await client();
  const write=await visitor.request('/auth/register',{method:'POST',data:{username:'disk_fixture',displayName:'Fixture',password:PASSWORD}});assert.equal(write.status,503);assert.equal(write.data.error.code,'DISK_RESERVE');assert.equal((await visitor.request('/health')).status,200);assert.equal((await service.store.statement('SELECT count(*) AS n FROM users').get()).n,0);
});
