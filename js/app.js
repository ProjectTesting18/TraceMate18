// ═══════════════════════════════════════════════
//  app.js – Navigation, Dashboard, Browse,
//           Report Lost/Found, Matching, Claims
//  TraceMate – Smart Lost & Found Campus App
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════
const pageTitles = {
  'dashboard':    'Dashboard',
  'browse':       'Browse Items',
  'report-lost':  'Report Lost Item',
  'report-found': 'Report Found Item',
  'my-reports':   'My Reports',
  'my-claims':    'My Claims',
  'admin':        'Admin Panel',
};

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');
  const navItem = [...document.querySelectorAll('.nav-item')]
    .find(n => n.getAttribute('onclick')?.includes(`'${name}'`));
  if (navItem) navItem.classList.add('active');
  document.getElementById('page-title').textContent = pageTitles[name] || name;
  refreshPage(name);
  window.scrollTo(0, 0);
}

function refreshPage(name) {
  if (name === 'dashboard')   refreshDashboard();
  if (name === 'browse')      renderBrowse();
  if (name === 'my-reports')  renderMyReports();
  if (name === 'my-claims')   renderMyClaims();
  if (name === 'admin')       renderAdmin();
}

function refreshAll() {
  refreshDashboard();
  renderBrowse();
  updateBadges();
  renderNotificationBell();
  initNotificationUI();
}

// ═══════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════
function refreshDashboard() {
  const lost     = DB.get('lost_items');
  const found    = DB.get('found_items');
  const claims   = DB.get('claims').map(c => ({ ...c, status: normalizeClaimStatus(c) }));
  const resolved = claims.filter(c => c.status === 'approved').length;
  const pending  = claims.filter(c => isClaimPending(c.status)).length;

  document.getElementById('dash-lost').textContent     = lost.length;
  document.getElementById('dash-found').textContent    = found.length;
  document.getElementById('dash-resolved').textContent = resolved;
  document.getElementById('dash-pending').textContent  = pending;

  // Auth screen stats
  document.getElementById('stat-total').textContent     = lost.length + found.length;
  document.getElementById('stat-recovered').textContent = resolved;
  document.getElementById('stat-users').textContent     = DB.get('users').filter(u => u.role !== 'admin').length;

  // Recent lists
  renderRecentList('recent-lost-list',  lost.slice(-3).reverse(),  'lost');
  renderRecentList('recent-found-list', found.slice(-3).reverse(), 'found');

  // Auto matches for current student
  if (currentUser && currentUser.role !== 'admin') {
    renderUserMatches();
    renderNotifications();
    renderNotificationBell();
  } else {
    const notificationSection = document.getElementById('notifications-section');
    if (notificationSection) notificationSection.style.display = 'none';
  }
}

function getCurrentUserNotifications() {
  if (!currentUser) return [];
  const users = DB.get('users');
  const me = users.find(u => u.id === currentUser.id) || currentUser;
  const notifications = Array.isArray(me.notifications) ? me.notifications : [];
  return notifications.slice().sort((a, b) => new Date(b.time || b.date || 0) - new Date(a.time || a.date || 0));
}

