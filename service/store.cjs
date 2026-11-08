'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync, backup} = require('node:sqlite');
const {check} = require('./security.cjs');
const APP_ID = 0x4d4a5331;
function openStore(filename, {readOnly = false} = {}) {
  filename = path.resolve(filename);
  check(!fs.existsSync(filename) || (!fs.lstatSync(filename).isSymbolicLink() && fs.statSync(filename).isFile()), 500, 'DATABASE_PATH', 'Недопустимый путь базы.');
  if (!readOnly) fs.mkdirSync(path.dirname(filename), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(filename, {readOnly, enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false});
  db.exec('PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;');
  const application = db.prepare('PRAGMA application_id').get().application_id;
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const empty = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n === 0;
  if (!readOnly && application === 0 && version === 0 && empty) {
    db.exec(`BEGIN IMMEDIATE;
      PRAGMA application_id=${APP_ID};
      CREATE TABLE users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, created_at INTEGER NOT NULL) STRICT;
      CREATE TABLE credentials(user_id TEXT PRIMARY KEY REFERENCES users(id), password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, changed_at INTEGER NOT NULL) STRICT;
      CREATE TABLE identities(issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), linked_at INTEGER NOT NULL, PRIMARY KEY(issuer,subject)) STRICT;
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
      CREATE INDEX sessions_user ON sessions(user_id);
      CREATE TABLE objects(user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('catalog','preferences')), revision INTEGER NOT NULL CHECK(revision>0), raw TEXT NOT NULL, digest TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,kind)) STRICT;
      CREATE TABLE melodies(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL CHECK(revision>0), raw TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
      CREATE INDEX melodies_owner ON melodies(owner_id,created_at);
      CREATE TABLE melody_revisions(melody_id TEXT NOT NULL REFERENCES melodies(id), revision INTEGER NOT NULL, raw TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(melody_id,revision)) STRICT;
      CREATE TABLE publications(id TEXT PRIMARY KEY, melody_id TEXT NOT NULL UNIQUE REFERENCES melodies(id), owner_id TEXT NOT NULL REFERENCES users(id), revision INTEGER NOT NULL CHECK(revision>0), melody_revision INTEGER NOT NULL, raw TEXT NOT NULL, rights TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, visible INTEGER NOT NULL CHECK(visible IN (0,1))) STRICT;
      CREATE INDEX publications_visible ON publications(visible,updated_at);
      CREATE TABLE publication_revisions(publication_id TEXT NOT NULL REFERENCES publications(id), revision INTEGER NOT NULL, raw TEXT NOT NULL, rights TEXT NOT NULL, visible INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(publication_id,revision)) STRICT;
      CREATE TABLE feedback(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('received','reviewing','resolved','declined')), created_at INTEGER NOT NULL) STRICT;
      CREATE INDEX feedback_owner ON feedback(owner_id,created_at);
      CREATE TABLE rate_limits(bucket TEXT PRIMARY KEY, started_at INTEGER NOT NULL, attempts INTEGER NOT NULL) STRICT;
      CREATE TABLE operation_receipts(owner_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, operation_id TEXT NOT NULL, digest TEXT NOT NULL, result_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id,kind,operation_id)) STRICT;
      PRAGMA user_version=1; COMMIT;`);
  } else {
    if (application !== APP_ID || version !== 1) {
      db.close();
      check(false, 500, 'DATABASE_VERSION', 'Неподдерживаемая база: автоматическое изменение отключено.');
    }
  }
  if (!readOnly) { db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON; PRAGMA max_page_count=32768;'); try { fs.chmodSync(filename, 0o600); } catch {} }
  // Low-level SQLite v1 format reader/initializer, retained for migration and
  // recovery. Current account operations use the shared async repository.
  let closed=false;
  return {db,filename,close:()=>{if(!closed){closed=true;db.close();}},backup:target=>backup(db,target)};
}
module.exports={openStore,APP_ID};
