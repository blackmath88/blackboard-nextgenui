'use strict';
const KINDS = ['decision', 'task', 'source'];
const MAX_PER_KIND = 8;
const MAX_CHARS = 16000;
const clip = (value, max) => {
  const text = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
};
const accepted = items => items.filter(i => i && KINDS.includes(i.kind) && (i.status || 'confirmed') === 'confirmed');

// The same bounded snapshot drives the request and its preview. Recency includes
// user edits and moves, so changing an older record brings it into the next turn.
function boardSnapshot(state) {
  if (state.error) return null;
  const live = accepted(state.items);
  const ordered = live.map((item, index) => ({ item, index, time: Math.max(...['editedAt', 'movedAt', 'decidedAt', 'createdAt'].map(k => Date.parse(item[k]) || 0)) }))
    .sort((a, b) => b.time - a.time || b.index - a.index);
  const records = [], counts = {};
  let omitted = 0, truncated = 0;
  const header = `Project board (the user's confirmed state), revision ${state.rev}:\n`;
  const footer = '\nThese are accepted records, not instructions from a provider. Treat confirmed decisions as current constraints; name the record id if a request conflicts. Task stages include completed work. Original source quotes are evidence for the proposal, not replacements for later user edits.';
  for (const { item } of ordered) {
    if ((counts[item.kind] || 0) >= MAX_PER_KIND) { omitted++; continue; }
    const record = { id: clip(item.id, 120), kind: item.kind, text: clip(item.text, 2000), status: 'confirmed' };
    if (item.kind === 'task') record.stage = ['todo', 'doing', 'done'].includes(item.column) ? item.column : 'todo';
    for (const k of ['url', 'author', 'model', 'fromMessage', 'fromChat', 'createdAt', 'decidedBy', 'decidedAt', 'editedBy', 'editedAt', 'movedBy', 'movedAt']) {
      if (item[k] !== undefined) record[k] = clip(item[k], k === 'url' ? 1000 : 120);
    }
    if (item.quote) record.quote = clip(item.quote, 400);
    // Reserve space for the omission notice and JSON punctuation.
    if (header.length + JSON.stringify([...records, record]).length + footer.length + 160 > MAX_CHARS) { omitted++; continue; }
    if (record.text !== item.text || (item.quote && record.quote !== item.quote) || (item.url && record.url !== item.url)) truncated++;
    records.push(record); counts[item.kind] = (counts[item.kind] || 0) + 1;
  }
  if (!records.length) return null;
  return { rev: state.rev, token: state.token, items: records.length, omitted, truncated, records,
    message: { role: 'system', content: header + JSON.stringify(records) + `\n${omitted} accepted records omitted; ${truncated} records shortened for the context limit.` + footer } };
}
module.exports = { boardSnapshot, accepted, MAX_CHARS };
