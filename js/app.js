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
      const score = matchScore(l, f);
      if (score >= 40) allMatches.push({ lost: l, found: f, score });
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
function matchScore(lostItem, foundItem) {
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
  ['lost-name','lost-location','lost-desc','lost-contact'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('lost-cat').value  = '';
  document.getElementById('lost-date').value = '';
  const lostHideContact = document.getElementById('lost-hide-contact');
  if (lostHideContact) lostHideContact.checked = false;
  document.getElementById('lost-preview').style.display = 'none';
  document.querySelector('#lost-upload-zone .upload-placeholder').style.display = 'block';
  document.getElementById('lost-upload-zone').classList.remove('has-image');
  lostImageData = '';
}

function resetFoundForm() {
  ['found-name','found-location','found-desc','found-storage','found-contact'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('found-cat').value  = '';
  document.getElementById('found-date').value = '';
  const foundHideContact = document.getElementById('found-hide-contact');
  if (foundHideContact) foundHideContact.checked = false;
  document.getElementById('found-preview').style.display = 'none';
  document.querySelector('#found-upload-zone .upload-placeholder').style.display = 'block';
  document.getElementById('found-upload-zone').classList.remove('has-image');
  foundImageData = '';
}

// ═══════════════════════════════════════════════
//  MY REPORTS
// ═══════════════════════════════════════════════
function renderMyReports() {
  if (!currentUser) return;
  const lost  = DB.get('lost_items').filter(i => i.userId === currentUser.id);
  const found = DB.get('found_items').filter(i => i.userId === currentUser.id);

  const lostTbody = document.getElementById('my-lost-tbody');
  lostTbody.innerHTML = lost.length ? lost.map(i => `
    <tr>
      <td><strong>${i.name}</strong></td>
      <td><span class="cat-tag">${getCatEmoji(i.category)} ${capitalize(i.category)}</span></td>
      <td>${fmtDate(i.date)}</td>
      <td>${i.location}</td>
      <td><span class="status status-${i.status === 'open' ? 'lost' : i.status}">${i.status}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline" onclick="openItemModal('${i.id}','lost')">View</button>
          ${i.status === 'open' ? `<button class="btn btn-sm btn-danger" onclick="deleteItem('${i.id}','lost')">Delete</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="6"><div class="empty-state" style="padding:24px;">No lost item reports yet.</div></td></tr>';

  const foundTbody = document.getElementById('my-found-tbody');
  foundTbody.innerHTML = found.length ? found.map(i => `
    <tr>
      <td><strong>${i.name}</strong></td>
      <td><span class="cat-tag">${getCatEmoji(i.category)} ${capitalize(i.category)}</span></td>
      <td>${fmtDate(i.foundDate)}</td>
      <td>${i.location}</td>
      <td><span class="status status-${i.status}">${i.status}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn btn-sm btn-outline" onclick="openItemModal('${i.id}','found')">View</button>
          ${i.status === 'open' ? `<button class="btn btn-sm btn-danger" onclick="deleteItem('${i.id}','found')">Delete</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('') : '<tr><td colspan="6"><div class="empty-state" style="padding:24px;">No found item reports yet.</div></td></tr>';
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
}

function openNotificationMatch(notificationId, foundItemId) {
  markNotificationRead(notificationId);
  showClaimPrompt(foundItemId);
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