function renderNotifications() {
  if (!currentUser || currentUser.role === 'admin') return;

  const section = document.getElementById('notifications-section');
  const list = document.getElementById('notifications-list');
  if (!section || !list) return;

  const notifications = getCurrentUserNotifications();
  if (!notifications.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = notifications.slice(0, 8).map(n => {
    const message = escapeHtml(n.message || 'Possible match found for your lost item.');
    return `
      <div class="notify-item ${n.read ? '' : 'unread'}">
        <div class="notify-head">
          <div class="notify-title">${n.read ? 'Match Alert' : 'New Match Alert'}</div>
          <div class="notify-time">${fmtDateTime(n.time || n.date)}</div>
        </div>
        <div class="notify-message">${message}</div>
        <div class="notify-actions">
          ${n.foundItemId ? `<button class="btn btn-sm btn-primary" onclick="openNotificationMatch('${n.id}', '${n.foundItemId}')">Review Match</button>` : ''}
          ${n.read ? '' : `<button class="btn btn-sm btn-outline" onclick="markNotificationRead('${n.id}')">Mark Read</button>`}
        </div>
      </div>
    `;
  }).join('');
}

function renderRecentList(elId, items, type) {
  const el = document.getElementById(elId);
  if (!items.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><div class="empty-icon" style="font-size:32px;">📭</div><p>No items yet</p></div>';
    return;
  }
  el.innerHTML = items.map(item => `
    <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--gray2);cursor:pointer;"
         onclick="openItemModal('${item.id}','${type}')">
      <div style="width:40px;height:40px;background:var(--gray1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;">
        ${getCatEmoji(item.category)}
      </div>
      <div style="flex:1;overflow:hidden;">
        <div style="font-size:14px;font-weight:600;color:var(--navy);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name}</div>
        <div style="font-size:12px;color:var(--gray3);">📍 ${item.location || item.foundDate} · ${fmtDate(item.date || item.foundDate)}</div>
      </div>
      <span class="status status-${item.status === 'open' ? (type === 'lost' ? 'lost' : 'open') : item.status}">${item.status}</span>
    </div>
  `).join('');
}

function renderUserMatches() {
  const lost  = DB.get('lost_items').filter(i => i.userId === currentUser.id && i.status === 'open');
  const found = DB.get('found_items').filter(i => i.status === 'open');
  const allMatches = [];
  lost.forEach(l => {
    found.forEach(f => {

      // Do not even calculate a candidate score when
      // both object families are known and incompatible.
      const lostObjectFamily =
        getLocalObjectFamily(l);

      const foundObjectFamily =
        getLocalObjectFamily(f);

      if (
        lostObjectFamily &&
        foundObjectFamily &&
        lostObjectFamily !== foundObjectFamily
      ) {
        return;
      }

      const score = matchScore(l, f);

      if (score >= 40) {
        allMatches.push({
          lost: l,
          found: f,
          score
        });
      }
    });
  });
  allMatches.sort((a, b) => b.score - a.score);

  const section = document.getElementById('matches-section');
  const list    = document.getElementById('matches-list');
  if (!allMatches.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  list.innerHTML = allMatches.slice(0, 3).map(m => `
    <div class="match-card">
      <div class="match-score">${m.score}%</div>
      <div class="match-info">
        <div class="match-title">Your lost "${m.lost.name}" may match found item: "${m.found.name}"</div>
        <div class="match-meta">📍 Found at: ${m.found.location} · ${fmtDate(m.found.foundDate)}</div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="initiateClaim('${m.lost.id}','${m.found.id}',${m.score})">Claim →</button>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════
//  AUTO-MATCHING ALGORITHM
// ═══════════════════════════════════════════════

/**
 * Detect a broad object family for local dashboard matching.
 *
 * IMPORTANT:
 * - Only rejects a comparison when BOTH items have a
 *   recognizable family and those families are different.
 * - Unknown/unrecognized items remain eligible.
 */
function getLocalObjectFamily(item = {}) {

  const source = [
    item.name,
    item.itemName,
    item.title,
    item.desc,
    item.description,
    item.category,
    item.objectType,
    item.object_type,
    item.visualRecognition?.objectType,
    item.visualRecognition?.object_type,
    ...(Array.isArray(item.detectedLabels)
      ? item.detectedLabels
      : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[-_]/g, " ");

  if (/\b(wristwatch|wrist watch|smartwatch|smart watch|watch)\b/i.test(source)) {
    return "watch";
  }

  if (/\b(water bottle|bottle|flask|thermos|sipper)\b/i.test(source)) {
    return "bottle";
  }

  if (/\b(wallet|cardholder|card holder)\b/i.test(source)) {
    return "wallet";
  }

  if (/\b(backpack|back pack|schoolbag|school bag|rucksack|handbag|purse|bag)\b/i.test(source)) {
    return "bag";
  }

  if (/\b(phone|mobile|cellphone|cell phone|smartphone|smart phone)\b/i.test(source)) {
    return "phone";
  }

  if (/\b(laptop|notebook computer|notebook)\b/i.test(source)) {
    return "laptop";
  }

  if (/\b(tablet|ipad)\b/i.test(source)) {
    return "tablet";
  }

  if (/\b(headphones|headphone|earbuds|earbud|earphones|earphone)\b/i.test(source)) {
    return "headphone";
  }

  if (/\b(keys|keychain|key chain|key)\b/i.test(source)) {
    return "key";
  }

  if (/\b(glasses|spectacles|eyeglasses|sunglasses)\b/i.test(source)) {
    return "glasses";
  }

  if (/\b(shoe|shoes|sneaker|sneakers|footwear)\b/i.test(source)) {
    return "shoe";
  }

  return null;
}

// ═══════════════════════════════════════════════
//  AI HYBRID MATCHING (CNN/CLIP + NLP + RULES)
// ═══════════════════════════════════════════════
const AI_CV_URL = 'http://127.0.0.1:8001';
const aiMatchCache = new Map();

function aiCacheKey(lostItem, foundItem) {
  return `${lostItem?.id || 'lost'}::${foundItem?.id || 'found'}`;
}

function normalizePercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

function localTextSimilarity(text1, text2) {
  const a = String(text1 || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const b = String(text2 || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  if (!a.length || !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let common = 0;
  sa.forEach(w => { if (sb.has(w)) common += 1; });
  return Math.round((common / Math.max(sa.size, sb.size)) * 100);
}

function structuredMatchBreakdown(lostItem, foundItem) {
  const category = String(lostItem?.category || '').toLowerCase() === String(foundItem?.category || '').toLowerCase() && lostItem?.category ? 100 : 0;
  const name = localTextSimilarity(lostItem?.name, foundItem?.name);
  const description = localTextSimilarity(lostItem?.desc, foundItem?.desc);
  const location = localTextSimilarity(lostItem?.location, foundItem?.location);
  const ld = new Date(lostItem?.date || 0).getTime();
  const fd = new Date(foundItem?.foundDate || 0).getTime();
  const days = Number.isFinite(ld) && Number.isFinite(fd) ? Math.abs(fd - ld) / 86400000 : Infinity;
  const date = days <= 1 ? 100 : days <= 3 ? 70 : days <= 7 ? 35 : 0;
  const base = matchScore(lostItem, foundItem);
  return { category, name, description, location, date, base };
}

async function requestAIImageSimilarity(lostItem, foundItem) {
  if (!lostItem?.image || !foundItem?.image) return null;
  try {
    const form = new FormData();
    const toBlob = async (dataUrl, name) => {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      return new File([blob], name, { type: blob.type || 'image/jpeg' });
    };
    form.append('image1', await toBlob(lostItem.image, 'lost-item.jpg'));
    form.append('image2', await toBlob(foundItem.image, 'found-item.jpg'));
    const response = await fetch(`${AI_CV_URL}/cv/image-similarity`, { method: 'POST', body: form });
    if (!response.ok) return null;
    const result = await response.json();
    return {
      score: normalizePercent(result.hybrid_similarity_percentage ?? result.similarity_percentage),
      mobileNet: normalizePercent(result.mobilenet_similarity_percentage),
      clip: normalizePercent(result.clip_similarity_percentage),
      models: result.hybrid_models_used || result.visual_models || [],
      method: result.hybrid_method || result.method || 'CNN image similarity',
      recognition: result.visual_recognition || null,
    };
  } catch (err) {
    console.warn('TraceMate image AI unavailable:', err.message);
    return null;
  }
}

async function requestAINLPSimilarity(lostItem, foundItem) {
  const text1 = [lostItem?.name, lostItem?.desc].filter(Boolean).join('. ').trim();
  const text2 = [foundItem?.name, foundItem?.desc].filter(Boolean).join('. ').trim();
  if (!text1 || !text2) return null;
  try {
    const response = await fetch('/api/ai/text-similarity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text1, text2 })
    });
    if (!response.ok) return null;
    const result = await response.json();
    return normalizePercent(
      result.similarity_percentage ?? result.similarity ?? result.score ?? result.confidence
    );
  } catch (err) {
    console.warn('TraceMate NLP AI unavailable:', err.message);
    return null;
  }
}

async function getHybridMatchAnalysis(lostItem, foundItem) {
  const key = aiCacheKey(lostItem, foundItem);
  if (aiMatchCache.has(key)) return aiMatchCache.get(key);

  const structured = structuredMatchBreakdown(lostItem, foundItem);
  const [imageAI, nlpAI] = await Promise.all([
    requestAIImageSimilarity(lostItem, foundItem),
    requestAINLPSimilarity(lostItem, foundItem)
  ]);

  const imageScore = imageAI?.score;
  const textScore = nlpAI ?? Math.round((structured.name * 0.45) + (structured.description * 0.55));

  // When both AI modalities are available, use them as the primary evidence.
  // Rule-based signals remain contextual confirmation and never get ignored.
  let finalScore;
  if (imageScore !== null && textScore !== null) {
    finalScore = Math.round(
      imageScore * 0.35 +
      textScore * 0.25 +
      structured.category * 0.15 +
      Math.max(structured.location, structured.date) * 0.10 +
      structured.name * 0.05 +
      structured.description * 0.05 +
      structured.date * 0.05
    );
  } else {
    // Safe fallback when the AI services are offline.
    finalScore = structured.base;
  }

  const analysis = {
    score: Math.max(0, Math.min(100, finalScore)),
    imageScore,
    nlpScore: nlpAI,
    categoryScore: structured.category,
    nameScore: structured.name,
    descriptionScore: structured.description,
    locationScore: structured.location,
    dateScore: structured.date,
    imageAI,
    aiAvailable: imageScore !== null || nlpAI !== null,
    fallback: !(imageScore !== null && nlpAI !== null),
    method: imageAI?.method || (nlpAI !== null ? 'NLP + rule-based hybrid matching' : 'Rule-based matching')
  };

  aiMatchCache.set(key, analysis);
  return analysis;
}

function renderAIMatchBreakdown(analysis) {
  if (!analysis) return '';
  const rows = [
    ['🖼️ CNN/CLIP Image', analysis.imageScore],
    ['📝 NLP Description', analysis.nlpScore],
    ['📦 Category', analysis.categoryScore],
    ['🏷️ Name', analysis.nameScore],
    ['📍 Location', analysis.locationScore],
    ['📅 Date', analysis.dateScore]
  ];
  return `
    <div class="ai-match-breakdown">
      <div class="ai-match-breakdown-title">🤖 Explainable AI Match</div>
      <div class="ai-match-grid">
        ${rows.map(([label, value]) => `
          <div class="ai-match-factor">
            <span>${label}</span>
            <strong>${value === null || value === undefined ? '—' : `${Math.round(value)}%`}</strong>
          </div>
        `).join('')}
      </div>
      <div class="ai-match-method">${escapeHtml(analysis.method || 'Hybrid matching')}</div>
    </div>
  `;
}

function matchScore(lostItem, foundItem) {

  // HARD OBJECT-FAMILY GATE
  //
  // Example:
  // watch + watch   -> continue scoring
  // watch + bottle  -> reject immediately
  // unknown + watch -> continue scoring
  //
  const lostObjectFamily =
    getLocalObjectFamily(lostItem);

  const foundObjectFamily =
    getLocalObjectFamily(foundItem);

  if (
    lostObjectFamily &&
    foundObjectFamily &&
    lostObjectFamily !== foundObjectFamily
  ) {
    return 0;
  }

  let score = 0;

  // Category match (40 pts)
  if (lostItem.category === foundItem.category) score += 40;

  // Date proximity (20 pts)
  const ld   = new Date(lostItem.date);
  const fd   = new Date(foundItem.foundDate);
  const diff = Math.abs(fd - ld) / (1000 * 60 * 60 * 24);
  if (diff <= 1) score += 20; else if (diff <= 3) score += 12; else if (diff <= 7) score += 5;

  // Name similarity (30 pts)
  const lw     = lostItem.name.toLowerCase().split(/\s+/);
  const fw     = foundItem.name.toLowerCase().split(/\s+/);
  const common = lw.filter(w => fw.some(fw2 => (fw2.includes(w) || w.includes(fw2)) && w.length > 2));
  score += Math.min(30, common.length * 12);

  // Description keyword match (10 pts)
  if (lostItem.desc && foundItem.desc) {
    const ldw = lostItem.desc.toLowerCase().split(/\s+/);
    const fdw = foundItem.desc.toLowerCase().split(/\s+/);
    const dk  = ldw.filter(w => fdw.includes(w) && w.length > 4);
    score += Math.min(10, dk.length * 3);
  }
  return Math.min(100, score);
}

// ═══════════════════════════════════════════════
//  BROWSE
// ═══════════════════════════════════════════════
let browseFilter = 'all';

function setFilter(f, el) {
  browseFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderBrowse();
}

function renderBrowse(searchQuery = '') {
  const lost  = DB.get('lost_items');
  const found = DB.get('found_items');
  let items   = [
    ...lost.map(i  => ({ ...i,  type: 'lost'  })),
    ...found.map(i => ({ ...i,  type: 'found' })),
  ];

  // Apply filter
  if (browseFilter === 'lost')  items = items.filter(i => i.type === 'lost');
  else if (browseFilter === 'found') items = items.filter(i => i.type === 'found');
  else if (['electronics','documents','accessories','clothing','keys','other','books'].includes(browseFilter)) {
    items = items.filter(i => i.category === browseFilter);
  }

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      (i.desc     || '').toLowerCase().includes(q) ||
      (i.location || '').toLowerCase().includes(q)
    );
  }

  items.sort((a, b) =>
    new Date(b.created || b.date || b.foundDate) - new Date(a.created || a.date || a.foundDate)
  );

  const grid = document.getElementById('browse-grid');
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">🔍</div><h3>No items found</h3><p>Try a different filter or search term</p></div>';
    return;
  }
  grid.innerHTML = items.map(item => `
    <div class="item-card" onclick="openItemModal('${item.id}','${item.type}')">
      <div class="item-card-img">
        ${item.image ? `<img src="${item.image}" alt="">` : getCatEmoji(item.category)}
        <span class="item-type-badge badge-${item.type}">${item.type === 'lost' ? '🔴 Lost' : '🟢 Found'}</span>
      </div>
      <div class="item-card-body">
        <div class="item-card-title">${item.name}</div>
        <div class="item-card-meta">
          <span>📁 ${capitalize(item.category || 'other')}</span>
          <span>📍 ${item.location || item.foundDate}</span>
        </div>
        <div class="item-card-desc">${item.desc || 'No description provided.'}</div>
        <div class="item-card-footer">
          ${item.type === 'found' && currentUser && currentUser.role !== 'admin' && item.userId !== currentUser.id
            ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();showClaimPrompt('${item.id}')">Claim This →</button>`
            : `<span class="status status-${item.status === 'open' ? (item.type === 'lost' ? 'lost' : 'open') : item.status}">${item.status}</span>`
          }
          <span style="margin-left:auto;font-size:12px;color:var(--gray3);">${fmtDate(item.date || item.foundDate)}</span>
        </div>
      </div>
    </div>
  `).join('');
}

let searchTimeout;
function globalSearch(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    showPage('browse');
    renderBrowse(val);
  }, 300);
}

// ═══════════════════════════════════════════════
//  REPORT LOST / FOUND
// ═══════════════════════════════════════════════
let lostImageData  = '';
let foundImageData = '';

// Report edit mode. The same report ID is updated; no duplicate report is created.
let reportEditState = { id: null, type: null };

function setReportFormMode(type, editing) {
  const isLost = type === 'lost';
  const pageId = isLost ? 'page-report-lost' : 'page-report-found';
  const submitButton = document.querySelector(
    `#${pageId} button[onclick="submit${isLost ? 'Lost' : 'Found'}Item()"]`
  );
  const resetButton = document.querySelector(
    `#${pageId} button[onclick="reset${isLost ? 'Lost' : 'Found'}Form()"]`
  );
  const title = document.querySelector(`#${pageId} .card-title`);

  if (submitButton) {
    submitButton.textContent = editing
      ? '💾 Save Changes'
      : (isLost ? '📋 Submit Report' : '📦 Submit Report');
  }

  if (resetButton) {
    resetButton.textContent = editing ? 'Cancel' : 'Reset';
  }

  if (title) {
    title.textContent = editing
      ? (isLost ? '✏️ Edit Lost Item Report' : '✏️ Edit Found Item Report')
      : (isLost ? '📋 Report a Lost Item' : '📦 Report a Found Item');
  }
}

function isReportEditable(item) {
  const blocked = ['resolved', 'returned', 'closed', 'cancelled', 'canceled'];
  return !blocked.includes(String(item?.status || '').toLowerCase());
}

function editReport(id, type) {
  if (!currentUser) {
    toast('Please sign in before editing a report', 'error');
    return;
  }

  const key = type === 'lost' ? 'lost_items' : 'found_items';
  const item = DB.get(key).find(i => i.id === id);
  if (!item) {
    toast('Report not found', 'error');
    return;
  }

  if (item.userId !== currentUser.id) {
    toast('You can only edit your own reports', 'error');
    return;
  }

  if (!isReportEditable(item)) {
    toast('This report is no longer editable because it is closed/resolved', 'error');
    return;
  }

  reportEditState = { id: item.id, type };
  showPage(type === 'lost' ? 'report-lost' : 'report-found');

  if (type === 'lost') {
    document.getElementById('lost-name').value = item.name || '';
    document.getElementById('lost-cat').value = item.category || '';
    document.getElementById('lost-date').value = item.date || '';
    document.getElementById('lost-location').value = item.location || '';
    document.getElementById('lost-desc').value = item.desc || '';
    document.getElementById('lost-contact').value = item.contact || '';
    document.getElementById('lost-hide-contact').checked = !!item.contactHidden;
    lostImageData = item.image || '';
    setExistingReportImage('lost-preview', 'lost-upload-zone', lostImageData);
  } else {
    document.getElementById('found-name').value = item.name || '';
    document.getElementById('found-cat').value = item.category || '';
    document.getElementById('found-date').value = item.foundDate || '';
    document.getElementById('found-location').value = item.location || '';
    document.getElementById('found-desc').value = item.desc || '';
    document.getElementById('found-storage').value = item.storage || '';
    document.getElementById('found-contact').value = item.contact || '';
    document.getElementById('found-hide-contact').checked = !!item.contactHidden;
    foundImageData = item.image || '';
    setExistingReportImage('found-preview', 'found-upload-zone', foundImageData);
  }

  setReportFormMode(type, true);
}

function setExistingReportImage(previewId, zoneId, imageData) {
  const preview = document.getElementById(previewId);
  const zone = document.getElementById(zoneId);
  const placeholder = zone?.querySelector('.upload-placeholder');
  if (!preview || !zone) return;

  if (imageData) {
    preview.src = imageData;
    preview.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
    zone.classList.add('has-image');
  } else {
    preview.src = '';
    preview.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
    zone.classList.remove('has-image');
  }
}


function handleImageUpload(input, previewId, zoneId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById(previewId);
    preview.src            = e.target.result;
    preview.style.display  = 'block';
    document.querySelector(`#${zoneId} .upload-placeholder`).style.display = 'none';
    document.getElementById(zoneId).classList.add('has-image');
    if (previewId === 'lost-preview') lostImageData  = e.target.result;
    else                              foundImageData = e.target.result;
  };
  reader.readAsDataURL(file);
}

function validateContact(contact) {
  if (!contact) return '';
  if (/[a-zA-Z]/.test(contact)) return 'Enter a valid phone number';
  const cleaned = contact.replace(/[\s-]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  const isIndia = cleaned.startsWith('+91') || cleaned.startsWith('91');
  if (isIndia) {
    if (digits.length !== 12) return 'Phone number must be +91 followed by 10 digits';
    return '';
  }
  if (digits.length !== 10 && digits.length !== 12) return 'Phone number must be 10 digits or use +91 / 12-digit format';
  return '';
}

function formatIndianPhone(value) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('91')) digits = digits.slice(2);
  digits = digits.slice(0, 10);
  if (!digits.length) return '';
  const part1 = digits.slice(0, 5);
  const part2 = digits.slice(5);
  return part2 ? `+91 ${part1} ${part2}` : `+91 ${part1}`;
}

