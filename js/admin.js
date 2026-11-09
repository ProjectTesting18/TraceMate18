// ═══════════════════════════════════════════════
//  admin.js – Admin Panel
//  TraceMate – Smart Lost & Found Campus App
// ═══════════════════════════════════════════════

function formatAdminImageSimilarity(value, options = {}, legacyHasFoundPhoto) {
  // Support object options and the legacy positional booleans.
  const photoOptions = typeof options === 'boolean'
    ? { hasLostPhoto: options, hasFoundPhoto: legacyHasFoundPhoto !== false }
    : (options || {});
  const { hasLostPhoto = true, hasFoundPhoto = true } = photoOptions;
  if (!hasLostPhoto && !hasFoundPhoto) return 'No photos provided';
  if (!hasLostPhoto) return 'No photo on lost report';
  if (!hasFoundPhoto) return 'No photo on found report';
  if (value === null || value === undefined || value === '') return 'Image similarity unavailable';
  const score = Number(value);
  if (!Number.isFinite(score)) return 'Image similarity unavailable';
  const percentage = score >= 0 && score <= 1 ? score * 100 : score;
  return `${percentage.toFixed(1)}%`;
}

// A low-confidence visual prediction warrants review, but does not by itself
// prove that object identity is unresolved. Apply the defensive score cap only
// when the payload explicitly says object-type evidence is unresolved/zero.
function requiresVisualIdentityScoreCap(match = {}) {
  const reasons = [
    ...(Array.isArray(match.reviewReasons) ? match.reviewReasons : []),
    ...(Array.isArray(match.reasons) ? match.reasons : []),
    ...(Array.isArray(match.warnings) ? match.warnings : [])
  ];
  return reasons.some(reason => /object type evidence is unresolved|object type similarity is 0/i.test(String(reason)));
}

