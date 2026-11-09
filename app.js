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
//  AI LOST REPORT ASSISTANT
// ═══════════════════════════════════════════════
let aiLostReportState = null;

function aiToday(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function aiNormalizeText(value) {
  let text = String(value || '').trim().replace(/\s+/g, ' ');

  const corrections = [
    [/\byesterdaay\b/gi, 'yesterday'],
    [/\byesterdya\b/gi, 'yesterday'],
    [/\byestereday\b/gi, 'yesterday'],
    [/\btommorow\b/gi, 'tomorrow'],
    [/\btomorow\b/gi, 'tomorrow'],
    [/\bnaear\b/gi, 'near'],
    [/\bneear\b/gi, 'near'],
    [/\bclssroom\b/gi, 'classroom'],
    [/\bclasroom\b/gi, 'classroom'],
    [/\bclassrom\b/gi, 'classroom'],
    [/\bpen\s+drive\b/gi, 'pendrive'],
    [/\busb\s+flash\s+drive\b/gi, 'USB flash drive'],
    [/\busb\s+drive\b/gi, 'USB drive']
  ];

  for (const [pattern, replacement] of corrections) {
    text = text.replace(pattern, replacement);
  }

  return text;
}

function aiCategory(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(phone|mobile|cellphone|smartphone|laptop|tablet|charger|earbud|earbuds|headphone|headphones|earphone|watch|smartwatch|camera|usb|pendrive|power bank|powerbank)\b/.test(t)) return 'electronics';
  if (/\b(aadhaar|aadhar|pan card|id card|license|passport|document|certificate|mark sheet|marksheet)\b/.test(t)) return 'documents';
  if (/\b(wallet|purse|belt|ring|bracelet|necklace|bag|backpack|handbag|jewell)\b/.test(t)) return 'accessories';
  if (/\b(key|keys|keychain|key chain)\b/.test(t)) return 'keys';
  if (/\b(shirt|tshirt|t-shirt|jacket|hoodie|coat|jeans|pant|trouser|shoe|shoes|dress|cap|clothes)\b/.test(t)) return 'clothing';
  if (/\b(book|notebook|novel|textbook|journal)\b/.test(t)) return 'books';
  return 'other';
}

