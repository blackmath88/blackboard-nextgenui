'use strict';
let overviewSig = '', contextSig = '', recoverySig = '', workspaceKeysLoaded = false;
function showSurface(surface, focus = false) {
  document.body.dataset.surface = surface;
  document.getElementById('show-conversation').setAttribute('aria-pressed', String(surface === 'conversation'));
  document.getElementById('show-knowledge').setAttribute('aria-pressed', String(surface === 'knowledge'));
  if (focus) (surface === 'conversation' ? input : document.querySelector('[data-knowledge-view][aria-current="page"]')).focus({ preventScroll: true });
}
function renderExtractionRecovery() {
  const data = state.extractions || { jobs: [] }, sig = JSON.stringify(data);
  if (sig === recoverySig) return;
  recoverySig = sig;
  const section = document.getElementById('extraction-recovery');
  const focused = section.contains(document.activeElement) ? document.activeElement.dataset.job : null;
  section.textContent = ''; section.hidden = !data.jobs.length;
  if (section.hidden) {
    if (focused) document.querySelector('[data-knowledge-view][aria-current="page"]')?.focus({ preventScroll: true });
    return;
  }
  const heading = document.createElement('h3'); heading.textContent = 'Proposal extraction'; section.append(heading);
  for (const job of data.jobs) {
    const row = document.createElement('div'), label = document.createElement('p');
    label.textContent = `${job.status}: ${job.title}${job.error ? ' — ' + job.error : ''}`; row.append(label);
    if (!['running', 'queued'].includes(job.status)) {
      for (const [action, title] of [['retry', 'Retry extraction'], ['dismiss', 'Dismiss']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = title; button.dataset.job = job.id;
        button.disabled = action === 'retry' && !job.retryable;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const res = await fetch('/extraction', { method: 'POST', headers: hdrs(), body: JSON.stringify({ id: job.id, action }) });
            if (!res.ok) await writeFailed(res);
            await loadState();
          } catch (error) { showFlash(error.message); }
          finally { button.disabled = false; }
        }); row.append(button);
      }
    }
    section.append(row);
  }
  const note = document.createElement('p');
  note.textContent = 'Retry uses the current extraction provider and sharing setting. Restarting alone sends nothing.' + (data.omitted ? ` ${data.omitted} older unfinished turns remain; resolve these to see them.` : '');
  section.append(note);
  if (focused) (section.querySelector(`[data-job="${CSS.escape(focused)}"]:not(:disabled)`) || document.querySelector('[data-knowledge-view][aria-current="page"]'))?.focus({ preventScroll: true });
}
function renderWorkspace() {
  renderExtractionRecovery();
  const panel = document.getElementById('overview-items');
  const view = location.hash.match(/^#knowledge-(summary|index|kanban)$/)?.[1] || 'index';
  const sig = JSON.stringify([state.items, state.stateRev, state.stateToken, view]);
  if (sig !== overviewSig) {
    const focused = panel.contains(document.activeElement) ? document.activeElement.closest('[data-id]')?.dataset.id : null;
    const focusedControl = focused && document.activeElement.matches('select') ? 'select' : null;
    overviewSig = sig; panel.textContent = '';
    const accepted = (state.items || []).filter(i => statusOf(i) === 'confirmed');
    const proposed = (state.items || []).filter(i => statusOf(i) === 'proposed');
    document.getElementById('review-count').textContent = proposed.length ? `(${proposed.length} to review)` : '';
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
        if (item.fromMessage) {
          const origin = document.createElement('button'); origin.type = 'button'; origin.className = 'item-origin'; origin.textContent = 'Show in conversation';
          origin.addEventListener('click', e => { e.stopPropagation(); showSurface('conversation'); showMsg(item.fromMessage).catch(error => showFlash(error.message)); }); card.append(origin);
        }
        if (moves) {
          const label = document.createElement('label'); label.textContent = 'Stage ';
          const select = document.createElement('select'); select.setAttribute('aria-label', `Stage for ${item.id}`);
          for (const col of COLS) { const option = document.createElement('option'); option.value = col; option.textContent = col; select.append(option); }
          select.value = item.column || 'todo';
          const rev = state.stateRev, token = state.stateToken;
          select.addEventListener('click', e => e.stopPropagation());
          select.addEventListener('change', async () => {
            select.disabled = true;
            try {
              const res = await fetch('/move', { method: 'POST', headers: hdrs(), body: JSON.stringify({ itemId: item.id, column: select.value, rev, token }) });
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
      section('Tasks', accepted.filter(i => i.kind === 'task'), true);
      section('Sources', accepted.filter(i => i.kind === 'source'));
    } else if (view === 'kanban') {
      for (const col of COLS) section(col, accepted.filter(i => i.kind === 'task' && (i.column || 'todo') === col), true);
      section('Decisions and sources', accepted.filter(i => i.kind !== 'task'));
    } else {
      for (const [kind, title] of [['decision', 'Accepted decisions'], ['task', 'Accepted tasks'], ['source', 'Accepted sources']]) section(title, accepted.filter(i => i.kind === kind));
    }
    section('Review — proposals, not accepted knowledge', proposed);
    if (focused) panel.querySelector(`[data-id="${CSS.escape(focused)}"]${focusedControl ? ' ' + focusedControl : ''}`)?.focus({ preventScroll: true });
  }
  const nextContextSig = JSON.stringify(state.context?.roles || {});
  if (nextContextSig !== contextSig) {
    const block = document.getElementById('context-roles');
    const opened = new Set([...block.querySelectorAll('details[open]')].map(d => d.dataset.role));
    const focusedRole = block.contains(document.activeElement) ? document.activeElement.closest('details')?.dataset.role : null;
    contextSig = nextContextSig; block.textContent = '';
    for (const [name, role] of Object.entries(state.context?.roles || {})) {
      const detail = document.createElement('details'), title = document.createElement('summary'), explanation = document.createElement('p'), payload = document.createElement('pre');
      detail.dataset.role = name; detail.open = opened.has(name);
      title.textContent = `${name}: ${role.candidate || 'none'}${role.location ? ` (${role.location})` : ''}`;
      explanation.textContent = `${role.skipReason || role.sends}. Allowed recipients: ${(role.candidates || []).filter(c => !c.blocked).map(c => `${c.name} (${c.location}${c.model ? ', ' + c.model : ''})`).join(', ') || 'none'}.${(role.candidates || []).some(c => c.blocked) ? ' Local-to-cloud fallback is blocked.' : ''}`;
      const heading = document.createElement('p'); heading.textContent = 'Preview of the next request (placeholders show the next turn):';
      payload.textContent = JSON.stringify(role.messagesTemplate || role.extraSystemMessage || null, null, 2);
      detail.append(title, explanation, heading, payload);
      if (role.lastRequest) {
        const sent = role.lastRequest, label = document.createElement('p'), actual = document.createElement('pre');
        label.textContent = `Last attempted request in this server session: ${sent.candidate} / ${sent.model} (${sent.location}, ${sent.endpoint}) · ${sent.status} · ${sent.at}${sent.truncated ? ' · display shortened to 100,000 characters' : ''}`;
        actual.className = 'last-request'; actual.textContent = sent.payload; detail.append(label, actual);
      }
      block.append(detail);
    }
    if (focusedRole) block.querySelector(`[data-role="${CSS.escape(focusedRole)}"] summary`)?.focus({ preventScroll: true });
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

document.getElementById('show-conversation').addEventListener('click', () => showSurface('conversation', true));
document.getElementById('show-knowledge').addEventListener('click', () => showSurface('knowledge', true));
window.addEventListener('hashchange', () => { showSurface('knowledge'); renderWorkspace(); });
showSurface(location.hash.startsWith('#knowledge-') ? 'knowledge' : 'conversation');
