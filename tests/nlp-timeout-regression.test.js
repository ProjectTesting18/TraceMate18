const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('NLP and image-text bridges allow model cold-start buffers with configurable timeouts', () => {
  const bridge = fs.readFileSync(path.join(__dirname, '../src/advanced-cnn/nlpBridge.js'), 'utf8');
  const cnnBridge = fs.readFileSync(path.join(__dirname, '../src/advanced-cnn/cnnBridge.js'), 'utf8');
  assert.match(bridge, /NLP_TIMEOUT_MS/);
  assert.match(bridge, /45000/);
  assert.match(cnnBridge, /IMAGE_TEXT_TIMEOUT_MS/);
  assert.match(cnnBridge, /90000/);
});
test('NLP service loads SBERT asynchronously and keeps a TF-IDF fallback', () => {
  const service = fs.readFileSync(path.join(__dirname, '../ai-service/services/nlp_service.py'), 'utf8');
  assert.match(service, /threading\.Thread/);
  assert.match(service, /_tfidf_compare\(text1, text2\)/);
  assert.match(service, /fallback_used/);
});
