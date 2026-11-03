'use strict';
let editingItem = null;
const editDialog = document.getElementById('item-editor');
const editText = document.getElementById('item-edit-text');
const editURL = document.getElementById('item-edit-url');
const editNotice = document.getElementById('item-edit-notice');
const editLatest = document.getElementById('item-edit-latest');
const editReload = document.getElementById('item-edit-reload');
const editSave = document.getElementById('item-edit-save');

function setEditSnapshot(item) {
  editingItem.rev = state.stateRev; editingItem.token = state.stateToken;
  editText.value = item.text; editURL.value = item.url || '';
  document.getElementById('item-edit-url-label').hidden = item.kind !== 'source';
  document.getElementById('item-edit-origin').textContent = item.quote ? `Original evidence: “${item.quote}”` : 'No original quote was recorded.';
  editNotice.textContent = ''; editLatest.hidden = true; editReload.hidden = true; editSave.disabled = false;
}
function openItemEditor(id, card) {
  const item = (state.items || []).find(i => i.id === id);
  if (!item || statusOf(item) !== 'confirmed') return;
  editingItem = { id, surface: card?.closest('#overview') ? '#overview' : '#bench' };
  document.getElementById('item-editor-title').textContent = `Edit ${id}`;
  setEditSnapshot(item); editDialog.showModal(); editText.focus();
}
editReload.addEventListener('click', () => {
  const item = (state.items || []).find(i => i.id === editingItem?.id);
  if (item && statusOf(item) === 'confirmed') { setEditSnapshot(item); editText.focus(); }
});
document.getElementById('item-edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!editingItem || editSave.disabled) return;
  editSave.disabled = true; editNotice.textContent = 'Saving…';
  const current = editingItem;
  const stillOpen = () => editingItem === current && editDialog.open;
  try {
    const res = await fetch('/edit', { method: 'POST', headers: hdrs(), body: JSON.stringify({ itemId: current.id, text: editText.value, ...(document.getElementById('item-edit-url-label').hidden ? {} : { url: editURL.value }), rev: current.rev, token: current.token }) });
    const result = await res.json();
    if (!res.ok) {
      if (!stillOpen()) { showFlash(result.error || `Save failed (HTTP ${res.status}).`); return; }
      editNotice.textContent = result.error || `Save failed (HTTP ${res.status}). Your draft is kept.`;
      if (result.stale) {
        await loadState();
        if (!stillOpen()) return;
        const latest = (state.items || []).find(i => i.id === current.id);
        editLatest.hidden = false;
        editLatest.textContent = latest ? `Current saved record (${latest.column || latest.kind}): ${latest.text}` : 'This record is no longer available.';
        editReload.hidden = !latest || statusOf(latest) !== 'confirmed';
        editNotice.textContent = 'This record changed while you were editing. Your draft is kept above. Review the current saved version below.';
        return;
      }
      editSave.disabled = false; return;
    }
    await loadState();
    if (stillOpen()) editDialog.close();
    showFlash(`${current.id} saved. Every knowledge view and the next shared request use this version.`);
  } catch (error) {
    if (stillOpen()) { editNotice.textContent = `Save not confirmed: ${error.message}. Your draft is kept; reload before retrying if the server may have saved it.`; editSave.disabled = false; }
    else showFlash(`Save for ${current.id} not confirmed: ${error.message}. Reload to inspect its saved state.`);
  }
});
document.getElementById('item-edit-cancel').addEventListener('click', () => editDialog.close());
editDialog.addEventListener('close', () => {
  const previous = editingItem; editingItem = null;
  const card = previous && document.querySelector(`${previous.surface} .item[data-id="${CSS.escape(previous.id)}"]`);
  (card || input).focus({ preventScroll: true });
});
