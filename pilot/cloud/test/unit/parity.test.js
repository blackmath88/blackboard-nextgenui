// The Worker reuses local Pilot code that cannot be imported (CommonJS with Node fs): check the copies match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { looksLikeKey, shortTitle } from '../../src/guard.js';

const here = (p) => new URL(p, import.meta.url);
const require = createRequire(import.meta.url);

test('style.css is the local Pilot stylesheet', () => {
  assert.equal(readFileSync(here('../../public/style.css'), 'utf8'), readFileSync(here('../../../app/public/style.css'), 'utf8'));
});

test('looksLikeKey matches pilot/app/secrets.js', () => {
  const local = require('../../../app/secrets.js');
  for (const s of ['hello', 'sk-ant-abcdefgh12345', 'mistral_ABCDEFGH1234', 'sk-proj-xxxxxxxxxxxxxx', 'A'.repeat(40), 'a normal sentence that is long enough to be 32+ chars']) {
    assert.equal(looksLikeKey(s), local.looksLikeKey(s), s);
  }
});

test('shortTitle matches pilot/app/server.js', () => {
  const src = readFileSync(here('../../../app/server.js'), 'utf8');
  const line = src.split('\n').find((l) => l.startsWith('const shortTitle = '));
  assert.ok(line);
  assert.ok(readFileSync(here('../../src/guard.js'), 'utf8').includes('export ' + line));
  assert.equal(shortTitle('First sentence. Second one.'), 'First sentence.');
});