function setupContactPhoneInputs() {
  ['lost-contact', 'found-contact'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', () => {
      const formatted = formatIndianPhone(input.value);
      if (input.value !== formatted) {
        input.value = formatted;
        input.setSelectionRange(input.value.length, input.value.length);
      }
    });
  });
}

function maskContactForPrivacy(contact) {
  const digits = String(contact || '').replace(/\D/g, '');
  if (digits.length >= 10) return 'XXX XXX ' + digits.slice(-4);
  return 'XXX XXX XXXX';
}

function getVisibleContact(item, reporter) {
  const contact = (item?.contact || reporter?.email || '').trim();
  if (!contact) return '-';

  if (item?.contactHidden) {
    return 'Hidden by reporter (' + maskContactForPrivacy(contact) + ')';
  }

  return contact;
}

function normalizeClaimStatus(claim) {
  return claim?.status === 'pending' ? 'pending_user' : claim?.status;
}

function isClaimPending(status) {
  const s = status === 'pending' ? 'pending_user' : status;
  return s === 'pending_user' || s === 'pending_admin';
}

function isClaimActive(status) {
  const s = status === 'pending' ? 'pending_user' : status;
  return s === 'pending_user' || s === 'pending_admin' || s === 'approved' || s === 'closed';
}

function getClaimStatusLabel(status) {
  const s = status === 'pending' ? 'pending_user' : status;
  if (s === 'pending_user') return 'pending user approval';
  if (s === 'pending_admin') return 'pending admin verification';
  return s;
}

