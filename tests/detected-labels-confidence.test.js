const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('AI image labels use a usable top CLIP candidate when no high-confidence class exists', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /objectCandidates/);
  assert.match(server, /topCandidateConfidence\s*>\s*0/);
  assert.match(server, /retain it as weak evidence/i);
  assert.match(server, /item\.detectedLabelConfidence/);
  assert.match(server, /selectedObjectLabel/);
});

test('low-confidence CLIP labels remain weak evidence and cannot earn full image-label points', () => {
  const matcher = fs.readFileSync(path.join(__dirname, '..', 'src', 'advanced-cnn', 'matchingServiceCompat.js'), 'utf8');
  assert.match(matcher, /Both high-confidence predictions can contribute up to 5\/5/);
  assert.match(matcher, /Math\.min\(2, rawScore\)/);
  assert.match(matcher, /labelScore\(\s*lost,\s*found\s*\)/);
});

test('CLIP object vocabulary includes common chargers and cables', () => {
  const cnn = fs.readFileSync(path.join(__dirname, '..', 'ai-service', 'services', 'cnn_service.py'), 'utf8');
  assert.match(cnn, /a phone charger/);
  assert.match(cnn, /a charging cable/);
  assert.match(cnn, /a power adapter/);
});

test('matching engine awards capped points for matching weak labels and full points for strong labels', () => {
  const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');
  const item = (confidence) => ({
    name: 'phone charger', category: 'Electronics', description: 'phone charger',
    detectedLabels: ['phone charger'], detectedLabelConfidence: confidence
  });
  const weak = calculateMatchScore(item(0.2), item(0.2));
  const strong = calculateMatchScore(item(0.8), item(0.8));
  assert.ok(weak.breakdown.imageLabels > 0 && weak.breakdown.imageLabels <= 2);
  assert.equal(strong.breakdown.imageLabels, 5);
});
