'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {check,sha}=require('./security.cjs');
const {SqliteDatabase,PostgresDatabase,statement:makeStatement}=require('./database.cjs');
async function openRepository({filename,database}={}){
const adapter=database||new SqliteDatabase(filename);
const statement=sql=>makeStatement(adapter,sql);
const atomic=(fn,key)=>adapter.transaction(fn,key);
try{
if(adapter.kind==='sqlite')await adapter.transaction(()=>adapter.exec(fs.readFileSync(path.join(__dirname,'game-schema.sql'),'utf8')));
const metadata=await statement('SELECT app_key,schema_version FROM service_metadata').get();check(metadata?.app_key==='melodiajest'&&metadata.schema_version===2,500,'DATABASE_VERSION','Неподдерживаемая база сервиса.');
}catch(error){await adapter.close();throw error;}
async function rate(bucket, limit, period, now) {
    return (await atomic(async () => {
        const old = (await statement('SELECT * FROM rate_limits WHERE bucket=?').get(bucket));
        if (!old || old.started_at + period <= now) {
            (await statement('INSERT INTO rate_limits VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET started_at=excluded.started_at,attempts=1').run(bucket, now));
        }
        else {
            check(old.attempts < limit, 429, 'RATE_LIMIT', 'Слишком много попыток. Подожди и повтори.');
            (await statement('UPDATE rate_limits SET attempts=attempts+1 WHERE bucket=?').run(bucket));
        }
        // Bounded expiration by age, not a global maintenance operation.
        (await statement('DELETE FROM rate_limits WHERE bucket IN (SELECT bucket FROM rate_limits WHERE started_at<? ORDER BY bucket LIMIT 100)').run(now - 2 * 86400000));
    }, "rate:" + bucket));
}
function user(row) { return row ? { id: row.id, username: row.username, displayName: row.display_name, createdAt: row.created_at } : null; }
async function getUser(id) { return user((await statement('SELECT * FROM users WHERE id=?').get(id))); }
async function quota(owner, extraBytes = 0) {
    const total = (await statement(`SELECT COALESCE(SUM(n),0) AS n FROM (
      SELECT length(CAST(raw AS BLOB)) AS n FROM objects WHERE user_id=? UNION ALL
      SELECT length(CAST(raw AS BLOB)) FROM melodies WHERE owner_id=? UNION ALL
      SELECT length(CAST(r.raw AS BLOB)) FROM melody_revisions r JOIN melodies m ON r.melody_id=m.id WHERE m.owner_id=? UNION ALL
      SELECT length(CAST(raw AS BLOB)) FROM publications WHERE owner_id=? UNION ALL
      SELECT length(CAST(r.raw AS BLOB)) FROM publication_revisions r JOIN publications p ON r.publication_id=p.id WHERE p.owner_id=?)`).get(owner, owner, owner, owner, owner)).n;
    check(total + extraBytes <= 25 * 1024 * 1024, 409, 'STORAGE_LIMIT', 'Достигнут лимит первой версии: 25 МБ личных данных с историей. Скачай копию; история не удаляется автоматически.');
}
async function receipt(owner, kind, operation, raw) {
    const old = (await statement('SELECT * FROM operation_receipts WHERE owner_id=? AND kind=? AND operation_id=?').get(owner, kind, operation));
    if (old)
        check(old.digest === sha(raw), 409, 'OPERATION_CONFLICT', 'Этот запрос уже выполнен с другим содержимым. Сохрани черновик и обнови список.');
    return old;
}
async function credentials(name) { return (await statement('SELECT c.*,u.id,u.username FROM users u JOIN credentials c ON u.id=c.user_id WHERE lower(u.username)=lower(?)').get(name)); }
async function register(name, display, hash, recoveryHash, now) {
    return (await atomic(async () => {
        check(!(await credentials(name)), 409, 'REGISTRATION', 'Не удалось зарегистрировать этот логин. Выбери другой.');
        const id = randomUUID();
        check((await statement('SELECT count(*) AS n FROM users').get()).n < 1000, 503, 'ACCOUNT_CAPACITY', 'Регистрация временно заполнена. Повтори позже.');
        (await statement('INSERT INTO users VALUES(?,?,?,?)').run(id, name, display, now));
        (await statement('INSERT INTO credentials VALUES(?,?,?,?)').run(id, hash, recoveryHash, now));
        return (await getUser(id));
    }, "registration"));
}
async function session(raw, now) {
    if (!raw)
        return null;
    const row = (await statement('SELECT * FROM sessions WHERE token_hash=?').get(sha(raw)));
    if (!row || row.expires_at <= now || row.last_seen + 12 * 3600000 <= now)
        return null;
    if (row.last_seen + 60000 < now)
        (await statement('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now, sha(raw)));
    return row;
}
async function newSession(raw, userId, now) {
 return atomic(async()=>{await adapter.lock('session-capacity');
    (await statement('DELETE FROM sessions WHERE expires_at<=? OR last_seen<?').run(now, now - 12 * 3600000));
    // Limit persistent anonymous sessions as well as the per-IP creation rate.
    const count = (await statement('SELECT count(*) AS n FROM sessions').get()).n;
    check(count < 20000, 503, 'SESSION_CAPACITY', 'Вход временно занят. Повтори позже.');
    if (userId)
        (await statement('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created_at DESC,token_hash LIMIT 20000 OFFSET 9)').run(userId));
    (await statement('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(raw), userId, now, now, now + (userId ? 7 * 86400000 : 3600000)));

 },'session-capacity');
}

async function revokeSession(raw) { if (raw)
    (await statement('DELETE FROM sessions WHERE token_hash=?').run(sha(raw))); }
async function resetPassword(userId,hash,recoveryHash,now,expected={}){
  return atomic(async()=>{
    const current=await statement('SELECT password_hash,recovery_hash FROM credentials WHERE user_id=?').get(userId);
    check(current&&(!expected.passwordHash||current.password_hash===expected.passwordHash)&&(!expected.recoveryHash||current.recovery_hash===expected.recoveryHash),409,'CREDENTIAL_CHANGED','Доступ уже изменился. Войди заново.');
    await statement('UPDATE credentials SET password_hash=?,recovery_hash=?,changed_at=? WHERE user_id=?').run(hash,recoveryHash,now,userId);
    await statement('DELETE FROM sessions WHERE user_id=?').run(userId);
  },userId);
}

async function getObject(owner, kind) {
    const row = (await statement('SELECT * FROM objects WHERE user_id=? AND kind=?').get(owner, kind));
    return row ? { revision: row.revision, raw: row.raw, sha256: row.digest, updatedAt: row.updated_at } : { revision: 0, raw: null, sha256: null, updatedAt: null };
}
async function putObject(owner, kind, expected, raw, now) {
    return (await atomic(async () => {
        const previous = (await getObject(owner, kind));
        check(previous.revision === expected, 409, 'REVISION_CONFLICT', 'Данные изменились в другой вкладке или на другом устройстве. Сохрани свою копию перед повторной загрузкой.');
        const revision = expected + 1;
        (await quota(owner, Buffer.byteLength(raw)));
        (await statement('INSERT INTO objects VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET revision=excluded.revision,raw=excluded.raw,digest=excluded.digest,updated_at=excluded.updated_at').run(owner, kind, revision, raw, sha(raw), now));
        return (await getObject(owner, kind));
    }, owner));
}
async function melody(owner, id) {
    const row = (await statement('SELECT * FROM melodies WHERE id=? AND owner_id=?').get(id, owner));
    check(row, 404, 'NOT_FOUND', 'Мелодия не найдена.');
    const pub = (await statement('SELECT id,revision,melody_revision,visible FROM publications WHERE melody_id=? AND owner_id=?').get(id, owner));
    return { id: row.id, revision: row.revision, data: JSON.parse(row.raw), createdAt: row.created_at, updatedAt: row.updated_at, publication: pub ? { id: pub.id, revision: pub.revision, melodyRevision: pub.melody_revision, visible: Boolean(pub.visible) } : null };
}
async function listMelodies(owner){
  const rows=await statement('SELECT m.*,p.id AS pub_id,p.revision AS pub_revision,p.melody_revision AS pub_melody_revision,p.visible AS pub_visible FROM melodies m LEFT JOIN publications p ON p.melody_id=m.id AND p.owner_id=m.owner_id WHERE m.owner_id=? ORDER BY m.updated_at DESC,m.id LIMIT 201').all(owner);
  return rows.map(row=>({id:row.id,revision:row.revision,data:JSON.parse(row.raw),createdAt:row.created_at,updatedAt:row.updated_at,publication:row.pub_id?{id:row.pub_id,revision:row.pub_revision,melodyRevision:row.pub_melody_revision,visible:Boolean(row.pub_visible)}:null}));
}

async function createMelody(owner, data, now, operation) {
    return (await atomic(async () => {
        const raw = JSON.stringify(data), old = (await receipt(owner, 'melody-create', operation, raw));
        if (old)
            return (await melody(owner, old.result_id));
        (await quota(owner, 2 * Buffer.byteLength(raw)));
        check((await statement('SELECT count(*) AS n FROM melodies WHERE owner_id=?').get(owner)).n < 200, 409, 'LIBRARY_LIMIT', 'В первой версии доступно до 200 личных мелодий.');
        const id = randomUUID();
        (await statement('INSERT INTO melodies VALUES(?,?,1,?,?,?)').run(id, owner, JSON.stringify(data), now, now));
        (await statement('INSERT INTO melody_revisions VALUES(?,1,?,?)').run(id, JSON.stringify(data), now));
        (await statement('INSERT INTO operation_receipts VALUES(?,?,?,?,?,?)').run(owner, 'melody-create', operation, sha(raw), id, now));
        return (await melody(owner, id));
    }, owner));
}
async function updateMelody(owner, id, expected, data, now) {
    return (await atomic(async () => {
        const previous = (await melody(owner, id));
        (await quota(owner, 2 * Buffer.byteLength(JSON.stringify(data))));
        check(previous.revision === expected, 409, 'REVISION_CONFLICT', 'Мелодия уже изменена. Скачай свой вариант и обнови страницу.');
        (await statement('UPDATE melodies SET revision=revision+1,raw=?,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(JSON.stringify(data), now, id, owner, expected));
        (await statement('INSERT INTO melody_revisions VALUES(?,?,?,?)').run(id, expected + 1, JSON.stringify(data), now));
        return (await melody(owner, id));
    }, owner));
}
async function publish(owner, id, expected, expectedPublication, rights, now) {
    return (await atomic(async () => {
        const source = (await melody(owner, id));
        (await quota(owner, 2 * Buffer.byteLength(JSON.stringify(source.data))));
        check(source.revision === expected && (source.publication?.revision || 0) === expectedPublication, 409, 'REVISION_CONFLICT', 'Мелодия или её публикация изменилась. Обнови список.');
        const pubId = source.publication?.id || randomUUID();
        (await statement('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT(melody_id) DO UPDATE SET revision=publications.revision+1,melody_revision=excluded.melody_revision,raw=excluded.raw,rights=excluded.rights,updated_at=excluded.updated_at,visible=1').run(pubId, id, owner, 1, source.revision, JSON.stringify(source.data), rights, now, now));
        (await statement('INSERT INTO publication_revisions VALUES(?,?,?,?,1,?)').run(pubId, (source.publication?.revision || 0) + 1, JSON.stringify(source.data), rights, now));
        return (await melody(owner, id));
    }, owner));
}
async function unpublish(owner, id, expected, now) {
    return (await atomic(async () => {
        const source = (await melody(owner, id));
        check(source.publication && source.publication.revision === expected, 409, 'REVISION_CONFLICT', 'Публикация изменилась. Обнови список.');
        if (!source.publication.visible)
            return source;
        (await statement('UPDATE publications SET visible=0,revision=revision+1,updated_at=? WHERE melody_id=? AND owner_id=?').run(now, id, owner));
        const previous = (await statement('SELECT raw,rights FROM publications WHERE id=?').get(source.publication.id));
        (await statement('INSERT INTO publication_revisions VALUES(?,?,?,?,0,?)').run(source.publication.id, expected + 1, previous.raw, previous.rights, now));
        return (await melody(owner, id));
    }, owner));
}
async function publicMelody(id) {
    const row = (await statement('SELECT p.id,p.revision,p.raw,p.rights,p.updated_at,u.display_name FROM publications p JOIN users u ON u.id=p.owner_id WHERE p.id=? AND p.visible=1').get(id));
    check(row, 404, 'NOT_FOUND', 'Публикация не найдена.');
    return { id: row.id, revision: row.revision, data: JSON.parse(row.raw), rights: row.rights, author: row.display_name, updatedAt: row.updated_at };
}
async function publicList(offset=0){
  const rows=await statement('SELECT p.id,p.revision,p.raw,p.rights,p.updated_at,u.display_name FROM publications p JOIN users u ON u.id=p.owner_id WHERE p.visible=1 ORDER BY p.updated_at DESC,p.id LIMIT 20 OFFSET ?').all(offset);
  return rows.map(row=>({id:row.id,revision:row.revision,data:JSON.parse(row.raw),rights:row.rights,author:row.display_name,updatedAt:row.updated_at}));
}

async function createFeedback(owner, title, body, target, now, operation) {
    return (await atomic(async () => {
        const raw = JSON.stringify({ title, body, target }), old = (await receipt(owner, 'feedback-create', operation, raw));
        if (old)
            return (await statement('SELECT id,title,body,target,status,created_at AS createdAt FROM feedback WHERE id=? AND owner_id=?').get(old.result_id, owner));
        const id = randomUUID();
        (await statement("INSERT INTO feedback VALUES(?,?,?,?,?,'received',?)").run(id, owner, title, body, target, now));
        (await statement('INSERT INTO operation_receipts VALUES(?,?,?,?,?,?)').run(owner, 'feedback-create', operation, sha(raw), id, now));
        return { id, title, body, target, status: 'received', createdAt: now };
    }, owner));
}
async function feedbackList(owner) { return (await statement('SELECT id,title,body,target,status,created_at AS createdAt FROM feedback WHERE owner_id=? ORDER BY created_at DESC,id LIMIT 100').all(owner)); }

return {db:adapter.native,filename:adapter.filename,_database:adapter,statement,atomic,rate,getUser,credentials,register,session,newSession,revokeSession,resetPassword,getObject,putObject,melody,listMelodies,createMelody,updateMelody,publish,unpublish,publicMelody,publicList,createFeedback,feedbackList,health:async()=>{await statement('SELECT 1').get();return {engine:adapter.kind,databaseSchemaVersion:2};},close:()=>adapter.close(),backup:target=>adapter.legacy?.backup(target)};
}
module.exports={openRepository};