function syncClaimItemStatuses(lostId, foundId) {
  const claims = DB.get('claims').map(c => ({ ...c, status: normalizeClaimStatus(c) }));
  const lostHasApproved = claims.some(c => c.lostItemId === lostId && (c.status === 'approved' || c.status === 'closed'));
  const foundHasApproved = claims.some(c => c.foundItemId === foundId && (c.status === 'approved' || c.status === 'closed'));
  const lostHasActivePending = claims.some(c => c.lostItemId === lostId && isClaimPending(c.status));
  const foundHasActivePending = claims.some(c => c.foundItemId === foundId && isClaimPending(c.status));

  DB.set('lost_items', DB.get('lost_items').map(i => {
    if (i.id !== lostId) return i;
    if (lostHasApproved) return { ...i, status: 'resolved' };
    if (lostHasActivePending) return { ...i, status: 'matched' };
    return { ...i, status: 'open' };
  }));

  DB.set('found_items', DB.get('found_items').map(i => {
    if (i.id !== foundId) return i;
    if (foundHasApproved) return { ...i, status: 'resolved' };
    if (foundHasActivePending) return { ...i, status: 'matched' };
    return { ...i, status: 'open' };
  }));
}

async function submitLostItem() {
  const user = await ensureCurrentUser();
  if (!user) {
    toast('Please sign in before submitting a lost item', 'error');
    return;
  }

  if (reportEditState.type === 'lost' && reportEditState.id) {
    await updateLostItemFromForm(user);
    return;
  }

  const name = document.getElementById('lost-name').value.trim();
  const cat  = document.getElementById('lost-cat').value;
  const date = document.getElementById('lost-date').value;
  const loc  = document.getElementById('lost-location').value.trim();
  if (!name || !cat || !date || !loc) { toast('Please fill all required fields', 'error'); return; }

  const lostContact = document.getElementById('lost-contact').value.trim();
  const lostContactError = validateContact(lostContact);
  if (lostContactError) { toast(lostContactError, 'error'); return; }
  const hideLostContact = document.getElementById('lost-hide-contact')?.checked || false;

  const items   = DB.get('lost_items');
  const newItem = {
    id: genId(), userId: user.id,
    name, category: cat, date, location: loc,
    desc:    document.getElementById('lost-desc').value.trim(),
    contact: lostContact,
    contactHidden: hideLostContact,
    image: lostImageData, status: 'open', created: today(),
  };
  items.push(newItem);
  try {
    DB.set('lost_items', items);
    lostImageData = '';
    resetLostForm();
    toast('Lost item reported successfully! 📋', 'success');
    setTimeout(() => showPage('dashboard'), 800);
    await runAutoMatch(newItem, 'lost');
  } catch (err) {
    toast(err.message || 'Could not save the lost item', 'error');
  }
}

