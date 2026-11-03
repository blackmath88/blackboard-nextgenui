'use strict';
let overviewSig = '', workspaceKeysLoaded = false;
function renderWorkspace() {
  const panel = document.getElementById('overview-items');
  const view = location.hash.match(/^#knowledge-(summary|index|kanban)$/)?.[1] || 'index';
  const sig = JSON.stringify([state.items, state.stateRev, view]);
  if (sig !== overviewSig) {
    const focused = panel.contains(document.activeElement) ? document.activeElement.closest('[data-id]')?.dataset.id : null;
    overviewSig = sig; panel.textContent = '';
    const accepted = (state.items || []).filter(i => statusOf(i) === 'confirmed');
    const proposed = (state.items || []).filter(i => statusOf(i) === 'proposed');
    document.querySelectorAll('[data-knowledge-view]').forEach(a => a.setAttribute('aria-current', a.dataset.knowledgeView === view ? 'page' : 'false'));
    const note = document.createElement('p');
    note.textContent = `${accepted.length} accepted · ${proposed.length} awaiting review · revision ${state.stateRev ?? 0}`;
    panel.append(note);
    const section = (title, items, moves = false) => {
      const box = document.createElement('section'), h = document.createElement('h3');
      h.textContent = title; box.append(h);
      for (const item of items) {
        const card = itemCard(item);
        card.dataset.reviewRev = state.stateRev;
        if (item.quote) {
          const quote = document.createElement('blockquote'); quote.textContent = item.quote; card.append(quote);
        }
        if (moves) {
          const label = document.createElement('label'); label.textContent = 'Stage ';
          const select = document.createElement('select'); select.setAttribute('aria-label', `Stage for ${item.id}`);
          for (const col of COLS) { const option = document.createElement('option'); option.value = col; option.textContent = col; select.append(option); }
          select.value = item.column || 'todo';
          const rev = state.stateRev;
          select.addEventListener('click', e => e.stopPropagation());
          select.addEventListener('change', async () => {
            select.disabled = true;
            try {
              const res = await fetch('/move', { method: 'POST', headers: hdrs(), body: JSON.stringify({ itemId: item.id, column: select.value, rev }) });
              if (!res.ok) await writeFailed(res);
              await loadState();
            } catch (e) { showFlash(e.message); }
            finally { select.disabled = false; }
          });
          label.append(select); card.append(label);
        }
        box.append(card);
      }
      if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'None yet'; box.append(empty); }
      panel.append(box);
    };
    if (view === 'summary') {
      const summary = document.createElement('p');
      summary.textContent = ['decision', 'task', 'source'].map(kind => `${accepted.filter(i => i.kind === kind).length} ${kind}(s)`).join(' · ');
      panel.append(summary);
      section('Accepted decisions', accepted.filter(i => i.kind === 'decision'));
      section('Open tasks', accepted.filter(i => i.kind === 'task' && i.column !== 'done'), true);
    } else if (view === 'kanban') {
      for (const col of COLS) section(col, accepted.filter(i => i.kind === 'task' && (i.column || 'todo') === col), true);
      section('Decisions and sources', accepted.filter(i => i.kind !== 'task'));
    } else {
      for (const [kind, title] of [['decision', 'Accepted decisions'], ['task', 'Accepted tasks'], ['source', 'Accepted sources']]) section(title, accepted.filter(i => i.kind === kind));
    }
    section('Review — proposals, not accepted knowledge', proposed);
    if (focused) panel.querySelector(`[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }
  const block = document.getElementById('context-roles'); block.textContent = '';
  for (const [name, role] of Object.entries(state.context?.roles || {})) {
    const p = document.createElement('p'); p.textContent = `${name}: ${role.candidate || 'none'}${role.location ? ` (${role.location})` : ''} — ${role.skipReason || role.sends}`; block.append(p);
  }
  const toggle = document.getElementById('share-board'); toggle.checked = !!state.context?.share?.board;
  document.getElementById('files-section').hidden = !state.project;
  if (state.project && !document.getElementById('file-list').dataset.loaded) loadFiles();
  if (!workspaceKeysLoaded) { workspaceKeysLoaded = true; refreshWorkspaceKeys(); }
}
async function refreshWorkspaceKeys() {
  const res = await fetch('/settings/keys'), out = await res.json();
  document.getElementById('workspace-keys').textContent = res.ok ? out.keys.map(k => `${k.name}: ${k.source === 'env' ? 'from environment' : k.source}`).join(' · ') || 'No keys configured' : out.error;
}
async function loadFiles() {
  const list = document.getElementById('file-list');
  try {
    const res = await fetch('/files'), out = await res.json(); if (!res.ok) throw new Error(out.error);
    list.textContent = ''; list.dataset.loaded = '1';
    for (const name of out.files) {
      const li = document.createElement('li'), button = document.createElement('button'); button.type = 'button'; button.textContent = name;
      button.addEventListener('click', () => openFile(name)); li.append(button); list.append(li);
    }
    if (out.capped) { const li = document.createElement('li'); li.textContent = 'List capped (200 files / depth 3).'; list.append(li); }
  } catch (e) { list.textContent = e.message; }
}
async function openFile(name) {
  try {
    const res = await fetch('/files/read?path=' + encodeURIComponent(name)), out = await res.json(); if (!res.ok) throw new Error(out.error);
    document.getElementById('file-title').textContent = out.name; document.getElementById('file-text').textContent = out.text;
    document.getElementById('file-view').hidden = false; document.getElementById('file-close').focus();
  } catch (e) { showFlash(e.message); }
}
document.getElementById('file-close').addEventListener('click', () => { document.getElementById('file-view').hidden = true; input.focus(); });
document.getElementById('overview-settings').addEventListener('click', openSettings);
document.getElementById('settings').addEventListener('close', () => refreshWorkspaceKeys().catch(() => {}));
document.getElementById('share-board').addEventListener('change', async e => { await runCommand('/context share board ' + (e.target.checked ? 'on' : 'off')); });

window.addEventListener('hashchange', renderWorkspace);
