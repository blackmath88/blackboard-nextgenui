#!/usr/bin/env node
// CLI Pilot (P0-P2 + pilot-v0.3 to pilot-v0.6): serves the page, proxies POST /chat to the `chat` role with
// streaming and per-role candidates/policies, appends lines to .pilot/transcript.jsonl,
// runs the deterministic growth controller (rules.json -> consent -> modules.json),
// runs the `extract` role in the background after each reply (proposals -> .pilot/state.json),
// handles commands via POST /command and answers via POST /answer, logs to .pilot/metrics.jsonl,
// watches .pilot/ (fs.watch, 150 ms debounce) and pushes {file, rev} to the page over SSE (GET /events).
// pilot-v0.6: authorship (item_write ledger in metrics.jsonl, hand edits shown as "you (file edit)"), the P5 metrics
// events (server_start, turn, controller_add with answerRef, index_jump via POST /metric) and /stats (stats.js).
// pilot-v0.7: /why explains the current panes and items from the files only, every statement with its source (why.js).
// pilot-v0.8: panes can go. A pane nobody touched for fadeAfterTurns turns fades to a tab (modules.json state "faded",
// never deleted); a touch (POST /touch, or a decision on one of its cards) brings it back. After askRemoveAfterTurns
// more turns as a tab the controller asks once whether to remove it; only a recorded yes/never removes it (fade.js).
// pilot-v0.9: experiment "settled input" behind a flag (experiments.settledInput in the config, or /flag settled-input
// on|off, kept in .pilot/flags.json; default off). The page proposes "send?" after a pause on a finished-looking input
// (public/settle.js) and reports settle_offer / settle_accept / settle_ignore / enter_send via POST /metric.
// pilot-v0.10: frame proposals behind a flag (experiments.frameProposals, /flag frame-proposals on|off; default off).
// After a turn the `frame` role may return a FrameIntent (schemas/frame-intent.schema.json, checked by frame.js): how a
// shown map or kanban presents its cards. It is kept as a proposal in .pilot/frames.json; only you apply it (f in that
// pane, POST /frame) or dismiss it; /frame reset undoes an applied one. It never touches modules.json or state.json.
// pilot-v0.11: you arrange your own kanban (POST /move, from drag and drop or Alt+arrows in the page): column, order,
// movedBy "user", movedAt on that task only (public/board.js has the order rule); item_move in metrics.jsonl; a touch of
// the kanban; a move never decides anything, and it resets an applied kanban frame (reason "manual move").
// pilot-v0.12: several chats in one project (chats.js): chats.json, chats/<id>.jsonl, main stays transcript.jsonl.
// pilot-v0.13: several projects. A project is a pilot dir; project.js (createProject) holds everything that works on one
// dir, so every project has its own files, caches, write chain, watcher and SSE clients. Without PILOT_HOME the server
// has one project, the pilot dir (PILOT_DIR, else .pilot/), exactly as before. With PILOT_HOME (env, or config.pilotHome;
// e.g. PILOT_HOME=projects) the home lists the projects (projects.json, projects.js); a request names its project with
// ?project=<id> or "project" in its JSON body (missing = the first listed); a project is opened on first use and watched
// only while a tab has it open. /projects and /project ... are handled here; every other command by the project.
// Node 20+, no dependencies. All paths resolve against this file's folder.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const fade = require('./fade.js');
const chats = require('./chats.js');
const projects = require('./projects.js');   // pilot-v0.13
const { createProject } = require('./project.js');

