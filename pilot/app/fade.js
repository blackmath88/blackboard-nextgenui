// CLI Pilot (pilot-v0.8): panes can go. Pure helpers shared by server.js (the controller) and why.js (/why).
// A turn is one message you sent: the turn number is the count of `user` lines in transcript.jsonl (commands are not
// turns). A pane entry in modules.json may carry:
//   lastTouch: {at, turn, how}   the last time you interacted with the pane (see CHECKS.md # pilot-v0.8, "touch")
//   state: "faded", fadedAt, fadedTurn   while it is a tab (missing state = shown)
//   removalAsked: true           the removal question was asked for this pane (it is asked once per pane)
// rules.json: fadeAfterTurns and askRemoveAfterTurns, top level (default) or per rule (overrides the default).
// Without fadeAfterTurns a pane never fades; without askRemoveAfterTurns a faded pane is never offered for removal.
// Node 20+, no dependencies.
'use strict';

const PANE_KINDS = { index: [], map: ['decision', 'source'], kanban: ['task'] };   // the items a pane shows
const TOUCH_HOWS = ['click', 'focus', 'scroll', 'decide', 'tab'];

const turnOf = (lines) => lines.filter((l) => l && l.role === 'user').length;
// the turn number at a moment: user lines written at or before ts (for entries without lastTouch: older data)
function turnAt(lines, ts) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return 0;
  return lines.filter((l) => l && l.role === 'user' && Date.parse(l.ts) <= t).length;
}

const posInt = (v) => Number.isInteger(v) && v > 0;
// {fadeAfter, askRemoveAfter, fadeFrom, askFrom}: a per-rule value wins over the top-level default; null = off.
// fadeFrom/askFrom say where the value came from ("rule" | "default" | null) for /why.
function config(rulesDoc, mod) {
  const doc = rulesDoc && typeof rulesDoc === 'object' ? rulesDoc : {};
  const rule = (Array.isArray(doc.rules) ? doc.rules : []).find((r) => r && r.module === mod) || {};
  const pick = (k) => (posInt(rule[k]) ? [rule[k], 'rule'] : posInt(doc[k]) ? [doc[k], 'default'] : [null, null]);
  const [fadeAfter, fadeFrom] = pick('fadeAfterTurns');
  const [askRemoveAfter, askFrom] = pick('askRemoveAfterTurns');
  return { fadeAfter, askRemoveAfter, fadeFrom, askFrom };
}

// The last touch of a pane entry. Without a recorded lastTouch (a pane added before pilot-v0.8, or by hand) the
// count starts when the pane was added: {recorded: false, how: "added"}.
function lastTouch(entry, lines) {
  const t = entry && entry.lastTouch;
  if (t && Number.isInteger(t.turn)) return { turn: t.turn, at: t.at || null, how: t.how || null, recorded: true };
  return { turn: turnAt(lines, entry && entry.addedAt), at: (entry && entry.addedAt) || null, how: 'added', recorded: false };
}

// Proposals a pane holds: items of its kinds with status proposed. A pane holding one never fades.
function proposalsIn(mod, items) {
  const kinds = PANE_KINDS[mod] || [];
  return (items || []).filter((i) => i && kinds.includes(i.kind) && i.status === 'proposed').map((i) => i.id);
}
const paneOfKind = (kind) => Object.keys(PANE_KINDS).find((m) => PANE_KINDS[m].includes(kind)) || null;
const isFaded = (entry) => !!entry && entry.state === 'faded';

// Everything about one pane's fading, now: {faded, lastTouch, idle, fadeAfter, askRemoveAfter, holds, fadedTurn,
// fadedFor, removalAsked, fadeDue, removeDue}. fadeDue: shown, fading on, idle >= fadeAfter, no proposal.
// removeDue: faded, removal on, faded for >= askRemoveAfter turns, never asked for this pane, no proposal.
function status(entry, { lines, turn, rulesDoc, items }) {
  const mod = entry.module;
  const cfg = config(rulesDoc, mod);
  const lt = lastTouch(entry, lines);
  const idle = Math.max(0, turn - lt.turn);
  const holds = proposalsIn(mod, items);
  const faded = isFaded(entry);
  const fadedTurn = faded && Number.isInteger(entry.fadedTurn) ? entry.fadedTurn : null;
  const fadedFor = fadedTurn === null ? null : Math.max(0, turn - fadedTurn);
  return { module: mod, faded, lastTouch: lt, turn, idle, ...cfg, holds, fadedTurn, fadedAt: faded ? entry.fadedAt || null : null, fadedFor,
    removalAsked: entry.removalAsked === true,
    fadeDue: !faded && cfg.fadeAfter !== null && idle >= cfg.fadeAfter && !holds.length,
    removeDue: faded && cfg.askRemoveAfter !== null && fadedFor !== null && fadedFor >= cfg.askRemoveAfter && entry.removalAsked !== true && !holds.length };
}

module.exports = { PANE_KINDS, TOUCH_HOWS, turnOf, turnAt, config, lastTouch, proposalsIn, paneOfKind, isFaded, status };
