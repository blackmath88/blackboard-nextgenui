'use strict';
let overviewSig = '', workspaceKeysLoaded = false;
function renderWorkspace() {
  const panel = document.getElementById('overview-items');
  const sig = JSON.stringify(state.items);
  if (sig !== overviewSig) {
    overviewSig = sig; panel.textContent = '';
    for (const [kind, title] of [['decision', 'Decisions'], ['task', 'Tasks'], ['source', 'Sources']]) {
      const section = document.createElement('section'), heading = document.createElement('h3'); heading.textContent = title; section.append(heading);
      const items = (state.items || []).filter(i => i.kind === kind && i.status !== 'rejected');
      for (const item of items) section.append(itemCard(item));
      if (!items.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'None yet'; section.append(empty); }
      panel.append(section);
    }
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