const APP = __dirname;
const PUBLIC = path.join(APP, 'public');
const configPath = path.resolve(APP, process.env.PILOT_CONFIG || 'pilot.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
// PILOT_DIR (env, relative to pilot/app/) overrides config.pilotDir, e.g. PILOT_DIR=.pilot-demo for demos.
const PILOT = path.resolve(APP, process.env.PILOT_DIR || config.pilotDir || '.pilot');
// pilot-v0.13: PILOT_HOME (env, relative to pilot/app/) overrides config.pilotHome; either switches several projects on.
const HOME_SETTING = process.env.PILOT_HOME || config.pilotHome || '';
const HOME = HOME_SETTING ? path.resolve(APP, HOME_SETTING) : null;
const PORT = Number(config.port) || 4747;
const HOST = '127.0.0.1';
const UNWATCH_MS = 5000;   // a project nobody has open stops being watched this long after its last tab left

if (path.relative(APP, PILOT).startsWith('..')) throw new Error(`pilotDir must stay inside ${APP}`);
if (HOME && !projects.inside(HOME)) throw new Error(`PILOT_HOME must be a folder inside ${APP}`);

// ---- projects (pilot-v0.13). Single-dir mode (no PILOT_HOME): one project, opened and watched from the start, as
// before; nothing about projects is ever written. Home mode: projects open on first use (open), watched while a tab
// has them open. ----
const SINGLE = HOME ? null : { ...projects.defaultEntry(APP, PILOT), path: PILOT, dir: path.relative(APP, PILOT), reference: false, archived: false, missing: false };
const open = new Map();   // project id -> {dir, p, timer}
if (SINGLE) { const p = createProject(PILOT, { config, configPath }); p.watch(); open.set(SINGLE.id, { dir: PILOT, p, timer: null }); }
else fs.mkdirSync(HOME, { recursive: true });

let lastGoodProjects = null;
// -> {exists, doc, rev, list, error?}: projects.json (a broken one reads as its last good version and is never written)
function readProjects() {
  const r = projects.readDoc(HOME);
  if (r.doc) lastGoodProjects = r.doc;
  const doc = r.doc || (r.error && lastGoodProjects) || null;
  const list = doc ? projects.normalize(doc, HOME, PILOT) : r.exists ? [] : projects.normalize(null, HOME, PILOT);
  return { exists: r.exists, doc, rev: doc && Number.isInteger(doc.rev) ? doc.rev : 0, list, ...(r.error ? { error: r.error } : {}) };
}
function openProject(entry) {
  let o = open.get(entry.id);
  if (o && o.dir !== entry.path) { o.p.unwatch(); clearTimeout(o.timer); open.delete(entry.id); o = null; }   // dir changed by hand
  if (!o) {
    o = { dir: entry.path, p: createProject(entry.path, { config, configPath }), timer: null };
    open.set(entry.id, o);
    o.p.start();
  }
  return o.p;
}
// The project a request names (raw: ?project= or body.project; missing = the default) -> {id, p, entry} or {code, error}.
// Default: the single dir; with PILOT_HOME the first listed project that is not archived.
function projectOf(raw) {
  const named = raw !== undefined && raw !== null && raw !== '';
  if (SINGLE) {
    if (named && String(raw) !== SINGLE.id) return { code: 404, error: `no project "${raw}": this server has one project, ${SINGLE.id} (single-dir mode)` };
    return { id: SINGLE.id, p: open.get(SINGLE.id).p, entry: SINGLE };
  }
  const pr = readProjects();
  const entry = named ? pr.list.find((x) => x.id === String(raw)) : pr.list.find((x) => !x.archived && !x.missing) || pr.list.find((x) => !x.missing);
  if (!entry) return { code: 404, error: named ? `no project "${raw}" (see /projects)` : 'no project to open (see /projects)' };
  // a dir listed in projects.json that does not exist is never created (a reference must not appear out of nowhere)
  if (entry.missing && pr.exists) return { code: 404, error: `project ${entry.id}: its dir ${entry.dir} does not exist; nothing was created` };
  return { id: entry.id, p: openProject(entry), entry };
}

// The project list for the page (/state part projects.json). Other projects' chats are read from their files (read-only;
// they need not be open); the page shows the current project's chats from its own chats part.
function projectsSummary(cur) {
  if (SINGLE) return { home: false, exists: false, current: SINGLE.id, list: [{ id: SINGLE.id, name: SINGLE.name, dir: SINGLE.dir, reference: false, archived: false }] };
  const pr = readProjects();
  const list = pr.list.map((x) => {
    const s = x.missing ? { list: [], lastActivity: null } : projects.chatSummary(x.path);
    return { id: x.id, name: x.name, dir: x.dir, reference: x.reference, createdAt: x.createdAt, archived: x.archived, missing: x.missing,
      chats: s.list, lastActivity: s.lastActivity };
  });
  return { home: true, exists: pr.exists, rev: pr.rev, current: cur, homeDir: path.relative(APP, HOME), list, ...(pr.error ? { error: pr.error } : {}) };
}

// ---- projects.json writes: atomic, serialized (one chain for the home) ----
let homeChain = Promise.resolve();
function homeSerial(fn) { const p = homeChain.then(fn); homeChain = p.catch(() => {}); return p; }
function writeProjects(doc) {
  doc.rev = (Number.isInteger(doc.rev) ? doc.rev : 0) + 1;
  const file = path.join(HOME, 'projects.json'), tmp = path.join(HOME, `.projects.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n'); fs.renameSync(tmp, file);
  lastGoodProjects = JSON.parse(JSON.stringify(doc));
  return doc.rev;
}
// The doc to change: the file as it is, or (no projects.json yet) one listing the default dir by reference, first.
function projectsDocForWrite(pr) {
  if (pr.doc) return JSON.parse(JSON.stringify(pr.doc));
  const d = projects.defaultEntry(HOME, PILOT);
  const first = chats.readLines(path.join(PILOT, 'transcript.jsonl'))[0];
  return { rev: 0, projects: [{ id: d.id, name: d.name, dir: d.dir, createdAt: (first && first.ts) || new Date().toISOString() }] };
}
const cleanName = (t) => { const s = String(t || '').replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim(); return s && s.length <= 60 ? s : null; };
const refused = (pr) => ({ ok: false, lines: [`projects.json is not valid JSON, not changed: ${pr.error}`] });

// /project new <name>: a new dir in the home, named after the project (never an existing dir), rules.json seeded from
// rules.example.json; projects.json is created on the first one (the default dir listed first, by reference).
async function newProject(name, from) {
  const out = await homeSerial(() => {
    const pr = readProjects();
    if (pr.error) return refused(pr);
    const doc = projectsDocForWrite(pr);
    const taken = new Set(projects.normalize(doc, HOME, PILOT).map((x) => x.id));
    const base = projects.slug(name) || 'project';
    let id = base;
    for (let n = 2; taken.has(id) || fs.existsSync(path.join(HOME, id)); n++) id = `${base}-${n}`;
    const dir = path.join(HOME, id), ts = new Date().toISOString();
    fs.mkdirSync(dir);
    fs.copyFileSync(path.join(APP, 'rules.example.json'), path.join(dir, 'rules.json'));
    doc.projects.push({ id, name, dir: id, createdAt: ts });
    const rev = writeProjects(doc);
    return { ok: true, id, rev, created: !pr.exists };
  });
  if (!out.ok) return out;
  const p = projectOf(out.id).p;
  await p.metric('project_new', { project: out.id, name, dir: out.id, from: from || null, rev: out.rev, ...(out.created ? { created: 'projects.json' } : {}) });
  return { ok: true, project: out.id, lines: [`new project ${out.id} "${name}" (${path.relative(APP, HOME)}/${out.id}/, rules.json seeded${out.created ? '; projects.json created, the default dir is listed first by reference' : ''})`] };
}
async function renameProject(id, name) {
  const out = await homeSerial(() => {
    const pr = readProjects();
    if (pr.error) return refused(pr);
    const doc = projectsDocForWrite(pr);
    const e = doc.projects.find((x) => x && x.id === id);
    if (!e) return { ok: false, lines: [`no project ${id}`] };
    const was = typeof e.name === 'string' ? e.name : id;
    e.name = name;
    return { ok: true, was, rev: writeProjects(doc), created: !pr.exists };
  });
  if (!out.ok) return out;
  await projectOf(id).p.metric('project_rename', { project: id, name, was: out.was, by: 'user', rev: out.rev, ...(out.created ? { created: 'projects.json' } : {}) });
  return { ok: true, lines: [`project ${id} is now "${name}" (named by you)`] };
}
// archived: true hides a project from the list; its dir and files stay. The last listed project cannot be archived.
async function archiveProject(id, archived) {
  const out = await homeSerial(() => {
    const pr = readProjects();
    if (pr.error) return refused(pr);
    if (!pr.exists && archived) return { ok: false, lines: ['this home has one project; nothing to archive'] };
    const doc = projectsDocForWrite(pr);
    const e = doc.projects.find((x) => x && x.id === id);
    if (!e) return { ok: false, lines: [`no project ${id}`] };
    if ((e.archived === true) === archived) return { ok: true, same: true, lines: [`project ${id} is already ${archived ? 'archived' : 'in the list'}`] };
    if (archived && !pr.list.some((x) => x.id !== id && !x.archived)) return { ok: false, lines: ['the last project in the list cannot be archived'] };
    if (archived) e.archived = true; else delete e.archived;
    return { ok: true, rev: writeProjects(doc) };
  });
  if (!out.ok || out.same) return out;
  const t = projectOf(id);
  if (t.p) await t.p.metric('project_archive', { project: id, archived, rev: out.rev });
  return { ok: true, lines: [archived ? `project ${id} archived: hidden from the list, nothing deleted (its dir stays; /project unarchive ${id} brings it back)` : `project ${id} is back in the list`] };
}

// /projects [all], /project ... -> {ok, lines, project?} (project: the one this tab should switch to)
async function projectCommand(cmd, args, cur) {
  if (SINGLE) {
    const one = `one project: ${SINGLE.name} (${SINGLE.dir}/), single-dir mode. Several projects: start the server with PILOT_HOME=projects (README, "Projects")`;
    if (cmd === '/projects' || !args.length) return { ok: true, lines: [one] };
    if (args[0] === SINGLE.id || args.join(' ') === SINGLE.name) return { ok: true, lines: [`you are in ${SINGLE.id}`] };
    return { ok: false, lines: [`single-dir mode: nothing changed. ${one}`] };
  }
  const sum = projectsSummary(cur);
  const label = (x) => `${x.name} · ${x.chats.filter((c) => !c.archived).length} chats · ${x.dir}${x.reference ? ' (by reference)' : ''}${x.missing ? ' · dir missing' : ''}${x.archived ? ' · archived' : ''}`;
  if (cmd === '/projects') {
    const lines = sum.list.filter((x) => !x.archived || args[0] === 'all').map((x) => `${x.id === cur ? '*' : ' '} ${x.id.padEnd(24)} ${label(x)}`);
    const n = sum.list.filter((x) => x.archived).length;
    if (n && args[0] !== 'all') lines.push(`  ${n} archived (/projects all shows them)`);
    if (!sum.exists) lines.push('  one project so far: /project new <name> starts another (projects.json is created then)');
    return { ok: true, lines };
  }
  const [sub, ...rest] = args;
  const here = sum.list.find((x) => x.id === cur);
  if (!sub) return { ok: true, lines: [`you are in ${here ? `${here.name} (${cur}, ${here.dir}/)` : cur}. /project new <name> | /project <name or id> | /project rename <name> | /project archive | /project unarchive <project> | /projects`] };
  if (sub === 'new' || sub === 'rename') {
    const name = cleanName(rest.join(' '));
    if (!name) return { ok: false, lines: [`usage: /project ${sub} <name>  (1 to 60 characters)`] };
    return sub === 'new' ? newProject(name, cur) : renameProject(cur, name);
  }
  if (sub === 'archive' || sub === 'unarchive') {
    const f = rest.length ? projects.find(rest.join(' '), sum.list) : { project: here };
    if (f.error || !f.project) return { ok: false, lines: [f.error || 'name a project (see /projects)'] };
    const r = await archiveProject(f.project.id, sub === 'archive');
    // archiving the project you are in takes you to the first project still listed
    if (r.ok && sub === 'archive' && f.project.id === cur) r.project = (readProjects().list.find((x) => !x.archived && !x.missing) || {}).id;
    return r;
  }
  const f = projects.find(args.join(' '), sum.list);
  if (f.error) return { ok: false, lines: [f.error] };
  if (f.project.missing) return { ok: false, lines: [`project ${f.project.id}: its dir ${f.project.dir} does not exist`] };
  return { ok: true, lines: [`project ${f.project.id}: ${label(f.project)}`], project: f.project.id };
}

// ---- live files. Each project watches its own dir (project.js). The home has one watcher of its own, for
// projects.json: a change is pushed to every open tab (the list of projects is everybody's). ----
function sseFor(id, p, req, res) {
  const o = open.get(id);
  clearTimeout(o.timer);
  p.watch();
  p.handleEvents(req, res);
  if (SINGLE) return;
  req.on('close', () => {
    if (p.clientCount()) return;
    clearTimeout(o.timer);
    o.timer = setTimeout(() => { if (!p.clientCount()) p.unwatch(); }, UNWATCH_MS);
    o.timer.unref();
  });
}
function watchHome() {
  const file = path.join(HOME, 'projects.json');
  const sigOf = () => { try { const st = fs.statSync(file); return `${st.mtimeMs}|${st.size}|${st.ino}`; } catch { return null; } };
  let known = sigOf(), timer = null;
  const scan = () => {
    const now = sigOf();
    if (now === known) return;
    known = now;
    const r = projects.readDoc(HOME);
    const data = { file: 'projects.json', rev: r.doc && Number.isInteger(r.doc.rev) ? r.doc.rev : r.error ? null : 0, ...(r.error ? { error: r.error } : {}) };
    for (const o of open.values()) o.p.broadcast('change', data);
  };
  try {
    const w = fs.watch(HOME, () => { clearTimeout(timer); timer = setTimeout(scan, 150); });
    w.on('error', (err) => { console.error(`watch ${path.relative(APP, HOME)}/ stopped: ${err.message}`); w.close(); setTimeout(watchHome, 1000).unref(); });
  } catch (err) { console.error(`cannot watch ${path.relative(APP, HOME)}/: ${err.message}`); setTimeout(watchHome, 1000).unref(); }
}
if (HOME) watchHome();

// ---- HTTP ----
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (path.relative(PUBLIC, file).startsWith('..') || path.isAbsolute(path.relative(PUBLIC, file))) return sendJson(res, 404, { error: 'not found' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

// pilot-v0.13: every route names its project: ?project=<id>, or "project" in the JSON body (missing = the default).
// An unknown project is 404, like an unknown chat (pilot-v0.12).
const server = http.createServer(async (req, res) => {
  try {
    const { pathname, searchParams } = new URL(req.url, `http://${HOST}`);
    const isPost = req.method === 'POST' && ['/answer', '/metric', '/frame', '/move', '/touch', '/command', '/chat'].includes(pathname);
    if (req.method === 'GET' && (pathname === '/state' || pathname === '/events') || isPost) {
      let body = null;
      if (isPost) {
        const limit = ['/metric', '/frame', '/move', '/touch'].includes(pathname) ? 2000 : 100000;
        try { body = JSON.parse(await readBody(req, limit)); } catch { return sendJson(res, 400, pathname === '/command' ? { ok: false, lines: ['expected JSON {text}'] } : { error: BAD_BODY[pathname] }); }
        if (!body || typeof body !== 'object') body = {};
      }
      const raw = searchParams.has('project') ? searchParams.get('project') : body && body.project;
      const pj = projectOf(raw);
      if (!pj.p) return sendJson(res, pj.code, pathname === '/command' ? { ok: false, lines: [pj.error], unknownProject: true } : { error: pj.error, unknownProject: true });
      return await route(pj, pathname, searchParams, body, req, res);
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);
    sendJson(res, 405, { error: 'method not allowed' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
    else res.end();
  }
});
const BAD_BODY = { '/answer': 'expected JSON {module, answer} or {itemId, decision}', '/metric': 'expected JSON {event: "index_jump", target}',
  '/frame': 'expected JSON {pane, id, action}', '/move': 'expected JSON {itemId, column, index}', '/touch': 'expected JSON {module, how}', '/chat': 'expected JSON {text, chat?}' };

async function route({ id, p }, pathname, searchParams, body, req, res) {
  if (pathname === '/state') {
    const only = searchParams.has('only') ? searchParams.get('only').split(',').filter(Boolean) : null;
    const chat = p.chatOf(searchParams.get('chat'));   // pilot-v0.12
    if (!chat) return sendJson(res, 404, { error: `no chat "${searchParams.get('chat')}"`, unknownChat: true });
    const out = p.statePayload(only, chat);
    out.project = id;   // pilot-v0.13
    if (!only || only.includes('projects.json')) out.projects = projectsSummary(id);
    return sendJson(res, 200, out);
  }
  if (pathname === '/events') return sseFor(id, p, req, res);
  if (pathname === '/command' && /^\/projects?(\s|$)/.test(String(body.text || '').trim())) {   // pilot-v0.13
    const [cmd, ...args] = String(body.text).trim().split(/\s+/);
    const out = await projectCommand(cmd, args, id);
    return sendJson(res, out.ok ? 200 : 400, out);
  }
  const chat = p.chatOf(body && body.chat);
  if (!chat) return pathname === '/command' ? sendJson(res, 404, { ok: false, lines: ['no such chat'] }) : sendJson(res, 404, { error: pathname === '/chat' ? 'no such chat (see /chats)' : 'no such chat' });
  if (pathname === '/answer') {
    const rev = body && body.rev !== undefined && body.rev !== null ? body.rev : undefined;   // optional: the rev the page last saw
    const out = body && body.itemId !== undefined ? await p.decide(body.itemId, body.decision, rev, chat) : await p.answer(body && body.module, body && body.answer, rev, chat);
    return sendJson(res, out.code, out.body);
  }
  // pilot-v0.6: the page reports index jumps (Usefulness). Only this one event, with a message id that exists.
  // pilot-v0.9: and the settled-input events, only while that experiment is on (settleEvent validates them).
  if (pathname === '/metric') {
    if (body && body.event === 'chat_switch') {   // pilot-v0.12: the page moved to another chat
      const list = p.readChats().list;
      const ok = (x) => typeof x === 'string' && list.some((c) => c.id === x);
      if (!ok(body.from) || !ok(body.to) || body.from === body.to) return sendJson(res, 400, { error: 'chat_switch needs from and to: two different chats in chats.json' });
      const how = ['sidebar', 'command', 'tag', 'link', 'new', 'archive', 'back'].includes(body.how) ? body.how : null;
      await p.metric('chat_switch', { from: body.from, to: body.to, how, turn: fade.turnOf(p.readTranscript()) });
      return sendJson(res, 200, { ok: true });
    }
    if (body && body.event === 'project_switch') {   // pilot-v0.13: the page moved to this project (logged here, in the project it went to)
      const list = SINGLE ? [SINGLE] : readProjects().list;
      if (typeof body.from !== 'string' || !list.some((x) => x.id === body.from) || body.from === id) return sendJson(res, 400, { error: 'project_switch needs from: another project in projects.json (the project param is where the page went)' });
      const how = ['sidebar', 'command', 'new', 'archive', 'back', 'chat'].includes(body.how) ? body.how : null;
      await p.metric('project_switch', { from: body.from, to: id, how });
      return sendJson(res, 200, { ok: true });
    }
    if (body && p.SETTLE_EVENTS[body.event]) {
      const out = p.settleEvent(body);
      if (out.error) return sendJson(res, 400, { error: out.error });
      await p.metric(body.event, out.fields);
      return sendJson(res, 200, { ok: true });
    }
    if (!body || body.event !== 'index_jump') return sendJson(res, 400, { error: 'only {event: "index_jump", target} is accepted' });
    const target = typeof body.target === 'string' ? body.target : '';
    // pilot-v0.12: the message is looked up in every chat; position and of count in its own chat
    const row = chats.allRows(p.dir, p.readChats().list).find((r) => r.obj && r.obj.id === target);
    if (!row) return sendJson(res, 400, { error: `no message "${target}"` });
    const lines = p.readChat(row.chat);
    const at = lines.findIndex((l) => l.id === target);
    await p.metric('index_jump', { target, position: at + 1, of: lines.length, ...(row.chat !== chats.MAIN ? { chat: row.chat } : {}) });
    return sendJson(res, 200, { ok: true });
  }
  // pilot-v0.10: apply or dismiss a frame proposal (only you; the frame role only proposes)
  if (pathname === '/frame') {
    const rev = body && body.rev !== undefined && body.rev !== null ? body.rev : undefined;
    const out = await p.frameAnswer(body && body.pane, body && body.id, body && body.action, rev, chat);
    return sendJson(res, out.code, out.body);
  }
  // pilot-v0.11: you move a task on the kanban (drag and drop or Alt+arrows)
  if (pathname === '/move') {
    const rev = body && body.rev !== undefined && body.rev !== null ? body.rev : undefined;
    const index = body && body.index !== undefined && body.index !== null ? body.index : undefined;
    const out = await p.move(body && body.itemId, body && body.column, index, rev, chat);
    return sendJson(res, out.code, out.body);
  }
  // pilot-v0.8: the page reports an interaction with a pane (a faded pane comes back)
  if (pathname === '/touch') {
    const out = await p.touch(body && body.module, body && body.how, chat);
    return sendJson(res, out.code, out.body);
  }
  if (pathname === '/command') {
    const out = await p.runCommand(String(body.text || ''), chat);
    return sendJson(res, out.ok ? 200 : 400, out);
  }
  // POST /chat
  const text = String(body.text || '').trim();
  if (!text) return sendJson(res, 400, { error: 'empty message' });
  return await p.chatTurn(text, chat, res);
}

server.listen(PORT, HOST, () => {
  if (SINGLE) open.get(SINGLE.id).p.start();   // pilot-v0.6 continuity: server_start (with PILOT_HOME: when a project is first opened)
  const where = SINGLE ? `data: ${path.relative(APP, PILOT)}/` : `projects: ${path.relative(APP, HOME)}/ (PILOT_HOME)`;
  console.log(`CLI Pilot on http://${HOST}:${PORT}  (config: ${path.relative(APP, configPath)}, ${where})`);
});
