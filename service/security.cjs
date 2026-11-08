'use strict';
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const SCRYPT = Object.freeze({N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024});
class ServiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function check(condition, status, code, message) { if (!condition) throw new ServiceError(status, code, message); }
function username(value) {
  check(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{3,31}$/.test(value), 400, 'USERNAME', 'Логин: от 4 до 32 латинских букв, цифр, знаков _ или -.');
  const result = value.toLowerCase();
  check(!['admin', 'administrator', 'melodiajest', 'support', 'moderator', 'root', 'system'].includes(result), 400, 'USERNAME', 'Выбери другой логин.');
  return result;
}
function password(value) {
  check(typeof value === 'string' && Array.from(value).length >= 15 && Array.from(value).length <= 128 && Buffer.byteLength(value) <= 512, 400, 'PASSWORD', 'Пароль: от 15 до 128 символов. Можно использовать длинную фразу.');
  check(!/^(.)\1+$/.test(value) && !['passwordpassword', '123456789012345', 'qwertyuiopasdfgh', 'парольпарольпароль'].includes(value.toLowerCase()), 400, 'PASSWORD', 'Выбери менее предсказуемый пароль.');
  return value;
}
function displayName(value) {
  check(typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 60 && !/[\u0000-\u001f\u007f]/.test(value), 400, 'NAME', 'Имя для публикаций должно содержать от 1 до 60 символов.');
  return value.trim();
}
async function hashPassword(value) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await scrypt(value, salt, 32, SCRYPT);
  return ['scrypt', 32768, 8, 3, salt, hash.toString('hex')].join('$');
}
async function verifyPassword(value, encoded) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 512 || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$32768$8$3' || !/^[a-f0-9]{32}$/.test(parts[4]) || !/^[a-f0-9]{64}$/.test(parts[5])) return false;
  const actual = await scrypt(value, parts[4], 32, SCRYPT);
  return crypto.timingSafeEqual(actual, Buffer.from(parts[5], 'hex'));
}
function constantEqual(a, b) {
  return typeof a === 'string' && typeof b === 'string' && crypto.timingSafeEqual(Buffer.from(sha(a), 'hex'), Buffer.from(sha(b), 'hex'));
}
function csrf(secret, session) { return crypto.createHmac('sha256', secret).update('melodiajest-csrf-v1\0' + session).digest('base64url'); }
function cookieValue(header, name) {
  const matches = String(header || '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='));
  return matches.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(matches[0].slice(name.length + 1)) ? matches[0].slice(name.length + 1) : null;
}
function jsonRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function exactFields(value, names) {
  check(jsonRecord(value) && Object.keys(value).every(key => names.includes(key)), 400, 'FIELDS', 'В запросе есть неподдерживаемые поля.');
}
module.exports = {ServiceError, check, username, password, displayName, hashPassword, verifyPassword, constantEqual, csrf, cookieValue, token, sha, jsonRecord, exactFields, SCRYPT};
