// CLI Pilot (pilot-v0.10): frame proposals. Pure helpers shared by server.js (the frame role, POST /frame, /frame) and
// why.js (/why), and required by the verify table. No model, no writes.
// A FrameIntent says how ONE shown pane presents its cards (02-morph: the model may only propose a frame, a compiler
// with a closed vocabulary decides what becomes visible):
//   {pane: "map" | "kanban", focus?: item id, order?: [item ids], group?: "status" | "author"}
// It can never add, remove or fade a pane, never add, change, confirm or reject an item, never change a text: there
// are no keys for that (schemas/frame-intent.schema.json, additionalProperties false). On top of the schema, check()
// needs the pane to be shown (consented and not a tab) and every id to be an item that pane shows and that is not
// rejected (a frame must not surface what you rejected); one unknown key or id rejects the whole intent.
// Presentation only: `order` puts the named cards first in that order (the rest keep theirs), `focus` marks one card
// and scrolls it into view, `group` adds sub-headings. Nothing is ever hidden.
// Node 20+, no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const { assertSupported, validate } = require('./schema-check.js');
const { PANE_KINDS } = require('./fade.js');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas', 'frame-intent.schema.json'), 'utf8'));
assertSupported(SCHEMA, 'frame-intent.schema.json');
const FRAME_PANES = SCHEMA.properties.pane.enum;   // map, kanban
const GROUPS = SCHEMA.properties.group.enum;       // status, author

// Model output -> {intent} | {none: true} | {reason: "malformed" | "schema", error}. A ```json fence is tolerated.
// {} is "no suggestion" (not an error).
function parse(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  let j;
  try { j = JSON.parse(t); } catch (e) { return { reason: 'malformed', error: `not JSON: ${e.message}` }; }
  if (j && typeof j === 'object' && !Array.isArray(j) && !Object.keys(j).length) return { none: true };
  const errs = validate(SCHEMA, j);
  return errs.length ? { reason: 'schema', error: errs.slice(0, 5).join('; ') } : { intent: j };
}

// Checks a schema-valid intent against what is on screen. ctx = {visible: [modules shown with consent], faded:
// [modules that are tabs], items: state.json items}. -> {ok: true} | {ok: false, reason, errors: [...]}.
function check(intent, ctx) {
  const errs = [];
  const pane = intent.pane;
  const visible = ctx.visible || [], faded = ctx.faded || [];
  if (!visible.includes(pane)) return { ok: false, reason: 'pane', errors: [`pane "${pane}" is not shown (no consented ${pane} pane)`] };
  if (faded.includes(pane)) return { ok: false, reason: 'pane', errors: [`pane "${pane}" is a tab; a frame never brings a pane back`] };
  const kinds = PANE_KINDS[pane] || [];
  const byId = new Map((ctx.items || []).filter((i) => i && typeof i.id === 'string').map((i) => [i.id, i]));
  const idErr = (id, where) => {
    const it = byId.get(id);
    if (!it) return `${where}: unknown id "${id}"`;
    if (!kinds.includes(it.kind)) return `${where}: "${id}" is a ${it.kind}, the ${pane} pane does not show it`;
    if (it.status === 'rejected') return `${where}: "${id}" is rejected (a frame must not bring it back)`;
    return null;
  };
  if (intent.focus !== undefined) { const e = idErr(intent.focus, 'focus'); if (e) errs.push(e); }
  if (intent.order !== undefined) {
    const seen = new Set();
    for (const id of intent.order) {
      if (seen.has(id)) { errs.push(`order: "${id}" twice`); continue; }
      seen.add(id);
      const e = idErr(id, 'order'); if (e) errs.push(e);
    }
  }
  if (intent.focus === undefined && !(intent.order && intent.order.length) && intent.group === undefined) errs.push('nothing to frame: no focus, order or group');
  return errs.length ? { ok: false, reason: errs.some((e) => /unknown id|does not show|rejected|twice/.test(e)) ? 'id' : 'empty', errors: errs.slice(0, 6) } : { ok: true };
}

// The intent as you read it: "focus dec-2 · order dec-2, dec-8, dec-7 · group by status".
function describe(intent) {
  if (!intent) return '';
  const parts = [];
  if (intent.focus) parts.push(`focus ${intent.focus}`);
  if (intent.order && intent.order.length) parts.push(`order ${intent.order.join(', ')}`);
  if (intent.group) parts.push(`group by ${intent.group}`);
  return parts.join(' · ');
}
// Two intents with the same effect (key order does not matter).
const key = (i) => JSON.stringify(i ? { pane: i.pane, focus: i.focus || null, order: i.order || [], group: i.group || null } : null);
const same = (a, b) => !!a && !!b && key(a) === key(b);

// frames.json -> {rev, pending: {pane: proposal}, applied: {pane: frame}, resets: {pane: reset}}; anything else in the
// file is ignored here (and kept by the server when it writes).
function normalize(doc) {
  const d = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const map = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return { rev: Number.isInteger(d.rev) ? d.rev : 0, pending: map(d.pending), applied: map(d.applied), resets: map(d.resets) };
}

module.exports = { SCHEMA, FRAME_PANES, GROUPS, parse, check, describe, same, normalize };
