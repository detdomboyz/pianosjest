'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');

test('release interruption: native backoff and deferred health cannot inherit stale success', (t) => {
  const output = spawnSync('python', ['-B', path.join(__dirname, 'release_interruption_test.py'), '--portable'], {
    cwd: path.resolve(__dirname, '..'), timeout: 30000, windowsHide: true,
    env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}, encoding: 'utf8', stdio: 'pipe'
  });
  assert.equal(output.error, undefined);
  assert.equal(output.status, 0, output.stderr);
  assert.match(output.stderr, /Ran 12 tests/);
  assert.match(output.stderr, /\nOK\s*$/);
  assert.equal(output.stdout, '');
  t.diagnostic('12 Python interruption cases passed without skips; no native service commands executed.');
});
