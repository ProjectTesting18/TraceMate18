const {
  calculateMatchScore,
  extractProperties
} = require("../src/advanced-cnn/matchingServiceCompat");

const lost = {
  name: "charger",
  category: "electronics",
  description: "red charger cable with white adaptor of one plus",
  location: "parking",
  brand: "OnePlus",
  color: "red",
  visualRecognition: {
    objectType: "charger",
    objectConfidence: 0.17,
    color: "red",
    colorConfidence: 0.8
  }
};

const found = {
  name: "charger",
  category: "electronics",
  description: "charger found near parking area",
  location: "parking",
  brand: "OnePlus",
  color: "white",
  visualRecognition: {
    objectType: "charger",
    objectConfidence: 0.17,
    color: "white",
    colorConfidence: 0.8
  }
};

const result = calculateMatchScore(lost, found);

console.log("\n=== INTERNAL MATCH DIAGNOSTIC ===");
console.log(JSON.stringify({
  score: result.score,
  nlpSimilarity: result.nlpSimilarity,
  scoreAudit: result.scoreAudit,
  propertyBreakdown: result.propertyBreakdown,
  lostExtractedProperties: extractProperties({
    description: lost.description
  }),
  foundExtractedProperties: extractProperties({
    description: found.description
  })
}, null, 2));
