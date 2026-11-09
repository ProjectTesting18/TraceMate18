const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMatchScore } = require('../src/advanced-cnn/matchingServiceCompat');

test('red cable and white adapter do not trigger a whole-item color conflict', () => {
  const lost = {
    name: 'charger',
    category: 'electronics',
    description: 'red charger cable with white adaptor of one plus',
    location: 'parking'
  };

  const found = {
    name: 'charger',
    category: 'electronics',
    description: 'a white charger of oneplus company which has 80w initials on it',
    location: 'near bike parking'
  };

  const result = calculateMatchScore(lost, found);

  assert.equal(result.scoreAudit.primaryColorConflict, false);
  assert.equal(result.scoreAudit.multiComponentColorDifference, true);
  assert.equal(result.reviewRecommended, true);
  assert.ok(
    result.scoreAudit.internalTextSimilarityPercentage >= 0,
    'combined text similarity must be reported'
  );
});

test('red cable versus white cable still recommends manual review', () => {
  const result = calculateMatchScore(
    {
      name: 'charging cable',
      category: 'electronics',
      description: 'red charging cable'
    },
    {
      name: 'charging cable',
      category: 'electronics',
      description: 'white charging cable'
    }
  );

  assert.equal(result.reviewRecommended, true);
});
