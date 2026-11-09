/* TraceMate AI Match modal entity repair (v26)
 * Repairs legacy-encoded text only; decoded strings are assigned as text nodes,
 * never interpreted as HTML. This is intentionally separate from admin.js so
 * it also repairs content inserted by later async render paths.
 */
(function () {
  'use strict';

  const MODAL_ID = 'ai-match-modal';
  const MAX_PASSES = 12;

  function decodeEntities(input) {
    let value = String(input == null ? '' : input);
    const textarea = document.createElement('textarea');
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      textarea.innerHTML = value;
      const next = textarea.value;
      if (next === value) break;
      value = next;
    }
    return value;
  }

  function repairModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return 0;
    let changed = 0;
    const walker = document.createTreeWalker(modal, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const before = node.nodeValue || '';
      const after = decodeEntities(before);
      if (after !== before) {
        node.nodeValue = after;
        changed += 1;
      }
    }
    return changed;
  }

  function install() {
    // Run immediately and on later mutations, including text-only updates.
    repairModal();
    if (document.body && !window.__traceMateEntityRepairV26) {
      window.__traceMateEntityRepairV26 = true;
      const observer = new MutationObserver(function () {
        repairModal();
      });
      observer.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true
      });
      // Repair once more after the current render cycle.
      Promise.resolve().then(repairModal);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }

  // The modal may be populated by a later asynchronous request without
  // replacing its outer element. Re-run after the common open/render actions.
  document.addEventListener('click', function (event) {
    if (event.target && event.target.closest && event.target.closest('[onclick*="showAIMatches"], [data-action*="ai-match"]')) {
      Promise.resolve().then(repairModal);
    }
  }, true);

  window.repairTraceMateAIModalEntities = repairModal;
})();
