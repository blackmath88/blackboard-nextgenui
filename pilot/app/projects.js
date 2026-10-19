// CLI Pilot (pilot-v0.13): several projects. Pure readers over a projects home (PILOT_HOME), used by server.js.
// - A project is a pilot dir, exactly as before: its own chats, board, rules, modules, roles (pins), flags, frames and
//   metrics. Nothing in a pilot dir changes because it is a project.
// - The home holds projects.json {rev, projects: [{id, name, dir, createdAt, archived?}]} and one sub-dir per project
//   created by "/project new". `dir` is relative to the home (a sub-dir's name, or a path to a pilot dir elsewhere,
//   e.g. "../.pilot": listed by reference, never copied or moved). Every dir must resolve inside pilot/app/ (as PILOT_DIR
//   must), so a hand edit of projects.json can never make the server read or write elsewhere.
// - projects.json is created lazily, on the first "/project new", rename or archive. Until then the home has one
//   project: the default pilot dir (PILOT_DIR, else .pilot/) by reference. It is listed first when the file is created,
//   like main in chats.json.
// - Nothing is ever deleted: archived: true only hides a project from the list (/project unarchive brings it back).
// Node 20+, no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const chats = require('./chats.js');
const stats = require('./stats.js');

const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const APP = __dirname;
const inside = (dir) => { const r = path.relative(APP, dir); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };

// "Health insurance claim" -> "health-insurance-claim" (empty when nothing is left)
function slug(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

// projects.json as parsed -> {exists, doc, error}. doc null when missing or broken.
function readDoc(home) {
  const file = path.join(home, 'projects.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { exists: false, doc: null } : { exists: true, doc: null, error: `projects.json: ${e.message}` }; }
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.projects)) return { exists: true, doc: null, error: 'projects.json: expected {"rev": n, "projects": [...]}' };
    return { exists: true, doc };
  } catch (e) { return { exists: true, doc: null, error: `projects.json is not valid JSON: ${e.message}` }; }
}

// The entry for the default pilot dir, listed by reference (no projects.json yet, or the first entry once it exists).
function defaultEntry(home, defaultDir) {
  const base = path.basename(defaultDir);
  return { id: slug(base) || 'pilot', name: base.replace(/^\.+/, '') || base, dir: path.relative(home, defaultDir) || '.', createdAt: null };
}

// The project list from a parsed doc (or null = no projects.json: the default dir alone). Each entry
// {id, name, dir (as written), path (absolute), reference (not a sub-dir of the home), createdAt, archived, missing}.
// Skipped: a bad or repeated id, a dir outside pilot/app/, the home itself, a dir two entries share.
function normalize(doc, home, defaultDir) {
  const src = doc ? doc.projects : [defaultEntry(home, defaultDir)];
  const out = [], ids = new Set(), dirs = new Set();
  for (const p of Array.isArray(src) ? src : []) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID_RE.test(p.id) || ids.has(p.id)) continue;
    if (typeof p.dir !== 'string' || !p.dir.trim()) continue;
    const abs = path.resolve(home, p.dir);
    if (!inside(abs) || abs === path.resolve(home) || dirs.has(abs)) continue;
    ids.add(p.id); dirs.add(abs);
    out.push({ id: p.id, name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id, dir: p.dir, path: abs,
      reference: path.dirname(abs) !== path.resolve(home), createdAt: typeof p.createdAt === 'string' ? p.createdAt : null,
      archived: p.archived === true, missing: !fs.existsSync(abs) });
  }
  return out;
}

// A project's chats for the sidebar, read-only (the project need not be open): the listed chats, most recent first,
// with who named each one (chats.titleOf over that project's metrics.jsonl), and the project's last activity.
function chatSummary(dir) {
  const cd = chats.readDoc(dir);
  const events = stats.readJsonl(path.join(dir, 'metrics.jsonl'));
  const list = chats.withActivity(dir, chats.normalize(cd.doc)).map((x) => {
    const t = chats.titleOf(x, events);
    return { id: x.id, title: t.title, titleBy: t.by, titleModel: t.model, messages: x.messages, lastActivity: x.lastActivity, archived: x.archived };
  });
  const at = (x) => Date.parse(x.lastActivity) || 0;
  list.sort((a, b) => at(b) - at(a) || (a.id === chats.MAIN ? -1 : b.id === chats.MAIN ? 1 : 0));
  return { exists: cd.exists, list, lastActivity: list.length ? list.reduce((m, x) => (at(x) > at(m) ? x : m)).lastActivity : null };
}

// A project named by id or name (case-insensitive; an exact id wins, then an exact name, then a unique name prefix).
function find(q, list) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return { error: 'name a project: its name or id (see /projects)' };
  const named = list.map((p) => ({ p, n: p.name.toLowerCase() }));
  const hit = named.find((x) => x.p.id === s) || named.find((x) => x.n === s);
  if (hit) return { project: hit.p };
  const pre = named.filter((x) => x.n.startsWith(s));
  if (pre.length === 1) return { project: pre[0].p };
  return { error: pre.length ? `"${q}" fits ${pre.length} projects: ${pre.map((x) => `${x.p.name} (${x.p.id})`).join(', ')}` : `no project "${q}" (see /projects)` };
}

module.exports = { ID_RE, slug, readDoc, defaultEntry, normalize, chatSummary, find, inside };
