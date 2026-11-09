const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

test('low text similarity can cap a weak charging-accessory match without inventing an unresolved-object warning', () => {
  const result = calculateMatchScore(
    {
      name: 'Black Charging Cable with Vivo Adapter',
      category: 'electronics',
      description: 'A black braided charging cable with multiple connectors, a white Vivo wall adapter and a small collectible character figurine attached to one cable.',
      visualRecognition: { objectType: 'charger', objectConfidence: 26, color: 'black', colorConfidence: 80 }
    },
    {
      name: 'vivo charger with 3 charging cable in one',
      category: 'electronics',
      description: 'Vivo charger with three charging cables together.',
      visualRecognition: { objectType: 'cable', objectConfidence: 31, color: 'black', colorConfidence: 78 }
    }
  );

  assert.ok(result.score <= 69, `unresolved object type must cap score at 69, got ${result.score}`);
  assert.ok(result.recommendedScoreCap <= 69);
  assert.equal(result.reviewRecommended, true);
  assert.ok(result.reviewReasons.some(reason => /Low-confidence visual object prediction/i.test(reason)));
  assert.ok(result.reviewReasons.some(reason => /lost: 26%; found: 31%; review threshold: 45%/i.test(reason)), 'show the actual visual classifier confidence and threshold');
  assert.ok(result.scoreAudit.recommendedScoreCapReasons.some(reason => /combined text evidence is .* below the 45% threshold/i.test(reason)), 'explain that the text evidence triggered the conservative score cap');
  assert.ok(!result.reviewReasons.some(reason => /object type evidence is unresolved/i.test(reason)), 'do not claim object type evidence is missing when measured subtype evidence is positive');
});

test('admin candidate renderer contains a defensive cap for zero object-type evidence plus a review warning', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(adminSource, /function requiresVisualIdentityScoreCap/);
  assert.match(adminSource, /object type evidence is unresolved\|object type similarity is 0/i);
  assert.match(adminSource, /const score = objectTypeScoreCapped \? 69 : rawScore/);
});

test('charging cable and charger remain family-compatible but are not reported as an exact 100% subtype match', () => {
  const result = calculateMatchScore(
    {
      name: 'Black Charging Cable with Vivo Adapter',
      category: 'electronics',
      description: 'A black braided charging cable with multiple connectors, a white Vivo wall adapter and a small collectible character figurine attached to one cable.',
      visualRecognition: { objectType: 'charger', objectConfidence: 26, color: 'black', colorConfidence: 80 }
    },
    {
      name: 'vivo charger with 3 charging cable in one',
      category: 'electronics',
      description: 'Vivo charger with three charging cables together.',
      visualRecognition: { objectType: 'cable', objectConfidence: 31, color: 'black', colorConfidence: 78 }
    }
  );
  assert.notEqual(result.identityConflict, true, 'related charging accessories should not hard-reject solely for subtype difference');
  assert.ok(result.propertyBreakdown.objectType < 100, `different subtypes should not show exact 100% object type, got ${result.propertyBreakdown.objectType}`);
  assert.ok(result.score <= 69, `low-confidence object predictions should cap score, got ${result.score}`);
  assert.equal(result.reviewRecommended, true);
});

test('admin display caps only explicitly unresolved object identity, not low-confidence warning alone', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const adminSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin.js'), 'utf8');
  assert.match(adminSource, /function requiresVisualIdentityScoreCap/);
  assert.match(adminSource, /function effectiveCandidateScore/);
  assert.match(adminSource, /filter\(match => effectiveCandidateScore\(match\) >= 80\)/);
  assert.match(adminSource, /object type evidence is unresolved\|object type similarity is 0/i);
});


test('strong charging-kit text/property evidence is not capped solely by low visual classifier confidence', () => {
  const item = {
    name: 'Black Charging Cable with Vivo Adapter',
    category: 'electronics',
    description: 'A black braided charging cable with multiple charging connectors, a white Vivo wall adapter, and a small collectible character figurine attached to one of the cables. The adapter has the Vivo logo. The cable is black, and the adapter is white.',
    location: 'parking',
    visualRecognition: {
      objectType: 'charger', objectConfidence: 0.30,
      color: 'black', colorConfidence: 0.80,
      brand: 'vivo', brandConfidence: 0.80
    }
  };
  const result = calculateMatchScore(item, { ...item, location: 'parking area' });
  assert.equal(result.propertyBreakdown.objectType, 100);
  assert.equal(result.reviewRecommended, true, 'low-confidence visual prediction must still recommend manual review');
  assert.ok(result.score > 69, `strong text/property evidence should not be capped solely by visual confidence; got ${result.score}`);
  assert.ok(result.reviewReasons.some(reason => /Low-confidence visual object prediction/i.test(reason)));
  assert.ok(!result.reviewReasons.some(reason => /score capped pending manual review/i.test(reason)));
});
