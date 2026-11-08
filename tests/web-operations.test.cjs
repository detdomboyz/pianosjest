'use strict';
const test = require('node:test');
const {execFileSync} = require('node:child_process');
const path = require('node:path');

test('release archives preserve sources and reject corrupt, private and escaping members', () => {
  execFileSync('python', [path.join(__dirname, 'web_operations_test.py')], {
    cwd: path.resolve(__dirname, '..'), timeout: 60000, windowsHide: true,
    stdio: 'pipe', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}
  });
});
