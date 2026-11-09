'use strict';

function hasHardMatchConflict(result = {}) {
  return result.identityConflict === true ||
    result.objectFamilyConflict === true ||
    result.objectConflict === true;
}

/**
 * Prefer eligible candidates. If all open candidates are hard conflicts,
 * return at most five as review-only rows so the admin can see why no safe
 * match is available. Review-only rows must never be confirmable.
 */
function selectAdminCandidatePool(scoredCandidates, options = {}) {
  const limit = Number.isInteger(options.limit) ? Math.max(1, options.limit) : 10;
  const fallbackLimit = Number.isInteger(options.fallbackLimit)
    ? Math.max(1, options.fallbackLimit)
    : 5;
  const valid = Array.isArray(scoredCandidates)
    ? scoredCandidates.filter(candidate => candidate && candidate.item && candidate.result)
    : [];
  const compatible = valid.filter(candidate => !hasHardMatchConflict(candidate.result));
  if (compatible.length) {
    return {
      candidates: compatible.slice(0, limit).map(candidate => ({
        ...candidate,
        eligibleForConfirmation: true,
        hardConflictCandidate: false
      })),
      reviewOnlyFallback: false
    };
  }
  return {
    candidates: valid.slice(0, fallbackLimit).map(candidate => ({
      ...candidate,
      eligibleForConfirmation: false,
      hardConflictCandidate: hasHardMatchConflict(candidate.result)
    })),
    reviewOnlyFallback: valid.length > 0
  };
}

module.exports = { hasHardMatchConflict, selectAdminCandidatePool };
