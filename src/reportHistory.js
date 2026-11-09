'use strict';

const TRACKED_FIELDS = [
  'name', 'category', 'date', 'foundDate', 'location', 'desc',
  'color', 'brand', 'features', 'storage', 'status'
];

function comparableValue(item, field) {
  if (field === 'photo') return Boolean(item && item.image);
  const value = item ? item[field] : undefined;
  return value == null ? '' : String(value).trim().toLowerCase();
}

function snapshotReport(item = {}) {
  const snapshot = {};
  for (const field of TRACKED_FIELDS) {
    if (item[field] !== undefined) snapshot[field] = item[field];
  }
  snapshot.photoAttached = Boolean(item.image);
  return snapshot;
}

function prepareReportsWithHistory(existingItems, incomingItems, type, now = new Date().toISOString()) {
  const oldById = new Map((Array.isArray(existingItems) ? existingItems : []).filter(x => x && x.id).map(x => [String(x.id), x]));
  const label = type === 'found_items' ? 'Found' : 'Lost';

  return (Array.isArray(incomingItems) ? incomingItems : []).map(raw => {
    const item = { ...(raw || {}) };
    const old = item.id ? oldById.get(String(item.id)) : null;
    const priorTimeline = Array.isArray(item.timeline) ? item.timeline : (Array.isArray(old?.timeline) ? old.timeline : []);
    const priorHistory = Array.isArray(item.history) ? item.history : (Array.isArray(old?.history) ? old.history : []);
    item.timeline = priorTimeline.slice();
    item.history = priorHistory.slice();

    if (!old) {
      item.createdAt = item.createdAt || (item.created ? `${item.created}T00:00:00.000Z` : now);
      item.updatedAt = item.updatedAt || now;
      const event = { event: `${label} report created`, time: now };
      item.timeline.push(event);
      item.history.push({ event: 'created', time: now, snapshot: snapshotReport(item) });
      item.history = item.history.slice(-50);
      return item;
    }

    // Preserve server-owned lifecycle fields if a stale browser form omits them.
    item.createdAt = old.createdAt || item.createdAt || (old.created ? `${old.created}T00:00:00.000Z` : now);
    for (const field of ['receivedAt', 'receivedByAdminId', 'matchedLostItemId', 'matchedAt']) {
      if (item[field] === undefined && old[field] !== undefined) item[field] = old[field];
    }

    const changedFields = TRACKED_FIELDS.filter(field => comparableValue(old, field) !== comparableValue(item, field));
    if (String(old.image || '') !== String(item.image || '')) changedFields.push('photo');

    if (changedFields.length) {
      item.updatedAt = now;
      const event = { event: `${label} report updated`, time: now, changedFields };
      item.timeline.push(event);
      item.history.push({ event: 'updated', time: now, changedFields, snapshot: snapshotReport(item) });
      item.history = item.history.slice(-50);
    } else {
      item.updatedAt = old.updatedAt || item.updatedAt || item.createdAt;
    }

    return item;
  });
}

module.exports = { prepareReportsWithHistory, snapshotReport };
