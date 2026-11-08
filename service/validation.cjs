'use strict';
const {check, exactFields, jsonRecord} = require('./security.cjs');
const Transfer = require('../catalog-transfer.js');
const Adapter = require('../piano-catalog-adapter.js');
const Music = require('../music-document.js');
const Personal = require('../catalog-personalization.js');
const MAX_CATALOG = 5 * 1024 * 1024;
function boundedJson(raw, max) {
  check(typeof raw === 'string' && Buffer.byteLength(raw) <= max, 413, 'DATA_SIZE', 'Данные превышают допустимый размер.');
  let value; try { value = JSON.parse(raw); } catch { check(false, 400, 'JSON', 'Не удалось прочитать JSON.'); }
  let count = 0;
  function visit(item, depth) {
    check(depth <= 40 && ++count <= 300000, 400, 'JSON_DEPTH', 'Слишком сложная структура данных.');
    if (item && typeof item === 'object') for (const key of Object.keys(item)) {
      check(!['__proto__', 'constructor', 'prototype'].includes(key), 400, 'JSON_KEY', 'Недопустимое имя поля.');
      visit(item[key], depth + 1);
    }
  }
  visit(value, 0); return value;
}
function revision(value) { check(Number.isSafeInteger(value) && value >= 0, 400, 'REVISION', 'Не указана версия сохранённых данных.'); return value; }
function operationId(value) { check(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value), 400, 'OPERATION_ID', 'Не указан ID операции сохранения.'); return value; }
function objectRaw(kind, raw) {
  const value = boundedJson(raw, kind === 'catalog' ? MAX_CATALOG : 16384);
  check(jsonRecord(value), 400, 'OBJECT', 'Ожидается объект настроек или каталога.');
  if (kind === 'catalog') {
    if(value.kind===Personal.KIND){try{Personal.validate(value);}catch{check(false,400,'PERSONAL_CATALOG','Личные правки каталога не прошли проверку или превышают 2 МБ. Сохрани полный JSON.');}return raw;}
    try { Transfer.read(raw, pattern => Adapter.parsePattern(pattern).steps.length > 0); }
    catch { check(false, 400, 'CATALOG', 'Каталог не прошёл проверку. Исходная копия не изменена.'); }
  }
  return raw; // Preserve musical metadata, unknown extensions, order, IDs and raw JSON.
}
function text(value, max, min = 0) {
  check(typeof value === 'string' && value.trim().length >= min && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 400, 'TEXT', 'Проверь длину и содержание текстовых полей.');
  return value;
}
function melodyData(value) {
  exactFields(value, ['entry', 'origin', 'source']);
  check(['original', 'adaptation', 'public-domain'].includes(value.origin), 400, 'ORIGIN', 'Укажи происхождение мелодии.');
  text(value.source, 2000);
  const entry = value.entry;
  check(jsonRecord(entry) && entry.contentKind === 'piece', 400, 'MELODY', 'Личная мелодия должна быть произведением.');
  text(entry.id, 200, 1); text(entry.title, 200, 1); text(entry.description, 20000); text(entry.pattern, 100000, 1);
  boundedJson(JSON.stringify(value), 256 * 1024);
  try {
    Transfer.read(JSON.stringify({version: 7, themes: [{id: entry.themeId, name: 'Личная мелодия'}], lessons: [entry]}), pattern => Adapter.parsePattern(pattern).steps.length > 0);
    const projection = Adapter.project(entry);
    Music.assertValid(projection.music);
    check(projection.music.notes.length > 0 && projection.music.notes.length <= 10000, 400, 'NOTES', 'Допустимо от 1 до 10000 нот.');
  } catch (error) {
    if (error.status) throw error;
    check(false, 400, 'MUSIC_DATA', 'Ноты или музыкальные данные не прошли проверку.');
  }
  return value;
}
function feedback(value) {
  exactFields(value, ['title', 'body', 'target', 'operationId']);
  operationId(value.operationId);
  text(value.title, 160, 3); text(value.body, 10000, 10); text(value.target, 300);
  return value;
}
module.exports = {boundedJson, revision, operationId, objectRaw, melodyData, feedback, text, MAX_CATALOG};