async function submitFoundItem() {
  const user = await ensureCurrentUser();
  if (!user) {
    toast('Please sign in again before submitting a found item', 'error');
    return;
  }

  if (reportEditState.type === 'found' && reportEditState.id) {
    await updateFoundItemFromForm(user);
    return;
  }

  const name = document.getElementById('found-name').value.trim();
  const cat  = document.getElementById('found-cat').value;
  const date = document.getElementById('found-date').value;
  const loc  = document.getElementById('found-location').value.trim();
  if (!name || !cat || !date || !loc) { toast('Please fill all required fields', 'error'); return; }

  const foundContact = document.getElementById('found-contact').value.trim();
  const foundContactError = validateContact(foundContact);
  if (foundContactError) { toast(foundContactError, 'error'); return; }
  const hideFoundContact = document.getElementById('found-hide-contact')?.checked || false;

  const items   = DB.get('found_items');
  const newItem = {
    id: genId(), userId: user.id,
    name, category: cat, foundDate: date, location: loc,
    desc:    document.getElementById('found-desc').value.trim(),
    storage: document.getElementById('found-storage').value.trim(),
    contact: foundContact,
    contactHidden: hideFoundContact,
    image: foundImageData, status: 'open', created: today(),
  };
  items.push(newItem);
  try {
    DB.set('found_items', items);
    foundImageData = '';
    resetFoundForm();
    toast('Found item reported successfully! 📦', 'success');
    setTimeout(() => showPage('dashboard'), 800);
    await runAutoMatch(newItem, 'found');
  } catch (err) {
    toast(err.message || 'Could not save the found item', 'error');
  }
}