function effectiveCandidateScore(match = {}) {
  const raw = Number(match.score ?? match.matchScore ?? match.aiScore ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return requiresVisualIdentityScoreCap(match) ? Math.min(raw, 69) : raw;
}

function renderAdmin() {
  const users = DB.get('users') || [];
  const lost = DB.get('lost_items') || [];
  const found = DB.get('found_items') || [];
  const claims = (DB.get('claims') || []).map(c => ({
    ...c,
    status: normalizeClaimStatus(c)
  }));

  const pendingUser = claims.filter(
    c => c.status === 'pending_user'
  );

  const pendingAdmin = claims.filter(
    c => c.status === 'pending_admin'
  );

  const resolved = claims.filter(
    c => ['approved', 'closed', 'returned'].includes(c.status)
  );

  const openFound = found.filter(i =>
    ['open', 'received_by_admin', 'matched'].includes(
      String(i.status || '').toLowerCase()
    )
  );

  const highConfidence = claims.filter(
    c => Number(
      c.matchScore ??
      c.score ??
      c.aiScore ??
      0
    ) >= 80
  );

  /*
   * Physical resolved/returned items.
   *
   * Use IDs to avoid counting the same physical item
   * multiple times when both a claim and item status
   * indicate resolution.
   */
  const resolvedPhysicalIds = new Set();

  found
    .filter(i =>
      ['returned', 'resolved'].includes(
        String(i.status || '').toLowerCase()
      )
    )
    .forEach(i => resolvedPhysicalIds.add(`found:${i.id}`));

  lost
    .filter(i =>
      String(i.status || '').toLowerCase() === 'resolved'
    )
    .forEach(i => resolvedPhysicalIds.add(`lost:${i.id}`));

  /*
   * Claims which are approved/closed but whose linked
   * physical items are not already counted.
   */
  claims
    .filter(c =>
      ['approved', 'closed', 'returned'].includes(c.status)
    )
    .forEach(c => {
      if (c.lostItemId) {
        resolvedPhysicalIds.add(`lost:${c.lostItemId}`);
      }

      if (c.foundItemId) {
        resolvedPhysicalIds.add(`found:${c.foundItemId}`);
      }
    });

  const resolvedCount =
    resolvedPhysicalIds.size;

  const setCount = (id, value) => {
    const el = document.getElementById(id);

    if (el) {
      el.textContent = String(value);
    }
  };

  // ─────────────────────────────────────────────
  // MAIN ADMIN OVERVIEW
  // ─────────────────────────────────────────────

  setCount(
    'admin-attention-count',
    openFound.length + pendingAdmin.length
  );

  setCount(
    'admin-high-match-count',
    highConfidence.length
  );

  /*
   * Potential matches means pending admin claims.
   */
  setCount(
    'admin-ai-match-count',
    pendingAdmin.length
  );

  /*
   * Resolved / returned.
   */
  setCount(
    'admin-ai-high-count',
    resolvedCount
  );

  // ─────────────────────────────────────────────
  // SECONDARY ADMIN STATISTICS
  // ─────────────────────────────────────────────

  setCount(
    'admin-users-count',
    users.filter(
      u => u.role !== 'admin'
    ).length
  );

  setCount(
    'admin-items-count',
    lost.length + found.length
  );

  setCount(
    'admin-pending-count',
    pendingAdmin.length
  );

  setCount(
    'admin-resolved-count',
    resolvedCount
  );

  setCount(
    'admin-ai-lost-count',
    lost.length
  );

  setCount(
    'admin-ai-found-count',
    found.length
  );

  // ─────────────────────────────────────────────
  // ADMIN BADGE
  // ─────────────────────────────────────────────

  const badge =
    document.getElementById('admin-badge');

  if (badge) {
    badge.textContent =
      String(pendingAdmin.length);

    badge.classList.toggle(
      'hidden',
      pendingAdmin.length === 0
    );
  }

  // ─────────────────────────────────────────────
  // USER APPROVAL PENDING
  // ─────────────────────────────────────────────

  const pendingUserTbody =
    document.getElementById(
      'admin-user-pending-tbody'
    );

  if (pendingUserTbody) {
    pendingUserTbody.innerHTML =
      pendingUser.length
        ? pendingUser.map(c => {
            const claimant =
              users.find(
                u => u.id === c.claimantId
              );

            const l =
              lost.find(
                i => i.id === c.lostItemId
              );

            const f =
              found.find(
                i => i.id === c.foundItemId
              );

            const waitingOn = [
              c.lostReporterApproved
                ? ''
                : 'Lost Reporter',

              c.foundReporterApproved
                ? ''
                : 'Found Reporter'
            ]
              .filter(Boolean)
              .join(' + ');

            return `
              <tr>
                <td>
                  <div style="font-weight:600;">
                    ${escapeHtml(
                      claimant?.name ||
                      'Unknown'
                    )}
                  </div>

                  <div style="
                    font-size:12px;
                    color:var(--gray3);
                  ">
                    ${escapeHtml(
                      claimant?.email ||
                      '-'
                    )}
                  </div>
                </td>

                <td>
                  ${escapeHtml(
                    l?.name || '-'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    f?.name || '-'
                  )}
                </td>

                <td>
                  ${fmtDate(c.date)}
                </td>

                <td>
                  <span style="
                    font-size:12px;
                    color:var(--gray4);
                    font-weight:600;
                  ">
                    ${escapeHtml(
                      waitingOn || '-'
                    )}
                  </span>
                </td>

                <td>
                  <div style="
                    display:flex;
                    align-items:center;
                    gap:6px;
                  ">
                    <div style="
                      width:40px;
                      height:6px;
                      background:var(--gray2);
                      border-radius:3px;
                      overflow:hidden;
                    ">
                      <div style="
                        width:${Number(c.score || 0)}%;
                        height:100%;
                        background:${
                          Number(c.score || 0) >= 70
                            ? 'var(--success)'
                            : Number(c.score || 0) >= 40
                              ? 'var(--warning)'
                              : 'var(--danger)'
                        };
                      "></div>
                    </div>

                    <span style="
                      font-size:12px;
                      font-weight:600;
                    ">
                      ${Number(c.score || 0)}%
                    </span>
                  </div>
                </td>
              </tr>
            `;
          }).join('')
        : `
          <tr>
            <td colspan="6">
              <div
                class="empty-state"
                style="
                  padding:24px;
                  color:var(--gray3);
                  text-align:center;
                "
              >
                No claims waiting on user approvals.
              </div>
            </td>
          </tr>
        `;
  }

  // ─────────────────────────────────────────────
  // PENDING CLAIMS TABLE
  // ─────────────────────────────────────────────

  const claimsTbody =
    document.getElementById(
      'admin-claims-tbody'
    );

  if (claimsTbody) {
    claimsTbody.innerHTML =
      pendingAdmin.length
        ? pendingAdmin.map(c => {
            const claimant =
              users.find(
                u => u.id === c.claimantId
              );

            const l =
              lost.find(
                i => i.id === c.lostItemId
              );

            const f =
              found.find(
                i => i.id === c.foundItemId
              );

            const canCompare =
              Boolean(l && f);

            const claimScore =
              Number(
                c.score ??
                c.matchScore ??
                c.aiScore ??
                0
              );

            return `
              <tr>
                <td>
                  <div style="
                    font-weight:600;
                  ">
                    ${escapeHtml(
                      claimant?.name ||
                      'Unknown'
                    )}
                  </div>

                  <div style="
                    font-size:12px;
                    color:var(--gray3);
                  ">
                    ${escapeHtml(
                      claimant?.email ||
                      '-'
                    )}
                  </div>
                </td>

                <td>
                  ${escapeHtml(
                    l?.name || '-'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    f?.name || '-'
                  )}
                </td>

                <td>
                  ${fmtDate(c.date)}
                </td>

                <td>
                  <div style="
                    display:flex;
                    align-items:center;
                    gap:6px;
                  ">
                    <div style="
                      width:40px;
                      height:6px;
                      background:var(--gray2);
                      border-radius:3px;
                      overflow:hidden;
                    ">
                      <div style="
                        width:${Math.max(
                          0,
                          Math.min(
                            100,
                            claimScore
                          )
                        )}%;
                        height:100%;
                        background:${
                          claimScore >= 70
                            ? 'var(--success)'
                            : claimScore >= 40
                              ? 'var(--warning)'
                              : 'var(--danger)'
                        };
                      "></div>
                    </div>

                    <span style="
                      font-size:12px;
                      font-weight:600;
                    ">
                      ${claimScore}%
                    </span>
                  </div>
                </td>

                <td>
                  <div style="
                    font-size:12px;
                    color:var(--gray3);
                    margin-bottom:8px;
                  ">
                    user approvals:
                    ${
                      c.lostReporterApproved
                        ? 'lost ✓'
                        : 'lost ✕'
                    }
                    ·
                    ${
                      c.foundReporterApproved
                        ? 'found ✓'
                        : 'found ✕'
                    }
                  </div>

                  <div class="action-btns">
                    <button
                      class="btn btn-sm btn-outline"
                      onclick="openClaimComparison('${escapeHtml(c.id)}')"
                      ${
                        canCompare
                          ? ''
                          : 'disabled title="Lost/Found item missing"'
                      }
                    >
                      Compare
                    </button>

                    <button
                      class="btn btn-sm btn-success"
                      onclick="approveClaim('${escapeHtml(c.id)}')"
                    >
                      ✓ Approve
                    </button>

                    <button
                      class="btn btn-sm btn-danger"
                      onclick="rejectClaim('${escapeHtml(c.id)}')"
                    >
                      ✕ Reject
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')
        : `
          <tr>
            <td colspan="6">
              <div
                class="empty-state"
                style="
                  padding:24px;
                  color:var(--gray3);
                  text-align:center;
                "
              >
                <div style="
                  font-size:24px;
                  margin-bottom:8px;
                ">
                  🧾
                </div>

                <div style="
                  font-weight:600;
                  color:var(--gray3);
                ">
                  No pending admin verifications
                </div>

                <div style="
                  margin-top:5px;
                  font-size:12px;
                  color:var(--gray3);
                ">
                  AI candidates are shown in the
                  AI Matching Workflow section above.
                </div>
              </div>
            </td>
          </tr>
        `;
  }

  // ─────────────────────────────────────────────
  // ALL LOST ITEMS TABLE
  // ─────────────────────────────────────────────

  const lostTbody =
    document.getElementById(
      'admin-lost-tbody'
    );

  if (lostTbody) {
    lostTbody.innerHTML =
      lost.map(i => {
        const u =
          users.find(
            user => user.id === i.userId
          );

        return `
          <tr
            onclick="adminOpenLostComparison('${escapeHtml(i.id)}')"
          >
            <td>
              <strong>
                ${escapeHtml(
                  i.name || 'Unnamed'
                )}
              </strong>
            </td>

            <td style="font-size:12px;">
              ${escapeHtml(
                u?.name || '-'
              )}
            </td>

            <td>
              ${fmtDate(i.date)}
            </td>

            <td>
              <span class="
                status
                status-${escapeHtml(
                  i.status === 'open'
                    ? 'lost'
                    : i.status || ''
                )}
              ">
                ${escapeHtml(
                  i.status || '-'
                )}
              </span>
            </td>

            <td>
              <button
                class="btn btn-sm btn-danger"
                onclick="
                  event.stopPropagation();
                  adminDelete(
                    '${escapeHtml(i.id)}',
                    'lost'
                  )
                "
              >
                Delete
              </button>
            </td>
          </tr>
        `;
      }).join('')
      ||
      `
        <tr>
          <td
            colspan="5"
            style="
              text-align:center;
              padding:16px;
              color:var(--gray3);
            "
          >
            No items
          </td>
        </tr>
      `;
  }

  // ─────────────────────────────────────────────
  // ALL FOUND ITEMS TABLE
  // ─────────────────────────────────────────────

  const foundTbody =
    document.getElementById(
      'admin-found-tbody'
    );

  if (foundTbody) {
    foundTbody.innerHTML =
      found.map(i => {
        const u =
          users.find(
            user => user.id === i.userId
          );

        return `
          <tr>
            <td>
              <strong>
                ${escapeHtml(
                  i.name || 'Unnamed'
                )}
              </strong>
            </td>

            <td style="font-size:12px;">
              ${escapeHtml(
                u?.name || '-'
              )}
            </td>

            <td>
              ${fmtDate(
                i.foundDate ||
                i.date
              )}
            </td>

            <td>
              <span class="
                status
                status-${escapeHtml(
                  i.status || ''
                )}
              ">
                ${escapeHtml(
                  i.status || '-'
                )}
              </span>
            </td>

            <td>
              <button
                class="btn btn-sm btn-danger"
                onclick="
                  event.stopPropagation();
                  adminDelete(
                    '${escapeHtml(i.id)}',
                    'found'
                  )
                "
              >
                Delete
              </button>
            </td>
          </tr>
        `;
      }).join('')
      ||
      `
        <tr>
          <td
            colspan="5"
            style="
              text-align:center;
              padding:16px;
              color:var(--gray3);
            "
          >
            No items
          </td>
        </tr>
      `;
  }
}


// ═══════════════════════════════════════════════════════════════════════
// CLAIM ACTIONS
// ═══════════════════════════════════════════════════════════════════════

function approveClaim(claimId) {
  const claims =
    (DB.get('claims') || []).map(c => ({
      ...c,
      status: normalizeClaimStatus(c)
    }));

  const claim =
    claims.find(
      c => c.id === claimId
    );

  if (!claim) return;

  if (
    claim.status !== 'pending_admin'
  ) {
    toast(
      'Claim must complete user approval before admin verification',
      'error'
    );

    return;
  }

  const updated =
    claims.map(c => {
      if (c.id === claimId) {
        return {
          ...c,
          status: 'approved',
          notes:
            'Approved by admin after user approvals'
        };
      }

      if (
        (
          c.lostItemId === claim.lostItemId ||
          c.foundItemId === claim.foundItemId
        ) &&
        (
          c.status === 'pending_user' ||
          c.status === 'pending_admin'
        )
      ) {
        return {
          ...c,
          status: 'rejected',
          notes:
            'Auto-rejected: another claim approved for this item'
        };
      }

      return c;
    });

  DB.set(
    'claims',
    updated
  );

  syncClaimItemStatuses(
    claim.lostItemId,
    claim.foundItemId
  );

  const competing =
    updated.filter(
      c =>
        c.id !== claimId &&
        (
          c.lostItemId === claim.lostItemId ||
          c.foundItemId === claim.foundItemId
        ) &&
        c.status === 'rejected'
    ).length;

  closeModal('item-modal');

  toast(
    `Claim approved and ${competing} competing claim(s) rejected ✅`,
    'success'
  );

  updateBadges();
  refreshDashboard();
  renderMyClaims();
  renderAdmin();
}


function rejectClaim(claimId) {
  const claims =
    (DB.get('claims') || []).map(c => ({
      ...c,
      status: normalizeClaimStatus(c)
    }));

  const claim =
    claims.find(
      c => c.id === claimId
    );

  if (!claim) return;

  const updated =
    claims.map(c =>
      c.id === claimId
        ? {
            ...c,
            status: 'rejected',
            notes: 'Rejected by admin'
          }
        : c
    );

  DB.set(
    'claims',
    updated
  );

  syncClaimItemStatuses(
    claim.lostItemId,
    claim.foundItemId
  );

  closeModal('item-modal');

  toast(
    'Claim rejected',
    'error'
  );

  updateBadges();
  refreshDashboard();
  renderMyClaims();
  renderAdmin();
}


function adminDelete(id, type) {
  if (
    !confirm('Delete this item?')
  ) {
    return;
  }

  const key =
    type === 'lost'
      ? 'lost_items'
      : 'found_items';

  try {
    DB.removeItem(key, id);
  } catch (error) {
    toast(error.message || 'Could not delete item', 'error');
    return;
  }

  toast(
    'Item deleted',
    'success'
  );

  closeAIMatchModal();
  renderAdmin();
}


// ═══════════════════════════════════════════════════════════════════════
// OLD ITEM COMPARISON
// ═══════════════════════════════════════════════════════════════════════

function adminOpenLostComparison(lostId) {
  const lostItems =
    DB.get('lost_items') || [];

  const foundItems =
    DB.get('found_items') || [];

  const users =
    DB.get('users') || [];

  const lostItem =
    lostItems.find(
      i => i.id === lostId
    );

  if (!lostItem) return;

  let bestMatch = null;
  let bestScore = -1;

  foundItems.forEach(f => {
    const score =
      matchScore(
        lostItem,
        f
      );

    if (score > bestScore) {
      bestScore = score;
      bestMatch = f;
    }
  });

  const lostReporter =
    users.find(
      u => u.id === lostItem.userId
    );

  const foundReporter =
    bestMatch
      ? users.find(
          u => u.id === bestMatch.userId
        )
      : null;

  const title =
    document.getElementById(
      'modal-title'
    );

  const body =
    document.getElementById(
      'modal-body'
    );

  if (!title || !body) {
    return;
  }

  title.textContent =
    'Compare Items';

  body.innerHTML = `
    <div class="admin-compare-grid">

      ${renderCompareCard(
        lostItem,
        'Lost Item',
        lostReporter
      )}

      ${
        bestMatch
          ? renderCompareCard(
              bestMatch,
              `Best Match (${bestScore}%)`,
              foundReporter
            )
          : `
            <div class="
              compare-card
              compare-empty
            ">
              No found items to compare yet.
            </div>
          `
      }

    </div>
  `;

  document
    .getElementById('item-modal')
    ?.classList.add('show');
}


function openClaimComparison(claimId) {
  const claims =
    (DB.get('claims') || []).map(c => ({
      ...c,
      status: normalizeClaimStatus(c)
    }));

  const claim =
    claims.find(
      c => c.id === claimId
    );

  if (!claim) return;

  const lostItems =
    DB.get('lost_items') || [];

  const foundItems =
    DB.get('found_items') || [];

  const users =
    DB.get('users') || [];

  const lostItem =
    lostItems.find(
      i => i.id === claim.lostItemId
    );

  const foundItem =
    foundItems.find(
      i => i.id === claim.foundItemId
    );

  if (
    !lostItem ||
    !foundItem
  ) {
    toast(
      'Compare unavailable: linked lost/found item is missing',
      'error'
    );

    return;
  }

  const lostReporter =
    users.find(
      u => u.id === lostItem.userId
    );

  const foundReporter =
    users.find(
      u => u.id === foundItem.userId
    );

  const title =
    document.getElementById(
      'modal-title'
    );

  const body =
    document.getElementById(
      'modal-body'
    );

  if (!title || !body) {
    return;
  }

  title.textContent =
    `Compare Claim (${Number(
      claim.score ??
      claim.matchScore ??
      0
    )}%)`;

  body.innerHTML = `
    <div class="admin-compare-grid">

      ${renderCompareCard(
        lostItem,
        'Lost Item',
        lostReporter
      )}

      ${renderCompareCard(
        foundItem,
        'Found Item',
        foundReporter
      )}

    </div>

    <div style="
      margin-top:16px;
      padding:14px 16px;
      border-radius:12px;
      background:rgba(255,255,255,0.04);
      border:1px solid rgba(255,255,255,0.08);
      font-size:12px;
      color:var(--gray3);
    ">

      <div style="
        display:flex;
        flex-wrap:wrap;
        gap:12px;
        justify-content:space-between;
        align-items:center;
      ">

        <div>

          <div style="
            font-weight:700;
            color:#f5f7fb;
            margin-bottom:4px;
          ">
            Claim status:
            ${escapeHtml(
              getClaimStatusLabel(
                claim.status
              )
            )}
          </div>

          <div>
            User approvals:
            ${
              claim.lostReporterApproved
                ? 'lost ✓'
                : 'lost ✕'
            }
            ·
            ${
              claim.foundReporterApproved
                ? 'found ✓'
                : 'found ✕'
            }
          </div>

        </div>

        <div class="claim-compare-actions">

          <button
            class="btn btn-sm btn-success"
            onclick="approveClaim('${escapeHtml(claim.id)}')"
          >
            ✓ Approve
          </button>

          <button
            class="btn btn-sm btn-danger"
            onclick="rejectClaim('${escapeHtml(claim.id)}')"
          >
            ✕ Reject
          </button>

        </div>

      </div>

    </div>
  `;

  document
    .getElementById('item-modal')
    ?.classList.add('show');
}


function renderCompareCard(
  item,
  title,
  reporter
) {
  const dateLabel =
    item.type === 'found' ||
    item.foundDate
      ? 'Date Found'
      : 'Date Lost';

  const dateValue =
    item.foundDate
      ? fmtDate(item.foundDate)
      : fmtDate(item.date);

  return `
    <div class="compare-card">

      <div class="compare-header">
        ${escapeHtml(title)}
      </div>

      ${
        item.image
          ? `
            <img
              class="compare-image"
              src="${escapeHtml(item.image)}"
              alt="${escapeHtml(
                item.name || 'Item'
              )}"
            >
          `
          : `
            <div class="
              compare-image
              compare-placeholder
            ">
              ${getCatEmoji(
                item.category
              )}
            </div>
          `
      }

      <div class="compare-row">
        <span class="compare-label">
          Name
        </span>

        <span class="compare-value">
          ${escapeHtml(
            item.name || '-'
          )}
        </span>
      </div>

      <div class="compare-row">
        <span class="compare-label">
          Category
        </span>

        <span class="compare-value">
          ${escapeHtml(
            capitalize(
              item.category ||
              'other'
            )
          )}
        </span>
      </div>

      <div class="compare-row">
        <span class="compare-label">
          ${dateLabel}
        </span>

        <span class="compare-value">
          ${dateValue}
        </span>
      </div>

      <div class="compare-row">
        <span class="compare-label">
          Location
        </span>

        <span class="compare-value">
          ${escapeHtml(
            item.location ||
            '-'
          )}
        </span>
      </div>

      ${
        item.desc ||
        item.description
          ? `
            <div class="
              compare-row
              compare-desc
            ">
              <span class="compare-label">
                Description
              </span>

              <span class="compare-value">
                ${escapeHtml(
                  item.desc ||
                  item.description ||
                  ''
                )}
              </span>
            </div>
          `
          : ''
      }

      <div class="compare-row">
        <span class="compare-label">
          Reported By
        </span>

        <span class="compare-value">
          ${escapeHtml(
            reporter?.name ||
            'Unknown'
          )}
        </span>
      </div>

    </div>
  `;
}


// ═══════════════════════════════════════════════════════════════════════
// ADMIN API
// ═══════════════════════════════════════════════════════════════════════

async function adminApi(
  path,
  options = {}
) {
  const token =
    getAuthToken();

  const headers = {
    ...(options.headers || {})
  };

  if (
    options.body &&
    !headers['Content-Type']
  ) {
    headers['Content-Type'] =
      'application/json';
  }

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const res =
    await fetch(
      apiUrl(path),
      {
        ...options,
        headers
      }
    );

  const data =
    await res.json()
      .catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data.error ||
      data.message ||
      `Request failed (${res.status})`
    );
  }

  return data;
}


// ═══════════════════════════════════════════════════════════════════════
// AI WORKFLOW
// ═══════════════════════════════════════════════════════════════════════

async function renderAdminAIWorkflow() {
  /*
   * Support both IDs because older versions of the HTML
   * used admin-ai-found-tbody while some versions used
   * admin-found-intake-tbody.
   */
  const tbody =
    document.getElementById(
      'admin-ai-found-tbody'
    ) ||
    document.getElementById(
      'admin-found-intake-tbody'
    );

  if (
    !tbody ||
    !currentUser ||
    currentUser.role !== 'admin'
  ) {
    return;
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="6" style="
        padding:18px;
        text-align:center;
        color:var(--gray3);
      ">
        Loading found items…
      </td>
    </tr>
  `;

  try {
    const found =
      DB.get('found_items') || [];

    const items =
      found.filter(i =>
        [
          'open',
          'received_by_admin',
          'matched'
        ].includes(
          String(
            i.status || ''
          ).toLowerCase()
        )
      );

    if (!items.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">
            <div
              class="empty-state"
              style="
                padding:24px;
                color:var(--gray3);
                text-align:center;
              "
            >
              No found items awaiting
              the admin workflow.
            </div>
          </td>
        </tr>
      `;

      return;
    }

    tbody.innerHTML =
      items.map(item => `
        <tr>

          <td>
            <strong>
              ${escapeHtml(
                item.name ||
                'Unnamed'
              )}
            </strong>
          </td>

          <td>
            ${escapeHtml(
              item.location ||
              '-'
            )}
          </td>

          <td>
            ${fmtDate(
              item.foundDate ||
              item.date
            )}
          </td>

          <td>
            <span class="workflow-status">
              ${escapeHtml(
                item.status ||
                'open'
              )}
            </span>
          </td>

          <td>
            <button
              class="btn btn-sm btn-outline"
              onclick="showAIMatches('${escapeHtml(item.id)}')"
            >
              View AI Matches
            </button>
          </td>

          <td>

            ${
              item.status === 'open'
                ? `
                  <button
                    class="btn btn-sm btn-primary"
                    onclick="receiveFoundItem('${escapeHtml(item.id)}')"
                  >
                    I Received This Item
                  </button>
                `
                : ''
            }

            ${
              item.status === 'matched'
                ? `
                  <button
                    class="btn btn-sm btn-success"
                    onclick="returnMatchedItem('${escapeHtml(item.id)}')"
                  >
                    Return to Owner
                  </button>
                `
                : ''
            }

          </td>

        </tr>
      `).join('');

  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td
          colspan="6"
          style="
            padding:18px;
            color:var(--danger);
          "
        >
          Could not load workflow:
          ${escapeHtml(
            err.message
          )}
        </td>
      </tr>
    `;
  }
}


// ═══════════════════════════════════════════════════════════════════════
// RECEIVE FOUND ITEM
// ═══════════════════════════════════════════════════════════════════════

async function receiveFoundItem(foundId) {
  try {
    const data =
      await adminApi(
        `/api/found/${foundId}`,
        {
          method: 'PUT'
        }
      );

    toast(
      'Physical item received by admin. AI matches are ready.',
      'success'
    );

    await renderAdminAIWorkflow();

    if (
      Array.isArray(
        data?.data?.matches
      )
    ) {
      showAIMatchModal(
        foundId,
        data.data.matches
      );
    } else {
      await showAIMatches(
        foundId
      );
    }

  } catch (err) {
    toast(
      err.message,
      'error'
    );
  }
}


// ═══════════════════════════════════════════════════════════════════════
// GET AI MATCHES
// ═══════════════════════════════════════════════════════════════════════

async function showAIMatches(foundId) {
  try {

    console.log(
      '[TraceMate] Loading AI matches:',
      foundId
    );

    const token =
      typeof getAuthToken === 'function'
        ? getAuthToken()
        : '';

    const response =
      await fetch(
        `/api/matches/admin/found/${encodeURIComponent(foundId)}`,
        {
          method: 'GET',
          headers: {
            Authorization:
              `Bearer ${token}`
          }
        }
      );

    const data =
      await response.json();

    console.log(
      '[TraceMate] AI API response:',
      data
    );

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        `Request failed (${response.status})`
      );
    }

    const matches =
      Array.isArray(data?.data)
        ? data.data
        : [];

    console.log(
      '[TraceMate] AI MATCH COUNT:',
      matches.length
    );

    if (matches.length) {
      console.log(
        '[TraceMate] FIRST AI MATCH:',
        matches[0]
      );
    }

    showAIMatchModal(
      foundId,
      matches
    );

  } catch (err) {

    console.error(
      '[TraceMate] AI match request failed:',
      err
    );

    toast(
      err?.message ||
      'Unable to load AI matches.',
      'error'
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// AI MATCH MODAL
// ═══════════════════════════════════════════════════════════════════════

function showAIMatchModal(
  foundId,
  matches
) {
  /*
   * Found item currently being inspected.
   *
   * This belongs to showAIMatchModal() scope because the
   * Possible High Matches summary and every candidate card
   * both need to know which found item is being matched.
   */
  const foundItem =
    DB.get('found_items').find(
      item => item.id === foundId
    ) || {};

  window.__traceMateCurrentFoundItemStatus = String(foundItem.status || '').toLowerCase();

  let modal =
    document.getElementById(
      'ai-match-modal'
    );

  if (!modal) {
    modal =
      document.createElement(
        'div'
      );

    modal.id =
      'ai-match-modal';

    modal.className =
      'modal-overlay ai-match-modal';

    modal.setAttribute(
      'aria-hidden',
      'true'
    );

    modal.innerHTML = `
      <div
        class="modal ai-match-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-match-modal-title"
      >

        <div class="
          modal-header
          ai-match-modal-header
        ">

          <div>

            <h3 id="ai-match-modal-title">
              🤖 AI Match Candidates
            </h3>

            <p class="
              ai-match-modal-subtitle
            ">
              NLP + Computer Vision +
              object properties +
              semantic location +
              date
            </p>

          </div>

          <button
            type="button"
            class="modal-close"
            data-ai-close
            aria-label="Close AI match modal"
          >
            ✖
          </button>

        </div>

        <div
          class="
            modal-body
            ai-match-modal-body
          "
          id="ai-match-modal-body"
        ></div>

      </div>
    `;

    document.body.appendChild(
      modal
    );

    /*
     * Close button.
     */
    const closeButton =
      modal.querySelector(
        '[data-ai-close]'
      );

    if (closeButton) {
      closeButton.addEventListener(
        'click',
        closeAIMatchModal
      );
    }

    /*
     * Backdrop click.
     */
    modal.addEventListener(
      'click',
      event => {
        if (
          event.target === modal
        ) {
          closeAIMatchModal();
        }
      }
    );
  }

  const body =
    document.getElementById(
      'ai-match-modal-body'
    );

  if (!body) {
    return;
  }

  // Decode entity-encoded legacy values as plain text (never parse them as HTML).
  // Numeric entities may be nested, e.g. &amp;#x53;ame or &amp;amp;#x53;ame.
  const decodeLegacyHtmlEntities = value => {
    let decoded = String(value ?? '');
    const namedEntities = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
      colon: ':', sol: '/', period: '.', comma: ',', hyphen: '-', ndash: '\u2013',
      mdash: '\u2014', rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d',
      ldquo: '\u201c', bull: '\u2022', hellip: '\u2026', copy: '\u00a9',
      reg: '\u00ae', trade: '\u2122', pound: '\u00a3', euro: '\u20ac'
    };
    const decodePass = text => text
      .replace(/&#(?:x([0-9a-f]{1,8})|(\d{1,10}));?/gi, (whole, hex, decimal) => {
        const cp = Number.parseInt(hex || decimal, hex ? 16 : 10);
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
        try { return String.fromCodePoint(cp); } catch { return whole; }
      })
      .replace(/&([a-z][a-z0-9]+);/gi, (whole, name) => {
        const replacement = namedEntities[name.toLowerCase()];
        return replacement === undefined ? whole : replacement;
      });
    for (let pass = 0; pass < 12; pass += 1) {
      const next = decodePass(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  };

  if (
    !Array.isArray(matches) ||
    !matches.length
  ) {
    body.innerHTML = `
      <div class="
        empty-state
        ai-match-empty
      ">

        <div
          class="empty-icon"
          style="
            font-size:32px;
            margin-bottom:8px;
          "
        >
          🔍
        </div>

        <h3>
          No AI matches found
        </h3>

        <p>
          No open lost-item candidates
          reached the configured
          matching threshold.
        </p>

      </div>
    `;

  } else {

    /*
     * ---------------------------------------------------------
     * POSSIBLE HIGH MATCH SUMMARY
     * ---------------------------------------------------------
     *
     * 80%+ is treated as a UI high-match threshold.
     * This is NOT model accuracy.
     *
     * The admin sees exactly:
     *
     * Lost item -> Found item -> Score
     */

    const highMatches =
      matches
        .filter(match => effectiveCandidateScore(match) >= 80)
        .map(match => {

          const lostItem =
            match?.lostItem || {};

          return {
            lostName:
              decodeLegacyHtmlEntities(lostItem.name || lostItem.itemName || 'Unnamed lost item'),

            foundName:
              decodeLegacyHtmlEntities(foundItem.name || foundItem.itemName || 'Unnamed found item'),

            score: effectiveCandidateScore(match)
          };
        });

    const highMatchSummary =
      highMatches.length
        ? `
          <section
            style="
              margin-bottom:18px;
              padding:16px;
              border-radius:14px;
              border:1px solid rgba(16,185,129,.25);
              background:rgba(16,185,129,.06);
            "
          >

            <div
              style="
                font-weight:800;
                font-size:15px;
                margin-bottom:10px;
              "
            >
              🔥 Possible High Matches
            </div>

            <div
              style="
                font-size:12px;
                color:var(--gray3);
                margin-bottom:10px;
              "
            >
              These candidates scored 80% or higher.
            </div>

            ${highMatches.map(match => `
              <div
                style="
                  display:flex;
                  justify-content:space-between;
                  align-items:center;
                  gap:12px;
                  padding:10px 0;
                  border-top:1px solid rgba(0,0,0,.07);
                "
              >

                <div>

                  <strong>
                    ${escapeHtml(match.lostName)}
                  </strong>

                  <span
                    style="
                      margin:0 7px;
                      font-size:16px;
                    "
                  >
                    →
                  </span>

                  <strong>
                    ${escapeHtml(match.foundName)}
                  </strong>

                </div>

                <span
                  style="
                    font-weight:800;
                    white-space:nowrap;
                  "
                >
                  ${match.score}%
                </span>

              </div>
            `).join('')}

          </section>
        `
        : '';

    body.innerHTML =
      highMatchSummary +
      matches.map(m => {

        const l =
          m.lostItem || {};

        const b =
          m.breakdown || {};

        /*
         * ───────────────────────────────────────
         * NLP
         * ───────────────────────────────────────
         */
        const nlpScore =
          m.pythonNlpScore ??
          m.nlpSimilarity ??
          m.nlpSimilarityPercentage ??
          m.nlp_similarity ??
          b.nlpSimilarity ??
          b.nlp_similarity ??
          b.nlp ??
          null;

        /*
         * ───────────────────────────────────────
         * CNN
         * ───────────────────────────────────────
         */
        const imageScore =
          m.imageSimilarityPercentage ??
          m.imageSimilarity ??
          m.image_similarity ??
          m.cnnSimilarityPercentage ??
          b.cnnSimilarityPercentage ??
          null;

        /*
         * ───────────────────────────────────────
         * PROPERTIES
         * ───────────────────────────────────────
         */
        const propertyScore =
          m.propertySimilarity ??
          m.propertyScore ??
          m.property_score ??
          null;

        /*
         * ───────────────────────────────────────
         * LOCATION
         * ───────────────────────────────────────
         */
        const locationSimilarity =
          m.locationSimilarityPercentage ??
          m.locationSimilarity ??
          b.locationSimilarity ??
          null;

        const locationBreakdown =
          m.locationBreakdown ||
          {};

        const locationRelation =
          m.locationRelation ||
          locationBreakdown.relation ||
          null;

        const sameLandmark =
          Boolean(
            m.sameLocationLandmark ??
            locationBreakdown.sameLandmark ??
            false
          );

        const specificSubLocation =
          Boolean(
            m.locationSpecificSubLocation ??
            locationBreakdown.specificSubLocation ??
            false
          );

        const locationExplanation =
          m.locationExplanation ||
          locationBreakdown.explanation ||
          '';

        /*
         * ───────────────────────────────────────
         * MATCH EVIDENCE
         * ───────────────────────────────────────
         *
         * These MUST match W in
         * matchingServiceCompat.js:
         *
         * category    = 20
         * name        = 15
         * description = 20
         * location    = 10
         * date        = 10
         * properties  = 10
         * imageLabels = 5
         * cnnImage    = 10
         */
        const categoryScore =
          Number(
            b.category ?? 0
          );

        const nameScore =
          Number(
            b.nameText ??
            b.name ??
            0
          );

        const descriptionScore =
          Number(
            b.description ??
            0
          );

        const locationScore =
          Number(
            b.location ??
            0
          );

        const dateScore =
          Number(
            b.date ??
            0
          );

        const propertyContribution =
          Number(
            b.properties ??
            m.contribution?.properties ??
            0
          );

        const imageLabelContribution =
          Number(
            b.imageLabels ??
            0
          );

        const cnnContribution =
          Number(
            m.contribution?.cnnImage ??
            b.cnnImage ??
            0
          );

        const audit = m.scoreAudit || {};
        const auditNum = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
        const componentSubtotal = [categoryScore, nameScore, descriptionScore, locationScore, dateScore, propertyContribution, imageLabelContribution, cnnContribution].reduce((sum, value) => sum + value, 0);
        const capReasons = Array.isArray(audit.recommendedScoreCapReasons)
          ? audit.recommendedScoreCapReasons.filter(Boolean)
          : [];
        const capReasonsHtml = capReasons.length
          ? `<br><strong>Why this score cap applies:</strong><ul style="margin:4px 0 4px 18px;padding:0;">${capReasons.map(reason => `<li>${escapeHtml(decodeLegacyHtmlEntities(String(reason)))}</li>`).join('')}</ul>`
          : '';
        const scoreAuditHtml = `
          <div class="ai-score-help" style="margin-top:10px;padding:10px;border-radius:8px;background:rgba(127,127,127,.08);">
            <strong>Score calculation (audit)</strong><br>
            Evidence components: ${componentSubtotal}/100<br>
            Shared-text boost: +${auditNum(audit.sharedTextBoost)} · Location boost: +${auditNum(audit.locationContextBoost)}<br>
            Visual contradiction penalty: −${auditNum(audit.visualContradictionPenalty)}<br>
            Visual evidence factor: ${audit.visualEvidenceFactor == null ? 'not applied' : `${(auditNum(audit.visualEvidenceFactor) * 100).toFixed(1).replace(/\.0$/, '')}%`}<br>
            Raw score before base policy cap: ${audit.scoreBeforeRecommendedCap == null ? 'not supplied' : Math.round(auditNum(audit.scoreBeforeRecommendedCap))}<br>
            Base matcher score after its cap: ${audit.baseMatcherScoreAfterCap == null ? (audit.advancedScore == null ? 'not supplied' : Math.round(auditNum(audit.advancedScore))) : Math.round(auditNum(audit.baseMatcherScoreAfterCap))}<br>
            External NLP adjustment: ${audit.pythonNlpAdjustment == null ? '0' : (auditNum(audit.pythonNlpAdjustment) > 0 ? '+' : '') + auditNum(audit.pythonNlpAdjustment)}<br>
            Hybrid pre-final-cap calculation (uncapped base score + NLP adjustment): ${audit.scoreBeforeRecommendedCap == null ? 'not supplied' : Math.round(auditNum(audit.scoreBeforeRecommendedCap))} ${auditNum(audit.pythonNlpAdjustment ?? 0) >= 0 ? '+' : '−'} ${Math.abs(auditNum(audit.pythonNlpAdjustment ?? 0))} = ${audit.scoreBeforeFinalCap == null ? 'not supplied' : Math.round(auditNum(audit.scoreBeforeFinalCap))}<br>
            <span class="audit-note">The base matcher cap shown above is diagnostic; the hybrid score uses the uncapped base score and applies the final recommended cap to the combined result.</span><br>
            Final recommended cap: ${audit.recommendedScoreCap == null ? 'not supplied' : Math.round(auditNum(audit.recommendedScoreCap))}${capReasonsHtml}<br>
            Final score: ${audit.finalScore == null ? 'not supplied' : Math.round(auditNum(audit.finalScore))}
          </div>`;

        const rawScore = Number(m.score ?? 0);
        // Defensive presentation guard: candidate payloads produced by an
        // older/stale matching module may carry a high score while the
        // evidence shown below reports Object Type = 0% and low-confidence
        // visual predictions. Never render that combination as a high match.
        const scorePropertyBreakdown = m.propertyBreakdown || {};
        const displayedObjectTypeScore = Number(scorePropertyBreakdown.objectType ?? 0);
        const scoreReviewReasons = Array.isArray(m.reviewReasons) ? m.reviewReasons : [];
        const lowConfidenceObjectWarning = Boolean(
          m.reviewRecommended || m.manualReviewRequired ||
          scoreReviewReasons.some(reason => /low-confidence visual object|object type evidence is unresolved|object type similarity is 0/i.test(String(reason)))
        );
        const explicitVisualIdentityWarning = requiresVisualIdentityScoreCap(m);
        const objectTypeScoreCapped = (explicitVisualIdentityWarning ||
          (displayedObjectTypeScore <= 0 && lowConfidenceObjectWarning)) && rawScore > 69;
        const score = objectTypeScoreCapped ? 69 : rawScore;

        /*
         * Confidence is match-engine confidence,
         * NOT experimentally measured accuracy.
         */
        const confidence =
          escapeHtml(
            objectTypeScoreCapped
              ? (score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low')
              : (m.confidence || (score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low'))
          );

        const confidenceClass =
          score >= 75
            ? 'ai-confidence-high'
            : score >= 45
              ? 'ai-confidence-medium'
              : 'ai-confidence-low';

        const nlpDisplay =
          nlpScore !== null
            ? `${Number(
                nlpScore
              ).toFixed(1)}%`
            : 'Not available';

        const hasLostPhoto = Boolean(l.image || l.imageUrl || l.imageURL || l.photo || l.imageData);
        const matchedFoundItem = m.foundItem || foundItem || {};
        const hasFoundPhoto = Boolean(matchedFoundItem.image || matchedFoundItem.imageUrl || matchedFoundItem.imageURL || matchedFoundItem.photo || matchedFoundItem.imageData);
        const imageDisplay = imageScore !== null && imageScore !== undefined
          ? `${Number(imageScore).toFixed(1)}%`
          : !hasLostPhoto && !hasFoundPhoto
            ? 'No photos provided'
            : !hasLostPhoto
              ? 'No photo on lost report'
              : !hasFoundPhoto
                ? 'No photo on found report'
                : 'Image similarity unavailable';

        const propertyDisplay =
          propertyScore !== null
            ? `${Number(
                propertyScore
              ).toFixed(1)}%`
            : 'Calculated from fields';

        const locationDisplay =
          locationSimilarity !== null
            ? `${Number(
                locationSimilarity
              ).toFixed(1)}%`
            : 'Not available';

        const description =
          l.desc ||
          l.description ||
          'No description provided.';

        const reasons =
          Array.isArray(
            m.reasons
          )
            ? m.reasons
            : [];

        const reviewRecommended = Boolean(
          m.reviewRecommended || m.manualReviewRequired
        );
        const eligibleForConfirmation = String(foundItem.status || '').toLowerCase() === 'received_by_admin' &&
          m.eligibleForConfirmation !== false &&
          m.hardConflictCandidate !== true &&
          m.identityConflict !== true &&
          m.objectFamilyConflict !== true &&
          m.objectConflict !== true;
        const reviewReasons = Array.isArray(m.reviewReasons)
          ? m.reviewReasons
          : [];

        // The banner already summarizes review reasons. Suppress duplicate
        // warning entries in the detailed evidence list while retaining the
        // distinct AI-estimated-color explanation and actual visual metrics.
        const reviewWarningKinds = new Set();
        for (const reviewReason of reviewReasons) {
          const warningText = String(reviewReason || '').toLowerCase();
          if (/primary color|color differs|color conflict|colour difference/.test(warningText)) reviewWarningKinds.add('color');
          if (/low combined text similarity|low text similarity/.test(warningText)) reviewWarningKinds.add('text');
          if (/low-confidence visual object|visual object prediction/.test(warningText)) reviewWarningKinds.add('object-confidence');
          if (/scratch-like mark|scratch screening/.test(warningText)) reviewWarningKinds.add('scratch');
        }
        const evidenceReasons = reasons.filter(reason => {
          const reasonText = decodeLegacyHtmlEntities(String(reason || '')).toLowerCase();
          if (reviewWarningKinds.has('color') && /primary color differs|primary colour differs/.test(reasonText)) return false;
          if (reviewWarningKinds.has('text') && /low combined text similarity|low text similarity/.test(reasonText)) return false;
          if (reviewWarningKinds.has('object-confidence') && /low-confidence visual object prediction/.test(reasonText)) return false;
          if (reviewWarningKinds.has('scratch') && /scratch-like mark screening:/.test(reasonText)) return false;
          return true;
        });

        const scoreCap = Number(m.recommendedScoreCap);
        // Do not display a stale 69% cap supplied by an older matcher when the
        // only remaining issue is low classifier confidence and measured
        // object-type evidence is positive. Keep unrelated caps (e.g. weak
        // text or color conflicts) visible when they actually constrain score.
        const staleVisualOnlyCap = displayedObjectTypeScore > 0 &&
          !explicitVisualIdentityWarning &&
          scoreReviewReasons.some(reason => /low-confidence visual object/i.test(String(reason))) &&
          Number.isFinite(scoreCap) && scoreCap <= 69 && rawScore <= 69;
        const effectiveScoreCap = objectTypeScoreCapped
          ? Math.min(Number.isFinite(scoreCap) ? scoreCap : 100, 69)
          : staleVisualOnlyCap ? 100 : scoreCap;
        const scoreCapReasons = Array.isArray(m.scoreAudit?.recommendedScoreCapReasons)
          ? m.scoreAudit.recommendedScoreCapReasons.filter(Boolean)
          : [];
        const scoreCapHtml = Number.isFinite(effectiveScoreCap) && effectiveScoreCap < 100
          ? `<div style="margin-top:6px;font-size:12px;"><strong>Score limit applied:</strong> maximum candidate score ${effectiveScoreCap}%. ${scoreCapReasons.length ? scoreCapReasons.map(reason => escapeHtml(decodeLegacyHtmlEntities(String(reason)))).join(' ') : 'The matcher applied a conservative evidence-based score limit.'}</div>`
          : '';
        const reviewBannerHtml = reviewRecommended
          ? `
            <div role="status" style="margin:12px 0;padding:12px 14px;border:1px solid #eab308;border-radius:10px;background:rgba(234,179,8,.10);color:var(--text-color,#713f12);">
              <strong>⚠ Manual review recommended</strong>
              <div style="margin-top:4px;font-size:13px;">Some evidence is uncertain or inconsistent. Compare the original photos and report details; image similarity alone does not prove these are the same physical item.</div>
              ${reviewReasons.length ? `<ul style="margin:6px 0 0 18px;padding:0;">${reviewReasons.map(reason => `<li>${escapeHtml(decodeLegacyHtmlEntities(String(reason)))}</li>`).join('')}</ul>` : ''}
              ${scoreCapHtml}
            </div>
          `
          : '';

        /*
         * ───────────────────────────────────────
         * LOCATION LABEL
         * ───────────────────────────────────────
         */
        let locationTitle =
          'Location Context';

        let locationBadge =
          '';

        if (
          locationRelation ===
          'same_landmark_specific_found'
        ) {
          locationBadge =
            '🟢 Same landmark — found location is more specific';
        } else if (
          locationRelation ===
          'same_landmark_specific_lost'
        ) {
          locationBadge =
            '🟢 Same landmark — lost location is more specific';
        } else if (
          locationRelation ===
          'same_location_phrase'
        ) {
          locationBadge =
            '🟢 Same location context';
        } else if (
          sameLandmark
        ) {
          locationBadge =
            '🟢 Same landmark';
        } else if (
          Number(
            locationSimilarity || 0
          ) >= 50
        ) {
          locationBadge =
            '🟡 Similar location context';
        } else {
          locationBadge =
            '⚪ Limited location evidence';
        }

        /*
         * ───────────────────────────────────────
         * LOCATION EXPLANATION
         * ───────────────────────────────────────
         */
        const lostLocation =
          l.location ||
          l.lastSeenLocation ||
          '';

        /*
         * Found item isn't inside lostItem.
         * Backend currently sends lostItem only,
         * therefore get the found location from the
         * match when available.
         */
        const foundLocation =
          m.foundItem?.location ||
          m.foundItem?.foundLocation ||
          m.foundLocation ||
          '';

        const locationExplanationHtml =
          locationSimilarity !== null
            ? `
              <div class="
                ai-location-context
              ">

                <div class="
                  ai-location-context-header
                ">

                  <div>
                    <div class="
                      ai-location-title
                    ">
                      📍 ${locationTitle}
                    </div>

                    <div class="
                      ai-location-score
                    ">
                      ${locationDisplay}
                      <span>
                        semantic similarity
                      </span>
                    </div>
                  </div>

                  <div class="
                    ai-location-badge
                  ">
                    ${escapeHtml(
                      locationBadge
                    )}
                  </div>

                </div>

                ${
                  lostLocation
                    ? `
                      <div class="
                        ai-location-line
                      ">
                        <span>
                          Lost:
                        </span>

                        <strong>
                          ${escapeHtml(
                            lostLocation
                          )}
                        </strong>
                      </div>
                    `
                    : ''
                }

                ${
                  foundLocation
                    ? `
                      <div class="
                        ai-location-line
                      ">
                        <span>
                          Found:
                        </span>

                        <strong>
                          ${escapeHtml(
                            foundLocation
                          )}
                        </strong>
                      </div>
                    `
                    : ''
                }

                ${
                  locationExplanation
                    ? `
                      <div class="
                        ai-location-explanation
                      ">
                        ${escapeHtml(
                          locationExplanation
                        )}
                      </div>
                    `
                    : `
                      <div class="
                        ai-location-explanation
                      ">
                        The matching engine compares
                        the landmark and contextual
                        location terms rather than
                        requiring exact wording.
                      </div>
                    `
                }

                ${
                  sameLandmark
                    ? `
                      <div class="
                        ai-location-evidence
                      ">
                        <span>✓</span>
                        Same broad landmark detected
                      </div>
                    `
                    : ''
                }

                ${
                  specificSubLocation
                    ? `
                      <div class="
                        ai-location-evidence
                      ">
                        <span>✓</span>
                        Compatible specific
                        sub-location detected
                      </div>
                    `
                    : ''
                }

              </div>
            `
            : '';

        /*
         * ───────────────────────────────────────
         * PROPERTY DETAILS
         * ───────────────────────────────────────
         */
        const propertyBreakdown =
          m.propertyBreakdown ||
          {};

        const colorProperty =
          Number(
            propertyBreakdown.color ||
            0
          );

        const brandProperty =
          Number(
            propertyBreakdown.brand ||
            0
          );

        const objectProperty =
          Number(
            propertyBreakdown.objectType ||
            0
          );

        const featureProperty =
          Number(
            propertyBreakdown.distinctiveFeatures ||
            0
          );

        return `
          <article
            class="ai-match-card"
          >

            <!-- LOST -> FOUND RELATIONSHIP -->
            <div
              style="
                margin-bottom:14px;
                padding:12px 14px;
                border-radius:12px;
                background:rgba(15,23,42,.04);
                border:1px solid rgba(15,23,42,.08);
              "
            >

              <div
                style="
                  font-size:11px;
                  font-weight:800;
                  text-transform:uppercase;
                  letter-spacing:.05em;
                  color:var(--gray3);
                  margin-bottom:8px;
                "
              >
                🔗 Match Relationship
              </div>

              <div
                style="
                  display:flex;
                  align-items:center;
                  flex-wrap:wrap;
                  gap:8px;
                  font-size:14px;
                "
              >

                <span>
                  🔴
                  <strong>Lost:</strong>
                  ${escapeHtml(decodeLegacyHtmlEntities(
                    l.name ||
                    l.itemName ||
                    'Unnamed lost item'
                  ))}
                </span>

                <span
                  style="
                    font-size:18px;
                    font-weight:700;
                  "
                >
                  →
                </span>

                <span>
                  🟢
                  <strong>Possible Found:</strong>
                  ${escapeHtml(decodeLegacyHtmlEntities(
                    foundItem.name ||
                    foundItem.itemName ||
                    'Unnamed found item'
                  ))}
                </span>

              </div>

            </div>

            ${reviewBannerHtml}

            <!-- HEADER -->
            <div class="
              ai-match-card-header
            ">

              <div class="
                ai-match-card-title-area
              ">

                <h4 class="
                  ai-match-title
                ">
                  ${escapeHtml(decodeLegacyHtmlEntities(
                    l.name ||
                    l.itemName ||
                    'Unnamed lost item'
                  ))}
                </h4>

                <div class="
                  ai-match-description
                ">
                  ${escapeHtml(decodeLegacyHtmlEntities(
                    description.slice(
                      0,
                      300
                    )
                  ))}
                </div>

              </div>

              <div class="
                ai-match-score-area
              ">

                <div class="
                  ai-match-score
                ">
                  ${score}%
                </div>

                <span class="
                  ai-confidence
                  ${confidenceClass}
                ">
                  ${confidence}
                </span>

              </div>

            </div>


            <!-- AI SCORES -->
            <div class="
              ai-match-ai-scores
            ">

              <div class="
                ai-score-box
              ">

                <div class="
                  ai-score-label
                ">
                  🧠 NLP
                </div>

                <div class="
                  ai-score-value
                ">
                  ${nlpDisplay}
                </div>

                <div class="
                  ai-score-help
                ">
                  NLP model similarity (separate from combined text score)
                </div>

              </div>


              <div class="
                ai-score-box
              ">

                <div class="
                  ai-score-label
                ">
                  👁️ CNN / CV
                </div>

                <div class="
                  ai-score-value
                ">
                  ${imageDisplay}
                </div>

                <div class="
                  ai-score-help
                ">
                  Visual feature similarity; not proof of item identity
                </div>

              </div>


              <div class="
                ai-score-box
              ">

                <div class="
                  ai-score-label
                ">
                  📦 Properties
                </div>

                <div class="
                  ai-score-value
                ">
                  ${propertyDisplay}
                </div>

                <div class="
                  ai-score-help
                ">
                  Object attributes
                </div>

              </div>

            </div>


            <!-- LOCATION CONTEXT -->
            ${locationExplanationHtml}


            <!-- PROPERTY BREAKDOWN -->
            <div class="
              ai-breakdown-title
            ">
              Match Evidence
            </div>


            <div class="
              ai-match-row
            ">

              <span>
                📦 Category
                <strong>
                  ${categoryScore}/20
                </strong>
              </span>

              <span>
                🏷️ Name
                <strong>
                  ${nameScore}/15
                </strong>
              </span>

              <span>
                📝 Description
                <strong>
                  ${descriptionScore}/20
                </strong>
              </span>

              <span>
                📍 Location
                <strong>
                  ${locationScore}/10
                </strong>
              </span>

              <span>
                📅 Date
                <strong>
                  ${dateScore}/10
                </strong>
              </span>

              <span>
                📦 Properties
                <strong>
                  ${propertyContribution}/10
                </strong>
              </span>

              <span>
                🏷️ Image Labels
                <strong>
                  ${imageLabelContribution}/5
                </strong>
              </span>

              <span>
                🖼️ CNN Image
                <strong>
                  ${cnnContribution}/10
                </strong>
              </span>

            </div>

            ${scoreAuditHtml}

            <!-- PROPERTY DETAILS -->
            ${
              (
                colorProperty ||
                brandProperty ||
                objectProperty ||
                featureProperty
              )
                ? `
                  <div class="
                    ai-property-details
                  ">

                    <div class="
                      ai-breakdown-title
                    ">
                      📦 Object Property Evidence
                    </div>

                    <div class="
                      ai-property-grid
                    ">

                      <div>
                        <span>
                          Color
                        </span>

                        <strong>
                          ${colorProperty}%
                        </strong>
                      </div>

                      <div>
                        <span>
                          Brand
                        </span>

                        <strong>
                          ${brandProperty}%
                        </strong>
                      </div>

                      <div>
                        <span>
                          Object Type
                        </span>

                        <strong>
                          ${objectProperty}%
                        </strong>
                      </div>

                      <div>
                        <span>
                          Features
                        </span>

                        <strong>
                          ${featureProperty}%
                        </strong>
                      </div>

                    </div>

                  </div>
                `
                : ''
            }


            <!-- REASONS -->
            <div class="
              ai-match-reasons
            ">

              <div class="
                ai-reasons-title
              ">
                Why this is a candidate
              </div>

              ${
                evidenceReasons.length
                  ? evidenceReasons
                      .map(
                        reason => {
                          const reasonText = decodeLegacyHtmlEntities(String(reason));
                          const isWarning = /\bwarning\b|low[- ]confidence|low (?:combined )?text similarity|text similarity.*manual review|color difference|color:.*\bvs\b|conflict|contradict|visual difference|mismatch|differs|unconfirmed|insufficient confidence|review required|manual review|heuristic|unresolved|score capped|cannot confirm|not proof/i.test(reasonText);
                          const isVisualMetric = /visual ai similarity|mobilenetv2 visual similarity|clip visual similarity|fine visual detail similarity|ai shape similarity|ai colour structure similarity|ai local.region similarity|ai foreground geometry similarity/i.test(reasonText);
                          const reasonClass = isWarning ? 'ai-reason-warning' : isVisualMetric ? 'ai-reason-muted' : '';

                          return `
                            <div class="ai-reason ${reasonClass}">
                              <span class="ai-reason-check">
                                ${isWarning ? '⚠' : isVisualMetric ? 'ℹ' : '✓'}
                              </span>

                              <span>
                                ${escapeHtml(reasonText)}
                              </span>
                            </div>
                          `;
                        }
                      )
                      .join('')
                  : `
                    <div class="
                      ai-reason
                      ai-reason-muted
                    ">
                      No additional explanation
                      was returned by the matching
                      engine.
                    </div>
                  `
              }

            </div>


            <!-- ACTION -->
            <div class="
              ai-match-actions
            ">

              <button
                type="button"
                class="btn ${eligibleForConfirmation ? 'btn-success' : 'btn-secondary'} ai-confirm-btn"
                ${eligibleForConfirmation ? '' : 'disabled aria-disabled="true" title="A hard identity/object conflict must be resolved before confirmation."'}
                ${eligibleForConfirmation ? `onclick="confirmAIMatch('${escapeHtml(foundId)}','${escapeHtml(l.id)}')"` : ''}
              >
                ${eligibleForConfirmation ? '✓ Confirm Match' : '⚠ Review only — cannot confirm'}
              </button>

            </div>

          </article>
        `;

      }).join('');
  }

  if (String(foundItem.status || '').toLowerCase() !== 'received_by_admin' &&
      String(foundItem.status || '').toLowerCase() !== 'matched') {
    body.insertAdjacentHTML('afterbegin', `
      <div role="status" class="ai-receipt-required" style="margin:0 0 14px;padding:12px 14px;border:1px solid #eab308;border-radius:10px;background:rgba(234,179,8,.10);">
        <strong>📥 Physical receipt required</strong>
        <p style="margin:5px 0 10px;">The admin office must record physical receipt before confirming a match.</p>
        <button type="button" class="btn btn-primary" onclick="receiveFoundItem('${escapeHtml(foundId)}')">Record Receipt</button>
      </div>
    `);
  }

  /*
   * Open modal.
   */
  modal.classList.add(
    'show'
  );

  modal.style.display =
    'flex';

  modal.setAttribute(
    'aria-hidden',
    'false'
  );

  /*
   * Prevent background scrolling
   * while AI modal is open.
   */
  document.body.style.overflow =
    'hidden';
}


// ═══════════════════════════════════════════════════════════════════════
// CLOSE AI MODAL
// ═══════════════════════════════════════════════════════════════════════

function closeAIMatchModal() {
  const modal =
    document.getElementById(
      'ai-match-modal'
    );

  if (!modal) {
    return;
  }

  modal.classList.remove(
    'show'
  );

  modal.style.display =
    'none';

  modal.setAttribute(
    'aria-hidden',
    'true'
  );

  /*
   * Restore page scrolling.
   */
  document.body.style.overflow =
    '';
}


// ═══════════════════════════════════════════════════════════════════════
// ESCAPE KEY
// ═══════════════════════════════════════════════════════════════════════

if (
  !window.__traceMateAIModalEscapeBound
) {
  window.__traceMateAIModalEscapeBound =
    true;

  document.addEventListener(
    'keydown',
    event => {
      if (
        event.key !== 'Escape'
      ) {
        return;
      }

      const modal =
        document.getElementById(
          'ai-match-modal'
        );

      if (
        modal &&
        modal.style.display !== 'none'
      ) {
        closeAIMatchModal();
      }
    }
  );
}


// ═══════════════════════════════════════════════════════════════════════
// CONFIRM AI MATCH
// ═══════════════════════════════════════════════════════════════════════

async function confirmAIMatch(
  foundId,
  lostId
) {
  const foundItem = (DB.get('found_items') || []).find(
    item => String(item.id) === String(foundId)
  );
  const foundStatus = String(
    (foundItem && foundItem.status) || window.__traceMateCurrentFoundItemStatus || ''
  ).toLowerCase();
  if (foundStatus !== 'received_by_admin') {
    toast('Record physical receipt of the found item before confirming a match.', 'error');
    return;
  }

  if (
    !confirm(
      'Confirm this match? The owner will be notified to collect the item from the Admin Office.'
    )
  ) {
    return;
  }

  try {
    await adminApi(
      '/api/matches/admin/confirm',
      {
        method: 'POST',

        body: JSON.stringify({
          foundItemId:
            foundId,

          lostItemId:
            lostId
        })
      }
    );

    closeAIMatchModal();

    toast(
      'Match confirmed. Owner has been notified.',
      'success'
    );

    await renderAdminAIWorkflow();

    renderAdmin();

  } catch (err) {
    toast(
      err.message,
      'error'
    );
  }
}


// ═══════════════════════════════════════════════════════════════════════
// RETURN MATCHED ITEM
// ═══════════════════════════════════════════════════════════════════════

async function returnMatchedItem(foundId) {
  const foundItem = (DB.get('found_items') || []).find(item => String(item.id) === String(foundId));
  if (!foundItem || !foundItem.matchedLostItemId) {
    toast('This item does not have a confirmed lost-item match.', 'error');
    return;
  }
  const lostItem = (DB.get('lost_items') || []).find(item => String(item.id) === String(foundItem.matchedLostItemId));
  const owner = lostItem ? (DB.get('users') || []).find(user => String(user.id) === String(lostItem.userId)) : null;
  const ownerEmail = String(owner?.email || '').trim();
  const ownerName = String(owner?.name || owner?.fullName || 'Registered owner').trim();
  const details = `Return “${foundItem.name || 'Found item'}” to ${ownerName}${ownerEmail ? ` (${ownerEmail})` : ''}.\n\nConfirm that you have checked the person's identity in person and that this is the correct owner.`;
  if (!confirm(details)) return;

  const enteredNotes = prompt('Collection note (optional):\nExample: Collected at Admin Office; item condition checked. Leave blank if not needed.', '');
  if (enteredNotes === null) return;

  try {
    await adminApi('/api/matches/admin/return', {
      method: 'POST',
      body: JSON.stringify({ foundItemId: foundId, notes: enteredNotes.trim() })
    });
    closeAIMatchModal();
    toast('Item marked as returned to the verified owner.', 'success');
    await renderAdminAIWorkflow();
    renderAdmin();
  } catch (err) {
    toast(err.message || 'Could not record item return.', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// ADMIN RENDER WRAPPER
// ═══════════════════════════════════════════════════════════════════════

const _originalRenderAdmin =
  renderAdmin;

renderAdmin = function() {
  _originalRenderAdmin();

  Promise.resolve(
    renderAdminAIWorkflow()
  ).catch(err => {
    console.warn(
      'Admin AI workflow refresh failed:',
      err
    );
  });

  Promise.resolve(
    refreshAdminAIMetrics()
  ).catch(err => {
    console.warn(
      'Admin AI metrics refresh failed:',
      err
    );
  });
};
// ═══════════════════════════════════════════════════════════════════════
// AI ADMIN DASHBOARD METRICS
// ═══════════════════════════════════════════════════════════════════════

async function refreshAdminAIMetrics() {
  try {
    if (
      typeof currentUser === 'undefined' ||
      !currentUser ||
      currentUser.role !== 'admin'
    ) {
      return;
    }

    const foundItems =
      DB.get('found_items') || [];

    const activeFoundItems =
      foundItems.filter(item =>
        [
          'open',
          'received_by_admin',
          'matched'
        ].includes(
          String(item.status || '').toLowerCase()
        )
      );

    let potentialMatches = 0;
    let highConfidenceMatches = 0;

    /*
     * Prevent duplicate counting when the same
     * lost/found pair appears more than once.
     */
    const countedPairs = new Set();

    for (const foundItem of activeFoundItems) {
      try {
        const data = await adminApi(
          `/api/matches/admin/found/${encodeURIComponent(foundItem.id)}`
        );

        const matches =
          Array.isArray(data?.data)
            ? data.data
            : [];

        for (const match of matches) {
          const lostId =
            match?.lostItem?.id ||
            match?.lostItemId ||
            match?.lost_id ||
            '';

          const score =
            Number(
              match?.score ??
              match?.matchScore ??
              match?.aiScore ??
              0
            );

          /*
           * If the backend did not return an ID,
           * do not count the candidate because
           * we cannot safely deduplicate it.
           */
          if (!lostId) {
            continue;
          }

          const pairKey =
            `${foundItem.id}::${lostId}`;

          if (countedPairs.has(pairKey)) {
            continue;
          }

          countedPairs.add(pairKey);

          /*
           * 60+ = potential candidate
           * 80+ = high-confidence candidate
           *
           * These are UI thresholds, NOT measured
           * model accuracy.
           */
          if (score >= 60) {
            potentialMatches++;
          }

          if (score >= 80) {
            highConfidenceMatches++;
          }
        }
      } catch (err) {
        console.warn(
          'Could not calculate AI metrics for found item:',
          foundItem.id,
          err
        );
      }
    }

    const setMetric = (
      id,
      value
    ) => {
      const element =
        document.getElementById(id);

      if (element) {
        element.textContent =
          String(value);
      }
    };

    setMetric(
      'admin-ai-match-count',
      potentialMatches
    );

    setMetric(
      'admin-high-match-count',
      highConfidenceMatches
    );

    /* =========================================================
   TRACEMATE ADMIN AI MODAL - ROBUST BUTTON HANDLERS
   =========================================================
 *
 * This block makes the dynamically-created AI modal buttons
 * work reliably even when the modal is recreated.
 *
 * It specifically fixes:
 *   - ✖ Close button
 *   - backdrop click
 *   - Escape key
 *   - View AI Matches
 *   - I Received This Item
 *   - Confirm Match
 *   - Return to Owner
 *
 * It does NOT replace the existing matching engine.
 */

/* ---------------------------------------------------------
   EXPOSE AI FUNCTIONS GLOBALLY
   --------------------------------------------------------- */

window.showAIMatches =
  showAIMatches;

window.showAIMatchModal =
  showAIMatchModal;

window.closeAIMatchModal =
  closeAIMatchModal;

window.receiveFoundItem =
  receiveFoundItem;

window.confirmAIMatch =
  confirmAIMatch;

window.returnMatchedItem =
  returnMatchedItem;


/* ---------------------------------------------------------
   ROBUST AI MODAL CLICK HANDLER
   --------------------------------------------------------- */

if (
  !window.__traceMateAIModalClickBound
) {
  window.__traceMateAIModalClickBound =
    true;

  document.addEventListener(
    'click',
    function(event) {

      /*
       * CLOSE BUTTON
       *
       * Works for:
       *   [data-ai-close]
       *   .modal-close
       *   #ai-match-modal .modal-close
       */
      const closeButton =
        event.target.closest(
          '#ai-match-modal [data-ai-close], ' +
          '#ai-match-modal .modal-close'
        );

      if (closeButton) {

        event.preventDefault();
        event.stopPropagation();

        closeAIMatchModal();

        return;
      }


      /*
       * BACKDROP CLICK
       *
       * Only close when the actual overlay is clicked.
       * Clicking inside the modal does not close it.
       */
      const modal =
        document.getElementById(
          'ai-match-modal'
        );

      if (
        modal &&
        event.target === modal
      ) {

        event.preventDefault();

        closeAIMatchModal();

        return;
      }

    },
    true
  );
}


/* ---------------------------------------------------------
   FORCE THE AI CLOSE BUTTON TO BE CLICKABLE
   --------------------------------------------------------- */

function ensureAIModalCloseButton() {

  const modal =
    document.getElementById(
      'ai-match-modal'
    );

  if (!modal) {
    return;
  }

  const closeButton =
    modal.querySelector(
      '[data-ai-close], .modal-close'
    );

  if (!closeButton) {
    return;
  }

  closeButton.type =
    'button';

  closeButton.setAttribute(
    'aria-label',
    'Close AI match modal'
  );

  closeButton.style.pointerEvents =
    'auto';

  closeButton.style.cursor =
    'pointer';

  closeButton.style.position =
    'relative';

  closeButton.style.zIndex =
    '10001';
}


/* ---------------------------------------------------------
   OBSERVE AND REPAIR AI MODAL TEXT ENTITIES
   --------------------------------------------------------- */

// Decode legacy entity-encoded strings in text nodes only. The decoded value
// is assigned to nodeValue, never parsed as HTML, so user content stays inert.
function repairAIModalTextEntities() {
  const modal = document.getElementById('ai-match-modal');
  if (!modal) return;

  if (typeof ensureAIModalCloseButton === 'function') {
    ensureAIModalCloseButton();
  }

  const decodeVisibleText = (input) => {
    let value = String(input ?? '');
    const decoder = document.createElement('textarea');
    for (let pass = 0; pass < 12; pass += 1) {
      decoder.innerHTML = value;
      const next = decoder.value;
      if (next === value) break;
      value = next;
    }
    return value;
  };

  const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const textNode of textNodes) {
    const decoded = decodeVisibleText(textNode.nodeValue);
    if (decoded !== textNode.nodeValue) {
      textNode.nodeValue = decoded;
    }
  }
}

if (!window.__traceMateAIModalObserverBound) {
  window.__traceMateAIModalObserverBound = true;

  const aiModalObserver = new MutationObserver(() => {
    repairAIModalTextEntities();
  });

  // Observe dynamic content updates and run an initial pass as well. The
  // initial pass is important when the modal exists before this script loads
  // and is merely shown later without any child-list mutation.
  if (document.body) {
    aiModalObserver.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
  repairAIModalTextEntities();
}




/* ---------------------------------------------------------
   KEEP ORIGINAL FUNCTION REFERENCES AVAILABLE
   --------------------------------------------------------- */

window.showAIMatches =
  showAIMatches;

window.closeAIMatchModal =
  closeAIMatchModal;

window.receiveFoundItem =
  receiveFoundItem;

window.confirmAIMatch =
  confirmAIMatch;

window.returnMatchedItem =
  returnMatchedItem;

    /*
     * Keep the existing secondary counters
     * synchronized with the local database.
     */
    setMetric(
      'admin-ai-lost-count',
      (DB.get('lost_items') || []).length
    );

    setMetric(
      'admin-ai-found-count',
      foundItems.length
    );

  } catch (err) {
    console.warn(
      'AI admin metrics refresh failed:',
      err
    );
  }
}
