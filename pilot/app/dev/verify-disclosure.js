'use strict';
const assert = require('assert/strict');
const { requestDisclosures } = require('../request-disclosure');
const { extractionJobs } = require('../extraction-recovery');
const receipts = requestDisclosures();
const candidate = { name: 'fixture', model: 'fake', local: true, baseUrl: 'http://user:password@127.0.0.1:5999/v1?key=not-a-real-key' };
const body = { model: 'fake', messages: [{ role: 'user', content: 'visible conversation' }], stream: true };
let receipt = receipts.begin('chat', 'c-1', candidate, body);
assert.equal(receipt.endpoint, 'http://127.0.0.1:5999'); assert.deepEqual(JSON.parse(receipt.payload), body);
assert.equal(receipts.latest('chat', 'c-2'), null); assert.equal(receipts.latest('extract', 'c-1'), null);
assert(!JSON.stringify(receipt).includes('password')); assert(!JSON.stringify(receipt).includes('not-a-real-key'));
receipt = receipts.begin('extract', 'c-1', candidate, { ...body, messages: [{ role: 'user', content: 'x'.repeat(150000) }] });
assert.equal(receipt.payload.length, 100000); assert.equal(receipt.truncated, true); assert(receipt.chars > 100000);
for (let n = 2; n < 35; n++) receipts.begin('chat', 'c-' + n, candidate, body);
assert.equal(receipts.latest('chat', 'c-1'), null);
console.log('PASS request disclosure separates chats/roles, strips endpoint credentials, bounds content and evicts old receipts');

const lines = [{ id: 'u', role: 'user', chat: 'c-1', text: 'Task: recover evidence.' },
  { id: 'r', role: 'assistant', chat: 'c-1', text: 'Done', replyTo: 'u', extractionPlanned: true },
  { id: 'legacy', role: 'assistant', text: 'Old or partial reply' }];
assert.equal(extractionJobs(lines, []).length, 1); assert.equal(extractionJobs(lines, [])[0].status, 'interrupted');
assert.equal(extractionJobs(lines, [], new Map([['r', 'running']]))[0].retryable, false);
assert.equal(extractionJobs(lines, [], new Map(), 'c-2').length, 0);
assert.equal(extractionJobs(lines, [{ event: 'extract', fromMessage: 'r' }, { event: 'extract_error', fromMessage: 'r', error: 'later controller failure' }]).length, 0);
assert.equal(extractionJobs(lines, [{ event: 'extract_dismissed', fromMessage: 'r' }]).length, 0);
assert.equal(extractionJobs(lines.slice(1), [])[0].retryable, false);
console.log('PASS extraction recovery excludes legacy/partial/completed/dismissed turns and never retries a missing or cross-chat source');
console.log('ALL DISCLOSURE AND RECOVERY CHECKS PASSED');