async function runAutoMatch(newItem, type) {
  const opposite = type === 'lost' ? DB.get('found_items') : DB.get('lost_items');
  const candidates = opposite
    .filter(o => o.status === 'open')
    .map(o => ({ item: o, baseScore: type === 'lost' ? matchScore(newItem, o) : matchScore(o, newItem) }))
    .filter(m => m.baseScore >= 30)
    .sort((a, b) => b.baseScore - a.baseScore)
    .slice(0, 10);

  let best = null;
  for (const candidate of candidates) {
    const lost = type === 'lost' ? newItem : candidate.item;
    const found = type === 'lost' ? candidate.item : newItem;
    const analysis = await getHybridMatchAnalysis(lost, found);
    if (!best || analysis.score > best.score) {
      best = { item: candidate.item, score: analysis.score, analysis, lost, found };
    }
  }

  if (best && best.score >= 60) {
    setTimeout(() => toast(`🤖 AI possible match found! (${best.score}% confidence) — check Dashboard`, 'info'), 1200);
  }

  if (type === 'found') {
    await createLostOwnerMatchNotifications(newItem);
  } else if (type === 'lost' && best && best.score >= 60 && currentUser) {
    const users = DB.get('users');
    const owner = users.find(u => u.id === currentUser.id);
    if (owner) {
      if (!Array.isArray(owner.notifications)) owner.notifications = [];
      const duplicate = owner.notifications.some(n => n.type === 'match_found' && n.lostItemId === newItem.id && n.foundItemId === best.item.id);
      if (!duplicate) {
        owner.notifications.unshift({
          id: genId(),
          type: 'match_found',
          read: false,
          time: new Date().toISOString(),
          score: best.score,
          lostItemId: newItem.id,
          foundItemId: best.item.id,
          aiAnalysis: best.analysis,
          message: `A similar found report was identified for "${newItem.name}" (${best.score}% match confidence).`,
        });
        owner.notifications = owner.notifications.slice(0, 25);
        DB.set('users', users);
      }
    }
  }

  return best;
}