function aiDate(text) {
  const t = String(text || '').toLowerCase().trim();
  if (/\bday before yesterday\b/.test(t)) return aiToday(-2);
  if (/\byesterday\b/.test(t)) return aiToday(-1);
  if (/\b(today|this morning|this afternoon|tonight)\b/.test(t)) return aiToday();

  const ago = t.match(/\b(\d+)\s+days?\s+ago\b/);
  if (ago) return aiToday(-Number(ago[1]));

  const dmy = t.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    return `${y}-${String(Number(dmy[2])).padStart(2,'0')}-${String(Number(dmy[1])).padStart(2,'0')}`;
  }

  const ymd = t.match(/\b(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (ymd) return `${ymd[1]}-${String(Number(ymd[2])).padStart(2,'0')}-${String(Number(ymd[3])).padStart(2,'0')}`;

  // Natural-language weekday references such as "last Monday" or "on Friday".
  const weekday = t.match(/\b(?:last\s+|on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const names = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    const target = names.indexOf(weekday[1]);
    const now = new Date();
    const todayDay = now.getDay();
    let delta = (todayDay - target + 7) % 7;
    if (/\blast\s+/i.test(weekday[0]) || delta === 0) delta += 7;
    return aiToday(-delta);
  }

  return '';
}

function aiLooksLikeDate(text) {
  const t = String(text || '').trim();
  return /^(today|yesterday|day before yesterday|this morning|this afternoon|tonight)$/i.test(t)
    || /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/.test(t)
    || /\b20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}\b/.test(t);
}

function aiLocation(text) {
  const source = aiNormalizeText(text);

  const campus = source.match(
    /\b(?:at|near|inside|outside|in|from)\s+(?:the\s+)?((?:block\s+[a-z0-9]+|classroom(?:\s+\d+)?|library|canteen|cafeteria|laboratory|lab|parking|main gate|gate|office|security|corridor|floor|building|hostel|auditorium|playground|gym|washroom|department))\b/i
  );

  if (campus && campus[1]) return aiNormalizeText(campus[1]);

  const m = source.match(
    /\b(?:at|near|inside|outside|in|from)\s+(?:the\s+)?(.+?)(?=\s+(?:today|yesterday|tomorrow|on|around|when|where|with|and)\b|[,.!?]|$)/i
  );

  return m && m[1] ? aiNormalizeText(m[1]) : '';
}

function aiLooksLikeLocation(text) {
  const t = aiNormalizeText(text);
  if (!t) return false;
  if (/^(skip|none|no|not sure|unknown|don't know|dont know)$/i.test(t)) return true;
  return /\b(library|canteen|classroom|lab|laboratory|parking|gate|office|security|corridor|floor|block|building|hostel|auditorium|playground|gym|washroom|cafeteria|department)\b/i.test(t);
}

function aiExtractItem(text) {
  const source = aiNormalizeText(text);

  const lost = source.match(
    /(?:i\s+)?(?:lost|misplaced|left|forgot|can't find|cannot find)\s+(?:my\s+|the\s+|a\s+|an\s+)?(.+?)(?=\s+(?:at|near|inside|outside|in|from|yesterday|today|tomorrow|day before yesterday|last\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|on|around|with|and)\b|[,.!?]|$)/i
  );

  if (lost && lost[1]) {
    return aiNormalizeText(lost[1]).replace(/\s+(?:was|is|has|had)\s*$/i, '').trim();
  }

  const alt = source.match(
    /\b(?:my|a|an)\s+(.+?)(?=\s+(?:at|near|inside|outside|in|from|yesterday|today|tomorrow|on|last\s+)\b|[,.!?]|$)/i
  );

  return alt && alt[1] ? aiNormalizeText(alt[1]) : '';
}

function aiExtractBrand(text) {
  const source = aiNormalizeText(text);
  const m = source.match(/\b(?:brand|make|company)\s*(?:is|:)?\s*([a-z0-9][a-z0-9 .&-]{1,30}?)(?=\s+(?:in|at|near|inside|outside|from|yesterday|today|tomorrow|with|and)\b|[,.!?]|$)/i);
  return m && m[1] ? aiCleanOptional(m[1]) : '';
}

function aiExtractContact(text) {
  const m = String(text || '').match(/(?:contact|phone|mobile|number|call(?:\s+me)?(?:\s+at)?)?\s*[:=-]?\s*(\+?91[\s-]?\d{10}|\d{10})\b/i);
  return m ? m[1].trim() : '';
}

function aiExtractDescription(text, item, location, date) {
  let t = aiNormalizeText(text);
  if (!t) return '';

  const explicit = t.match(
    /(?:it\s+has|it\s+contains|with|details?\s*(?:are|is)?|description\s*(?:is|are)?|identifying\s+details?\s*(?:are|is)?)\s+(.+?)(?=\s+(?:contact|phone|mobile|number)\s*(?:is|:)?\s*\+?\d|$)/i
  );
  if (explicit && explicit[1]) {
    return aiCleanOptional(explicit[1].replace(/[.!?]+$/, '').trim());
  }

  if (item) {
    const itemPattern = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp('\\b' + itemPattern + '\\b', 'ig'), ' ');
  }

  if (location) {
    const locationPattern = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(
      new RegExp('\\b(?:at|near|in|inside|outside|from)\\s+(?:the\\s+)?' + locationPattern + '\\b', 'ig'),
      ' '
    );
  }

  t = t.replace(/\b(i\s+)?(?:lost|misplaced|left|forgot|can't find|cannot find)\b/ig, ' ');
  t = t.replace(/\b(?:my|the|a|an)\b/ig, ' ');
  t = t.replace(/\b(?:today|yesterday|tomorrow|day before yesterday|this morning|this afternoon|tonight|\d+\s+days?\s+ago|last\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/ig, ' ');
  t = t.replace(/\b(?:contact|phone|mobile|number)\s*(?:is|:)?\s*(?:\+?91[\s-]?)?\d{10}\b/ig, ' ');

  // Remove filler left by natural-language descriptions.
  t = t.replace(/^\s*(?:was|is|has|had)\s+/i, ' ');
  t = t.replace(/[,.!?]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!t || aiLooksLikeLocation(t) || aiLooksLikeDate(t)) return '';
  return aiCleanOptional(t);
}

function aiCleanOptional(text) {
  const t = aiNormalizeText(text);
  if (!t || /^(skip|none|no|nothing|not sure|unknown|don't know|dont know)$/i.test(t)) return '';
  return t;
}

function aiAddMessage(who, text) {
  const chat = document.getElementById('ai-report-chat');
  if (!chat) return;
  const d = document.createElement('div');
  d.className = `ai-msg ${who}`;
  d.textContent = text;
  chat.appendChild(d);
  chat.scrollTop = chat.scrollHeight;
  aiSetProgress();
}

function aiSetProgress() {
  const p = document.getElementById('ai-report-progress');
  if (!p || !aiLostReportState) return;
  const s = aiLostReportState;
  const done = [s.item, s.date, s.location, s.desc, s.image].filter(Boolean).length;
  p.textContent = `Report details collected: ${done}/5${s.contact ? ' · Contact added' : ''}`;
}

function aiFindMissingField() {
  const s = aiLostReportState;
  if (!s.item) return 'item';
  if (!s.location) return 'location';
  if (!s.date) return 'date';
  if (!s.desc) return 'description';
  if (!s.contactAsked) return 'contact';
  return 'preview';
}

function aiAskNextQuestion() {
  const missing = aiFindMissingField();
  aiLostReportState.step = missing;

  if (missing === 'item') return aiAddMessage('bot','What did you lose? You can include the color, brand or model too.');
  if (missing === 'location') return aiAddMessage('bot','Where did you last see it? For example: library, canteen, classroom 204, Block B, or main gate.');
  if (missing === 'date') return aiAddMessage('bot','When did you last see it? Say “today”, “yesterday”, or give a date such as 01/10/2026.');
  if (missing === 'description') return aiAddMessage('bot','Any other identifying details? For example: color, brand, sticker, scratches, case, initials, or anything unique. Type “skip” if there are none.');
  if (missing === 'contact') {
    aiLostReportState.contactAsked = true;
    return aiAddMessage('bot','Would you like to add a phone number for contact? Type a 10-digit number, or type “skip”.');
  }
  showAILostPreview();
}

function openAILostReport() {
  if (!currentUser || currentUser.role === 'admin') {
    toast('Please sign in as a student to use the AI report assistant','error');
    return;
  }

  aiLostReportState = {
    item:'', category:'', date:'', location:'', desc:'', contact:'',
    contactHidden:false, image:'', imageName:'', step:'collect',
    contactAsked:false, previewShown:false, busy:false
  };

  const modal=document.getElementById('ai-lost-report-modal');
  const chat=document.getElementById('ai-report-chat');
  const input=document.getElementById('ai-report-input');
  const actions=document.getElementById('ai-report-actions');
  const photo=document.getElementById('ai-report-photo');

  if (!modal || !chat || !input || !actions) {
    toast('AI report assistant UI is not loaded. Please refresh the page.','error');
    return;
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  chat.innerHTML='';
  actions.style.display='none';
  actions.innerHTML='';
  input.disabled=false;
  input.value='';
  input.placeholder='Type your answer...';

  const send=document.getElementById('ai-report-send');
  if (send) send.disabled=false;
  if (photo) photo.value='';

  aiAddMessage('bot','Hi! 👋 I can create your lost-item report. Tell me what you lost. You can give several details at once, for example: “I lost my black wallet in the library yesterday.”');
  input.focus();
}

function closeAILostReport() {
  const modal=document.getElementById('ai-lost-report-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
  }
  aiLostReportState=null;
}

function handleAILostPhoto(input) {
  const file=input?.files?.[0];
  if (!file || !aiLostReportState) return;

  if (!file.type.startsWith('image/')) {
    toast('Please select an image file','error');
    input.value='';
    return;
  }
  if (file.size > 5*1024*1024) {
    toast('Please use an image smaller than 5 MB','error');
    input.value='';
    return;
  }

  const reader=new FileReader();
  reader.onload=(event)=>{
    aiLostReportState.image=event.target.result;
    aiLostReportState.imageName=file.name;
    aiAddMessage('user',`📷 Photo uploaded: ${file.name}`);
    aiAddMessage('bot','Got it. I attached the photo to your report.');
    if (aiLostReportState.previewShown) showAILostPreview(true);
    aiSetProgress();
  };
  reader.onerror=()=>toast('Could not read that image','error');
  reader.readAsDataURL(file);
  input.value='';
}

function aiApplyAnswer(text) {
  const s=aiLostReportState;
  const value=aiNormalizeText(text);
  if (!s) return;

  if (s.step === 'edit') {
    if (/\b(item|name|lost)\b/i.test(value) && !/\bwhere\b|\blocation\b/i.test(value)) {
      const m=value.match(/(?:item|name)\s*(?:is|to|:)?\s*(.+)$/i);
      if (m) s.item=aiNormalizeText(m[1]);
    }
    if (/\b(location|place)\b/i.test(value)) {
      const m=value.match(/(?:location|place)\s*(?:is|to|:)?\s*(.+)$/i);
      s.location=m ? aiNormalizeText(m[1]) : (aiLocation(value) || s.location);
    }
    if (/\b(date|day|lost on)\b/i.test(value)) {
      const d=aiDate(value);
      if (d) s.date=d;
    }
    if (/\b(description|details|detail)\b/i.test(value)) {
      const m=value.match(/(?:description|details?|detail)\s*(?:is|are|:)?\s*(.+)$/i);
      if (m) s.desc=aiCleanOptional(m[1]);
    }
    if (/\b(contact|phone|number)\b/i.test(value)) {
      const m=value.match(/(?:contact|phone|number)\s*(?:is|:)?\s*(.+)$/i);
      if (m) {
        const err=validateContact(m[1].trim());
        if (!err) s.contact=m[1].trim();
      }
    }
    s.category=aiCategory(`${s.item} ${s.desc}`);
    s.step='collect';
    aiAddMessage('bot','Updated. I have applied that change.');
    showAILostPreview();
    return;
  }

  if (!s.item) {
    const item=aiExtractItem(value);
    const brand=aiExtractBrand(value);

    if (item && !aiLooksLikeDate(item) && !aiLooksLikeLocation(item)) {
      s.item=item;
      s.category=aiCategory(`${item} ${value}`);
    } else if (brand && s.item) {
      s.desc = s.desc ? `${brand} ${s.desc}` : brand;
    } else if (s.step === 'item' && value && !aiLooksLikeDate(value) && !aiLooksLikeLocation(value)) {
      // A short answer such as "pendrive" or "wallet" is a valid item answer.
      s.item=aiCleanOptional(value);
      s.category=aiCategory(`${s.item} ${value}`);
    }
  }

  if (!s.location) {
    const parsed=aiLocation(value);
    if (parsed) s.location=parsed;
    else if (s.step==='location' && aiLooksLikeLocation(value)) s.location=aiCleanOptional(value);
  }

  if (!s.date) {
    const d=aiDate(value);
    if (d) s.date=d;
  }

  if (s.item && s.location && s.date && !s.desc && s.step !== 'collect-initial') {
    const cleaned=aiCleanOptional(value);
    if (cleaned && cleaned!==s.item && !aiLooksLikeDate(cleaned) && !aiLooksLikeLocation(cleaned)) {
      s.desc=cleaned.replace(/^(details?|description|it is|it's|identifying details?)\s*(?:are|is|:)?\s*/i,'').trim();
    }
  }

  if (s.contactAsked && !s.contact) {
    const candidate=aiCleanOptional(value);
    if (!candidate) {
      s.contact='';
    } else {
      const err=validateContact(candidate);
      if (err) {
        aiAddMessage('bot',`${err}. You can also type “skip”.`);
        return;
      }
      s.contact=candidate;
    }
  }

  const detectedContact=aiExtractContact(value);
  if (detectedContact && !s.contact) s.contact=detectedContact;
  const detectedDesc=aiExtractDescription(value,s.item,s.location,s.date);
  if (detectedDesc && !s.desc && s.step !== 'contact') s.desc=detectedDesc;
  s.category=aiCategory(`${s.item} ${s.desc} ${value}`);
}

function aiExtractLabeledFields(text) {
  const result = {
    item: '',
    category: '',
    location: '',
    date: '',
    desc: '',
    contact: ''
  };

  const source = String(text || '').trim();
  if (!source) return result;

  const labels = 'item|item name|name|lost item|category|location|place|date|date lost|lost date|description|details|detail|contact|phone|phone number';

  function extract(label) {
    const pattern = new RegExp(
      '(?:^|[\\n,])\\s*' + label + '\\s*:\\s*(.*?)' +
      '(?=\\s*(?:' + labels + ')\\s*:|$)',
      'i'
    );
    const match = source.match(pattern);
    return match && match[1] ? aiNormalizeText(match[1]) : '';
  }

  result.item = aiCleanOptional(extract('item|item name|name|lost item'));
  result.category = aiCleanOptional(extract('category'));
  result.location = aiCleanOptional(extract('location|place'));
  result.date = aiCleanOptional(extract('date|date lost|lost date'));
  result.desc = aiCleanOptional(extract('description|details|detail'));
  result.contact = aiCleanOptional(extract('contact|phone|phone number'));

  return result;
}

function sendAILostMessage() {
  const s = aiLostReportState;
  if (!s || s.busy) return;

  const input = document.getElementById('ai-report-input');
  if (!input) return;

  const text = aiNormalizeText(input.value);
  if (!text) return;

  aiAddMessage('user', text);
  input.value = '';

  // ---------------------------------------------------------
  // FIRST MESSAGE: support both natural language and
  // labeled multi-field input.
  // ---------------------------------------------------------
  if (
    s.step === 'collect' &&
    !s.item &&
    !s.location &&
    !s.date &&
    !s.desc
  ) {
    s.step = 'collect-initial';

    const labeled = aiExtractLabeledFields(text);
    const hasLabeledData =
      labeled.item ||
      labeled.category ||
      labeled.location ||
      labeled.date ||
      labeled.desc ||
      labeled.contact;

    if (hasLabeledData) {
      if (labeled.item) s.item = labeled.item;
      if (labeled.category) s.category = labeled.category;
      if (labeled.location) s.location = labeled.location;

      if (labeled.date) {
        s.date = aiDate(labeled.date) || labeled.date;
      }

      if (labeled.desc) s.desc = labeled.desc;

      if (labeled.contact) {
        const detectedContact = aiExtractContact(labeled.contact);
        if (detectedContact) {
          s.contact = detectedContact;
        }
      }

      // If the user supplied a labeled item but no description,
      // preserve useful text such as color/model as details.
      if (!s.desc && s.item) {
        const detectedDesc = aiExtractDescription(
          text,
          s.item,
          s.location,
          s.date
        );
        if (detectedDesc) s.desc = detectedDesc;
      }

      if (!s.category) {
        s.category = aiCategory(`${s.item} ${s.desc} ${text}`);
      }
    } else {
      // Existing natural-language behavior.
      const item = aiExtractItem(text);
      const loc = aiLocation(text);
      const date = aiDate(text);
      const contact = aiExtractContact(text);
      const brand = aiExtractBrand(text);

      if (item && !aiLooksLikeDate(item) && !aiLooksLikeLocation(item)) {
        s.item = item;
      }
      if (loc) s.location = loc;
      if (date) s.date = date;
      if (contact) s.contact = contact;

      s.desc = aiExtractDescription(
        text,
        s.item,
        s.location,
        s.date
      );

      if (brand) {
        s.desc = s.desc ? `${brand} ${s.desc}` : brand;
      }

      s.category = aiCategory(`${text} ${s.item} ${s.desc}`);
    }
  } else {
    // ---------------------------------------------------------
    // SUBSEQUENT MESSAGE
    // ---------------------------------------------------------
    const labeled = aiExtractLabeledFields(text);
    const hasLabeledData =
      labeled.item ||
      labeled.category ||
      labeled.location ||
      labeled.date ||
      labeled.desc ||
      labeled.contact;

    if (hasLabeledData) {
      if (labeled.item) s.item = labeled.item;
      if (labeled.category) s.category = labeled.category;
      if (labeled.location) s.location = labeled.location;

      if (labeled.date) {
        s.date = aiDate(labeled.date) || labeled.date;
      }

      if (labeled.desc) s.desc = labeled.desc;

      if (labeled.contact) {
        const detectedContact = aiExtractContact(labeled.contact);
        if (detectedContact) s.contact = detectedContact;
      }
    } else {
      // Handle normal conversational answers according to the
      // field currently requested by the assistant.
      if (s.step === 'item') {
        const item = aiExtractItem(text);
        if (item) s.item = item;
      } else if (s.step === 'location') {
        const location = aiLocation(text);

        if (location) {
          s.location = location;
        } else {
          // Do not get stuck if the user gives extra item details.
          const cleaned = aiCleanOptional(text);
          if (cleaned && !aiLooksLikeDate(cleaned)) {
            s.desc = s.desc
              ? `${s.desc}; ${cleaned}`
              : cleaned;

            s.category = aiCategory(`${s.item} ${s.desc}`);

            aiAddMessage(
              'bot',
              'I saved that as an identifying detail. Now tell me where you last saw the item, for example: library, classroom, canteen, or main gate.'
            );

            return;
          }
        }
      } else if (s.step === 'date') {
        const date = aiDate(text);
        if (date) s.date = date;
      } else if (s.step === 'description') {
        const cleaned = aiCleanOptional(text);
        if (cleaned) s.desc = cleaned;
      } else if (s.step === 'contact') {
        const cleaned = aiCleanOptional(text);

        if (!cleaned) {
          s.contact = '';
        } else {
          const contactError = validateContact(cleaned);
          if (contactError) {
            aiAddMessage(
              'bot',
              `${contactError}. You can also type "skip".`
            );
            return;
          }
          s.contact = cleaned;
        }
      } else {
        aiApplyAnswer(text);
      }
    }

    const detectedContact = aiExtractContact(text);
    if (detectedContact && !s.contact) {
      s.contact = detectedContact;
    }

    const detectedDesc = aiExtractDescription(
      text,
      s.item,
      s.location,
      s.date
    );

    if (detectedDesc && !s.desc && s.step !== 'contact') {
      s.desc = detectedDesc;
    }

    if (!s.category) {
      s.category = aiCategory(`${s.item} ${s.desc} ${text}`);
    }
  }

  if (aiLostReportState?.step === 'edit') return;

  const missing = aiFindMissingField();

  if (missing === 'preview') {
    return showAILostPreview();
  }

  aiAskNextQuestion();
}

function showAILostPreview(refreshOnly=false) {
  const s=aiLostReportState;
  if (!s) return;

  s.previewShown=true;

  if (!refreshOnly) aiAddMessage('bot','Please check the report below. If everything is correct, submit it. You can edit any detail before submitting.');

  const chat=document.getElementById('ai-report-chat');
  const d=document.createElement('div');
  d.className='ai-msg bot';

  const imageHtml=s.image
    ? `<div class="ai-report-photo-preview"><img src="${s.image}" alt="Lost item photo"><span>${escapeHtml(s.imageName || 'Photo attached')}</span></div>`
    : 'Not attached';

  d.innerHTML=`
    <div class="ai-report-preview">
      <h4>📋 Lost Item Report Preview</h4>
      <div class="ai-report-preview-row"><b>Item</b><span>${escapeHtml(s.item || '-')}</span></div>
      <div class="ai-report-preview-row"><b>Category</b><span>${escapeHtml(s.category || 'other')}</span></div>
      <div class="ai-report-preview-row"><b>Date Lost</b><span>${escapeHtml(s.date || '-')}</span></div>
      <div class="ai-report-preview-row"><b>Location</b><span>${escapeHtml(s.location || '-')}</span></div>
      <div class="ai-report-preview-row"><b>Details</b><span>${escapeHtml(s.desc || 'None')}</span></div>
      <div class="ai-report-preview-row"><b>Contact</b><span>${escapeHtml(s.contact || 'Not provided')}</span></div>
      <div class="ai-report-preview-row"><b>Photo</b><span>${imageHtml}</span></div>
    </div>`;

  chat.appendChild(d);
  chat.scrollTop=chat.scrollHeight;

  const actions=document.getElementById('ai-report-actions');
  const input=document.getElementById('ai-report-input');
  const send=document.getElementById('ai-report-send');

  if (actions) {
    actions.innerHTML=`<button type="button" class="btn btn-outline" onclick="editAILostReport()">✏️ Edit</button><button type="button" class="btn btn-primary" onclick="submitAILostReportFromAI()">✅ Submit Lost Report</button>`;
    actions.style.display='flex';
  }
  if (input) {
    input.disabled=true;
    input.placeholder='Report preview ready';
  }
  if (send) send.disabled=true;
  aiSetProgress();
}

function editAILostReport() {
  const s=aiLostReportState;
  if (!s) return;

  s.step='edit';
  s.previewShown=false;

  const actions=document.getElementById('ai-report-actions');
  const input=document.getElementById('ai-report-input');
  const send=document.getElementById('ai-report-send');

  if (actions) { actions.style.display='none'; actions.innerHTML=''; }
  if (input) { input.disabled=false; input.placeholder='Example: location is Block B library'; input.focus(); }
  if (send) send.disabled=false;

  aiAddMessage('bot','Tell me what to change. Examples: “item is a black wallet”, “location is Block B library”, “date is yesterday”, “details are blue sticker”, or “contact is 9876543210”.');
}

async function submitAILostReportFromAI() {
  const s=aiLostReportState;
  if (!s || s.busy) return;

  s.busy=true;

  try {
    const user=await ensureCurrentUser();
    if (!user) throw new Error('Please sign in again.');
    if (user.role==='admin') throw new Error('Admin accounts cannot create student lost reports.');
    if (!s.item || !s.location || !s.date) throw new Error('Please complete the item, location and date before submitting.');

    const contact=String(s.contact || '').trim();
    const contactError=validateContact(contact);
    if (contactError) throw new Error(contactError);

    const item={
      id:genId(),
      userId:user.id,
      name:s.item.trim(),
      category:s.category || aiCategory(`${s.item} ${s.desc}`) || 'other',
      date:s.date,
      location:s.location.trim(),
      desc:s.desc.trim(),
      contact,
      contactHidden:false,
      image:s.image || '',
      status:'open',
      created:typeof today==='function' ? today() : new Date().toISOString()
    };

    const items=DB.get('lost_items');
    items.push(item);
    DB.set('lost_items',items);

    aiAddMessage('bot','✅ Your lost-item report has been submitted successfully. I’m now checking TraceMate’s existing matching system for possible found-item matches.');
    toast('AI lost report submitted successfully! 🤖📋','success');

    try {
      await Promise.resolve(runAutoMatch(item,'lost'));
    } catch (matchError) {
      console.warn('AI report auto-match warning:',matchError);
    }

    updateBadges();
    refreshDashboard();
    renderBrowse();
    if (typeof renderMyReports==='function') renderMyReports();

    const actions=document.getElementById('ai-report-actions');
    if (actions) {
      actions.innerHTML=`<button type="button" class="btn btn-primary" onclick="closeAILostReport();showPage('my-reports')">View My Reports →</button>`;
      actions.style.display='flex';
    }

    const input=document.getElementById('ai-report-input');
    const send=document.getElementById('ai-report-send');
    if (input) { input.disabled=true; input.placeholder='Report submitted'; }
    if (send) send.disabled=true;

  } catch (error) {
    console.error('AI lost report submission error:',error);
    toast(error.message || 'Could not save the report','error');
    aiAddMessage('bot','I could not save the report. Your normal “Report Lost” form is still available as a fallback.');
  } finally {
    s.busy=false;
  }
}

document.addEventListener('keydown',(event)=>{
  const modal=document.getElementById('ai-lost-report-modal');
  if (!modal?.classList.contains('open')) return;

  if (event.key==='Escape') {
    closeAILostReport();
    return;
  }

  if (event.key==='Enter') {
    const input=document.getElementById('ai-report-input');
    if (input && document.activeElement===input && !input.disabled) {
      event.preventDefault();
      sendAILostMessage();
    }
  }
});


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
    runAutoMatch(newItem, 'lost');
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
    runAutoMatch(newItem, 'found');
  } catch (err) {
    toast(err.message || 'Could not save the found item', 'error');
  }
}

function runAutoMatch(newItem, type) {
  const opposite = type === 'lost' ? DB.get('found_items') : DB.get('lost_items');
  const best = opposite
    .map(o => ({ item: o, score: type === 'lost' ? matchScore(newItem, o) : matchScore(o, newItem) }))
    .filter(m => m.score >= 60)
    .sort((a, b) => b.score - a.score)[0];


  if (best) {
    setTimeout(() => toast(`🤖 Possible match found! (${best.score}% confidence) — check Dashboard`, 'info'), 1200);
  }
}

function createLostOwnerMatchNotifications(foundItem) {
  const lostItems = DB.get('lost_items').filter(i => i.status === 'open' && i.userId !== foundItem.userId);
  if (!lostItems.length) return;

  const users = DB.get('users');
  let changed = false;

  lostItems.forEach(lostItem => {
    const score = matchScore(lostItem, foundItem);
    if (score < 60) return;

    const owner = users.find(u => u.id === lostItem.userId);
    if (!owner) return;

    if (!Array.isArray(owner.notifications)) owner.notifications = [];
    const duplicate = owner.notifications.some(n => n.type === 'match_found' && n.lostItemId === lostItem.id && n.foundItemId === foundItem.id);
    if (duplicate) return;

    owner.notifications.unshift({
      id: genId(),
      type: 'match_found',
      read: false,
      time: new Date().toISOString(),
      score,
      lostItemId: lostItem.id,
      foundItemId: foundItem.id,
      message: `A similar found report was submitted for "${lostItem.name}" (${score}% match).`,
    });
    owner.notifications = owner.notifications.slice(0, 25);
    changed = true;

    if (currentUser?.id === owner.id) {
      setTimeout(() => toast(`🔔 New match for "${lostItem.name}" (${score}%)`, 'info'), 900);
    }
  });

  if (changed) {
    try {
      DB.set('users', users);
    } catch {
      // Keep found report flow successful even if notification write fails.
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
  lostImageData = '';
  setReportFormMode('lost', false);
  if (wasEditing) showPage('my-reports');
}

function resetFoundForm() {
  const wasEditing = reportEditState.type === 'found';
  reportEditState = { id: null, type: null };
  ['found-name','found-location','found-desc','found-storage','found-contact'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('found-cat').value  = '';
  document.getElementById('found-date').value = '';
  const foundHideContact = document.getElementById('found-hide-contact');
  if (foundHideContact) foundHideContact.checked = false;
  document.getElementById('found-preview').style.display = 'none';
  document.getElementById('found-preview').src = '';
  document.querySelector('#found-upload-zone .upload-placeholder').style.display = 'block';
  document.getElementById('found-upload-zone').classList.remove('has-image');
  foundImageData = '';
  setReportFormMode('found', false);
  if (wasEditing) showPage('my-reports');
}

async function updateLostItemFromForm(user) {
  const id = reportEditState.id;
  const items = DB.get('lost_items');
  const index = items.findIndex(i => i.id === id && i.userId === user.id);
  if (index < 0) {
    toast('Lost report could not be found', 'error');
    return;
  }

  const item = items[index];
  const name = document.getElementById('lost-name').value.trim();
  const cat = document.getElementById('lost-cat').value;
  const date = document.getElementById('lost-date').value;
  const loc = document.getElementById('lost-location').value.trim();
  if (!name || !cat || !date || !loc) {
    toast('Please fill all required fields', 'error');
    return;
  }

  const contact = document.getElementById('lost-contact').value.trim();
  const contactError = validateContact(contact);
  if (contactError) {
    toast(contactError, 'error');
    return;
  }

  const updatedItem = {
    ...item,
    name,
    category: cat,
    date,
    location: loc,
    desc: document.getElementById('lost-desc').value.trim(),
    contact,
    contactHidden: document.getElementById('lost-hide-contact')?.checked || false,
    image: lostImageData || '',
    updated: today(),
  };

  try {
    items[index] = updatedItem;
    DB.set('lost_items', items);
    reportEditState = { id: null, type: null };
    lostImageData = '';
    resetLostForm();
    toast('Lost report updated successfully! ✏️', 'success');
    renderMyReports();
    setTimeout(() => showPage('my-reports'), 250);
    runAutoMatch(updatedItem, 'lost');
  } catch (err) {
    toast(err.message || 'Could not update the lost report', 'error');
  }
}

async function updateFoundItemFromForm(user) {
  const id = reportEditState.id;
  const items = DB.get('found_items');
  const index = items.findIndex(i => i.id === id && i.userId === user.id);
  if (index < 0) {
    toast('Found report could not be found', 'error');
    return;
  }

  const item = items[index];
  const name = document.getElementById('found-name').value.trim();
  const cat = document.getElementById('found-cat').value;
  const date = document.getElementById('found-date').value;
  const loc = document.getElementById('found-location').value.trim();
  if (!name || !cat || !date || !loc) {
    toast('Please fill all required fields', 'error');
    return;
  }

  const contact = document.getElementById('found-contact').value.trim();
  const contactError = validateContact(contact);
  if (contactError) {
    toast(contactError, 'error');
    return;
  }

  const updatedItem = {
    ...item,
    name,
    category: cat,
    foundDate: date,
    location: loc,
    desc: document.getElementById('found-desc').value.trim(),
    storage: document.getElementById('found-storage').value.trim(),
    contact,
    contactHidden: document.getElementById('found-hide-contact')?.checked || false,
    image: foundImageData || '',
    updated: today(),
  };

  try {
    items[index] = updatedItem;
    DB.set('found_items', items);
    reportEditState = { id: null, type: null };
    foundImageData = '';
    resetFoundForm();
    toast('Found report updated successfully! ✏️', 'success');
    renderMyReports();
    setTimeout(() => showPage('my-reports'), 250);
    runAutoMatch(updatedItem, 'found');
  } catch (err) {
    toast(err.message || 'Could not update the found report', 'error');
  }
}

// ═══════════════════════════════════════════════
//  MY REPORTS
// ═══════════════════════════════════════════════
function renderMyReports() {
  if (!currentUser) return;
  const lost  = DB.get('lost_items').filter(i => i.userId === currentUser.id);
  const found = DB.get('found_items').filter(i => i.userId === currentUser.id);

  const lostTbody = document.getElementById('my-lost-tbody');
  lostTbody.innerHTML = lost.length ? lost.map(i => {
    const editable = isReportEditable(i);
    return `
    <tr>
      <td><strong>${i.name}</strong></td>
      <td><span class="cat-tag">${getCatEmoji(i.category)} ${capitalize(i.category)}</span></td>
      <td>${fmtDate(i.date)}</td>
      <td>${i.location}</td>
      <td><span class="status status-${i.status === 'open' ? 'lost' : i.status}">${i.status}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline" onclick="openItemModal('${i.id}','lost')">View</button>
          ${editable ? `<button class="btn btn-sm btn-outline" onclick="editReport('${i.id}','lost')">Edit</button>` : ''}
          ${i.status === 'open' ? `<button class="btn btn-sm btn-danger" onclick="deleteItem('${i.id}','lost')">Delete</button>` : ''}
        </div>
      </td>
    </tr>
  `;
  }).join('') : '<tr><td colspan="6"><div class="empty-state" style="padding:24px;">No lost item reports yet.</div></td></tr>';

  const foundTbody = document.getElementById('my-found-tbody');
  foundTbody.innerHTML = found.length ? found.map(i => {
    const editable = isReportEditable(i);
    return `
    <tr>
      <td><strong>${i.name}</strong></td>
      <td><span class="cat-tag">${getCatEmoji(i.category)} ${capitalize(i.category)}</span></td>
      <td>${fmtDate(i.foundDate)}</td>
      <td>${i.location}</td>
      <td><span class="status status-${i.status}">${i.status}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline" onclick="openItemModal('${i.id}','found')">View</button>
          ${editable ? `<button class="btn btn-sm btn-outline" onclick="editReport('${i.id}','found')">Edit</button>` : ''}
          ${i.status === 'open' ? `<button class="btn btn-sm btn-danger" onclick="deleteItem('${i.id}','found')">Delete</button>` : ''}
        </div>
      </td>
    </tr>
  `;
  }).join('') : '<tr><td colspan="6"><div class="empty-state" style="padding:24px;">No found item reports yet.</div></td></tr>';
}

function deleteItem(id, type) {
  if (!confirm('Delete this report?')) return;
  const key   = type === 'lost' ? 'lost_items' : 'found_items';
  const items = DB.get(key).filter(i => i.id !== id);
  DB.set(key, items);
  toast('Report deleted', 'success');
  renderMyReports();
}

// ═══════════════════════════════════════════════
//  CLAIMS
// ═══════════════════════════════════════════════
function showClaimPrompt(foundItemId) {
  if (!currentUser || currentUser.role === 'admin') return;
  const lost  = DB.get('lost_items').filter(i => i.userId === currentUser.id && i.status === 'open');
  const found = DB.get('found_items').find(i => i.id === foundItemId);
  if (!found) return;

  const rankedLost = lost
    .map(item => ({ item, score: matchScore(item, found) }))
    .sort((a, b) => b.score - a.score);

  document.getElementById('modal-title').textContent = 'Claim: ' + found.name;
  document.getElementById('modal-body').innerHTML = `
    ${lost.length === 0
      ? `<div class="empty-state" style="padding:24px;">
           <div class="empty-icon">📋</div>
           <p>You have no open lost item reports to match with.</p>
           <button class="btn btn-amber" style="margin-top:12px;"
             onclick="closeModal('item-modal');showPage('report-lost');">Report Lost Item First</button>
         </div>`
      : rankedLost.map(({ item: l, score }, index) => {
          return `
            <div class="match-card match-card-claim">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;">
                <div class="match-info" style="margin-bottom:0;">
                  <div class="match-title">${l.name}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
                  <div class="match-score">${score}%</div>
                  ${index === 0 ? '<span class="status status-approved" style="padding:3px 8px;">Best match</span>' : ''}
                </div>
              </div>
              <div class="admin-compare-grid" style="margin-top:12px;">
                ${renderClaimCompareCard(found, 'Found Item')}
                ${renderClaimCompareCard(l, 'Your Lost Item', score)}
              </div>
              <div class="claim-compare-actions" style="margin-top:14px;justify-content:space-between;">
                <div style="font-size:12px;color:var(--gray3);align-self:center;">
                  Review this match and choose an action.
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
                  <button class="btn btn-sm btn-success" onclick="submitClaim('${l.id}','${foundItemId}',${score})">Approve</button>
                  <button class="btn btn-sm btn-danger" onclick="closeModal('item-modal')">Reject</button>
                </div>
              </div>
            </div>
          `;
        }).join('')
    }
  `;
  document.getElementById('item-modal').classList.add('show');
}

function renderClaimCompareCard(item, title, score = null) {
  const dateLabel = item.foundDate ? 'Date Found' : 'Date Lost';
  const dateValue = fmtDate(item.foundDate || item.date);
  return `
    <div class="compare-card">
      <div class="compare-header">${title}</div>
      ${item.image
        ? `<img class="compare-image" src="${item.image}" alt="${escapeHtml(item.name || title)}">`
        : `<div class="compare-image compare-placeholder">${getCatEmoji(item.category)}</div>`
      }
      <div class="compare-row">
        <span class="compare-label">Name</span>
        <span class="compare-value">${escapeHtml(item.name || '-')}</span>
      </div>
      <div class="compare-row">
        <span class="compare-label">Category</span>
        <span class="compare-value">${capitalize(item.category || 'other')}</span>
      </div>
      <div class="compare-row">
        <span class="compare-label">${dateLabel}</span>
        <span class="compare-value">${dateValue}</span>
      </div>
      <div class="compare-row">
        <span class="compare-label">Location</span>
        <span class="compare-value">${escapeHtml(item.location || '-')}</span>
      </div>
      ${item.desc ? `
        <div class="compare-row compare-desc">
          <span class="compare-label">Description</span>
          <span class="compare-value">${escapeHtml(item.desc)}</span>
        </div>` : ''}
      ${score !== null ? `
        <div class="compare-row">
          <span class="compare-label">Match score</span>
          <span class="compare-value">${score}%</span>
        </div>` : ''}
    </div>
  `;
}

function submitClaim(lostId, foundId, score) {
  const claims = DB.get('claims');
  const exists = claims.find(c => c.lostItemId === lostId && c.foundItemId === foundId);
  if (exists) { toast('Claim already submitted', 'error'); return; }

  const lostItem = DB.get('lost_items').find(i => i.id === lostId);
  const foundItem = DB.get('found_items').find(i => i.id === foundId);
  const lostReporterApproved = currentUser.id === lostItem?.userId;
  const foundReporterApproved = currentUser.id === foundItem?.userId;

  const claim = {
    id: genId(), lostItemId: lostId, foundItemId: foundId,
    claimantId: currentUser.id, date: today(),
    status: 'pending_user', score,
    lostReporterApproved,
    foundReporterApproved,
    notes: 'Waiting for user-side approval before admin verification',
    pickupLocation: '', pickupTime: '', pickupNotes: '',
    messages: [],
  };
  claims.push(claim);
  DB.set('claims', claims);

  syncClaimItemStatuses(lostId, foundId);

  closeModal('item-modal');
  toast('Claim submitted! Waiting for user approval first. 🏷️', 'success');
  updateBadges();
  refreshDashboard();
}

function initiateClaim(lostId, foundId, score) {
  submitClaim(lostId, foundId, score);
}

function renderMyClaims() {
  if (!currentUser) return;
  const allClaims = DB.get('claims');
  const lost   = DB.get('lost_items');
  const found  = DB.get('found_items');
  const users  = DB.get('users');
  const tbody  = document.getElementById('my-claims-tbody');
  const claims = allClaims.filter(c => {
    if (c.claimantId === currentUser.id) return true;
    const l = lost.find(i => i.id === c.lostItemId);
    const f = found.find(i => i.id === c.foundItemId);
    return l?.userId === currentUser.id || f?.userId === currentUser.id;
  });

  if (!claims.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state" style="padding:24px;">No claims submitted yet.</div></td></tr>';
    return;
  }
  tbody.innerHTML = claims.map(c => {
    const status = normalizeClaimStatus(c);
    const l = lost.find(i  => i.id === c.lostItemId);
    const f = found.find(i => i.id === c.foundItemId);
    const lostReporter  = l ? users.find(u => u.id === l.userId) : null;
    const foundReporter = f ? users.find(u => u.id === f.userId) : null;
    const lostContact   = getVisibleContact(l, lostReporter);
    const foundContact  = getVisibleContact(f, foundReporter);
    const isLostReporter = l?.userId === currentUser.id;
    const isFoundReporter = f?.userId === currentUser.id;
    const canApproveAsLost = status === 'pending_user' && isLostReporter && !c.lostReporterApproved;
    const canApproveAsFound = status === 'pending_user' && isFoundReporter && !c.foundReporterApproved;
    const roleLabel = c.claimantId === currentUser.id
      ? 'You: Claimant'
      : isLostReporter
        ? 'You: Lost Reporter'
        : isFoundReporter
          ? 'You: Found Reporter'
          : '';
    const contactCell = (status === 'approved' || status === 'closed')
      ? `<div style="display:grid;gap:4px;font-size:12px;color:var(--gray2);">
           <div><strong>Lost:</strong> ${escapeHtml(lostContact)}</div>
           <div><strong>Found:</strong> ${escapeHtml(foundContact)}</div>
         </div>`
      : `<span style="font-size:12px;color:var(--gray3);">Available after approval</span>`;
    const actionCell = (status === 'approved' || status === 'closed')
      ? `<button class="btn btn-sm btn-outline" onclick="openClaimDetails('${c.id}')">Open</button>`
      : canApproveAsLost && canApproveAsFound
        ? `<div class="action-btns">
             <button class="btn btn-sm btn-success" onclick="userApproveClaim('${c.id}','lost')">Approve Lost Side</button>
             <button class="btn btn-sm btn-success" onclick="userApproveClaim('${c.id}','found')">Approve Found Side</button>
             <button class="btn btn-sm btn-danger" onclick="userRejectClaim('${c.id}','lost')">Reject</button>
           </div>`
        : canApproveAsLost
        ? `<div class="action-btns">
             <button class="btn btn-sm btn-success" onclick="userApproveClaim('${c.id}','lost')">Approve</button>
             <button class="btn btn-sm btn-danger" onclick="userRejectClaim('${c.id}','lost')">Reject</button>
           </div>`
        : canApproveAsFound
          ? `<div class="action-btns">
               <button class="btn btn-sm btn-success" onclick="userApproveClaim('${c.id}','found')">Approve</button>
               <button class="btn btn-sm btn-danger" onclick="userRejectClaim('${c.id}','found')">Reject</button>
             </div>`
          : `<span style="font-size:12px;color:var(--gray3);">${status === 'pending_admin' ? 'Waiting for admin' : 'Waiting for user approval'}</span>`;
    return `
      <tr>
        <td><strong>${l?.name || '-'}</strong></td>
        <td>${f?.name || '-'}</td>
        <td>${fmtDate(c.date)}</td>
        <td><span class="status status-${status}">${getClaimStatusLabel(status)}</span></td>
        <td>${contactCell}</td>
        <td style="font-size:12px;color:var(--gray3);">${roleLabel ? roleLabel + ' · ' : ''}${c.notes}</td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join('');
}

function userApproveClaim(claimId, role) {
  const claims = DB.get('claims');
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return;

  const lostItem = DB.get('lost_items').find(i => i.id === claim.lostItemId);
  const foundItem = DB.get('found_items').find(i => i.id === claim.foundItemId);

  const status = normalizeClaimStatus(claim);
  if (status !== 'pending_user') return;

  if (role === 'lost' && lostItem?.userId !== currentUser?.id) return;
  if (role === 'found' && foundItem?.userId !== currentUser?.id) return;

  if (role === 'lost') claim.lostReporterApproved = true;
  if (role === 'found') claim.foundReporterApproved = true;

  if (claim.lostReporterApproved && claim.foundReporterApproved) {
    claim.status = 'pending_admin';
    claim.notes = 'User-side approval complete. Awaiting admin verification';
    toast('User approval complete. Sent for admin verification.', 'success');
  } else {
    claim.status = 'pending_user';
    claim.notes = 'Partially approved by user. Waiting for second user approval';
    toast('Approval recorded. Waiting for another user approval.', 'success');
  }

  DB.set('claims', claims);
  syncClaimItemStatuses(claim.lostItemId, claim.foundItemId);
  renderMyClaims();
  updateBadges();
  refreshDashboard();
}

function userRejectClaim(claimId, role) {
  const claims = DB.get('claims');
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return;

  const lostItem = DB.get('lost_items').find(i => i.id === claim.lostItemId);
  const foundItem = DB.get('found_items').find(i => i.id === claim.foundItemId);

  const status = normalizeClaimStatus(claim);
  if (status !== 'pending_user' && status !== 'pending_admin') return;

  if (role === 'lost' && lostItem?.userId !== currentUser?.id) return;
  if (role === 'found' && foundItem?.userId !== currentUser?.id) return;

  claim.status = 'rejected';
  claim.notes = role === 'lost' ? 'Rejected by lost reporter' : role === 'found' ? 'Rejected by found reporter' : 'Rejected by user';
  DB.set('claims', claims);
  syncClaimItemStatuses(claim.lostItemId, claim.foundItemId);
  toast('Claim rejected by user', 'error');
  renderMyClaims();
  updateBadges();
  refreshDashboard();
}

function openClaimDetails(claimId) {
  const claims = DB.get('claims');
  const claim = claims.find(c => c.id === claimId);
  if (!claim || !currentUser) return;

  claim.status = normalizeClaimStatus(claim);

  const lostItems = DB.get('lost_items');
  const foundItems = DB.get('found_items');
  const users = DB.get('users');
  const lostItem = lostItems.find(i => i.id === claim.lostItemId);
  const foundItem = foundItems.find(i => i.id === claim.foundItemId);
  const isRelated = claim.claimantId === currentUser.id
    || lostItem?.userId === currentUser.id
    || foundItem?.userId === currentUser.id;
  if (!isRelated) return;

  const lostReporter = lostItem ? users.find(u => u.id === lostItem.userId) : null;
  const foundReporter = foundItem ? users.find(u => u.id === foundItem.userId) : null;

  const isApproved = claim.status === 'approved' || claim.status === 'closed';
  const isClosed = claim.status === 'closed';
  const lostContact = getVisibleContact(lostItem, lostReporter);
  const foundContact = getVisibleContact(foundItem, foundReporter);
  let messages = Array.isArray(claim.messages) ? claim.messages : [];
  let seenUpdated = false;
  if (isApproved) {
    messages = messages.map(m => {
      if (m.senderId !== currentUser.id && !m.seen) {
        seenUpdated = true;
        return { ...m, seen: true };
      }
      return m;
    });
    if (seenUpdated) {
      claim.messages = messages;
      DB.set('claims', claims);
    }
  }

  document.getElementById('claim-title').textContent = `Claim: ${lostItem?.name || '-'} ↔ ${foundItem?.name || '-'}`;
  document.getElementById('claim-body').innerHTML = `
    <div class="claim-meta-grid">
      <div class="claim-section">
        <div class="claim-section-title">Contact Exchange</div>
        ${isApproved ? `
          <div class="claim-contact-card">
            <div class="claim-contact-title">Lost Reporter</div>
            <div class="claim-contact-value">${lostReporter?.name || 'Unknown'}</div>
            <div class="claim-contact-meta">${escapeHtml(lostContact)}</div>
          </div>
          <div class="claim-contact-card">
            <div class="claim-contact-title">Found Reporter</div>
            <div class="claim-contact-value">${foundReporter?.name || 'Unknown'}</div>
            <div class="claim-contact-meta">${escapeHtml(foundContact)}</div>
          </div>
        ` : `<div class="claim-muted">Contact details unlock after approval.</div>`}
      </div>
      <div class="claim-section">
        <div class="claim-section-title">Pickup / Handover</div>
        ${isApproved ? `
          <div class="form-group">
            <label>Pickup Location</label>
            <input type="text" id="pickup-location" value="${escapeHtml(claim.pickupLocation || '')}" placeholder="e.g. Security Office, Block C">
          </div>
          <div class="form-group">
            <label>Pickup Time</label>
            <input type="text" id="pickup-time" value="${escapeHtml(claim.pickupTime || '')}" placeholder="e.g. 5:30 PM, 19 Apr">
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="pickup-notes" placeholder="Any instructions or confirmations">${escapeHtml(claim.pickupNotes || '')}</textarea>
          </div>
          <div class="claim-actions">
            <button class="btn btn-sm btn-primary" onclick="savePickupDetails('${claim.id}')">Save Details</button>
            ${isClosed ? '' : `<button class="btn btn-sm btn-success" onclick="markClaimCompleted('${claim.id}')">Mark Completed</button>`}
          </div>
        ` : `<div class="claim-muted">Pickup details unlock after approval.</div>`}
      </div>
    </div>

    <div class="claim-section claim-chat">
      <div class="claim-section-title">Chat</div>
      ${isApproved ? `
        <div class="claim-chat-list">
          ${renderClaimMessages(messages)}
        </div>
        ${isClosed
          ? `<div class="claim-muted">Chat is locked after completion.</div>`
          : `<div class="claim-chat-input">
               <input type="text" id="claim-chat-input-${claim.id}" placeholder="Type a message..." onkeydown="handleClaimChatKey(event,'${claim.id}')">
               <button class="btn btn-sm btn-primary" onclick="sendClaimMessage('${claim.id}')">Send</button>
             </div>`}
        ${isClosed ? '' : `<div class="claim-chat-actions">
          <button class="btn btn-sm btn-outline" onclick="clearClaimChat('${claim.id}')">Clear Chat</button>
        </div>`}
      ` : `<div class="claim-muted">Chat unlocks after approval.</div>`}
    </div>
  `;
  document.getElementById('claim-modal').classList.add('show');
}

function savePickupDetails(claimId) {
  const claims = DB.get('claims');
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return;

  claim.pickupLocation = document.getElementById('pickup-location')?.value.trim() || '';
  claim.pickupTime = document.getElementById('pickup-time')?.value.trim() || '';
  claim.pickupNotes = document.getElementById('pickup-notes')?.value.trim() || '';
  DB.set('claims', claims);
  toast('Pickup details saved', 'success');
  renderMyClaims();
}

function handleClaimChatKey(event, claimId) {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendClaimMessage(claimId);
  }
}

function sendClaimMessage(claimId) {
  const input = document.getElementById(`claim-chat-input-${claimId}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  const claims = DB.get('claims');
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return;

  if (!Array.isArray(claim.messages)) claim.messages = [];
  claim.messages.push({ id: genId(), senderId: currentUser.id, text, time: new Date().toISOString(), seen: false });
  DB.set('claims', claims);
  input.value = '';
  openClaimDetails(claimId);
}

function clearClaimChat(claimId) {
  const claims = DB.get('claims');
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return;
  claim.messages = [];
  DB.set('claims', claims);
  openClaimDetails(claimId);
}

function markClaimCompleted(claimId) {
  const claims = DB.get('claims');
  const claim = claims.find(c => c.id === claimId);
  if (!claim) return;
  claim.status = 'closed';
  claim.notes = claim.notes ? `${claim.notes} · Completed by users` : 'Completed by users';
  DB.set('claims', claims);
  toast('Claim marked as completed', 'success');
  closeModal('claim-modal');
  updateBadges();
  renderMyClaims();
}

function renderClaimMessages(messages) {
  if (!messages.length) {
    return '<div class="claim-muted">No messages yet.</div>';
  }
  return messages.map(m => {
    const mine = m.senderId === currentUser?.id;
    const tick = mine
      ? `<span class="claim-tick ${m.seen ? 'seen' : 'sent'}">${m.seen ? '✓✓' : '✓'}</span>`
      : '';
    return `
      <div class="claim-message ${mine ? 'mine' : ''}">
        <div class="claim-message-text">${escapeHtml(m.text)}</div>
        <div class="claim-message-meta">
          <span>${fmtDateTime(m.time)}</span>
          ${tick}
        </div>
      </div>
    `;
  }).join('');
}

function fmtDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════
//  ITEM DETAIL MODAL
// ═══════════════════════════════════════════════
function openItemModal(id, type) {
  const items    = type === 'lost' ? DB.get('lost_items') : DB.get('found_items');
  const item     = items.find(i => i.id === id);
  if (!item) return;
  const users    = DB.get('users');
  const reporter = users.find(u => u.id === item.userId);

  document.getElementById('modal-title').textContent = item.name;
  document.getElementById('modal-body').innerHTML = `
    ${item.image
      ? `<img src="${item.image}" class="item-modal-image" alt="${item.name}">`
      : `<div class="item-modal-placeholder">${getCatEmoji(item.category)}</div>`
    }
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div style="background:var(--gray1);padding:12px;border-radius:10px;">
        <div style="font-size:11px;color:var(--gray3);font-weight:700;text-transform:uppercase;margin-bottom:4px;">Type</div>
        <span class="status status-${type === 'lost' ? 'lost' : 'open'}">${type === 'lost' ? '🔴 Lost' : '🟢 Found'}</span>
      </div>
      <div style="background:var(--gray1);padding:12px;border-radius:10px;">
        <div style="font-size:11px;color:var(--gray3);font-weight:700;text-transform:uppercase;margin-bottom:4px;">Category</div>
        <span class="cat-tag">${getCatEmoji(item.category)} ${capitalize(item.category || 'other')}</span>
      </div>
      <div style="background:var(--gray1);padding:12px;border-radius:10px;">
        <div style="font-size:11px;color:var(--gray3);font-weight:700;text-transform:uppercase;margin-bottom:4px;">${type === 'lost' ? 'Date Lost' : 'Date Found'}</div>
        <div style="font-size:14px;font-weight:600;">${fmtDate(item.date || item.foundDate)}</div>
      </div>
      <div style="background:var(--gray1);padding:12px;border-radius:10px;">
        <div style="font-size:11px;color:var(--gray3);font-weight:700;text-transform:uppercase;margin-bottom:4px;">Status</div>
        <span class="status status-${item.status === 'open' ? (type === 'lost' ? 'lost' : 'open') : item.status}">${item.status}</span>
      </div>
    </div>
    <div class="item-modal-panel">
      <div class="item-modal-label">📍 Location</div>
      <div class="item-modal-text">${item.location || '-'}</div>
    </div>
    ${item.desc ? `
      <div class="item-modal-panel">
        <div class="item-modal-label">📝 Description</div>
        <div class="item-modal-text item-modal-muted">${item.desc}</div>
      </div>` : ''}
    ${type === 'found' && item.storage ? `
      <div class="item-modal-panel">
        <div class="item-modal-label">📦 Storage Location</div>
        <div class="item-modal-text item-modal-accent">${item.storage}</div>
      </div>` : ''}
    <div class="item-modal-panel">
      <div class="item-modal-label">👤 Reported By</div>
      <div class="item-modal-reporter-row">
        <div class="avatar" style="width:28px;height:28px;font-size:12px;">${(reporter?.name || '?')[0]}</div>
        <span class="item-modal-text">${reporter?.name || 'Unknown'}</span>
      </div>
      ${item.contactHidden ? '<div style="font-size:12px;color:var(--gray3);margin-top:6px;">Contact number hidden by reporter</div>' : ''}
    </div>
    ${type === 'found' && currentUser && currentUser.role !== 'admin' && item.userId !== currentUser.id && item.status === 'open'
      ? `<button class="btn btn-primary btn-full" onclick="closeModal('item-modal');showClaimPrompt('${item.id}')">🏷️ Claim This Item</button>`
      : ''}
  `;
  document.getElementById('item-modal').classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// ═══════════════════════════════════════════════
//  BADGES
// ═══════════════════════════════════════════════

function getNotificationIcon(notification) {
  const type = String(notification?.type || '').toLowerCase();

  if (type.includes('match')) return '🤖';
  if (type.includes('return') || type.includes('resolved')) return '📦';
  if (type.includes('claim') && type.includes('approved')) return '✅';
  if (type.includes('claim') && type.includes('rejected')) return '❌';
  if (type.includes('created')) return '📋';

  return '🔔';
}

function getNotificationTitle(notification) {
  const type = String(notification?.type || '').toLowerCase();

  if (type === 'match_found') return notification.read ? 'Match Alert' : 'New Match Alert';
  if (type.includes('claim') && type.includes('approved')) return 'Claim Approved';
  if (type.includes('claim') && type.includes('rejected')) return 'Claim Update';
  if (type.includes('return') || type.includes('resolved')) return 'Item Returned';
  if (type.includes('created')) return 'Report Submitted';

  return notification?.title || 'Notification';
}

function renderNotificationBell() {
  const bell = document.getElementById('notification-bell');
  const countEl = document.getElementById('notification-count');

  if (!bell || !countEl) return;

  if (!currentUser || currentUser.role === 'admin') {
    bell.style.display = 'none';
    return;
  }

  bell.style.display = 'flex';

  const notifications = getCurrentUserNotifications();
  const unread = notifications.filter(n => !n.read).length;

  countEl.textContent = unread > 99 ? '99+' : String(unread);
  countEl.classList.toggle('hidden', unread === 0);
  bell.classList.toggle('has-unread', unread > 0);
}

function renderNotificationPanel() {
  const list = document.getElementById('notification-panel-list');
  if (!list || !currentUser || currentUser.role === 'admin') return;

  const notifications = getCurrentUserNotifications();

  if (!notifications.length) {
    list.innerHTML = `
      <div class="notification-empty">
        <div class="notification-empty-icon">🔔</div>
        <div>No notifications yet.</div>
        <small>You'll be notified when something important happens.</small>
      </div>
    `;
    renderNotificationBell();
    return;
  }

  list.innerHTML = notifications.slice(0, 12).map(n => {
    const id = escapeHtml(String(n.id || ''));
    const message = escapeHtml(
      n.message || n.body || 'You have a new TraceMate notification.'
    );
    const title = escapeHtml(getNotificationTitle(n));
    const icon = getNotificationIcon(n);
    const score = Number(n.score ?? n.matchScore);
    const type = String(n.type || '').toLowerCase();
    const isMatch = type === 'match_found' || type.includes('match');
    const isReturn =
      type.includes('return') ||
      type.includes('resolved') ||
      type === 'item_returned';

    const foundId = escapeHtml(String(n.foundItemId || ''));

    return `
      <div class="notification-card ${n.read ? '' : 'unread'}"
           data-notification-id="${id}">
        <div class="notification-card-icon">${icon}</div>

        <div class="notification-card-content">
          <div class="notification-card-top">
            <strong>${title}</strong>
            <span>${escapeHtml(fmtDateTime(n.time || n.date))}</span>
          </div>

          <div class="notification-card-message">${message}</div>

          ${
            Number.isFinite(score) && score > 0
              ? `<div class="notification-score">🤖 ${score}% match confidence</div>`
              : ''
          }

          <div class="notification-card-actions">
            ${
              isMatch && foundId
                ? `<button class="btn btn-sm btn-primary"
                    onclick="openNotificationMatch('${id}', '${foundId}')">
                    Review Match
                  </button>`
                : ''
            }

            ${
              isReturn
                ? `<button class="btn btn-sm btn-primary"
                    onclick="openReturnedNotification('${id}')">
                    View My Reports
                  </button>`
                : ''
            }

            ${
              n.read
                ? ''
                : `<button class="btn btn-sm btn-outline"
                    onclick="markNotificationRead('${id}')">
                    Mark Read
                  </button>`
            }
          </div>
        </div>
      </div>
    `;
  }).join('');

  renderNotificationBell();
}

function toggleNotificationPanel() {
  const panel = document.getElementById('notification-panel');
  if (!panel) return;

  const willOpen = !panel.classList.contains('open');

  document.querySelectorAll('.notification-panel.open')
    .forEach(p => p.classList.remove('open'));

  panel.classList.toggle('open', willOpen);

  if (willOpen) {
    renderNotificationPanel();
  }
}

function openReturnedNotification(notificationId) {
  markNotificationRead(notificationId);

  const panel = document.getElementById('notification-panel');
  if (panel) panel.classList.remove('open');

  showPage('my-reports');
}

function updateBadges() {
  if (!currentUser) return;
  const notifications = getCurrentUserNotifications().filter(n => !n.read);
  const notifBadge = document.getElementById('notif-badge');
  if (notifBadge) {
    notifBadge.textContent = notifications.length;
    notifBadge.classList.toggle('hidden', notifications.length === 0 || currentUser.role === 'admin');
  }

  const myClaims = DB.get('claims').filter(c => c.claimantId === currentUser.id && isClaimPending(c.status));
  const badge    = document.getElementById('claims-badge');
  badge.textContent = myClaims.length;
  badge.classList.toggle('hidden', myClaims.length === 0);

  if (currentUser.role === 'admin') {
    const pending = DB.get('claims').filter(c => normalizeClaimStatus(c) === 'pending_admin').length;
    const ab = document.getElementById('admin-badge');
    ab.textContent = pending;
    ab.classList.toggle('hidden', pending === 0);
  }
}

function markNotificationRead(notificationId) {
  if (!currentUser) return;
  const users = DB.get('users');
  const me = users.find(u => u.id === currentUser.id);
  if (!me || !Array.isArray(me.notifications)) return;

  const target = me.notifications.find(n => n.id === notificationId);
  if (!target || target.read) return;
  target.read = true;

  DB.set('users', users);
  currentUser = me;
  updateBadges();
  renderNotifications();
  renderNotificationBell();
  if (document.getElementById('notification-panel')?.classList.contains('open')) {
    renderNotificationPanel();
  }
}

function markAllNotificationsRead() {
  if (!currentUser) return;
  const users = DB.get('users');
  const me = users.find(u => u.id === currentUser.id);
  if (!me || !Array.isArray(me.notifications)) return;

  let changed = false;
  me.notifications.forEach(n => {
    if (!n.read) {
      n.read = true;
      changed = true;
    }
  });
  if (!changed) return;

  DB.set('users', users);
  currentUser = me;
  updateBadges();
  renderNotifications();
  renderNotificationBell();
  if (document.getElementById('notification-panel')?.classList.contains('open')) {
    renderNotificationPanel();
  }
}

function openNotificationMatch(notificationId, foundItemId) {
  const users = DB.get('users') || [];
  const me = users.find(u => u.id === currentUser?.id) || currentUser;
  const notifications = Array.isArray(me?.notifications) ? me.notifications : [];
  const notification = notifications.find(n => String(n.id) === String(notificationId));

  markNotificationRead(notificationId);
  const panel = document.getElementById('notification-panel');
  if (panel) panel.classList.remove('open');

  // Admin-confirmed notifications must open their exact lost/found pair.
  // Do not rank every open lost report against the same found item.
  if (notification && notification.lostItemId && notification.foundItemId) {
    showExactNotificationMatch(notification);
    return;
  }

  // Compatibility for older, pre-match-ID notifications only.
  if (foundItemId) showClaimPrompt(foundItemId);
}

function showExactNotificationMatch(notification) {
  const found = (DB.get('found_items') || []).find(i => String(i.id) === String(notification.foundItemId));
  const lost = (DB.get('lost_items') || []).find(i => String(i.id) === String(notification.lostItemId));
  const modal = document.getElementById('item-modal');
  const body = document.getElementById('modal-body');
  const title = document.getElementById('modal-title');

  if (!found || !lost) {
    toast('This match refers to a report that is no longer available. Please contact the Admin Office.', 'error');
    return;
  }

  const scoreValue = Number(notification.score ?? notification.matchScore);
  const score = Number.isFinite(scoreValue) ? Math.max(0, Math.min(100, Math.round(scoreValue))) : matchScore(lost, found);
  const type = String(notification.type || '').toLowerCase();
  const isConfirmed = type === 'match_confirmed' || type === 'match_confirmed_by_admin' || found.status === 'matched' || lost.status === 'matched';

  title.textContent = isConfirmed ? 'Admin-confirmed match' : 'Review match';
  body.innerHTML = `
    <div class="match-card match-card-claim">
      <div class="notify-message" style="margin-bottom:12px">${escapeHtml(notification.message || 'Review the exact item match confirmed by the admin.')}</div>
      <div class="admin-compare-grid">
        ${renderClaimCompareCard(found, 'Found Item')}
        ${renderClaimCompareCard(lost, 'Your Lost Item', score)}
      </div>
      <div class="claim-compare-actions" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end">
        <span style="margin-right:auto;align-self:center;font-weight:600">Match score: ${score}%</span>
        <button class="btn btn-sm btn-success" onclick="respondToNotificationMatch('${String(notification.id).replace(/'/g, '&#39;')}', 'approved')">Approve</button>
        <button class="btn btn-sm btn-danger" onclick="respondToNotificationMatch('${String(notification.id).replace(/'/g, '&#39;')}', 'rejected')">Reject</button>
      </div>
    </div>`;
  if (modal) modal.classList.add('show');
}

function respondToNotificationMatch(notificationId, decision) {
  if (!['approved', 'rejected'].includes(decision) || !currentUser) return;
  const users = DB.get('users') || [];
  const me = users.find(u => u.id === currentUser.id) || currentUser;
  const notification = (Array.isArray(me.notifications) ? me.notifications : []).find(n => String(n.id) === String(notificationId));
  if (!notification || !notification.lostItemId || !notification.foundItemId) {
    toast('Could not identify the exact match. Refresh notifications and try again.', 'error');
    return;
  }

  const claims = DB.get('claims') || [];
  let claim = claims.find(c => String(c.lostItemId) === String(notification.lostItemId) && String(c.foundItemId) === String(notification.foundItemId));
  if (!claim) {
    claim = {
      id: genId(), lostItemId: notification.lostItemId, foundItemId: notification.foundItemId,
      claimantId: currentUser.id, date: today(), score: Number(notification.score || 0),
      lostReporterApproved: decision === 'approved', foundReporterApproved: false,
      status: decision, notes: decision === 'approved' ? 'Approved by the owner from the admin-confirmed match notification.' : 'Rejected by the owner from the admin-confirmed match notification.'
    };
    claims.push(claim);
  } else {
    claim.status = decision;
    claim.notes = decision === 'approved'
      ? 'Approved by the owner from the admin-confirmed match notification.'
      : 'Rejected by the owner from the admin-confirmed match notification.';
    if (decision === 'approved') claim.lostReporterApproved = true;
    claim.ownerRespondedAt = new Date().toISOString();
  }
  DB.set('claims', claims);

  notification.ownerDecision = decision;
  notification.ownerDecisionAt = new Date().toISOString();
  notification.read = true;
  notification.message = decision === 'approved'
    ? 'You approved the admin-confirmed match. Please collect the item from the Admin Office after identity verification.'
    : 'You rejected this proposed match. The Admin Office should review the report before proceeding.';
  DB.set('users', users);

  closeModal('item-modal');
  toast(decision === 'approved' ? 'Match approved.' : 'Match rejected. The admin should review it.', decision === 'approved' ? 'success' : 'info');
  renderNotificationPanel();
  renderNotifications();
  renderMyClaims();
  updateBadges();
}

// ═══════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════
function getCatEmoji(cat) {
  const map = { electronics: '📱', documents: '📄', accessories: '👜', clothing: '👗', keys: '🔑', books: '📚', other: '📦' };
  return map[cat] || '📦';
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: '💡', '': '📢' };
  el.innerHTML = `${icons[type] || '📢'} ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}



// Close the notification panel when clicking outside it.
(function TraceMateNotificationOutsideClick() {
  if (window.__traceMateNotificationOutsideClick) return;
  window.__traceMateNotificationOutsideClick = true;

  document.addEventListener('click', function(event) {
    const wrap = document.getElementById('notification-wrap');
    const panel = document.getElementById('notification-panel');

    if (!wrap || !panel || !panel.classList.contains('open')) return;

    if (!wrap.contains(event.target)) {
      panel.classList.remove('open');
    }
  });
})();
