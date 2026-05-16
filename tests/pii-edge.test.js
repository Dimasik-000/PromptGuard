const test = require('node:test');
const assert = require('node:assert/strict');

const { regexScan, scanAndRedact } = require('../src/pii-core');

test('detects mixed pii types including address', () => {
  const text = 'Contact me: john@example.com, вул. Шевченка 10, IP 192.168.1.1';
  const types = regexScan(text).map(s => s.type);

  assert.ok(types.includes('EMAIL'));
  assert.ok(types.includes('ADDRESS'));
  assert.ok(types.includes('IP'));
});

test('keeps first two phones and redacts the rest', () => {
  const text = 'Phones: +380501112233, +380671112233, +380931112233';
  const result = scanAndRedact(text, 2);

  assert.match(result.redacted, /\+380501112233/);
  assert.match(result.redacted, /\+380671112233/);
  assert.match(result.redacted, /\[REDACTED_PHONE\]/);
  assert.equal(result.redactableCount, 1);
});

test('prefers credit card over overlapping phone match', () => {
  const text = 'Card: 4111 1111 1111 1111';
  const spans = regexScan(text);

  assert.equal(spans.length, 1);
  assert.equal(spans[0].type, 'CC');
});

test('returns unchanged text when no pii found', () => {
  const text = 'Just a normal message without secrets.';
  const result = scanAndRedact(text, 2);

  assert.equal(result.redacted, text);
  assert.equal(result.redactableCount, 0);
});