async function createLostOwnerMatchNotifications(foundItem) {
  const lostItems = DB.get('lost_items').filter(i => i.status === 'open' && i.userId !== foundItem.userId);
  if (!lostItems.length) return;

  const users = DB.get('users');
  let changed = false;

  for (const lostItem of lostItems.slice(0, 25)) {
    const analysis = await getHybridMatchAnalysis(lostItem, foundItem);
    const score = analysis.score;
    if (score < 60) continue;

    const owner = users.find(u => u.id === lostItem.userId);
    if (!owner) continue;

    if (!Array.isArray(owner.notifications)) owner.notifications = [];
    const duplicate = owner.notifications.some(n => n.type === 'match_found' && n.lostItemId === lostItem.id && n.foundItemId === foundItem.id);
    if (duplicate) continue;

    owner.notifications.unshift({
      id: genId(),
      type: 'match_found',
      read: false,
      time: new Date().toISOString(),
      score,
      lostItemId: lostItem.id,
      foundItemId: foundItem.id,
      aiAnalysis: analysis,
      message: `Admin/AI found a possible match for "${lostItem.name}" (${score}% match confidence).`,
    });
    owner.notifications = owner.notifications.slice(0, 25);
    changed = true;

    if (currentUser?.id === owner.id) {
      setTimeout(() => toast(`🔔 AI match for "${lostItem.name}" (${score}%)`, 'info'), 900);
    }
  }

  if (changed) {
    try {
      DB.set('users', users);
    } catch {
      // Keep found report flow successful if notification persistence fails.
    }
  }
}

function resetLostForm() {
  const wasEditing = reportEditState.type === 'lost';
  reportEditState = { id: null, type: null };
  ['lost-name','lost-location','lost-desc','lost-contact'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('lost-cat').value  = '';
  document.getElementById('lost-date').value = '';
  const lostHideContact = document.getElementById('lost-hide-contact');
  if (lostHideContact) lostHideContact.checked = false;
  document.getElementById('lost-preview').style.display = 'none';
  document.getElementById('lost-preview').src = '';
  document.querySelector('#lost-upload-zone .upload-placeholder').style.display = 'block';
  document.getElementById('lost-upload-zone').classList.remove('has-image');