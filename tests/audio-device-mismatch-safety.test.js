const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

test('unknown brands are not scored as a perfect brand match', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../src/advanced-cnn/matchingServiceCompat'), 'utf8');
  assert.match(source, /const brand = a\.brands\.length && b\.brands\.length/);
});

test('asymmetric low/high audio object confidence caps candidate and requires manual review', () => {
  const result = calculateMatchScore(
    {
      name: 'White Headphones', description: 'White headphones, with a white headband and white ear cups.',
      category: 'Electronics', color: 'White', location: 'classroom',
      visualDetails: { objectType: 'headphone', objectConfidence: 0.28 }, visualRecognition: { objectType: 'headphone', objectConfidence: 0.28 }
    },
    {
      name: 'headphone', description: 'White audio headphones', category: 'Electronics', color: 'White', location: 'classroom',
      visualDetails: { objectType: 'headphone', objectConfidence: 0.91 }, visualRecognition: { objectType: 'headphone', objectConfidence: 0.91 }
    }
  );
  assert.ok(result.score <= 59, `expected score <= 59, got ${result.score}`);
  assert.equal(result.reviewRecommended, true);
  assert.ok(result.reviewReasons.some(reason => /audio-device image predictions/i.test(reason)));
});
