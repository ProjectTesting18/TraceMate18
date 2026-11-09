const test = require('node:test');
const assert = require('node:assert/strict');
const { cnnScore } = require('../src/advanced-cnn/matchingServiceCompat');

test('color-histogram fallback is never reported as MobileNetV2 similarity', () => {
  const vector = [1, 0, 0, 1];
  const result = cnnScore(
    { imageEmbedding: vector, imageEmbeddingModel: 'ColorHistogramFallback' },
    { imageEmbedding: vector, imageEmbeddingModel: 'ColorHistogramFallback' }
  );
  assert.equal(result.mobileNetPercentage, null);
  assert.equal(result.percentage, null);
  assert.equal(result.model, 'none');
});

test('real MobileNetV2 embeddings retain cosine similarity scoring', () => {
  const vector = [1, 0, 0, 1];
  const result = cnnScore(
    { imageEmbedding: vector, imageEmbeddingModel: 'MobileNetV2' },
    { imageEmbedding: vector, imageEmbeddingModel: 'MobileNetV2' }
  );
  assert.equal(result.mobileNetPercentage, 100);
});

test('null and blank embedding dimensions cannot become matching zeroes', () => {
  const result = cnnScore(
    { imageEmbedding: [1, null, 0], imageEmbeddingModel: 'MobileNetV2' },
    { imageEmbedding: [1, '', 0], imageEmbeddingModel: 'MobileNetV2' }
  );
  assert.equal(result.mobileNetPercentage, null);
  assert.equal(result.percentage, null);
});

test('orthogonal embeddings are not inflated to a 50 percent visual match', () => {
  const result = cnnScore(
    { imageEmbedding: [1, 0], imageEmbeddingModel: 'MobileNetV2' },
    { imageEmbedding: [0, 1], imageEmbeddingModel: 'MobileNetV2' }
  );
  assert.equal(result.mobileNetCosine, 0);
  assert.equal(result.mobileNetPercentage, 0);
  assert.equal(result.percentage, 0);
});
