'use strict';
// Private, repeatable database snapshots. No production restore operation exists.
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {openStore} = require('./store.cjs');
const {sha, check} = require('./security.cjs');
const FILES = ['accounts.sqlite', 'session-secret'];
const DATA_TABLES=Object.freeze(Object.fromEntries(Object.entries({...require('./data-model.cjs').TABLES,service_metadata:'app_key'}).filter(([name])=>!['sessions','rate_limits'].includes(name))));
function dataDigest(db){
  const hash=require('node:crypto').createHash('sha256');
  for(const [table,order]of Object.entries(DATA_TABLES)){if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;hash.update(table+'\0');for(const row of db.prepare('SELECT * FROM '+table+' ORDER BY '+order).iterate())hash.update(JSON.stringify(row)+'\n');}
  return hash.digest('hex');
}
function regular(directory, name) {
  const file = path.join(directory, name);
  check(!fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile(), 500, 'BACKUP_FILE', 'Ожидается обычный файл копии.');
  return fs.readFileSync(file);
}
function realDirectory(directory) {
  directory = path.resolve(directory);
  const actual=fs.realpathSync(directory);
  check(fs.statSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink() && (process.platform==='win32'?actual.toLowerCase()===directory.toLowerCase():actual===directory), 500, 'BACKUP_PATH', 'Ожидается настоящий каталог.');
  return directory;
}
async function createBackup({dataDir, backupRoot, now = Date.now()}) {
  dataDir = realDirectory(dataDir);
  backupRoot = realDirectory(backupRoot);
  check(dataDir !== backupRoot && !backupRoot.startsWith(dataDir + path.sep), 500, 'BACKUP_PATH', 'Копия должна лежать отдельно от рабочей базы.');
  const id = new Date(now).toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
  const target = path.join(backupRoot, id); fs.mkdirSync(target, {mode: 0o700});
  const store = openStore(path.join(dataDir, 'accounts.sqlite'), {readOnly: true});
  try { await store.backup(path.join(target, 'accounts.sqlite')); } finally { store.close(); }
  // A closed portable snapshot must not need or create WAL/SHM companions when
  // verified read-only. Change only the new copy, never the production journal.
  const {DatabaseSync} = require('node:sqlite');
  const standalone = new DatabaseSync(path.join(target, 'accounts.sqlite'));
  let digest;
  try { standalone.exec('PRAGMA secure_delete=ON; DELETE FROM sessions; DELETE FROM rate_limits; PRAGMA journal_mode=DELETE; VACUUM;');digest=dataDigest(standalone); } finally { standalone.close(); }
  const secret = regular(dataDir, 'session-secret');
  check(/^[a-f0-9]{64}\n?$/.test(secret.toString()), 500, 'BACKUP_SECRET', 'Секрет не прошёл проверку.');
  fs.writeFileSync(path.join(target, 'session-secret'), secret, {flag: 'wx', mode: 0o600});
  const files = {};
  for (const name of FILES) { const bytes = regular(target, name); files[name] = {bytes: bytes.length, sha256: sha(bytes)}; try { fs.chmodSync(path.join(target, name), 0o600); } catch {} }
  const manifest = {kind: 'melodiajest-account-backup', version: 1, schemaVersion: 1, serviceVersion: require('./package.json').version, createdAt: new Date(now).toISOString(), sqliteOnlineBackup: true, encrypted: false, dataDigest:digest,excludedTables:['sessions','rate_limits'],restoredUsersMustSignIn:true,files};
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  verifyBackup(target);
  return {directory: target, manifest};
}
function verifyBackup(directory) {
  directory = realDirectory(directory);
  check(JSON.stringify(fs.readdirSync(directory).sort()) === JSON.stringify([...FILES, 'manifest.json'].sort()), 500, 'BACKUP_ALLOWLIST', 'В копии есть лишние или отсутствующие файлы.');
  const raw = regular(directory, 'manifest.json');
  check(raw.length < 16384, 500, 'BACKUP_MANIFEST', 'Слишком большой манифест.');
  const manifest = JSON.parse(raw);
  check(manifest.kind === 'melodiajest-account-backup' && manifest.version === 1 && manifest.schemaVersion === 1 && JSON.stringify(Object.keys(manifest.files).sort()) === JSON.stringify([...FILES].sort()), 500, 'BACKUP_MANIFEST', 'Неизвестная копия.');
  for (const name of FILES) {
    const bytes = regular(directory, name), expected = manifest.files[name];
    check(bytes.length === expected.bytes && sha(bytes) === expected.sha256, 500, 'BACKUP_SHA256', 'Размер или SHA256 копии не совпадает.');
  }
  check(/^[a-f0-9]{64}\n?$/.test(regular(directory, 'session-secret').toString()), 500, 'BACKUP_SECRET', 'Некорректный секрет копии.');
  const store = openStore(path.join(directory, 'accounts.sqlite'), {readOnly: true});
  try {
    check(store.db.prepare('PRAGMA integrity_check').all().every(row => row.integrity_check === 'ok'), 500, 'DATABASE_INTEGRITY', 'Целостность базы не подтверждена.');
    check(store.db.prepare('PRAGMA foreign_key_check').all().length === 0, 500, 'DATABASE_REFERENCES', 'Повреждены связи базы.');
    check(manifest.dataDigest===dataDigest(store.db),500,'DATABASE_DATA_DIGEST','Содержательные данные копии отличаются.');
    check(store.db.prepare('SELECT count(*) AS n FROM sessions').get().n===0&&store.db.prepare('SELECT count(*) AS n FROM rate_limits').get().n===0,500,'BACKUP_SESSIONS','Копия не должна восстанавливать прежние сессии.');
  } finally { store.close(); }
  return manifest;
}
function restoreIsolated({bundle, isolatedRoot, productionDataDir}) {
  const manifest = verifyBackup(bundle);
  isolatedRoot = realDirectory(isolatedRoot);
  const production = productionDataDir ? path.resolve(productionDataDir) : null;
  check(production && isolatedRoot !== production && !isolatedRoot.startsWith(production + path.sep), 500, 'RESTORE_ISOLATION', 'Проверка требует явного рабочего каталога и не должна его использовать.');
  const target = path.join(isolatedRoot, 'account-restore-' + randomUUID());
  fs.mkdirSync(target, {mode: 0o700});
  for (const name of FILES) fs.writeFileSync(path.join(target, name), regular(bundle, name), {flag: 'wx', mode: 0o600});
  const store = openStore(path.join(target, 'accounts.sqlite'));
  try { check(store.db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok', 500, 'RESTORE_INTEGRITY', 'Восстановление не подтвердилось.'); }
  finally { store.close(); }
  return {directory: target, manifest, productionDataUsed: false};
}
if (require.main === module) {
  const [command, source, target, production] = process.argv.slice(2);
  (async () => {
    if (command === 'backup') {
      const result = await createBackup({dataDir: source, backupRoot: target});
      console.log(JSON.stringify({directory: result.directory, createdAt: result.manifest.createdAt, filesVerified: FILES.length, encrypted: false}));
    } else if (command === 'check') {
      const manifest = verifyBackup(source); console.log(JSON.stringify({verified: true, createdAt: manifest.createdAt, filesVerified: FILES.length}));
    } else if (command === 'restore-isolated') {
      const result = restoreIsolated({bundle: source, isolatedRoot: target, productionDataDir: production});
      console.log(JSON.stringify({directory: result.directory, integrityVerified: true, productionDataUsed: false}));
    } else throw Error('Usage: backup <data> <backup-root> | check <bundle> | restore-isolated <bundle> <isolated-root> <production-data>');
  })().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
}
module.exports = {createBackup, verifyBackup, restoreIsolated};
