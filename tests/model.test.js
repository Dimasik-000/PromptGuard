const test = require('node:test');
const assert = require('node:assert/strict');

const model = require('../src');

test('model name', () => {
  assert.equal(model.MODEL_NAME, 'bert-base-NER');
});

test('model files', () => {
  assert.equal(model.MODEL_FILES.length, 4);
});

test('model path', () => {
  assert.match(model.getModelPath('config.json'), /models\/bert-base-NER\/config\.json$/);
});