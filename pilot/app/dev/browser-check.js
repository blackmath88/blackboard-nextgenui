#!/usr/bin/env node
// DEV ONLY. Drives the real page in headless Chrome over the DevTools protocol and prints PASS/FAIL.
// p1/p2: start their own fake models and server (PILOT_CONFIG=pilot.config.dev.json, ports 4747/5701/5702)
// and WIPE .pilot/ first. v03: own ports (4765/5766/5767, Chrome 9343) and its own dir .pilot-verify-v03b/,
// so it never touches .pilot/ or a running demo. v04 (pilot-v0.4 proposals): ports 4775/5776/5777, Chrome 9353,
// dir .pilot-verify-v04b/. v05 (pilot-v0.5 live files, c/r only on a focused card): ports 4785/5786/5787,
// Chrome 9363, dir .pilot-verify-v05b/; opens a second tab. v06 (pilot-v0.6 authorship, metrics, /stats): ports
// 4795/5796/5797, Chrome 9373, dir .pilot-verify-v06b/ seeded from demo/fixtures/v0.6/ (SHOT=<file.png> saves a
// screenshot). v07 (pilot-v0.7 /why and the layout fix): ports 4805/5806/5807, Chrome 9383, dir .pilot-verify-v07b/
// seeded from demo/fixtures/v0.7/ (SHOT=<dir> saves one screenshot per tested width). v08 (pilot-v0.8 panes can go):
// ports 4815/5816/5817, Chrome 9393, dir .pilot-verify-v08b/ seeded from demo/fixtures/v0.8/ (SHOT=<dir> saves screenshots).
// v09 (pilot-v0.9 settled input behind a flag): ports 4825/5826/5827, Chrome 9403, dir .pilot-verify-v09b/ seeded from
// demo/fixtures/v0.9/, config with experiments.settledInput false and settleMs 400 (fast; the 1800 default is checked
// in verify-v0.9.sh). v10 (pilot-v0.10 frame proposals behind a flag): ports 4835/5836/5837, Chrome 9413, dir
// .pilot-verify-v10b/ seeded from demo/fixtures/v0.10/, the dev config with experiments.frameProposals false (the page
// switches it on with /flag); the morrow fake answers frame requests with its default --frame=good (SHOT_DIR=<dir> saves
// screenshots).
// v11 (pilot-v0.11 kanban drag and drop): ports 4845/5846/5847, Chrome 9423, dir .pilot-verify-v11b/ seeded from
// demo/fixtures/v0.11/ with its config (kanban shown); real mouse drags, Alt+arrows, touch, a second tab (SHOT_DIR=<dir>).
// Needs Node 22+ (global WebSocket) and Google Chrome. No dependencies.
// v12 (pilot-v0.12 several chats): ports 4855/5856/5857, Chrome 9433, dir .pilot-verify-v12b/ seeded from demo/fixtures/v0.12/
// (chats/ included) with its config; sidebar, new chat, card tags, /why links, two tabs, Alt+S, the drawer (SHOT_DIR=<dir>).
// v13 (pilot-v0.13 projects): ports 4865/5866/5867, Chrome 9443, PILOT_HOME .pilot-verify-v13b/ seeded from demo/fixtures/v0.13/
// with its config; sidebar groups, project switch (board changes), Back, new chat in another project, new project, collapse,
// Alt+S, two tabs in two projects, the drawer, archive (SHOT_DIR=<dir>).
// Usage: node dev/browser-check.js [p1|p2|v03|v04|v05|v06|v07|v08|v09|v10|v11|v12|v13|all]     (CHROME=/path/to/chrome to override; all = p1 p2)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Per-scenario environment (see ENVS below); p1/p2 keep the P1/P2 ports and .pilot/.
let ENV = { url: 'http://127.0.0.1:4747/', fakes: [5701, 5702], dir: '.pilot', config: 'pilot.config.dev.json', cdp: 9333 };
let URL = ENV.url;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (!ok) fails++; };

// ---- processes ----
const procs = {};
function start(key, args, env = {}) {
  procs[key] = spawn(process.execPath, args, { cwd: APP, env: { ...process.env, ...env }, stdio: 'ignore' });
}
async function stop(key) { const p = procs[key]; if (!p) return; p.kill(); await new Promise((r) => p.exitCode !== null ? r() : p.once('exit', r)); delete procs[key]; }
// pilot-v0.13: ENV.home starts the server with PILOT_HOME (a projects home) instead of PILOT_DIR
async function startServer() { start('server', ['server.js'], { PILOT_CONFIG: ENV.config, ...(ENV.home ? { PILOT_HOME: ENV.dir, PILOT_DIR: `${ENV.dir}-default` } : { PILOT_DIR: ENV.dir, PILOT_HOME: '' }) }); await waitHttp(URL); }
async function waitHttp(url) { for (let i = 0; i < 50; i++) { try { await fetch(url); return; } catch { await sleep(100); } } throw new Error(`${url} did not come up`); }

// ---- minimal CDP client ----
async function openBrowser() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-cdp-'));
  const port = ENV.cdp;
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
    if (!target) await sleep(100);
  }
  const page = await connectTab(target);
  // pilot-v0.5: a second tab in the same browser (two tabs stay in sync)
  page.newTab = async () => connectTab(await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json());
  const closeFirst = page.close;
  page.close = () => { closeFirst(); chrome.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 300); };
  return page;
}

async function connectTab(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = {}; const net = []; const errors = [];
  ws.onmessage = (m) => {
    const j = JSON.parse(m.data);
    if (j.id && pending[j.id]) { pending[j.id](j); delete pending[j.id]; }
    if (j.method === 'Network.requestWillBeSent') net.push({ id: j.params.requestId, url: j.params.request.url, method: j.params.request.method });
    if (j.method === 'Network.loadingFailed') { const r = net.find((n) => n.id === j.params.requestId); if (r) r.failed = j.params.errorText; }
    if (j.method === 'Runtime.exceptionThrown') errors.push(j.params.exceptionDetails.exception ? j.params.exceptionDetails.exception.description : j.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  for (const m of ['Network.enable', 'Runtime.enable', 'Page.enable']) await send(m);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const page = {
    net, errors, send,
    async goto(url) { await send('Page.navigate', { url }); await sleep(700); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + expr);
      return r.result.result.value;
    },
    // modifiers (pilot-v0.11): CDP bit field, Alt = 1, Ctrl = 2, Meta = 4, Shift = 8
    async key(k, modifiers = 0) {
      const ARROWS = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Tab: 9, Escape: 27 };
      if (ARROWS[k]) {
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: ARROWS[k], modifiers });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: ARROWS[k], modifiers });
        return;
      }
      const enter = k === 'Enter';
      const vk = enter ? 13 : k.toUpperCase().charCodeAt(0);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: enter ? 'Enter' : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: vk, text: enter ? '\r' : k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: vk });
    },
    async type(text) { await page.eval(`document.getElementById('input').focus()`); await send('Input.insertText', { text }); },
    async submit(text, wait = 1800) { await page.type(text); await page.key('Enter'); await sleep(wait); },
    status() { return page.eval(`document.getElementById('models').textContent`); },
    close() { ws.close(); },
  };
  return page;
}

// ---- scenarios ----
async function p1(page) {
  await page.goto(URL);
  let s = await page.status();
  check('status bar shows active model per role on load', /chat: frontier( ·|$)/.test(s) && /extract: morrow/.test(s) && /title: none/.test(s), s);

  await page.submit('hello from the browser');
  const chatReq = page.net.filter((n) => n.url.endsWith('/chat'));
  check('POST /chat completes without net::ERR_ABORTED', chatReq.length === 1 && !chatReq[0].failed, chatReq.map((r) => r.failed || 'ok').join(','));
  check('streamed reply rendered with model frontier', await page.eval(`(() => { const l = [...document.querySelectorAll('.ln.assistant')].pop(); return l.textContent.includes('[fake:frontier]') && l.querySelector('.model').textContent === 'frontier'; })()`));

  await page.submit('/model chat morrow', 600);
  s = await page.status();
  // ADAPTED in pilot-v0.3: an explicit /model pins the role, the status bar shows "(pinned)".
  check('status bar shows chat: morrow after /model', /chat: morrow( \(pinned\))?( ·|$)/.test(s), s);
  await page.submit('this is private now');
  check('next assistant line records morrow', await page.eval(`(() => { const l = [...document.querySelectorAll('.ln.assistant')].pop(); return l.textContent.includes('[fake:morrow]') && l.querySelector('.model').textContent === 'morrow'; })()`));

  // ADAPTED in pilot-v0.3: was "/model chat frontier", which now pins frontier (no fallback). auto restores the policy.
  await page.submit('/model chat auto', 600);
  await stop('f1');
  await page.submit('frontier is down now');
  s = await page.status();
  check('status bar shows frontier→morrow after a fallback', /chat: frontier→morrow/.test(s), s);

  await stop('server'); await startServer(); await page.goto(URL);
  s = await page.status();
  check('status bar after restart shows the persisted choice', /chat: frontier( ·|$)/.test(s) && /extract: morrow/.test(s), s);
  start('f1', ['dev/fake-model.js', '5701', 'frontier']); await sleep(300);
}

function editJson(file, fn) {
  const f = path.join(APP, ENV.dir, file);
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j);
  fs.writeFileSync(f, JSON.stringify(j, null, 2));
}

async function p2(page) {
  editJson('rules.json', (r) => { r.rules.find((x) => x.module === 'index').threshold = 4; });
  await page.goto(URL);
  await page.eval(`(() => { const o = document.startViewTransition && document.startViewTransition.bind(document); window.__vt = 0;
    if (o) document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; })()`);
  await page.submit('first message');
  check('no question below the threshold', await page.eval(`document.querySelectorAll('.ln.controller').length === 0`));
  await page.submit('second message');
  check('controller asks at the threshold with y/n/a/x buttons', await page.eval(`document.querySelectorAll('.ln.controller.pending .key').length === 4`),
    await page.eval(`(document.querySelector('.ln.controller') || {}).textContent || 'none'`));
  check('only the chat pane before an answer (n1)', await page.eval(`document.getElementById('bench').className === 'bench n1'`));

  await page.eval(`document.getElementById('input').focus()`);
  await page.key('y'); await sleep(900);
  check('y adds the index pane (n2 layout)', await page.eval(`!!document.getElementById('pane-index') && document.getElementById('bench').className === 'bench n2'`));
  check('the y keystroke was not typed into the input', await page.eval(`document.getElementById('input').value === ''`));
  check('pane change used a View Transition', await page.eval(`window.__vt === 1 || !document.startViewTransition`), `calls: ${await page.eval('window.__vt')}`);
  const mods = JSON.parse(fs.readFileSync(path.join(APP, '.pilot', 'modules.json'), 'utf8'));
  check('modules.json records the answer yes and the pane', mods.answers.index.answer === 'yes' && mods.panes[0].module === 'index');

  for (let i = 3; i <= 8; i++) await page.submit(`message number ${i} to fill the terminal`, 1500);
  const inView = `(() => { const log = document.getElementById('log').getBoundingClientRect(); const el = document.querySelector('.ln.user').getBoundingClientRect();
    return el.top >= log.top && el.bottom <= log.bottom; })()`;
  check('first message is scrolled out of view before the click', !(await page.eval(inView)));
  await page.eval(`document.querySelector('#pane-index .idx button').click()`); await sleep(900);
  check('clicking the first index entry scrolls the chat to that message', await page.eval(inView));
  check('the target line is highlighted', await page.eval(`document.querySelector('.ln.user').classList.contains('flash')`));

  // 3 and 4 panes, with reduced motion: no View Transition, instant swap.
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const now = new Date().toISOString();
  editJson('modules.json', (m) => { m.panes.push({ module: 'map', addedAt: now, atCount: 0 }); m.answers.map = { answer: 'yes', at: now, count: 0 }; });
  await page.submit('/panes', 600);
  check('3 panes use the n3 template', await page.eval(`document.getElementById('bench').className === 'bench n3' && !!document.getElementById('pane-map')`));
  editJson('modules.json', (m) => { m.panes.push({ module: 'kanban', addedAt: now, atCount: 0 }); m.answers.kanban = { answer: 'yes', at: now, count: 0 }; });
  await page.submit('/panes', 600);
  check('4 panes use the n4 template', await page.eval(`document.getElementById('bench').className === 'bench n4' && document.querySelectorAll('.pane').length === 4`));
  check('reduced motion: panes swapped without a View Transition', await page.eval(`window.__vt === 1 || !document.startViewTransition`), `calls: ${await page.eval('window.__vt')}`);
  const layout = await page.eval(`[...document.querySelectorAll('.pane')].map(p => { const r = p.getBoundingClientRect(); return p.id + ':' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }).join(' | ')`);
  check('n4: chat on the left, three side panes stacked on the right', await page.eval(`(() => { const [c, ...s] = [...document.querySelectorAll('.pane')].map(p => p.getBoundingClientRect());
    return s.every(r => r.left > c.right - 1) && s[0].top < s[1].top && s[1].top < s[2].top; })()`), layout);
}

// pilot-v0.3: consent keys act only on an empty input; pin in the status bar; pastel palette and light/dark.
async function v03(page) {
  editJson('rules.json', (r) => { r.rules.find((x) => x.module === 'index').threshold = 4; });
  await page.goto(URL);
  const answers = () => page.net.filter((n) => n.url.endsWith('/answer')).length;
  const pending = async () => (await (await fetch(URL + 'state')).json()).pending;
  const val = () => page.eval(`document.getElementById('input').value`);

  let s = await page.status();
  check('status bar without a pin shows no "(pinned)"', /chat: frontier( ·|$)/.test(s) && !/pinned/.test(s), s);
  await page.submit('/model chat morrow', 600);
  s = await page.status();
  check('status bar shows chat: morrow (pinned) after /model chat morrow', /chat: morrow \(pinned\)/.test(s), s);
  await page.submit('/model chat auto', 600);
  s = await page.status();
  check('status bar after /model chat auto: chat: frontier, not pinned', /chat: frontier( ·|$)/.test(s) && !/pinned/.test(s), s);

  await page.submit('first message');
  await page.submit('second message');
  check('question pending with buttons', (await pending()) === 'index' && await page.eval(`document.querySelectorAll('.ln.controller.pending .key').length === 4`));

  await page.type('hello ');
  for (const k of ['y', 'n', 'a', 'x']) await page.key(k);
  await sleep(500);
  check('non-empty input: y/n/a/x stay text', (await val()) === 'hello ynax', JSON.stringify(await val()));
  check('non-empty input: no answer sent, question still pending', answers() === 0 && (await pending()) === 'index');

  await page.eval(`document.getElementById('input').value = ''`);
  await page.type(' ');
  await page.key('y'); await sleep(400);
  check('input with only a space is not empty: y stays text', (await val()) === ' y' && answers() === 0 && (await pending()) === 'index', JSON.stringify(await val()));

  await page.eval(`document.getElementById('input').value = ''`);
  await page.eval(`document.getElementById('input').focus()`);
  await page.key('n'); await sleep(900);
  check('empty input: n answers the question', answers() === 1 && (await pending()) === null && (await val()) === '');
  const mods = JSON.parse(fs.readFileSync(path.join(APP, ENV.dir, 'modules.json'), 'utf8'));
  check('modules.json records answer no', mods.answers.index.answer === 'no');

  for (let i = 3; i <= 4; i++) await page.submit(`message ${i}`);
  check('asked again after the count doubled', (await pending()) === 'index');
  await page.type('my draft');
  await page.eval(`document.querySelector('.ln.controller.pending .key[data-answer="yes"]').click()`); await sleep(900);
  check('button works while the input has text; draft kept', !!(await page.eval(`!!document.getElementById('pane-index')`)) && (await val()) === 'my draft', JSON.stringify(await val()));

  await page.eval(`document.getElementById('input').value = ''`);
  // Palette: colours come from CSS variables, sprites included; light variant via prefers-color-scheme and /theme.
  const look = () => page.eval(`(() => { const r = document.querySelector('#brand svg rect'); return {
    bg: getComputedStyle(document.body).backgroundColor, sprite: getComputedStyle(r).fill, attr: r.getAttribute('fill'),
    status: getComputedStyle(document.getElementById('status')).backgroundColor }; })()`);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(200);
  let l = await look();
  check('dark: page background #1e1f2b, status bar lavender', l.bg === 'rgb(30, 31, 43)' && l.status === 'rgb(195, 177, 225)', JSON.stringify(l));
  check('sprite fill comes from a CSS variable and resolves to the palette (dark --px-d = muted)', /^var\(--px-/.test(l.attr) && l.sprite === 'rgb(154, 151, 176)', `${l.attr} -> ${l.sprite}`);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }); await sleep(200);
  l = await look();
  check('light (OS preference): base #f4f5fa, sprite recoloured (--px-d = lavender)', l.bg === 'rgb(244, 245, 250)' && l.sprite === 'rgb(195, 177, 225)', JSON.stringify(l));
  await page.submit('/theme dark', 300);
  l = await look();
  check('/theme dark overrides the light preference', l.bg === 'rgb(30, 31, 43)', JSON.stringify(l) + ' theme=' + await page.eval(`document.documentElement.dataset.theme + ' | ' + [...document.querySelectorAll('.ln.out')].map(e => e.textContent).join(' / ')`));
  check('/theme is handled in the page, not sent to the server', page.net.filter((n) => n.url.endsWith('/command')).length === 2);
  await page.submit('/theme auto', 300);
  l = await look();
  check('/theme auto follows the OS again (light)', l.bg === 'rgb(244, 245, 250)', JSON.stringify(l));
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT_DIR) fs.writeFileSync(path.join(process.env.SHOT_DIR, 'v03-light.png'), Buffer.from(shot.result.data, 'base64'));
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }); await sleep(200);
  const shot2 = await page.send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT_DIR) fs.writeFileSync(path.join(process.env.SHOT_DIR, 'v03-dark.png'), Buffer.from(shot2.result.data, 'base64'));
}

// pilot-v0.4: proposals in the map and kanban panes; c/r keys (empty input or focused card), buttons, styles,
// rejected toggle, pickup of a background extraction without reload, hand-added items shown solid.
async function v04(page) {
  const at = (m) => new Date(Date.UTC(2026, 9, 17, 9, m)).toISOString();
  const file = (f) => path.join(APP, ENV.dir, f);
  fs.writeFileSync(file('state.json'), JSON.stringify({ rev: 1, items: [
    { id: 'dec-1', kind: 'decision', text: 'keep the claim local', status: 'confirmed', author: 'model', model: 'morrow', quote: 'Decision: keep the claim local.', fromMessage: 'm-x1', createdAt: at(1), decidedAt: at(2), decidedBy: 'user' },
    { id: 'dec-2', kind: 'decision', text: 'write the letter in German', status: 'proposed', author: 'model', model: 'morrow', quote: 'Decision: write the letter in German.', fromMessage: 'm-x1', createdAt: at(1) },
    { id: 'dec-3', kind: 'decision', text: 'use a paid cloud model', status: 'rejected', author: 'model', model: 'morrow', quote: 'Decision: use a paid cloud model.', fromMessage: 'm-x1', createdAt: at(1), decidedAt: at(3), decidedBy: 'user' },
    { id: 'task-1', kind: 'task', text: 'scan the invoice', status: 'confirmed', author: 'user', createdAt: at(4), column: 'done' },
  ] }, null, 2));
  fs.writeFileSync(file('modules.json'), JSON.stringify({ rev: 1, panes: [{ module: 'map', addedAt: at(5), atCount: 2 }], answers: { map: { answer: 'yes', at: at(5), count: 2 } }, pending: null }, null, 2));
  editJson('rules.json', (r) => { r.rules.find((x) => x.module === 'index').threshold = 50; r.rules.find((x) => x.module === 'kanban').threshold = 2; });
  await page.goto(URL);
  const answers = () => page.net.filter((n) => n.url.endsWith('/answer')).length;
  const items = () => JSON.parse(fs.readFileSync(file('state.json'), 'utf8')).items;
  const item = (id) => items().find((i) => i.id === id);
  const card = (id) => `document.querySelector('.item[data-id="${id}"]')`;
  const style = (id) => page.eval(`(() => { const c = ${card(id)}; if (!c) return null; const s = getComputedStyle(c);
    return { style: s.borderTopStyle, color: s.borderTopColor, meta: c.querySelector('.meta').textContent, selected: c.classList.contains('selected') }; })()`);
  const waitFor = async (expr, ms = 5000) => { for (let t = 0; t < ms; t += 100) { if (await page.eval(expr)) return true; await sleep(100); } return false; };
  const LAV = 'rgb(195, 177, 225)', MINT = 'rgb(168, 230, 207)', ROSE = 'rgb(244, 166, 184)';

  check('map pane shown (consented), no kanban pane yet (no answer)', await page.eval(`!!document.getElementById('pane-map') && !document.getElementById('pane-kanban')`));
  let s2 = await style('dec-2');
  // ADAPTED in pilot-v0.5: was "... highlighted"; only a focused card is outlined now, so no outline before focus.
  check('proposal dec-2: dashed lavender border, "model · morrow", not outlined before it has focus', s2 && s2.style === 'dashed' && s2.color === LAV && /dec-2 · model · morrow · proposed/.test(s2.meta) && !s2.selected, JSON.stringify(s2));
  const s1 = await style('dec-1');
  check('confirmed dec-1: solid mint border', s1 && s1.style === 'solid' && s1.color === MINT, JSON.stringify(s1));
  check('rejected dec-3 hidden; pane bar toggle "rejected: 1 (show)"', !(await style('dec-3')) && await page.eval(`document.querySelector('#pane-map .bar .toggle').textContent === 'rejected: 1 (show)'`));
  await page.eval(`document.querySelector('#pane-map .bar .toggle').click()`); await sleep(200);
  const s3 = await style('dec-3');
  check('toggle shows dec-3 with a solid rose border', s3 && s3.style === 'solid' && s3.color === ROSE, JSON.stringify(s3));
  await page.eval(`document.querySelector('#pane-map .bar .toggle').click()`); await sleep(200);
  check('toggle hides it again', !(await style('dec-3')));

  await page.type('cr');
  for (const k of ['c', 'r']) await page.key(k);
  await sleep(400);
  check('non-empty input: c and r stay text, nothing decided', (await page.eval(`document.getElementById('input').value`)) === 'crcr' && answers() === 0 && item('dec-2').status === 'proposed');
  await page.eval(`document.getElementById('input').value = ''`);
  await page.eval(`document.getElementById('input').focus()`);
  // ADAPTED in pilot-v0.5: was "empty input: c confirms the highlighted proposal". c/r never act from the input now;
  // ArrowDown moves focus to the newest proposal, which is then outlined, and c there confirms it.
  await page.key('c'); await sleep(400);
  check('empty input: c is text and decides nothing', (await page.eval(`document.getElementById('input').value`)) === 'c' && answers() === 0 && item('dec-2').status === 'proposed');
  await page.eval(`document.getElementById('input').value = ''`);
  await page.key('ArrowDown'); await sleep(100);
  check('ArrowDown from the empty input focuses the proposal dec-2, which is then outlined', await page.eval(`document.activeElement.dataset.id === 'dec-2'`) && !!(await style('dec-2')).selected);
  await page.key('c'); await sleep(700);
  const d2 = item('dec-2');
  check('c on the focused card confirms it (state.json: confirmed, decidedAt, decidedBy user)', d2.status === 'confirmed' && !!d2.decidedAt && d2.decidedBy === 'user', JSON.stringify(d2));
  s2 = await style('dec-2');
  // ADAPTED in pilot-v0.5: was "focus back in the input"; focus now stays in the pane and Escape returns to the input.
  check('confirmed card turns solid mint, focus stays on the card', s2 && s2.style === 'solid' && s2.color === MINT && await page.eval(`document.activeElement.dataset.id === 'dec-2'`), JSON.stringify(s2));
  await page.key('Escape'); await sleep(100);
  check('Escape on a card returns focus to the chat input', await page.eval(`document.activeElement.id === 'input'`));

  const t0 = Date.now();
  await page.submit('Decision: ship the board today. Task: test the keys. Task: write the notes.', 100);
  const appeared = await waitFor(`!!${card('dec-4')} && !!document.querySelector('.ln.controller.pending')`, 6000);
  check('after one message a dashed dec-4 appears and the kanban question asks, without a reload', appeared && (await style('dec-4') || {}).style === 'dashed', `${Date.now() - t0} ms`);
  // ADAPTED in pilot-v0.5: pickup is by SSE now (polling only without SSE); the assertion itself is unchanged.
  check('page loaded once (pickup without navigation)', page.net.filter((n) => n.url === URL).length === 1);
  // ADAPTED in pilot-v0.6: the line now starts with its author label "controller"; the question is its .text part.
  check('kanban question counts proposed + confirmed tasks (3)', await page.eval(`/^3 tasks/.test(document.querySelector('.ln.controller.pending .text').textContent)`));
  await page.eval(`document.getElementById('input').focus()`);
  await page.key('y'); await sleep(900);
  check('y adds the kanban pane; tasks in columns (task-1 in done)', await page.eval(`!!document.querySelector('#pane-kanban .col.done .item[data-id="task-1"]') && !!document.querySelector('#pane-kanban .col.todo .item[data-id="task-2"]')`));
  const u = await style('task-1');
  check('hand-added task-1 (author user) is solid and says "you"', u && u.style === 'solid' && /task-1 · you/.test(u.meta), JSON.stringify(u));
  // ADAPTED in pilot-v0.5: was "highlight = newest proposal (task-3)" and "empty input: r rejects it". The newest
  // proposal is now where ArrowDown from the empty input lands; r acts on it there.
  await page.eval(`document.getElementById('input').focus()`);
  await page.key('r'); await sleep(300);
  check('empty input: r is text and decides nothing', (await page.eval(`document.getElementById('input').value`)) === 'r' && item('task-3').status === 'proposed');
  await page.eval(`document.getElementById('input').value = ''`);
  await page.key('ArrowDown'); await sleep(100);
  const newest = await page.eval(`(document.querySelector('.item.selected') || {}).dataset?.id || null`);
  check('ArrowDown from the empty input focuses and outlines the newest proposal (task-3)', newest === 'task-3' && await page.eval(`document.activeElement.dataset.id === 'task-3'`), newest);
  await page.key('r'); await sleep(700);
  check('r on the focused card rejects it (rejected, decidedBy user) and it is hidden', item('task-3').status === 'rejected' && item('task-3').decidedBy === 'user' && !(await style('task-3')));

  await page.eval(`${card('dec-4')}.focus()`);
  await page.key('ArrowDown'); await sleep(100);
  check('ArrowDown on a focused card moves focus to the next card', await page.eval(`document.activeElement.classList.contains('item') && document.activeElement.dataset.id !== 'dec-4'`), await page.eval(`document.activeElement.dataset.id || document.activeElement.id`));
  await page.eval(`document.getElementById('input').focus()`);
  let tabs = 0;
  while (tabs < 20 && !(await page.eval(`document.activeElement.dataset && document.activeElement.dataset.id === 'task-2'`))) { await page.key('Tab'); tabs++; }
  check('Tab from the input reaches the task-2 card, and the focused card is highlighted', tabs < 20 && !!(await style('task-2')).selected, `${tabs} Tab presses`);
  await page.key('c'); await sleep(700);
  check('c on a focused card confirms that card', item('task-2').status === 'confirmed' && item('dec-4').status === 'proposed');
  await page.eval(`${card('dec-4')}.querySelector('.key[data-decision="reject"]').click()`); await sleep(700);
  check('reject button works', item('dec-4').status === 'rejected');
  check('map shows decisions as a chain (connector between cards)', await page.eval(`getComputedStyle(document.querySelector('#pane-map .chain .item + .item'), '::before').borderLeftStyle === 'solid'`));
  check('decisions are system lines in the chat', await page.eval(`[...document.querySelectorAll('.ln.system')].some(l => /dec-4 rejected/.test(l.textContent))`));

  const st = JSON.parse(fs.readFileSync(file('state.json'), 'utf8'));
  st.items.push({ id: 'task-9', kind: 'task', text: 'added by hand', status: 'confirmed', author: 'user', createdAt: new Date().toISOString(), column: 'doing' });
  fs.writeFileSync(file('state.json'), JSON.stringify(st, null, 2));
  // ADAPTED in pilot-v0.5: was "after the next state load" (it sent /panes first); now it shows by itself (SSE).
  await sleep(1000);
  const h = await style('task-9');
  check('hand edit of state.json shows without any action: solid, "you", in doing', h && h.style === 'solid' && /you/.test(h.meta) && await page.eval(`!!document.querySelector('#pane-kanban .col.doing .item[data-id="task-9"]')`), JSON.stringify(h));
}

// pilot-v0.5: live files. Two tabs stay in sync; a hand edit shows within 1 s (measured hand edit -> DOM); a stale
// write is rejected and the page reloads with a notice; a broken file shows "not valid JSON, showing last good
// version"; reconnect after a server restart; fallback without EventSource; c/r only on a focused card.
const timings = {};
async function v05(page) {
  const at = (m) => new Date(Date.UTC(2026, 9, 17, 9, m)).toISOString();
  const file = (f) => path.join(APP, ENV.dir, f);
  const prop = (id, text) => ({ id, kind: 'decision', text, status: 'proposed', author: 'model', model: 'morrow', quote: `Decision: ${text}.`, fromMessage: 'm-x1', createdAt: at(1) });
  fs.writeFileSync(file('state.json'), JSON.stringify({ rev: 1, items: [
    { id: 'dec-1', kind: 'decision', text: 'keep the claim local', status: 'confirmed', author: 'model', model: 'morrow', quote: 'Decision: keep the claim local.', fromMessage: 'm-x1', createdAt: at(1), decidedAt: at(2), decidedBy: 'user' },
    prop('dec-2', 'write the letter in German'), prop('dec-5', 'send it by registered mail'), prop('dec-6', 'ask the insurer first'),
  ] }, null, 2));
  fs.writeFileSync(file('modules.json'), JSON.stringify({ rev: 1, panes: [{ module: 'map', addedAt: at(5), atCount: 2 }], answers: { map: { answer: 'yes', at: at(5), count: 2 } }, pending: null }, null, 2));
  editJson('rules.json', (r) => { r.rules.forEach((x) => { x.threshold = 50; }); });
  const items = () => JSON.parse(fs.readFileSync(file('state.json'), 'utf8')).items;
  const item = (id) => items().find((i) => i.id === id);
  const editState = (fn) => { const j = JSON.parse(fs.readFileSync(file('state.json'), 'utf8')); fn(j); fs.writeFileSync(file('state.json'), JSON.stringify(j, null, 2)); };
  const waitFor = async (pg, expr, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pg.eval(expr)) return Date.now() - t0; await sleep(15); } return null; };
  const cardText = (id) => `(document.querySelector('.item[data-id="${id}"] .text') || {}).textContent`;
  const tagOf = (id) => `(document.querySelector('.item[data-id="${id}"] .tag') || {}).textContent`;
  const notice = `(document.getElementById('notice').hidden ? '' : document.getElementById('notice').textContent)`;

  const b = await page.newTab();
  await page.goto(URL); await b.goto(URL);
  const liveA = await waitFor(page, `document.getElementById('meta').textContent.includes('live')`);
  const liveB = await waitFor(b, `document.getElementById('meta').textContent.includes('live')`);
  check('both tabs connect to /events (status bar meta says "live")', liveA !== null && liveB !== null);

  // c/r never act from the chat input (QUESTIONS.md 2026-10-17, closed in v0.5)
  await page.eval(`document.getElementById('input').focus()`);
  for (const k of ['c', 'r']) await page.key(k);
  await sleep(300);
  check('c and r typed into the empty input are text and decide nothing', (await page.eval(`document.getElementById('input').value`)) === 'cr' && items().filter((i) => i.status === 'proposed').length === 3);
  check('placeholder no longer offers c/r from the input', await page.eval(`(() => { const i = document.getElementById('input'); const v = i.value; i.value = ''; const p = i.placeholder; i.value = v; return !p.includes('c/r confirm') && p.includes('Tab'); })()`));
  await page.eval(`document.getElementById('input').value = ''`);

  // two tabs: confirm in A (Tab presses into the map), watch B
  let tabs = 0;
  while (tabs < 20 && !(await page.eval(`document.activeElement.dataset && document.activeElement.dataset.id === 'dec-2'`))) { await page.key('Tab'); tabs++; }
  check('Tab from the input reaches dec-2; the focused proposal is outlined', tabs < 20 && await page.eval(`document.querySelector('.item[data-id="dec-2"]').classList.contains('selected')`), `${tabs} Tab presses`);
  const t0 = Date.now();
  await page.key('c');
  const synced = await waitFor(b, `${tagOf('dec-2')} === 'confirmed'`);
  timings.tabSyncMs = synced === null ? null : Date.now() - t0;
  check('confirm in tab A shows in tab B within 1 s, without a reload', synced !== null && timings.tabSyncMs < 1000 && b.net.filter((n) => n.url === URL).length === 1, `${timings.tabSyncMs} ms after the keypress`);

  // hand edit -> DOM, measured three times in tab B
  const lat = [];
  for (let i = 1; i <= 3; i++) {
    const text = `hand edited ${i}`;
    const h0 = Date.now();
    editState((j) => { j.items.find((x) => x.id === 'dec-1').text = text; });
    const ms = await waitFor(b, `${cardText('dec-1')} === ${JSON.stringify(text)}`);
    lat.push(ms === null ? null : Date.now() - h0);
    await sleep(250);
  }
  timings.handEditToDomMs = lat;
  check('hand edit of state.json appears in the page within 1 s (3 runs, hand edit -> DOM)', lat.every((x) => x !== null && x < 1000), `${lat.join(', ')} ms`);
  check('hand edit appears in tab A too', await page.eval(`${cardText('dec-1')} === 'hand edited 3'`));

  // stale rev: tab B stops listening, the file changes (rev + 1), B confirms dec-5 with its old rev -> 409, reload, notice
  await b.eval(`es.close(); live = false; true`);
  editState((j) => { j.rev += 1; j.items.find((x) => x.id === 'dec-1').text = 'changed behind B'; });
  await sleep(400);
  check('tab B without SSE still shows the old text (setup)', await b.eval(`${cardText('dec-1')} === 'hand edited 3'`));
  await b.eval(`document.querySelector('.item[data-id="dec-5"]').focus()`);
  await b.key('c');
  const reloaded = await waitFor(b, `${cardText('dec-1')} === 'changed behind B'`);
  const n1 = await b.eval(notice);
  check('stale write: rejected (dec-5 still proposed), tab B reloads state and shows a short notice', item('dec-5').status === 'proposed' && reloaded !== null && /changed since this page last saw it/.test(n1), n1);
  check('the stale write is not an error line in the chat', await b.eval(`![...document.querySelectorAll('.ln.out.err')].some(l => /changed since/.test(l.textContent))`));
  await b.eval(`document.querySelector('.item[data-id="dec-5"]').focus()`);
  await b.key('c');
  await sleep(600);
  check('after the reload the same keypress goes through (dec-5 confirmed)', item('dec-5').status === 'confirmed');

  // broken hand edits: the last good version stays visible with a notice, until the file is fixed
  const good = fs.readFileSync(file('state.json'), 'utf8');
  fs.writeFileSync(file('state.json'), good + 'oops');
  const brokenMs = await waitFor(page, `${notice}.includes('file state.json is not valid JSON, showing last good version')`);
  check('broken state.json: notice "file state.json is not valid JSON, showing last good version" within 1 s; cards still shown', brokenMs !== null && brokenMs < 1000 && await page.eval(`${tagOf('dec-5')} === 'confirmed' && !!document.querySelector('.item[data-id="dec-6"]')`), `${brokenMs} ms`);
  await page.eval(`document.querySelector('.item[data-id="dec-6"] .key[data-decision="confirm"]').click()`); await sleep(500);
  check('confirm while state.json is broken: error line, file untouched', fs.readFileSync(file('state.json'), 'utf8') === good + 'oops' && await page.eval(`[...document.querySelectorAll('.ln.out.err')].some(l => /not valid JSON/.test(l.textContent))`));
  fs.writeFileSync(file('state.json'), good);
  const fixedMs = await waitFor(page, `${notice} === ''`);
  check('fixing state.json removes the notice', fixedMs !== null, `${fixedMs} ms`);
  const mods = fs.readFileSync(file('modules.json'), 'utf8');
  fs.writeFileSync(file('modules.json'), '{"rev": 1, "panes": [');
  const mMs = await waitFor(page, `${notice}.includes('file modules.json is not valid JSON, showing last good version')`);
  check('broken modules.json: notice, the map pane stays (last good version)', mMs !== null && await page.eval(`!!document.getElementById('pane-map')`), `${mMs} ms`);
  fs.writeFileSync(file('modules.json'), mods);
  check('fixing modules.json removes the notice', (await waitFor(page, `${notice} === ''`)) !== null);

  // reconnect: restart the server, edit while it is down; tab A reconnects by itself and catches up
  await stop('server');
  editState((j) => { j.items.find((x) => x.id === 'dec-1').text = 'edited while the server was down'; });
  await startServer();
  const back = await waitFor(page, `${cardText('dec-1')} === 'edited while the server was down' && document.getElementById('meta').textContent.includes('live')`, 5000);
  check('after a server restart tab A reconnects and shows an edit made while it was down', back !== null, `${back} ms after the restart`);

  // fallback: a tab without EventSource refreshes after its own actions and polls during an extraction
  const c = await page.newTab();
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.EventSource; window.EventSource = undefined;' });
  await c.goto(URL);
  check('tab without EventSource: no /events request, meta "ready"', !c.net.some((n) => n.url.endsWith('/events')) && (await c.eval(`document.getElementById('meta').textContent`)) === 'ready');
  await c.eval(`document.querySelector('.item[data-id="dec-6"] .key[data-decision="reject"]').click()`);
  const fb = await waitFor(c, `!document.querySelector('.item[data-id="dec-6"]')`);
  check('tab without SSE: reject button -> the card updates (refresh after the action)', fb !== null && item('dec-6').status === 'rejected');
  await c.submit('Decision: keep the fallback simple.', 100);
  const fbx = await waitFor(c, `!!document.querySelector('.item[data-id="dec-7"]')`, 6000);
  check('tab without SSE: a proposal from the background extraction appears without a reload (polling)', fbx !== null && c.net.filter((n) => n.url === URL).length === 1);
  check('tab B (and A) got dec-7 by SSE as well', (await waitFor(page, `!!document.querySelector('.item[data-id="dec-7"]')`)) !== null);
  check('no uncaught page errors in tabs B and C', b.errors.length === 0 && c.errors.length === 0, [...b.errors, ...c.errors].join(' | '));
  b.close(); c.close();
  console.log(`TIMING tab sync ${timings.tabSyncMs} ms; hand edit -> DOM ${lat.join(', ')} ms`);
}

// pilot-v0.6: authorship on lines, cards and panes; hand edits as "you (file edit)"; index jumps; /stats in the page.
async function v06(page) {
  const file = (f) => path.join(APP, ENV.dir, f);
  await stop('server');   // reseed from the v0.6 fixture before the server starts (its server_start counts the files)
  const fix = path.join(APP, 'demo', 'fixtures', 'v0.6');
  for (const f of fs.readdirSync(fix)) if (!['demo.json', 'pilot.config.json'].includes(f)) fs.copyFileSync(path.join(fix, f), file(f));
  await startServer();
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });   // the page shows local time; fixture times are UTC
  const waitFor = async (expr, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr)) return Date.now() - t0; await sleep(15); } return null; };
  const meta = (id) => `((document.querySelector('.item[data-id="${id}"] .meta') || {}).textContent || '')`;
  const editState = (fn) => { const j = JSON.parse(fs.readFileSync(file('state.json'), 'utf8')); fn(j); fs.writeFileSync(file('state.json'), JSON.stringify(j, null, 2)); };
  const events = () => fs.readFileSync(file('metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  // a label's colours (text|fill) must be its role pair: --you-fg/--you-bg (peach), --pilot-* (sky), --ctl-* (lavender).
  // Dark mode: pastel text, no fill; light mode: ink on the pastel fill. Either way the pair names the role.
  const color = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const c = getComputedStyle(e); return c.color + '|' + c.backgroundColor; })()`;
  const token = (r) => page.eval(`(() => { const d = document.createElement('span'); d.style.color = 'var(--${r}-fg)'; d.style.background = 'var(--${r}-bg)'; document.body.append(d); const c = getComputedStyle(d); const v = c.color + '|' + c.backgroundColor; d.remove(); return v; })()`);
  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);
  const [peach, sky, lav] = [await token('you'), await token('pilot'), await token('ctl')];
  check('(setup) the three role pairs differ', new Set([peach, sky, lav]).size === 3, [peach, sky, lav].join(' / '));

  // transcript lines: you / model + name / controller / system, in the palette roles
  const lines = await page.eval(`(() => { const one = (s) => document.querySelector(s); const t = (e) => e ? e.querySelector('.who').textContent : null;
    return { user: t(one('.ln.user')), userA: one('.ln.user').dataset.author, asst: t(one('.ln.assistant')), asstModel: one('.ln.assistant .model').textContent,
      ctl: (one('.ln.controller .who .role') || {}).textContent, sys: t(one('.ln.system')), sysA: one('.ln.system').dataset.author,
      title: one('.ln.assistant').title }; })()`);
  check('transcript: every line names its author (you / model + model name / controller / system)', lines.user === 'you' && lines.userA === 'you' && lines.asst === 'model'
    && lines.asstModel === 'frontier' && lines.ctl === 'controller' && lines.sys === 'system' && lines.sysA === 'system' && lines.title === 'authored by model · frontier', JSON.stringify(lines));
  check('transcript labels use the palette roles: peach you, sky model, lavender controller', (await page.eval(color('.ln.user .who'))) === peach
    && (await page.eval(color('.ln.assistant .who'))) === sky && (await page.eval(color('.ln.controller .who .role'))) === lav);

  // cards: author, decided by, hand edits
  const m = {};
  for (const id of ['dec-1', 'dec-7', 'dec-8', 'task-1', 'task-7']) m[id] = await page.eval(meta(id));
  check('model item decided through the page: "model · morrow · confirmed · confirmed by you <time>"', /^dec-1 · model · morrow · confirmed · confirmed by you 10-14 \d\d:\d\d$/.test(m['dec-1']), m['dec-1']);
  check('pristine proposal: "model · morrow · proposed", no file-edit mark', m['dec-7'] === 'dec-7 · model · morrow · proposed', m['dec-7']);
  check('status flipped in the file: "confirmed by you (file edit)"', m['dec-8'] === 'dec-8 · model · morrow · confirmed · confirmed by you (file edit)', m['dec-8']);
  check('column moved in the file: "edited by you (file edit): column"', /edited by you \(file edit\): column$/.test(m['task-1']) && /confirmed by you 10-14/.test(m['task-1']), m['task-1']);
  check('item added in the file: "task-7 · you (file edit) · confirmed"', m['task-7'] === 'task-7 · you (file edit) · confirmed', m['task-7']);
  check('the proposed tag is not drawn in the controller pair (lavender stays the controller\'s)', (await page.eval(color('.item[data-id="dec-7"] .tag'))) !== lav);
  check('times on cards are local with the ISO timestamp as tooltip', await page.eval(`(() => { const w = document.querySelector('.item[data-id="dec-1"] .when'); return !!w && /^\\d{4}-\\d\\d-\\d\\dT/.test(w.title); })()`));
  check('card chips: model sky, you peach', (await page.eval(color('.item[data-id="dec-1"] .by.model'))) === sky && (await page.eval(color('.item[data-id="dec-8"] .by.you:last-child'))) === peach);

  // panes: which rule, which answer
  const bars = await page.eval(`Object.fromEntries(['index', 'map', 'kanban'].map((m) => [m, (document.querySelector('#pane-' + m + ' .pby') || {}).textContent]))`);
  check('pane bars name the rule (controller) and the answer (you)', /^controller · messages ≥ 12 · you: yes 10-15 14:14$/.test(bars.index) && /^controller · decisions ≥ 2 · you: yes/.test(bars.map)
    && /^controller · tasks ≥ 3 · you: always/.test(bars.kanban), JSON.stringify(bars));
  check('pane bar chips: controller lavender, you peach', (await page.eval(color('#pane-index .pby .by.ctl'))) === lav && (await page.eval(color('#pane-index .pby .by.you'))) === peach);

  // hand edits while the page is open (the coordinator's v0.5 note: a hand-made decision must not read as by-model)
  const t0 = Date.now();
  editState((j) => { j.items.find((i) => i.id === 'dec-7').status = 'confirmed'; });
  const ms = await waitFor(`${meta('dec-7')}.endsWith('confirmed by you (file edit)')`);
  check('hand edit (dec-7 proposed -> confirmed): the card says "confirmed by you (file edit)" within 1 s', ms !== null && Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  await sleep(400);
  check('the watcher logged file_edit {itemId: dec-7, fields: [status]}', events().some((e) => e.event === 'file_edit' && e.itemId === 'dec-7' && e.fields.join() === 'status'));
  editState((j) => { j.items.find((i) => i.id === 'dec-7').status = 'proposed'; });
  check('flipped back by hand: the card is pristine again ("model · morrow · proposed")', (await waitFor(`${meta('dec-7')} === 'dec-7 · model · morrow · proposed'`)) !== null);
  const mods = fs.readFileSync(file('modules.json'), 'utf8');
  fs.writeFileSync(file('modules.json'), mods.replace('"consentId": "c-f03"', '"consentId": "c-hand"'));
  check('an answer in modules.json without a consent event: pane bar says "you (file edit): yes"', (await waitFor(`(document.querySelector('#pane-index .pby') || {}).textContent.includes('you (file edit): yes')`)) !== null);
  fs.writeFileSync(file('modules.json'), mods);
  await waitFor(`!(document.querySelector('#pane-index .pby') || {}).textContent.includes('file edit')`);

  // decide through the page, then a hand edit of its text: both authors stay visible
  await page.eval(`document.querySelector('.item[data-id="task-4"]').focus()`);
  await page.key('c');
  check('c on a focused proposal: "confirmed by you <time>"', (await waitFor(`/confirmed by you \\d\\d-\\d\\d \\d\\d:\\d\\d$/.test(${meta('task-4')})`)) !== null, await page.eval(meta('task-4')));
  editState((j) => { j.items.find((i) => i.id === 'task-4').text = 'print the claim form twice'; });
  check('then a hand edit of its text: "confirmed by you <time> · edited by you (file edit): text"', (await waitFor(`/confirmed by you \\d\\d-\\d\\d \\d\\d:\\d\\d · edited by you \\(file edit\\): text$/.test(${meta('task-4')})`)) !== null, await page.eval(meta('task-4')));

  // index jumps -> metrics; /stats in the page
  const before = events().filter((e) => e.event === 'index_jump').length;
  for (const n of [1, 5, 9]) { await page.eval(`document.querySelectorAll('#pane-index .idx button')[${n}].click()`); await sleep(150); }
  await sleep(300);
  const jumps = events().filter((e) => e.event === 'index_jump').slice(before);
  check('three index clicks -> three index_jump events with the message ids', jumps.length === 3 && jumps.every((j) => /^m-f\d+$/.test(j.target)), JSON.stringify(jumps.map((j) => j.target)));
  await page.submit('/stats', 800);
  const st = await page.eval(`[...document.querySelectorAll('.ln.out.stat')].map((l) => l.className.split(' ').pop() + ' ' + l.textContent.split(/ +/)[0])`);
  check('/stats in the page: five verdict lines; usefulness now PASS (three jumps in this session), quiet NOT YET', st.join() === 'pass continuity,pass consent,pass usefulness,pass signal,notyet quiet', st.join());
  check('/stats labels the fixture data', await page.eval(`[...document.querySelectorAll('.ln.out')].some((l) => /^FIXTURE DATA: \\d+ of \\d+ metrics events/.test(l.textContent))`));

  // a live turn: the reply says which model wrote it; the new proposal is the model's, not a file edit
  await page.submit('Decision: we post the letter on Monday.', 2500);
  const last = await page.eval(`(() => { const l = [...document.querySelectorAll('.ln.assistant')].pop(); return l.querySelector('.who').textContent + ' ' + l.querySelector('.model').textContent; })()`);
  check('live reply: "model frontier"', last === 'model frontier', last);
  check('live proposal dec-10: "model · morrow · proposed", no file-edit mark', (await waitFor(`${meta('dec-10')} === 'dec-10 · model · morrow · proposed'`, 4000)) !== null, await page.eval(meta('dec-10')));
  if (process.env.SHOT) {
    const shot = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
  }
}

async function v07(page) {
  const file = (f) => path.join(APP, ENV.dir, f);
  await stop('server');   // reseed from the v0.7 fixture before the server starts
  const fix = path.join(APP, 'demo', 'fixtures', 'v0.7');
  for (const f of fs.readdirSync(fix)) if (!['demo.json', 'pilot.config.json'].includes(f)) fs.copyFileSync(path.join(fix, f), file(f));
  await startServer();
  await page.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  const waitFor = async (expr, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr)) return Date.now() - t0; await sleep(15); } return null; };
  const events = () => fs.readFileSync(file('metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  // the /why lines after the last command echo: [{head, text, cite, go}]
  const whyOut = `(() => { const all = [...document.querySelectorAll('.ln.out')]; const i = all.map((l) => l.classList.contains('cmd')).lastIndexOf(true);
    return { cmd: all[i] ? all[i].textContent : null, lines: all.slice(i + 1).filter((l) => l.classList.contains('why-line')).map((l) => ({ head: l.classList.contains('why-head'),
      text: l.querySelector('.text').textContent, cite: (l.querySelector('.cite') || {}).textContent || null, go: (l.querySelector('.go') || {}).textContent || null })) }; })()`;
  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);

  // /why typed: compact, one line per pane, every statement with its sources
  await page.submit('/why', 800);
  let w = await page.eval(whyOut);
  const facts = w.lines.filter((l) => !l.head);
  check('/why: heading, a panes line, one line per pane (index, map, kanban), two item lines, a details hint', w.cmd === '/why' && w.lines[0].head
    && facts.length === 6 && ['index:', 'map:', 'kanban:'].every((p) => facts.some((f) => f.text.startsWith(p))) && w.lines[w.lines.length - 1].head, JSON.stringify(w.lines.map((l) => l.text.slice(0, 30))));
  check('/why: every statement cites its sources as [file:line …]', facts.every((f) => /^\[(\S+\.jsonl?(:\d+)? [^;\]]+)(; \S+\.jsonl?(:\d+)? [^;\]]+)*\]$/.test(f.cite || '')), facts.map((f) => f.cite).join(' | '));
  check('/why map line: rule decisions ≥ 2, asked at 2 decisions, you said yes, added by the controller', facts.some((f) => /^map: decisions ≥ 2; asked at 2 decisions \(.*\); you said yes \(.*\); added by the controller/.test(f.text)));

  // /why map: the question line is a link that scrolls to it, without counting as an index jump
  await page.submit('/why map', 800);
  w = await page.eval(whyOut);
  check('/why map: the question, the answer and the add, each cited', w.lines.some((l) => /the controller asked at .*"2 decisions so far\. Add a reasoning map\?"/.test(l.text) && /metrics\.jsonl:\d+ controller_ask; transcript\.jsonl:\d+ m-f005/.test(l.cite))
    && w.lines.some((l) => /you answered "yes"/.test(l.text) && /consent c-f01/.test(l.cite)) && w.lines.some((l) => /the controller added the pane/.test(l.text) && /controller_add/.test(l.cite)), JSON.stringify(w.lines.map((l) => l.text)));
  const jumps0 = events().filter((e) => e.event === 'index_jump').length;
  await page.eval(`[...document.querySelectorAll('.ln.why-fact .go')].filter((b) => b.textContent === 'show m-f005').pop().click()`);
  check('"show m-f005" scrolls to that message and flashes it', (await waitFor(`document.getElementById('msg-m-f005').classList.contains('flash')
    && (() => { const r = document.getElementById('msg-m-f005').getBoundingClientRect(), l = document.getElementById('log').getBoundingClientRect(); return r.top >= l.top && r.bottom <= l.bottom; })()`)) !== null);
  await sleep(300);
  check('the "show" link is not logged as an index jump (Usefulness stays honest)', events().filter((e) => e.event === 'index_jump').length === jumps0);

  // /why dec-2: origin, message, quote, decision
  await page.submit('/why dec-2', 800);
  w = await page.eval(whyOut);
  const t = w.lines.map((l) => l.text).join('\n');
  check('/why dec-2: proposed by model morrow, from your message m-f003, the quote is in it, confirmed by you', /proposed by model morrow at 2026-10-14T09:05:44/.test(t) && /from message m-f003 by you/.test(t)
    && /quote "Decision: the claim stays on local models only\." is in that message/.test(t) && /confirmed by you at 2026-10-14T09:06:32/.test(t), t);
  check('/why dec-2: a "show m-f003" link', w.lines.some((l) => l.go === 'show m-f003'));
  await page.submit('/why dec-8', 800);
  check('/why dec-8: the missing fact is said plainly ("set by you (file edit), when is not recorded")', (await page.eval(whyOut)).lines.some((l) => /status "confirmed" set by you \(file edit\), when is not recorded/.test(l.text)));
  await page.submit('/why task-7', 800);
  check('/why task-7: "added by you (file edit) at 2026-10-16T18:30:04" with the file_edit line cited', (await page.eval(whyOut)).lines.some((l) => /^added by you \(file edit\) at 2026-10-16T18:30:04/.test(l.text) && /metrics\.jsonl:\d+ file_edit task-7/.test(l.cite)));

  // the "why?" affordance: the same explanation as the typed command
  await page.submit('/why kanban', 800);
  const typed = (await page.eval(whyOut)).lines;
  await page.eval(`document.querySelector('#pane-kanban .bar .why').click()`); await sleep(800);
  w = await page.eval(whyOut);
  check('"why?" on the kanban pane bar shows the same lines as /why kanban', w.cmd === '/why kanban' && JSON.stringify(w.lines) === JSON.stringify(typed), `${w.cmd}, ${w.lines.length} vs ${typed.length} lines`);
  check('every pane bar and every card has a "why?" button (a real button, outside the byline)', await page.eval(`[...document.querySelectorAll('.side')].every((p) => p.querySelector('.bar > button.why'))
    && [...document.querySelectorAll('.item')].every((c) => c.querySelector(':scope > button.why') && !c.querySelector('.meta .why'))`));
  // keyboard: Tab from the input reaches a "why?" button; Enter presses it
  await page.eval(`document.getElementById('input').focus()`);
  let tabs = 0;
  while (tabs < 40 && !(await page.eval(`document.activeElement.classList.contains('why') && document.activeElement.dataset.why === 'index'`))) { await page.key('Tab'); tabs++; }
  check('Tab reaches the "why?" of the index pane', tabs < 40, `${tabs} tabs`);
  await page.key('Enter'); await sleep(800);
  check('Enter on it shows /why index', (await page.eval(whyOut)).cmd === '/why index');
  // c/r on a focused "why?" inside a proposal never decides it
  await page.eval(`document.querySelector('.item[data-id="dec-7"] > .why').focus()`);
  await page.key('c'); await sleep(400);
  check('"c" on the focused "why?" of proposal dec-7 does not confirm it', JSON.parse(fs.readFileSync(file('state.json'), 'utf8')).items.find((i) => i.id === 'dec-7').status === 'proposed');

  // layout: 800, 1280 and 1600 px wide (plus 820 and 1000, where the side panes are narrowest)
  const labels = '.ln .who:not(:empty), .ln.controller .who .role, .by, .when, .item .tag, .sub, .pane .bar > span, .why, .key';
  const measure = `(() => {
    const brk = []; const over = [];
    for (const el of document.querySelectorAll(${JSON.stringify(labels)})) {
      if (!el.offsetParent) continue;
      // text only (a label may hold a pixel sprite): all its text boxes on one line
      const tops = new Set(); const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n);
        for (const x of r.getClientRects()) if (x.width > 0 && x.height > 0) tops.add(Math.round(x.top / 4)); }
      if (tops.size > 1) brk.push(el.textContent.trim());
      const pane = el.closest('.pane'); const b = el.getBoundingClientRect(); const p = pane && pane.getBoundingClientRect();
      if (p && b.width && b.right > p.right + 1) over.push(el.textContent.trim());
    }
    const body = document.querySelector('#pane-kanban .body'); const cs = getComputedStyle(body);
    const content = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const cols = [...document.querySelectorAll('#pane-kanban .col')].map((c) => Math.round(c.getBoundingClientRect().width));
    const stacked = new Set([...document.querySelectorAll('#pane-kanban .col')].map((c) => Math.round(c.getBoundingClientRect().left))).size === 1;
    return { hscroll: document.documentElement.scrollWidth > window.innerWidth, brk, over, content: Math.round(content), cols, stacked };
  })()`;
  // a controller line with a long question, so the label sits next to wrapping text (the v0.6 "contr/oller" case)
  await page.eval(`(() => { const l = document.querySelector('.ln.controller .text'); if (l) l.firstChild.textContent = l.firstChild.textContent + ' ' + 'and a much longer question that has to wrap over several lines in a narrow chat pane'.repeat(2); })()`);
  for (const width of [800, 820, 1000, 1280, 1600]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const m = await page.eval(measure);
    const kanbanOk = m.stacked ? m.content < 420 : m.content >= 420 && m.cols.every((c) => c >= 134);
    check(`${width} px: no horizontal page scroll; no label breaks or overflows its pane; kanban ${m.stacked ? 'stacked' : `3 columns ${m.cols.join('/')} px`} at ${m.content} px (threshold 420)`,
      !m.hscroll && !m.brk.length && !m.over.length && kanbanOk, JSON.stringify({ brk: m.brk.slice(0, 5), over: m.over.slice(0, 5), hscroll: m.hscroll }));
    if (process.env.SHOT) {
      fs.mkdirSync(process.env.SHOT, { recursive: true });
      const shot = await page.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(process.env.SHOT, `v07-${width}.png`), Buffer.from(shot.result.data, 'base64'));
    }
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
}

async function v08(page) {
  const file = (f) => path.join(APP, ENV.dir, f);
  await stop('server');   // reseed from the v0.8 fixture before the server starts
  const fix = path.join(APP, 'demo', 'fixtures', 'v0.8');
  for (const f of fs.readdirSync(fix)) if (!['demo.json', 'pilot.config.json'].includes(f)) fs.copyFileSync(path.join(fix, f), file(f));
  await startServer();
  const waitFor = async (expr, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr)) return Date.now() - t0; await sleep(15); } return null; };
  const events = () => fs.readFileSync(file('metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const touches = (mod) => events().filter((e) => e.event === 'pane_touch' && e.module === mod);
  const modules = () => JSON.parse(fs.readFileSync(file('modules.json'), 'utf8'));
  const entry = (mod) => modules().panes.find((p) => p.module === mod);
  const rect = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width), left: Math.round(r.left) }; })()`;
  const shot = async (name) => {
    if (!process.env.SHOT) return;
    fs.mkdirSync(process.env.SHOT, { recursive: true });
    const r = await page.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.SHOT, `v08-${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);

  // the fixture: map and index shown, kanban a tab in its place (third), the grid row shrunk to the tab
  const k = await page.eval(rect('#pane-kanban')), mp = await page.eval(rect('#pane-map')), ix = await page.eval(rect('#pane-index'));
  check('kanban is a slim labelled tab (button "▸ kanban"), map and index are full panes', await page.eval(`!!document.querySelector('#pane-kanban.faded > button.tab') && document.querySelector('#pane-kanban .tab').textContent.includes('kanban')
    && !document.querySelector('#pane-kanban .body') && !!document.querySelector('#pane-map:not(.faded) .body') && !!document.querySelector('#pane-index:not(.faded) .body')`));
  check('the tab keeps its place in the layout order (below map and index) and its row shrinks to about one line', k && mp && ix && k.top > ix.top && ix.top > mp.top && k.h < 44 && mp.h > 4 * k.h,
    JSON.stringify({ k, mp, ix }));
  await shot('1-kanban-tab');

  // one message: the map fades (untouched for 8 turns), and the removal question for the kanban appears with y/n/x
  await page.submit('what is left for Monday?', 2500);
  await waitFor(`!!document.querySelector('#pane-map.faded')`);
  check('after the message the map is a tab too; the index stays', await page.eval(`!!document.querySelector('#pane-map.faded .tab') && !!document.querySelector('#pane-index:not(.faded) .body')`));
  check('the controller says the map faded (a plain controller line, no keys)', await page.eval(`[...document.querySelectorAll('.ln.controller.fade-note')].some((l) => /map pane faded to a tab: untouched for 8 turns/.test(l.textContent) && !l.querySelector('.keys'))`));
  const q = await page.eval(`(() => { const l = document.querySelector('.ln.controller.pending'); return l && { text: l.textContent, keys: [...l.querySelectorAll('button.key')].map((b) => b.dataset.answer) }; })()`);
  check('the removal question "Remove the kanban pane?" has y/n/x buttons (no always)', q && /Remove the kanban pane\?/.test(q.text) && JSON.stringify(q.keys) === '["yes","no","never"]', JSON.stringify(q));
  check('the placeholder says y/n/x', /y\/n\/x answer the question/.test(await page.eval(`document.getElementById('input').placeholder`)));
  const mp2 = await page.eval(rect('#pane-map')), ix2 = await page.eval(rect('#pane-index'));
  check('with two tabs the index takes the freed height', mp2.h < 44 && ix2.h > ix.h, JSON.stringify({ mp2, ix, ix2 }));
  await shot('2-two-tabs-question');
  await page.eval(`document.getElementById('input').focus()`);
  await page.key('a'); await sleep(400);
  check('"a" in the empty input does not answer the removal question (it is text)', modules().pending === 'kanban' && await page.eval(`document.getElementById('input').value === 'a'`));
  await page.eval(`document.getElementById('input').value = ''`);

  // touches: a wheel on the index is a scroll touch, a second interaction in the same turn is not logged again
  const turn = () => JSON.parse(fs.readFileSync(file('transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.role === 'user').length);
  const t38 = turn();
  const ib = await page.eval(rect('#pane-index .body'));
  await page.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: ib.left + 20, y: ib.top + 20, deltaX: 0, deltaY: 60 }); await sleep(500);
  check(`a wheel over the index logs pane_touch index scroll at turn ${t38}`, touches('index').some((e) => e.how === 'scroll' && e.turn === t38) && entry('index').lastTouch.turn === t38);
  const n0 = touches('index').length;
  await page.eval(`document.querySelector('#pane-index .idx button').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`); await sleep(400);
  check('a second touch of the index in the same turn writes nothing new (once per pane per turn)', touches('index').length === n0);

  // the tab: a click brings the map back at once, with a View Transition; the server records a tab touch
  await page.eval(`(() => { window.__vt = 0; const o = document.startViewTransition && document.startViewTransition.bind(document); if (o) document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; })()`);
  await page.eval(`document.querySelector('#pane-map .tab').click()`);
  const backMs = await waitFor(`!!document.querySelector('#pane-map:not(.faded) .body .item')`, 2000);
  check(`a click on the map tab brings the map back at once (${backMs} ms, before the server's answer), with a View Transition`, backMs !== null && backMs < 400 && await page.eval('window.__vt') >= 1);
  await sleep(500);
  const tt = touches('map').pop();
  check('the server records pane_touch map tab (unfaded) and the map is no longer faded in modules.json', tt && tt.how === 'tab' && tt.unfaded === true && !entry('map').state && entry('map').lastTouch.how === 'tab');
  check('the removal question for the kanban is still open (touching the map does not answer it)', modules().pending === 'kanban' && modules().pendingKind === 'remove');

  // reduced motion: the bring-back is instant (no View Transition), from the keyboard (Tab to the tab, Enter)
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.eval(`document.querySelector('#pane-kanban .tab').focus()`);
  await page.eval('window.__vt = 0');
  await page.key('Enter');
  check('reduced motion: Enter on the kanban tab shows the kanban in the same frame, without a View Transition', await page.eval(`!!document.querySelector('#pane-kanban:not(.faded) .body') && window.__vt === 0`));
  await sleep(500);
  check('... and touching the kanban while its removal question is open withdraws the question', !modules().pending && events().some((e) => e.event === 'controller_withdraw' && e.module === 'kanban')
    && await page.eval(`!document.querySelector('.ln.controller.pending') && [...document.querySelectorAll('.ln.system')].some((l) => /remove kanban: question withdrawn, you used the pane/.test(l.textContent))`));
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  await shot('3-all-back');

  // the next turn: Tab into a pane is a focus touch; focus the page sets by itself is not
  await page.submit('one more thing about the envelope', 2500);
  const t39 = turn();
  await page.eval(`document.querySelector('#pane-map .item').focus()`); await sleep(400);
  check('focus set by script (no key) is not a touch', !touches('map').some((e) => e.turn === t39));
  await page.eval(`document.getElementById('input').focus()`);
  let tabs = 0;
  while (tabs < 80 && !(await page.eval(`!!document.activeElement.closest('#pane-index')`))) { await page.key('Tab'); tabs++; }
  await sleep(400);
  check(`Tab into the index (${tabs} tabs) logs pane_touch index focus at turn ${t39}`, tabs < 80 && touches('index').some((e) => e.how === 'focus' && e.turn === t39));
  check('the chat pane has no tab and no touch events (it never fades)', await page.eval(`!document.querySelector('#pane-chat.faded') && !document.querySelector('#pane-chat .tab')`) && !events().some((e) => e.event === 'pane_touch' && e.module === 'chat'));

  // a narrow window: tabs and labels stay whole, no horizontal scroll
  await page.eval(`document.getElementById('input').focus()`);
  await page.submit('/why', 600);   // nothing faded now; fade the index by hand to see two layouts with a tab
  const m = modules(); const ie = m.panes.find((p) => p.module === 'index'); ie.state = 'faded'; ie.fadedAt = new Date().toISOString(); ie.fadedTurn = t39;
  fs.writeFileSync(file('modules.json'), JSON.stringify(m, null, 2));
  await waitFor(`!!document.querySelector('#pane-index.faded')`);
  for (const width of [800, 820, 1280]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const r = await page.eval(`(() => {
      const t = document.querySelector('#pane-index .tab .tt'); const range = document.createRange(); range.selectNodeContents(t);
      const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
      const tab = document.querySelector('#pane-index').getBoundingClientRect(), b = document.querySelector('#pane-index .tab').getBoundingClientRect();
      return { hscroll: document.documentElement.scrollWidth > window.innerWidth, lines, inside: b.right <= tab.right + 1, h: Math.round(tab.height) };
    })()`);
    check(`${width} px with a tab: no horizontal scroll, the tab label on one line inside its strip (${r.h} px high)`, !r.hscroll && r.lines === 1 && r.inside && r.h < 44, JSON.stringify(r));
    await shot(`4-tab-${width}`);
  }
  // all side panes faded (by hand): tabs stack at the top of a column as wide as the tabs, the chat keeps the height
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const m2 = modules(); for (const p of m2.panes) { p.state = 'faded'; p.fadedAt = p.fadedAt || new Date().toISOString(); p.fadedTurn = p.fadedTurn || t39; }
  fs.writeFileSync(file('modules.json'), JSON.stringify(m2, null, 2));
  await waitFor(`document.querySelectorAll('.side.faded').length === 3`);
  await sleep(800);   // after the View Transition (480 ms)
  const all = await page.eval(`(() => {
    const r = (el) => el.getBoundingClientRect(); const chat = r(document.getElementById('pane-chat')), bench = r(document.getElementById('bench'));
    const tabs = [...document.querySelectorAll('.side.faded')].map(r);
    return { hscroll: document.documentElement.scrollWidth > window.innerWidth, chatH: Math.round(chat.height), benchH: Math.round(bench.height),
      tops: tabs.map((t) => Math.round(t.top)), hs: tabs.map((t) => Math.round(t.height)), w: Math.round(tabs[0].width), chatW: Math.round(chat.width) };
  })()`);
  check(`all three side panes faded: tabs stacked at the top (${all.tops.join('/')}), column ${all.w} px (at most 18rem), chat ${all.chatW} × ${all.chatH} px of ${all.benchH}`,
    !all.hscroll && all.hs.every((h) => h < 44) && all.tops[0] < all.tops[1] && all.tops[1] < all.tops[2] && all.tops[2] < all.benchH / 3 && all.chatH >= all.benchH - 2 && all.w <= 290, JSON.stringify(all));
  await shot('5-all-tabs');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
}

// pilot-v0.9: settled input. Off (the config default here): exactly the old prompt. On (/flag): the offer after a pause on
// a finished-looking input, Tab sends only while it shows, Enter always sends, every offer has at most one outcome.
async function v09(page) {
  const file = (f) => path.join(APP, ENV.dir, f);
  await stop('server');
  const fix = path.join(APP, 'demo', 'fixtures', 'v0.9');
  for (const f of fs.readdirSync(fix)) if (!['demo.json', 'pilot.config.json'].includes(f)) fs.copyFileSync(path.join(fix, f), file(f));
  await startServer();
  const T = 400;
  const waitFor = async (expr, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr)) return Date.now() - t0; await sleep(15); } return null; };
  const raw = () => fs.readFileSync(file('metrics.jsonl'), 'utf8');
  const events = () => raw().trim().split('\n').map((l) => JSON.parse(l));
  const settle = () => events().filter((e) => /^(settle_|enter_send$)/.test(e.event));
  const users = () => fs.readFileSync(file('transcript.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.role === 'user').map((l) => l.text);
  // the page reports by fetch without waiting: poll metrics.jsonl until the event is written
  const waitEv = async (pred, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const e = settle().filter(pred).at(-1); if (e) return e; await sleep(20); } return null; };
  const offerShown = `(() => { const o = document.getElementById('settle'); return !!o && !o.hidden && o.getBoundingClientRect().width > 0; })()`;
  const idle = () => waitFor(`!document.getElementById('input').disabled && document.activeElement === document.getElementById('input') && !document.querySelector('.ln.streaming')`, 5000);
  const clear = () => page.eval(`document.getElementById('input').value = ''`);
  const typeSlow = async (text) => { await page.eval(`document.getElementById('input').focus()`); for (const ch of text) { await page.send('Input.insertText', { text: ch }); await sleep(20); } };
  const activeIsInput = () => page.eval(`document.activeElement === document.getElementById('input')`);
  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);

  // ---- off: exactly today's prompt ----
  check('flag off (config default): no offer element, the old placeholder', await page.eval(`!document.getElementById('settle') && document.getElementById('input').placeholder === 'Type a message and press Enter'`));
  await typeSlow('Is the envelope ready?');
  await sleep(3 * T);
  check('off: a finished sentence and a long pause show no offer', !(await page.eval(offerShown)) && !(await page.eval(`!!document.getElementById('settle')`)));
  await page.key('Tab');
  check('off: Tab moves focus out of the input as before (into a pane)', !(await activeIsInput()) && await page.eval(`!!document.activeElement.closest('.side')`), await page.eval(`document.activeElement.className || document.activeElement.tagName`));
  await page.eval(`document.getElementById('input').focus()`);
  await page.key('Enter'); await idle();
  check('off: Enter sends; no settle event and no enter_send logged', users().at(-1) === 'Is the envelope ready?' && settle().length === 0);

  // ---- on ----
  await page.submit('/flag settled-input on', 800);
  check('/flag settled-input on: kept in flags.json; the offer element exists, hidden; the placeholder names Tab', JSON.parse(fs.readFileSync(file('flags.json'), 'utf8')).experiments.settledInput === true
    && await page.eval(`!!document.getElementById('settle') && document.getElementById('settle').hidden && /pause, then Tab/.test(document.getElementById('input').placeholder)`));
  const n0 = users().length;
  await clear(); await typeSlow('Is the stamp on it?');
  await sleep(T / 2);
  check(`a pause shorter than T (${T} ms) shows no offer`, !(await page.eval(offerShown)));
  const ms = await waitFor(offerShown, 2000);
  check(`after T the quiet offer appears ("send? (Tab to send, keep typing to ignore)", ${ms} ms after the check)`, ms !== null
    && await page.eval(`document.getElementById('settle').textContent === 'send? (Tab to send, keep typing to ignore)' && document.getElementById('input').getAttribute('aria-describedby') === 'settle'`));
  const o1 = await waitEv((e) => e.event === 'settle_offer');
  let ev;
  check('settle_offer logged with cue question, length and word count, never the text', o1 && o1.event === 'settle_offer' && o1.cue === 'question' && o1.chars === 19 && o1.words === 5 && o1.sinceKeyMs >= T - 20 && !raw().includes('stamp on it'), JSON.stringify(o1));
  await sleep(1500);
  check('nothing is sent without a key (1.5 s with the offer showing)', users().length === n0 && await page.eval(offerShown));
  await page.key('Tab'); await idle(); await waitEv((e) => e.event === 'settle_accept');
  ev = settle();
  check('Tab sends while the offer shows (settle_accept with the offer id, time since the last keystroke), focus stays in the input', users().at(-1) === 'Is the stamp on it?'
    && ev.some((e) => e.event === 'settle_accept' && e.offerRef === o1.offer && e.sinceKeyMs >= T) && !ev.some((e) => e.event === 'enter_send') && await activeIsInput());
  check('Tab-to-send is not a pane touch', !events().some((e) => e.event === 'pane_touch' && e.ts > o1.ts));

  await typeSlow('this is not done,');
  await sleep(3 * T);
  check('an unfinished line ("…,") gets no offer', !(await page.eval(offerShown)));
  await clear();

  await typeSlow('Fine, I will check.');
  await waitFor(offerShown, 2000);
  await typeSlow(' Then');
  check('keep typing: the offer goes at once and settle_ignore (typed) is logged', !(await page.eval(offerShown)) && !!(await waitEv((e) => e.event === 'settle_ignore' && e.how === 'typed')));
  const seenOffers = new Set(settle().filter((e) => e.event === 'settle_offer').map((e) => e.offer));
  await typeSlow(' we go.');
  await waitFor(offerShown, 2000);
  const o2 = await waitEv((e) => e.event === 'settle_offer' && !seenOffers.has(e.offer));
  await page.key('Enter'); await idle(); await waitEv((e) => e.event === 'enter_send' && e.offerShowing);
  ev = settle();
  check('Enter while an offer shows sends (enter_send offerShowing true, that offer)', users().at(-1) === 'Fine, I will check. Then we go.'
    && ev.some((e) => e.event === 'enter_send' && e.offerShowing === true && e.offerRef === o2.offer));

  await typeSlow('quick one.');
  await page.key('Enter'); await idle(); await waitEv((e) => e.event === 'enter_send' && !e.offerShowing);
  ev = settle();
  check('Enter before any offer sends at once (enter_send offerShowing false, no offer)', users().at(-1) === 'quick one.' && ev.at(-1).event === 'enter_send' && ev.at(-1).offerShowing === false && !ev.at(-1).offerRef);

  await typeSlow('Escape this one.');
  await waitFor(offerShown, 2000);
  await page.key('Escape');
  check('Escape drops the offer (settle_ignore escape), the text stays', !(await page.eval(offerShown)) && !!(await waitEv((e) => e.event === 'settle_ignore' && e.how === 'escape')) && await page.eval(`document.getElementById('input').value === 'Escape this one.'`));
  await page.key('Tab');
  check('without an offer Tab moves focus as before, flag on', !(await activeIsInput()));
  await clear();

  await typeSlow('/stats.');
  await sleep(3 * T);
  check('a command gets no offer', !(await page.eval(offerShown)));
  await clear();
  const before = settle().length;
  await page.submit('/stats', 900);
  const out = await page.eval(`[...document.querySelectorAll('.ln.out')].map((l) => l.textContent)`);
  check('/stats: an experiments block with offers, Tab, ignored, Enter with and without an offer, times', out.some((l) => /^experiments \(measured, not judged/.test(l))
    && out.some((l) => /^ *4 offers "send\?": 1 accepted with Tab, 2 ignored \(1 kept typing, 1 Escape\), 1 sent with Enter while showing, 0 unresolved/.test(l))
    && out.some((l) => /^ *2 sent with Enter: 1 while an offer showed, 1 without one/.test(l)) && out.some((l) => /^ *last keystroke to send \(median, n\): Tab \d+\.\d s \(1\)/.test(l)), out.slice(-6).join(' | '));
  check('/stats still has exactly five verdict lines (experiments are not judged)', await page.eval(`document.querySelectorAll('.ln.out.stat').length`) === 5);
  check('a command is not an enter_send', settle().length === before);
  const offers = settle().filter((e) => e.event === 'settle_offer');
  check('every offer has at most one outcome', offers.every((o) => settle().filter((e) => e.offerRef === o.offer).length <= 1));

  // ---- narrow: the offer fits, no horizontal scroll ----
  for (const w of [800, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    await clear(); await typeSlow('Is the layout still fine here?');
    await waitFor(offerShown, 2000);
    const r = await page.eval(`(() => { const o = document.getElementById('settle').getBoundingClientRect(), i = document.getElementById('input').getBoundingClientRect(); return { hscroll: document.documentElement.scrollWidth > innerWidth, right: Math.round(o.right), w: innerWidth, input: Math.round(i.width) }; })()`);
    check(`${w} px: the offer is on screen, the input keeps room, no horizontal scroll`, !r.hscroll && r.right <= r.w && r.input >= 120, JSON.stringify(r));
    await page.key('Escape'); await clear();
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  // ---- off again ----
  await page.submit('/flag settled-input off', 800);
  await typeSlow('Is it off now?');
  await sleep(3 * T);
  check('/flag settled-input off: the offer element is gone, no offer after a pause, the old placeholder', !(await page.eval(`!!document.getElementById('settle')`)) && !(await page.eval(offerShown)));
  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);
  await typeSlow('Still off after a reload?');
  await sleep(3 * T);
  check('off is kept across a reload (flags.json)', !(await page.eval(`!!document.getElementById('settle')`)) && await page.eval(`document.getElementById('input').placeholder === 'Type a message and press Enter'`));
}

async function v10(page) {
  const file = (f) => path.join(APP, ENV.dir, f);
  await stop('server');
  const fix = path.join(APP, 'demo', 'fixtures', 'v0.10');
  for (const f of fs.readdirSync(fix)) if (!['demo.json', 'pilot.config.json'].includes(f)) fs.copyFileSync(path.join(fix, f), file(f));
  await startServer();
  const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr)) return Date.now() - t0; await sleep(20); } return null; };
  const events = () => fs.readFileSync(file('metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const frames = () => { try { return JSON.parse(fs.readFileSync(file('frames.json'), 'utf8')); } catch { return null; } };
  const idle = () => waitFor(`!document.getElementById('input').disabled && !document.querySelector('.ln.streaming')`, 5000);
  const send = async (text) => { await page.submit(text, 300); await idle(); };
  const order = () => page.eval(`[...document.querySelectorAll('#pane-map .chain .item')].map((c) => c.dataset.id).join(',')`);
  const note = `#pane-map .frame-note`;
  const noteShown = `!!document.querySelector('${note}')`;
  const focusCard = (id) => page.eval(`document.querySelector('#pane-map .item[data-id="${id}"]').focus()`);
  const posts = () => page.net.filter((n) => n.url.endsWith('/frame') && n.method === 'POST').length;
  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);
  const own = await order();
  const writes0 = events().filter((e) => e.event === 'item_write').length;

  // ---- off (the shipped default): no frame role call, nothing rendered, f is just a key ----
  await send('what about keeping the claim local?');
  await sleep(600);
  check('flag off: after a turn no frame role call, no frames.json, no note in the map', !events().some((e) => e.role === 'frame' || /^frame_/.test(e.event)) && !frames() && !(await page.eval(noteShown)), own);
  await focusCard('dec-1'); await page.key('f');
  check('flag off: f on a map card does nothing (no POST /frame)', posts() === 0 && await order() === own);
  check('flag off: the status bar does not list the frame role (the old status bar)', !/frame:/.test(await page.status()), await page.status());

  // ---- on: a proposal is a note, nothing changes until you apply it ----
  await page.submit('/flag frame-proposals on', 800);
  check('flag on: the status bar lists frame: morrow', /· frame: morrow ·/.test(await page.status()), await page.status());
  await send('what about keeping the claim local?');
  const ms = await waitFor(noteShown, 4000);
  check(`flag on: the next turn yields a proposal note in the map (${ms} ms after the reply)`, ms !== null);
  const n = await page.eval(`(() => { const n = document.querySelector('${note}'); const cs = getComputedStyle(n); return { text: n.querySelector('.fn-what').textContent, by: n.querySelector('.fn-by').textContent, author: n.dataset.author, style: cs.borderTopStyle, tab: n.tabIndex, keys: [...n.querySelectorAll('button')].map((b) => b.textContent.trim()) }; })()`);
  check('the note says "model suggests: focus dec-2 · order dec-2, dec-4, src-1, dec-1, …" and "suggested by morrow, not by you", dashed, focusable', n.text === 'model suggests: focus dec-2 · order dec-2, dec-4, src-1, dec-1, …'
    && n.by === 'suggested by morrow, not by you' && n.author === 'model' && n.style === 'dashed' && n.tab === 0 && n.keys.join('|') === 'f apply|dismiss|why?', JSON.stringify(n));
  check('a proposal changes nothing: the map keeps its own order, no card is marked', await order() === own && !(await page.eval(`!!document.querySelector('.item.framed')`)));
  await page.eval(`document.getElementById('input').focus()`); await page.key('f');
  check('f in the chat input is text, not apply', await page.eval(`document.getElementById('input').value === 'f'`) && posts() === 0 && !!frames().pending.map);
  await page.eval(`document.getElementById('input').value = ''`);
  await page.eval(`document.querySelector('${note} button[data-frame-action="apply"]').focus()`); await page.key('f');
  await sleep(200);
  check('f on a focused button in the note does not apply (same rule as c/r)', posts() === 0 && !!frames().pending.map);
  await page.eval(`document.querySelector('${note}').focus()`);
  check('the note itself takes focus (tabIndex 0, so Tab reaches it)', await page.eval(`document.activeElement === document.querySelector('${note}')`));
  const shot = async (name) => { if (!process.env.SHOT_DIR) return; const r = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(r.result.data, 'base64')); };
  await shot('v10-proposal.png');
  await page.key('Escape');
  check('Escape on the note returns to the chat input', await page.eval(`document.activeElement === document.getElementById('input')`));

  // ---- apply with f, focus in the pane ----
  await focusCard('dec-5'); await page.key('f');
  await waitFor(`!!document.querySelector('#pane-map .item.framed')`, 3000);
  const f1 = frames();
  const applied = await page.eval(`(() => { const l = document.querySelector('#pane-map .frame-applied'); const c = document.querySelector('#pane-map .item.framed'); return { line: l && l.textContent, framed: c && c.dataset.id, chip: c && c.querySelector('.by.frame').textContent, active: document.activeElement.dataset.id, note: !!document.querySelector('${note}') }; })()`);
  check('f on a card in the map applies it: order dec-2, dec-4, dec-1, dec-8, dec-7, dec-5 (rejected stay hidden)', await order() === 'dec-2,dec-4,dec-1,dec-8,dec-7,dec-5', await order());
  check('dec-2 is marked "frame focus, suggested by morrow", focus moves to it, the note is gone', applied.framed === 'dec-2' && applied.chip === 'frame focus, suggested by morrow' && applied.active === 'dec-2' && !applied.note, JSON.stringify(applied));
  await shot('v10-applied.png');
  check('the frame line says who suggested it and that you applied it', /^frame fr-1: focus dec-2 · order dec-2, dec-4, src-1, dec-1, … · suggested by morrow · applied by you \d\d-\d\d \d\d:\d\d · reset$/.test(applied.line || ''), applied.line);
  check('recorded: frames.json applied.map (appliedBy user, appliedAt), a frame_apply event, a system line', f1.applied.map && f1.applied.map.appliedBy === 'user' && !!f1.applied.map.appliedAt && !f1.pending.map
    && events().some((e) => e.event === 'frame_apply' && e.id === 'fr-1' && e.module === 'map' && e.by === 'user'));
  check('sources follow the frame too (src-1 is in the order)', await page.eval(`[...document.querySelectorAll('#pane-map .items:not(.chain) .item')].map((c) => c.dataset.id).join(',')`) === 'src-1');

  // ---- /why map, reset ----
  await page.submit('/why map', 900);
  const why = await page.eval(`[...document.querySelectorAll('.ln.out.why-fact')].map((l) => l.textContent)`);
  check('/why map explains the applied frame: what it does, suggested by morrow after which message, applied by you, with sources', why.some((l) => /^frame fr-1 applied: focus dec-2/.test(l) && /\[frames\.json:\d+ applied\.map\]/.test(l))
    && why.some((l) => /^suggested by model morrow \(frame role/.test(l) && /metrics\.jsonl:\d+ frame_propose fr-1/.test(l)) && why.some((l) => /^applied by you at .*frame_apply fr-1/.test(l)), why.filter((l) => /frame/.test(l)).join(' | '));
  await page.eval(`document.querySelector('#pane-map .frame-applied button').click()`);
  await waitFor(`!document.querySelector('#pane-map .item.framed')`, 3000);
  check('reset (the button = /frame reset map): the map is back in its own order, nothing marked, resets.map recorded', await order() === own && !(await page.eval(`!!document.querySelector('#pane-map .frame-applied')`))
    && frames().resets.map.frame === 'fr-1' && events().some((e) => e.event === 'frame_reset' && e.id === 'fr-1'));

  // ---- dismiss ----
  await send('should the deadline go in the first paragraph?');
  await waitFor(noteShown, 4000);
  const id2 = frames().pending.map && frames().pending.map.id;
  await page.eval(`document.querySelector('${note} button[data-frame-action="dismiss"]').click()`);
  await waitFor(`!document.querySelector('${note}')`, 3000);
  check(`dismiss drops proposal ${id2}: no note, nothing applied, frame_dismiss logged, the order unchanged`, !!id2 && !frames().pending.map && !frames().applied.map && events().some((e) => e.event === 'frame_dismiss' && e.id === id2) && await order() === own);

  // ---- narrow widths with a note showing ----
  await send('is the registered mail still the plan?');
  await waitFor(noteShown, 4000);
  for (const w of [800, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(250);
    const r = await page.eval(`(() => { const n = document.querySelector('${note}').getBoundingClientRect(), p = document.querySelector('#pane-map').getBoundingClientRect(); return { hscroll: document.documentElement.scrollWidth > innerWidth, inPane: n.left >= p.left - 1 && n.right <= p.right + 1, w: Math.round(n.width) }; })()`);
    check(`${w} px: the note fits its pane, no horizontal scroll`, !r.hscroll && r.inPane, JSON.stringify(r));
    await shot(`v10-note-${w}.png`);
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(200);

  // ---- the keyboard path of the demo: real Tab presses from the empty input reach the note, f there applies ----
  await page.eval(`document.getElementById('input').value = ''; document.getElementById('input').focus()`);
  const tabs = [];
  for (let i = 0; i < 12; i++) {
    await page.key('Tab');
    const a = await page.eval(`(() => { const a = document.activeElement; return a.classList.contains('frame-note') ? 'NOTE' : (a.dataset.id || a.className || a.tagName); })()`);
    tabs.push(a);
    if (a === 'NOTE') break;
  }
  check(`real Tab presses from the input reach the note (${tabs.length} presses)`, tabs.at(-1) === 'NOTE', tabs.join(' > '));
  await page.key('f');
  await waitFor(`!!document.querySelector('#pane-map .item.framed')`, 3000);
  check('f on the note (reached with Tab) applies the proposal', await page.eval(`!!document.querySelector('#pane-map .item.framed') && !document.querySelector('${note}')`));

  // ---- the flag off hides frames (kept on file), on shows them again ----
  const framedOrder = await order();
  await page.submit('/flag frame-proposals off', 800);
  await waitFor(`!document.querySelector('#pane-map .item.framed')`, 2000);
  check('/flag frame-proposals off: the applied frame is not shown (own order), no note; frames.json keeps it', await order() === own && !(await page.eval(noteShown)) && !!frames().applied.map, `${framedOrder} -> ${await order()}`);
  await page.submit('/flag frame-proposals on', 800);
  await waitFor(`!!document.querySelector('#pane-map .item.framed')`, 2000);
  check('on again: the applied frame is back', await order() === framedOrder);
  await page.submit('/frame reset', 800);
  await waitFor(`!document.querySelector('#pane-map .item.framed')`, 2000);
  check('/frame reset: own order again', await order() === own);

  // ---- the kanban: a frame orders each column; the apply button ----
  editJson('modules.json', (m) => {
    const map = m.panes.find((p) => p.module === 'map'), kb = m.panes.find((p) => p.module === 'kanban');
    map.state = 'faded'; map.fadedAt = new Date().toISOString(); map.fadedTurn = 45;
    delete kb.state; delete kb.fadedAt; delete kb.fadedTurn; kb.lastTouch = { at: new Date().toISOString(), turn: 45, how: 'tab' };
  });
  await waitFor(`!!document.querySelector('#pane-kanban .cols') && !!document.querySelector('#pane-map.faded')`, 3000);
  const col = (c) => page.eval(`[...document.querySelectorAll('#pane-kanban .col.${c} .item')].map((x) => x.dataset.id).join(',')`);
  const doneBefore = await col('done'), todoBefore = await col('todo');
  await send('who calls the insurer about the deadline?');
  const kms = await waitFor(`!!document.querySelector('#pane-kanban .frame-note')`, 4000);
  check(`map a tab, kanban shown: the proposal comes for the kanban (${kms} ms), none for the map tab`, kms !== null && frames().pending.kanban && !frames().pending.map
    && await page.eval(`document.querySelector('#pane-kanban .frame-note .fn-what').textContent.startsWith('model suggests: focus task-2')`));
  await page.eval(`document.querySelector('#pane-kanban .frame-note button[data-frame-action="apply"]').click()`);
  await waitFor(`!!document.querySelector('#pane-kanban .item.framed')`, 3000);
  const doneAfter = await col('done');
  check('the apply button: task-2 marked and first in its column; every column keeps its cards (only the order moves)', await page.eval(`document.querySelector('#pane-kanban .item.framed').dataset.id`) === 'task-2'
    && doneAfter.split(',')[0] === 'task-2' && doneAfter.split(',').sort().join() === doneBefore.split(',').sort().join() && (await col('todo')).split(',').sort().join() === todoBefore.split(',').sort().join(), `done ${doneBefore} -> ${doneAfter}; todo ${todoBefore} -> ${await col('todo')}`);
  check('the map tab stayed a tab (a frame never brings a pane back)', await page.eval(`!!document.querySelector('#pane-map.faded')`));
  check('no frame write touched state.json items or modules.json panes', events().filter((e) => e.event === 'item_write').length === writes0 && JSON.parse(fs.readFileSync(file('modules.json'), 'utf8')).panes.length === 3);
}


// pilot-v0.11: drag and drop on the kanban, the keyboard way, a stale move, a second tab, a hand edit, a frame reset by a
// move, touch, reduced motion. Real input only: Input.dispatchMouseEvent / dispatchKeyEvent / dispatchTouchEvent.
async function v11(page) {
  const file = (f) => path.join(APP, ENV.dir, f);
  await stop('server');
  const fix = path.join(APP, 'demo', 'fixtures', 'v0.11');
  for (const f of fs.readdirSync(fix)) if (!['demo.json', 'pilot.config.json'].includes(f)) fs.copyFileSync(path.join(fix, f), file(f));
  await startServer();
  const waitFor = async (expr, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.eval(expr)) return Date.now() - t0; await sleep(20); } return null; };
  const events = () => fs.readFileSync(file('metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const items = () => JSON.parse(fs.readFileSync(file('state.json'), 'utf8')).items;
  const item = (id) => items().find((i) => i.id === id);
  const shot = async (name) => { if (!process.env.SHOT_DIR) return; const r = await page.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(r.result.data, 'base64')); };
  const colOf = (p, c) => p.eval(`[...document.querySelectorAll('#pane-kanban .col.${c} .item')].map((x) => x.dataset.id).join(',')`);
  const board = async (p = page) => `${await colOf(p, 'todo')} | ${await colOf(p, 'doing')} | ${await colOf(p, 'done')}`;
  const moves = () => page.net.filter((n) => n.url.endsWith('/move') && n.method === 'POST').length;
  const said = () => page.eval(`document.getElementById('announce').textContent`);
  const box = (sel) => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: r.top, bottom: r.bottom }; })()`);
  const card = (id) => `#pane-kanban .item[data-id="${id}"]`;
  const mouse = (type, x, y, buttons) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
  // a real drag: press on `from`, move in steps to `to` (each a {x, y}), optionally look at the page mid-drag, release
  async function drag(from, to, mid, { release = true } = {}) {
    await mouse('mouseMoved', from.x, from.y, 0);
    await mouse('mousePressed', from.x, from.y, 1);
    const steps = 10;
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', Math.round(from.x + (to.x - from.x) * i / steps), Math.round(from.y + (to.y - from.y) * i / steps), 1); await sleep(16); }
    const seen = mid ? await mid() : null;
    if (release) await mouse('mouseReleased', to.x, to.y, 0);
    return seen;
  }
  const settled = () => waitFor(`!document.querySelector('.item.dragging')`, 2000).then(() => sleep(250));
  const midDrag = () => page.eval(`(() => { const l = document.querySelector('#pane-kanban .drop-line'); const t = document.querySelector('#pane-kanban .col.drop-target'); return { line: !!l, lineCol: l && l.closest('.col').dataset.col, before: l && l.nextElementSibling && l.nextElementSibling.dataset.id || null, target: t && t.dataset.col, ghost: !!document.querySelector('body > .drag-ghost'), dragging: (document.querySelector('.item.dragging') || {}).dataset?.id || null }; })()`);

  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);
  const start = await board();
  check('the kanban is shown with seven tasks: todo task-4,task-5,task-7,task-8 | doing task-3 | done task-1,task-2 (task-6 rejected, not on the board)', start === 'task-4,task-5,task-7,task-8 | task-3 | task-1,task-2', start);
  await shot('v11-start.png');
  const writes0 = events().filter((e) => e.event === 'item_write').length;

  // ---- a real mouse drag: task-4 onto doing, below task-3 ----
  const t3 = await box(card('task-3')), doing = await box('#pane-kanban .col.doing > .items');
  const from = await box(card('task-4'));
  const mid = await drag(from, { x: doing.x, y: Math.round(Math.max(t3.bottom + 6, doing.bottom - 6)) }, midDrag);
  check('mid-drag: a copy follows the pointer, the card is dimmed, doing is the outlined drop target, the bar sits after task-3', mid.ghost && mid.dragging === 'task-4' && mid.target === 'doing' && mid.line && mid.lineCol === 'doing' && mid.before === null, JSON.stringify(mid));
  const optimistic = await board();
  check('drop: the card is in doing at once (optimistic)', optimistic.split(' | ')[1] === 'task-3,task-4', optimistic);
  await settled();
  let it = item('task-4');
  check('state.json: task-4 column doing, order after task-3 (7 -> 8), movedBy user, movedAt; status still confirmed', it.column === 'doing' && it.order === 8 && it.movedBy === 'user' && !!it.movedAt && it.status === 'confirmed', JSON.stringify(it));
  check('metrics.jsonl: item_move {id task-4, from todo, to doing, order 8} and item_write via move; a kanban touch this turn', events().some((e) => e.event === 'item_move' && e.id === 'task-4' && e.from === 'todo' && e.to === 'doing' && e.order === 8)
    && events().some((e) => e.event === 'item_write' && e.via === 'move' && e.itemId === 'task-4') && events().some((e) => e.event === 'pane_touch' && e.module === 'kanban' && e.turn === 44));
  check('the card reads as yours, not as a file edit (no "file edit" on task-4) and keeps focus', !(await page.eval(`document.querySelector('${card('task-4')}').textContent.includes('file edit')`)) && await page.eval(`document.activeElement.dataset.id === 'task-4'`));
  check(`announced: "${await said()}"`, /^task-4 moved to doing, position 2 of 2\.$/.test(await said()));
  await shot('v11-dragged.png');

  // ---- reorder within a column: task-7 above task-5 ----
  const t5 = await box(card('task-5'));
  await drag(await box(card('task-7')), { x: t5.x, y: Math.round(t5.top + 3) });
  await settled();
  check('reorder within todo: task-7 above task-5 (todo task-7,task-5,task-8), only task-7 written', (await colOf(page, 'todo')) === 'task-7,task-5,task-8' && item('task-7').movedBy === 'user' && item('task-5').movedBy === undefined && item('task-5').order === undefined, await colOf(page, 'todo'));

  // ---- a proposed card moves and stays proposed ----
  const done1 = await box(card('task-1'));
  await drag(await box(card('task-8')), { x: done1.x, y: Math.round(done1.top + 3) });
  await settled();
  it = item('task-8');
  check('the dashed task-8 moved to the top of done and stays proposed (dashed, c/r keys, no decidedAt)', (await colOf(page, 'done')).startsWith('task-8,') && it.status === 'proposed' && !it.decidedAt && !it.decidedBy
    && await page.eval(`(() => { const c = document.querySelector('${card('task-8')}'); return c.dataset.proposed === '1' && getComputedStyle(c).borderTopStyle === 'dashed' && !!c.querySelector('[data-decision="confirm"]'); })()`), JSON.stringify(it));

  // ---- cancel: Escape mid-drag, and a drop outside the columns ----
  let n0 = moves(), b0 = await board();
  await drag(await box(card('task-5')), await box('#pane-kanban .col.done > .items'), null, { release: false });
  await page.key('Escape');
  await mouse('mouseReleased', 0, 0, 0);
  await settled();
  check('Escape mid-drag cancels: no POST /move, the board unchanged', moves() === n0 && await board() === b0);
  await drag(await box(card('task-5')), await box('#log'));
  await settled();
  check('a drop outside the columns (on the chat) cancels: no POST /move', moves() === n0 && await board() === b0);

  // ---- the keyboard way ----
  await page.eval(`document.querySelector('${card('task-4')}').focus()`);
  await page.key('ArrowLeft', 1);
  await settled();
  check('Alt+← on task-4 (doing, position 2): back to todo at position 2', (await colOf(page, 'todo')).split(',')[1] === 'task-4' && item('task-4').column === 'todo' && await page.eval(`document.activeElement.dataset.id === 'task-4'`), `${await board()}; "${await said()}"`);
  check('announced via aria-live: "task-4 moved to todo, position 2 of 3."', await said() === 'task-4 moved to todo, position 2 of 3.' && await page.eval(`document.getElementById('announce').getAttribute('aria-live') === 'polite'`), await said());
  await page.key('ArrowUp', 1); await settled();
  check('Alt+↑: task-4 to the top of todo', (await colOf(page, 'todo')).startsWith('task-4,'), await colOf(page, 'todo'));
  n0 = moves();
  await page.key('ArrowUp', 1); await sleep(150);
  check('Alt+↑ at the top: nothing sent, announced "already at the top of todo"', moves() === n0 && /already at the top of todo/.test(await said()), await said());
  await page.key('ArrowLeft', 1); await sleep(150);
  check('Alt+← in the first column: nothing sent, announced', moves() === n0 && /already in the first column/.test(await said()), await said());
  await page.key('ArrowRight', 1); await settled();
  await page.key('ArrowRight', 1); await settled();
  check('Alt+→ twice: task-4 todo -> doing -> done, focus stays on it', item('task-4').column === 'done' && (await colOf(page, 'done')).split(',').includes('task-4') && await page.eval(`document.activeElement.dataset.id === 'task-4'`), await board());
  n0 = moves();
  await page.key('ArrowDown', 1); await page.key('ArrowDown', 1); await settled(); await sleep(300);
  check('two quick Alt+↓ (no wait between): both written in order, task-4 third in done, no stale refusal', moves() === n0 + 2 && (await colOf(page, 'done')).split(',')[2] === 'task-4'
    && events().filter((e) => e.event === 'item_move' && e.id === 'task-4' && e.from === 'done' && e.to === 'done').length === 2 && !/not moved/.test(await said()), `${await colOf(page, 'done')}; "${await said()}"`);
  await page.eval(`document.querySelector('${card('task-4')}').focus()`);
  await page.key('ArrowDown'); 
  check('a plain ↓ still moves focus to the next card (no move)', await page.eval(`document.activeElement.dataset.id !== 'task-4'`) && item('task-4').column === 'done');
  n0 = moves();
  await page.type('hello'); await page.key('ArrowLeft', 1); await page.key('ArrowUp', 1); await sleep(150);
  check('Alt+arrows in the chat input never move a card (input kept, no POST /move)', moves() === n0 && await page.eval(`document.getElementById('input').value === 'hello'`));
  await page.eval(`document.getElementById('input').value = ''`);
  await page.eval(`document.querySelector('#pane-kanban .toggle').click()`);
  await waitFor(`!!document.querySelector('${card('task-6')}')`, 2000);
  await page.eval(`document.querySelector('${card('task-6')}').focus()`);
  await page.key('ArrowRight', 1); await sleep(150);
  check('a rejected task (shown with "rejected: 1 (show)") cannot be moved: nothing sent, announced', moves() === n0 && /task-6 is rejected/.test(await said()) && item('task-6').column === 'todo', await said());
  const r6 = await box(card('task-6'));
  await drag(r6, await box('#pane-kanban .col.done > .items'));
  await settled();
  check('… nor dragged', moves() === n0 && item('task-6').column === 'todo');
  await page.eval(`document.querySelector('#pane-kanban .toggle').click()`);
  const r = await (await fetch(URL + 'move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: 'task-6', column: 'done' }) })).json();
  check('the server refuses it too (409 rejected)', /rejected/.test(r.error || ''), r.error);

  // ---- empty column: doing emptied, then a card dropped into it ----
  const t3b = await box(card('task-3'));
  await drag(t3b, await box('#pane-kanban .col.done > .items'));
  await settled();
  check('doing is empty now (task-3 dragged to done)', (await colOf(page, 'doing')) === '', await board());
  const empty = await box('#pane-kanban .col.doing > .items');
  const mid2 = await drag(await box(card('task-5')), empty, midDrag);
  await settled();
  check('an empty column is a drop zone: outlined, the bar inside it, the card lands there', mid2.target === 'doing' && mid2.lineCol === 'doing' && (await colOf(page, 'doing')) === 'task-5' && item('task-5').column === 'doing', JSON.stringify(mid2));

  // ---- stale rev: the server refuses, the card snaps back, a notice ----
  n0 = moves(); b0 = await board();
  await page.eval(`state.stateRev = 1`);
  await drag(await box(card('task-7')), await box('#pane-kanban .col.doing > .items'));
  await waitFor(`!document.getElementById('notice').hidden`, 3000); await settled();
  check('a stale rev: POST /move -> 409, the notice says so, the card snaps back, the file unchanged', moves() === n0 + 1 && await board() === b0 && item('task-7').column === 'todo'
    && /changed since this page last saw it/.test(await page.eval(`document.getElementById('notice').textContent`)) && /not moved/.test(await said()), `${b0} -> ${await board()}; ${await said()}`);

  // ---- a second tab follows ----
  const tab2 = await page.newTab();
  await tab2.goto(URL);
  await sleep(500);
  check('a second tab shows the same board', await board(tab2) === await board(), await board(tab2));
  await page.eval(`document.querySelector('${card('task-7')}').focus()`);
  await page.key('ArrowRight', 1);
  const t0 = Date.now(); let synced = false;
  for (let i = 0; i < 50 && !synced; i++) { synced = (await colOf(tab2, 'doing')).split(',').includes('task-7'); if (!synced) await sleep(40); }
  check(`a move in tab 1 shows in tab 2 (${Date.now() - t0} ms)`, synced, await board(tab2));
  // a move in tab 2 makes tab 1's rev old; tab 1 follows by SSE, so its next move is not stale
  await tab2.eval(`document.querySelector('${card('task-7')}').focus()`);
  await tab2.key('ArrowLeft', 1);
  await waitFor(`[...document.querySelectorAll('#pane-kanban .col.todo .item')].some((x) => x.dataset.id === 'task-7')`, 2000);
  n0 = moves();
  await page.eval(`document.querySelector('${card('task-7')}').focus()`);
  await page.key('ArrowRight', 1); await settled();
  check('after a move in tab 2, tab 1 is current (SSE): its next move is written (no 409)', moves() === n0 + 1 && item('task-7').column === 'doing' && /^task-7 moved to doing/.test(await said()), await said());
  tab2.close();

  // ---- a hand edit of column/order shows live and reads "you (file edit)" ----
  const s = JSON.parse(fs.readFileSync(file('state.json'), 'utf8'));
  const t2 = s.items.find((i) => i.id === 'task-2'); t2.column = 'doing'; t2.order = -50;
  fs.writeFileSync(file('state.json'), JSON.stringify(s, null, 2));
  const hand = await waitFor(`(document.querySelector('#pane-kanban .col.doing .item') || {}).dataset?.id === 'task-2'`, 2000);
  check(`a hand edit (task-2 to doing, order -50) shows at the top of doing (${hand} ms) and reads "edited by you (file edit): column, order"`, hand !== null
    && await page.eval(`document.querySelector('${card('task-2')}').textContent.includes('edited by you (file edit): column, order')`), await board());

  // ---- an applied kanban frame is reset by a manual move ----
  await page.submit('/flag frame-proposals on', 800);
  fs.writeFileSync(file('frames.json'), JSON.stringify({ rev: 1, pending: {}, applied: { kanban: { id: 'fr-1', pane: 'kanban', intent: { pane: 'kanban', focus: 'task-1', order: ['task-1'] }, author: 'model', model: 'morrow', modelId: 'fake-morrow', at: new Date().toISOString(), appliedBy: 'user', appliedAt: new Date().toISOString() } }, resets: {} }, null, 2));
  await waitFor(`!!document.querySelector('#pane-kanban .frame-applied')`, 2000);
  check('an applied kanban frame shows its line and marks task-1', await page.eval(`!!document.querySelector('#pane-kanban .item.framed[data-id="task-1"]')`));
  await page.eval(`document.querySelector('${card('task-5')}').focus()`);
  await page.key('ArrowLeft', 1);
  await waitFor(`!document.querySelector('#pane-kanban .frame-applied')`, 3000); await settled();
  const fr = JSON.parse(fs.readFileSync(file('frames.json'), 'utf8'));
  check('a manual move resets it: frames.json resets.kanban {reason "manual move"}, frame_reset logged, the frame line gone, the UI says so', !fr.applied.kanban && fr.resets.kanban.reason === 'manual move' && fr.resets.kanban.frame === 'fr-1'
    && events().some((e) => e.event === 'frame_reset' && e.reason === 'manual move' && e.id === 'fr-1') && /reset by your manual move/.test(await page.eval(`document.getElementById('notice').textContent`))
    && await page.eval(`[...document.querySelectorAll('.ln.system')].some((l) => l.textContent.includes('kanban: frame fr-1 reset by your manual move'))`), JSON.stringify(fr.resets));
  await page.submit('/flag frame-proposals off', 600);

  // ---- /why task-N lists the moves ----
  await page.submit('/why task-4', 900);
  const why = await page.eval(`[...document.querySelectorAll('.ln.out.why-fact')].map((l) => l.textContent)`);
  const mv = why.filter((l) => /^moved by you/.test(l));
  check(`/why task-4 lists its ${mv.length} moves with sources (metrics.jsonl:N item_move task-4)`, mv.length >= 5 && mv.every((l) => /\[metrics\.jsonl:\d+ item_move task-4\]/.test(l)) && why.some((l) => /^on the kanban now: done/.test(l)), mv.slice(0, 2).join(' | '));

  // ---- touch (pointer events from touch input) ----
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const tf = await box(card('task-7')), tt = await box('#pane-kanban .col.done > .items');
  const touch = (type, x, y) => page.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', tf.x, tf.y);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', Math.round(tf.x + (tt.x - tf.x) * i / 10), Math.round(tf.y + (tt.y - tf.y) * i / 10)); await sleep(16); }
  await touch('touchEnd');
  await settled();
  check('a touch drag moves task-7 to done', item('task-7').column === 'done', await board());
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  // ---- reduced motion ----
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);
  await page.eval(`document.querySelector('${card('task-7')}').focus()`);
  await page.key('ArrowLeft', 1);
  const anim = await page.eval(`getComputedStyle(document.querySelector('${card('task-7')}')).animationName`);
  await settled();
  check('reduced motion: the moved card gets no highlight animation (it still moves)', anim === 'none' && item('task-7').column === 'doing', anim);
  await page.send('Emulation.setEmulatedMedia', { features: [] });

  // ---- narrow widths ----
  for (const w of [820, 390]) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(250);
    check(`${w} px: no horizontal scroll with the kanban`, !(await page.eval(`document.documentElement.scrollWidth > innerWidth`)));
  }
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  check('no move wrote status, decidedAt or decidedBy (item_write via move only carries what it moved)', events().filter((e) => e.event === 'item_write' && e.via === 'move').every((e) => { const before = events().filter((x) => x.event === 'item_write' && x.itemId === e.itemId && x.ts < e.ts).pop(); return !before || (before.item.status === e.item.status && before.item.decidedAt === e.item.decidedAt); }) && events().filter((e) => e.event === 'item_write').length > writes0);
}

// pilot-v0.12: several chats in one project. The v0.12 fixture: chats c-hospital, c-invoices, main ("letter") and the
// archived c-scratch, one shared kanban. Real clicks on the sidebar, a new chat, a card tag, /why links, two tabs in two
// chats, Alt+S, the drawer at 820 px, back/forward, the open question shown in every chat.
async function v12(page) {
  const file = (f) => path.join(APP, ENV.dir, f);
  await stop('server');
  fs.cpSync(path.join(APP, 'demo', 'fixtures', 'v0.12'), path.join(APP, ENV.dir), { recursive: true });
  fs.rmSync(file('demo.json'), { force: true }); fs.rmSync(file('pilot.config.json'), { force: true });
  await startServer();
  const mainBefore = fs.readFileSync(file('transcript.jsonl'));
  const waitFor = async (expr, ms = 4000, p = page) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.eval(expr)) return Date.now() - t0; await sleep(20); } return null; };
  const events = () => fs.readFileSync(file('metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const chatsDoc = () => JSON.parse(fs.readFileSync(file('chats.json'), 'utf8'));
  const items = () => JSON.parse(fs.readFileSync(file('state.json'), 'utf8')).items;
  const shot = async (name, p = page) => { if (!process.env.SHOT_DIR) return; const r = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(r.result.data, 'base64')); };
  const click = async (sel, p = page) => {
    const b = await p.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!b) return false;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
    return true;
  };
  const listed = (p = page) => p.eval(`[...document.querySelectorAll('#chat-list .chat-link')].map((a) => a.dataset.chat).join(',')`);
  const current = (p = page) => p.eval(`(document.querySelector('#chat-list .chat-link[aria-current="page"]') || {}).dataset?.chat || null`);
  const where = (p = page) => p.eval(`location.pathname + location.search`);
  const board = (p = page) => p.eval(`['todo', 'doing', 'done'].map((c) => [...document.querySelectorAll('#pane-kanban .col.' + c + ' .item')].map((x) => x.dataset.id).join(',')).join(' | ')`);
  const tag = (id, p = page) => p.eval(`(document.querySelector('#pane-kanban .item[data-id="${id}"] .chat-tag') || {}).textContent || null`);
  const logHas = (t, p = page) => p.eval(`document.getElementById('log').textContent.includes(${JSON.stringify(t)})`);

  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);
  check('the sidebar is open (the project has chats.json): three chats, most recent first; the archived one is not listed', await page.eval(`!document.getElementById('chats').hidden`) && await listed() === 'c-hospital,c-invoices,main', await listed());
  check('main is the current chat at / (aria-current), the title bar says "· letter", the tab title too', await current() === 'main' && await where() === '/' && await page.eval(`document.getElementById('chat-name').textContent === '· letter' && document.title.startsWith('letter')`));
  const bylines = await page.eval(`[...document.querySelectorAll('#chat-list .chat-link')].map((a) => a.querySelector('.cby').textContent.replace(/ · \\d\\d-\\d\\d \\d\\d:\\d\\d$/, '')).join(' | ')`);
  check('who named each chat: the first sentence (no name yet), model · morrow, you', bylines === 'first message · 4 msg | model · morrow · 4 msg | you · 88 msg', bylines);
  check('the archived chat sits behind "archived: 1 (show)"', await page.eval(`(() => { const t = document.getElementById('archived-toggle'); return !t.hidden && t.textContent === 'archived: 1 (show)' && document.getElementById('chat-archived').hidden; })()`));
  const start = await board();
  check('the shared kanban: tasks from three chats', start === 'task-4,task-5,task-7,task-8,task-9,task-11 | task-3,task-10 | task-1,task-2', start);
  check('each card names its chat: task-9 "chat · invoices", task-10 and task-11 the hospital chat, task-4 "chat · letter"', await tag('task-9') === 'chat · invoices' && /^chat · The hospital sent/.test(await tag('task-10')) && /^chat · The hospital sent/.test(await tag('task-11')) && await tag('task-4') === 'chat · letter', `${await tag('task-9')} / ${await tag('task-10')} / ${await tag('task-4')}`);
  const lay = await page.eval(`(() => { const n = document.getElementById('chats').getBoundingClientRect(), b = document.getElementById('bench').getBoundingClientRect(), k = document.querySelector('#pane-kanban .body'); const cs = getComputedStyle(k); return { navRight: Math.round(n.right), benchLeft: Math.round(b.left), kb: Math.round(k.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)), cols: [...document.querySelectorAll('#pane-kanban .col')].map((c) => Math.round(c.getBoundingClientRect().top)), h: document.documentElement.scrollWidth > innerWidth }; })()`);
  check('1280 px: the sidebar is its own column left of the bench; the kanban keeps three columns side by side; no horizontal scroll', lay.navRight <= lay.benchLeft && lay.kb >= 420 && new Set(lay.cols).size === 1 && !lay.h, JSON.stringify(lay));
  await shot('v12-start.png');

  // ---- switch in the sidebar ----
  await click('#chat-list .chat-link[data-chat="c-invoices"]');
  await waitFor(`location.search === '?chat=c-invoices' && document.getElementById('log').textContent.includes('pharmacy receipts')`);
  check('a click on "invoices": the URL says ?chat=c-invoices, the log is that chat (its lines only), it is marked current', await where() === '/?chat=c-invoices' && await logHas('sort the pharmacy receipts') && !(await logHas('dogfood the pilot')) && await current() === 'c-invoices');
  check('the board stays the same (it belongs to the project, not the chat)', await board() === start);
  await sleep(300);
  check('metrics.jsonl: chat_switch {from main, to c-invoices, how sidebar}', events().some((e) => e.event === 'chat_switch' && e.from === 'main' && e.to === 'c-invoices' && e.how === 'sidebar'));

  // ---- a new chat; a task in it lands on the shared board, tagged ----
  await click('#new-chat');
  await waitFor(`/^\\?chat=c-[0-9a-f]{6}$/.test(location.search)`);
  const nc = (await where()).split('=')[1];
  await waitFor(`(document.querySelector('#chat-list .chat-link[aria-current="page"]') || {}).dataset?.chat === ${JSON.stringify(nc)} && !!document.querySelector('#log .ln.out.cmd')`);
  check('"+ new chat": a new chat c-xxxxxx, the URL follows, the log is empty but for the command, chats.json lists it (main stays first)', /^c-[0-9a-f]{6}$/.test(nc || '') && chatsDoc().chats[0].id === 'main' && chatsDoc().chats.some((c) => c.id === nc) && fs.existsSync(file(`chats/${nc}.jsonl`)) && !(await page.eval(`document.querySelectorAll('#log .ln:not(.out)').length`)), nc);
  check('the new chat is at the top of the list and current ("new chat", no messages)', (await listed()).startsWith(`${nc},`) && await current() === nc);
  await page.submit('Task: call the pharmacy about the receipts.', 300);
  const tAppear = await waitFor(`!!document.querySelector('#pane-kanban .item[data-id="task-12"] .chat-tag')`, 6000);
  check('the task from the new chat appears on the shared kanban, dashed (proposed), tagged with the new chat', tAppear !== null && await page.eval(`document.querySelector('#pane-kanban .item[data-id="task-12"]').classList.contains('proposed')`), `${tAppear} ms`);
  check('state.json: task-12 records fromChat (the new chat) and fromMessage (a line of chats/<id>.jsonl)', (() => { const t = items().find((i) => i.id === 'task-12'); return t && t.fromChat === nc && fs.readFileSync(file(`chats/${nc}.jsonl`), 'utf8').includes(t.fromMessage); })());
  check('the model saw only this chat: "1 messages in context"', await logHas('1 messages in context'));
  await waitFor(`(document.querySelector('#chat-list .chat-link[aria-current="page"] .ct') || {}).textContent === 'call the pharmacy about'`, 4000);
  check('after the first reply the title role names it: "call the pharmacy about", model · morrow', await page.eval(`(() => { const a = document.querySelector('#chat-list .chat-link[aria-current="page"]'); return a.querySelector('.ct').textContent === 'call the pharmacy about' && a.querySelector('.cby').textContent.startsWith('model · morrow'); })()`) && await tag('task-12') === 'chat · call the pharmacy about');
  check('transcript.jsonl (main) is untouched byte for byte by everything in the other chats', Buffer.compare(mainBefore, fs.readFileSync(file('transcript.jsonl'))) === 0);
  await shot('v12-new.png');

  // ---- a card's chat tag opens that chat at the message ----
  await click('#pane-kanban .item[data-id="task-9"] .chat-tag');
  const fm = items().find((i) => i.id === 'task-9').fromMessage;
  await waitFor(`location.search === '?chat=c-invoices' && !!document.getElementById('msg-${fm}') && document.getElementById('msg-${fm}').classList.contains('flash')`);
  await sleep(200);
  check('the tag on task-9 opens c-invoices and marks the message it came from', await where() === '/?chat=c-invoices' && await page.eval(`document.getElementById('msg-${fm}') && document.getElementById('msg-${fm}').classList.contains('flash')`) && events().some((e) => e.event === 'chat_switch' && e.to === 'c-invoices' && e.how === 'tag'));

  // ---- back and forward ----
  await page.eval(`history.back()`);
  await waitFor(`location.search === '?chat=${nc}' && document.getElementById('log').textContent.includes('call the pharmacy') && (document.querySelector('#chat-list .chat-link[aria-current="page"]') || {}).dataset?.chat === '${nc}'`);
  check('Back returns to the chat before (the log follows the URL)', await where() === `/?chat=${nc}` && await logHas('call the pharmacy') && await current() === nc);

  // ---- /why with a link into another chat ----
  await page.submit('/why task-9', 600);
  const why = await page.eval(`[...document.querySelectorAll('.why-fact')].map((p) => p.textContent).join('\\n')`);
  check('/why task-9 cites chats/c-invoices.jsonl and its line, and names the chat', /chats\/c-invoices\.jsonl:1 m-f/.test(why) && /from chat c-invoices "invoices" \(chats\/c-invoices\.jsonl, line 1\)/.test(why), why.split('\n').slice(0, 4).join(' / '));
  await click('.why-fact .go');
  await waitFor(`location.search === '?chat=c-invoices' && !!document.querySelector('#log .ln.flash')`);
  check('its "show m-…" opens c-invoices at that message', await where() === '/?chat=c-invoices' && await page.eval(`!!document.querySelector('#log .ln.flash')`));

  // ---- two tabs in two chats ----
  const tab2 = await page.newTab();
  await tab2.goto(`${URL}?chat=c-hospital`);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`, 4000, tab2);
  check('a second tab at ?chat=c-hospital shows that chat (its own log), marked current there', await current(tab2) === 'c-hospital' && await logHas('discharge letter', tab2) && !(await logHas('pharmacy receipts', tab2)));
  await click(`#chat-list .chat-link[data-chat="${nc}"]`);
  await waitFor(`location.search === '?chat=${nc}'`);
  await page.submit('Task: bring the receipts folder.', 300);
  const t2 = await waitFor(`!!document.querySelector('#pane-kanban .item[data-id="task-13"]')`, 6000, tab2);
  check('a task sent in tab 1 (the new chat) appears on the board in tab 2, which stays in c-hospital', t2 !== null && await where(tab2) === '/?chat=c-hospital' && !(await logHas('receipts folder', tab2)), `${t2} ms`);
  await waitFor(`(document.querySelector('#chat-list .chat-link') || {}).dataset?.chat === '${nc}'`, 3000, tab2);
  check('the list in tab 2 follows by SSE: the new chat is first there (most recent activity) with its name', (await listed(tab2)).startsWith(`${nc},`) && await tab2.eval(`document.querySelector('#chat-list .chat-link .ct').textContent === 'call the pharmacy about'`));
  await tab2.goto(`${URL}?chat=c-hospital`);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`, 4000, tab2);
  check('a reload keeps tab 2 in c-hospital', await where(tab2) === '/?chat=c-hospital' && await current(tab2) === 'c-hospital');
  check('tab 1 is still in the new chat (each tab has its own chat)', await where() === `/?chat=${nc}` && await current() === nc);
  tab2.close();

  // ---- the open question shows in every chat, saying where it was asked ----
  const mods = JSON.parse(fs.readFileSync(file('modules.json'), 'utf8'));
  const ask = { id: 'm-q12test', ts: new Date().toISOString(), role: 'controller', text: 'The index pane has been a tab for 9 turns. Remove the index pane? (y removes it, the rule may offer it again later; n keeps the tab; x removes it for good)', model: null, module: 'index', question: 'remove' };
  fs.appendFileSync(file('chats/c-hospital.jsonl'), JSON.stringify(ask) + '\n');
  mods.pending = 'index'; mods.pendingKind = 'remove'; mods.panes.find((p) => p.module === 'index').removalAsked = true; mods.rev += 1;
  fs.writeFileSync(file('modules.json'), JSON.stringify(mods, null, 2));
  await waitFor(`!!document.querySelector('#log .ln.controller.pending .asked-in')`, 3000);
  check('an open question asked in c-hospital shows in the new chat too, with its y/n/x buttons and "asked in chat …"', await page.eval(`(() => { const p = document.querySelector('#log .ln.controller.pending'); return !!p && /^asked in chat The hospital sent/.test(p.querySelector('.asked-in').textContent) && p.querySelectorAll('button.key').length === 3; })()`));
  await page.eval(`document.getElementById('input').focus()`);
  await page.key('n'); await sleep(500);
  check('n from the empty input answers it here: removals.index "no", the system line goes to this chat (not to main, not to c-hospital)', JSON.parse(fs.readFileSync(file('modules.json'), 'utf8')).removals.index.answer === 'no' && fs.readFileSync(file(`chats/${nc}.jsonl`), 'utf8').includes('remove index: no') && Buffer.compare(mainBefore, fs.readFileSync(file('transcript.jsonl'))) === 0);

  // ---- keyboard: Alt+S (Option+S), arrows, Escape; never from a non-empty input ----
  const altS = () => page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 1 }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 1 }));
  await page.eval(`document.getElementById('input').focus()`);
  await altS(); await sleep(100);
  check('Alt+S from the empty input focuses the current chat in the sidebar', await page.eval(`document.activeElement.classList.contains('chat-link') && document.activeElement.dataset.chat === ${JSON.stringify(nc)}`));
  await page.key('ArrowDown'); await sleep(50);
  const next = await page.eval(`document.activeElement.dataset.chat`);
  await page.key('Escape'); await sleep(50);
  check('↓ moves to the next chat, Escape returns to the input', next && next !== nc && await page.eval(`document.activeElement.id === 'input'`), next);
  await page.type('half a sentence');
  await altS(); await sleep(100);
  check('Alt+S with text in the input does nothing (focus and text stay)', await page.eval(`document.activeElement.id === 'input' && document.getElementById('input').value === 'half a sentence'`));
  await page.eval(`document.getElementById('input').value = ''`);

  // ---- /chat commands: rename, archive (nothing deleted), unarchive ----
  await page.submit('/chat rename pharmacy', 500);
  check('/chat rename pharmacy: chats.json title, named by you (chat_rename by user)', chatsDoc().chats.find((c) => c.id === nc).title === 'pharmacy' && chatsDoc().chats.find((c) => c.id === nc).titleBy === 'user' && await page.eval(`document.querySelector('#chat-list .chat-link[aria-current="page"] .cby').textContent.startsWith('you')`));
  const size = fs.statSync(file(`chats/${nc}.jsonl`)).size;
  await page.submit('/chat archive', 700);
  check('/chat archive: hidden from the list, you are taken to the most recent chat left, chats/<id>.jsonl still there unchanged', !(await listed()).split(',').includes(nc) && await where() !== `/?chat=${nc}` && fs.statSync(file(`chats/${nc}.jsonl`)).size === size && chatsDoc().chats.find((c) => c.id === nc).archived === true);
  await click('#archived-toggle');
  check('"archived: 2 (show)" lists both archived chats', await page.eval(`!document.getElementById('chat-archived').hidden && document.querySelectorAll('#chat-archived .chat-link').length === 2`));
  await page.submit(`/chat unarchive pharmacy`, 600);
  check('/chat unarchive pharmacy: back in the list', (await listed()).split(',').includes(nc) && chatsDoc().chats.find((c) => c.id === nc).archived === undefined);

  // ---- the drawer below 900 px ----
  await page.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check('820 px: the sidebar is a closed drawer, the ☰ button in the title bar opens it; no horizontal scroll', await page.eval(`document.getElementById('chats').hidden && getComputedStyle(document.getElementById('chats-btn')).display !== 'none' && document.documentElement.scrollWidth <= innerWidth`));
  await click('#chats-btn'); await sleep(200);
  const dr = await page.eval(`(() => { const n = document.getElementById('chats'); return { open: !n.hidden, fixed: getComputedStyle(n).position === 'fixed', w: Math.round(n.getBoundingClientRect().width), h: document.documentElement.scrollWidth > innerWidth }; })()`);
  check('☰ opens the drawer over the page (fixed), no horizontal scroll', dr.open && dr.fixed && dr.w > 0 && !dr.h, JSON.stringify(dr));
  await shot('v12-drawer.png');
  const other = (await current()) === 'c-invoices' ? 'c-hospital' : 'c-invoices';
  await click(`#chat-list .chat-link[data-chat="${other}"]`);
  await waitFor(`location.search === '?chat=${other}'`);
  await sleep(150);
  check('a chat picked in the drawer opens and the drawer closes', await where() === `/?chat=${other}` && await page.eval(`document.getElementById('chats').hidden`));
  await page.eval(`document.getElementById('input').focus()`);
  await altS(); await sleep(150);
  check('Alt+S opens the drawer and focuses the current chat; Escape closes it again', await page.eval(`!document.getElementById('chats').hidden && document.activeElement.dataset.chat === '${other}'`) && (await page.key('Escape'), await sleep(100), await page.eval(`document.getElementById('chats').hidden && document.activeElement.id === 'input'`)));
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(200);

  // ---- light mode and the files ----
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await sleep(150);
  check('light mode: the current chat keeps its marker (lavender edge on the bar colour)', await page.eval(`(() => { const a = document.querySelector('#chat-list .chat-link[aria-current="page"]'); const cs = getComputedStyle(a); return cs.borderLeftStyle === 'solid' && cs.borderLeftWidth === '3px'; })()`));
  await shot('v12-light.png');
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  check('nothing was deleted: every chat file of the fixture is still there, main byte for byte', ['chats/c-scratch.jsonl', 'chats/c-invoices.jsonl', 'chats/c-hospital.jsonl', `chats/${nc}.jsonl`].every((f) => fs.existsSync(file(f))) && Buffer.compare(mainBefore, fs.readFileSync(file('transcript.jsonl'))) === 0);
}

async function v13(page) {
  const file = (p, f) => path.join(APP, ENV.dir, p, f);
  await stop('server');
  fs.cpSync(path.join(APP, 'demo', 'fixtures', 'v0.13'), path.join(APP, ENV.dir), { recursive: true });
  for (const f of ['demo.json', 'pilot.config.json']) fs.rmSync(path.join(APP, ENV.dir, f), { force: true });
  await startServer();
  const waitFor = async (expr, ms = 4000, p = page) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.eval(expr)) return Date.now() - t0; await sleep(20); } return null; };
  const events = (p) => fs.readFileSync(file(p, 'metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const items = (p) => JSON.parse(fs.readFileSync(file(p, 'state.json'), 'utf8')).items;
  const shot = async (name, p = page) => { if (!process.env.SHOT_DIR) return; const r = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(process.env.SHOT_DIR, name), Buffer.from(r.result.data, 'base64')); };
  const click = async (sel, p = page) => {
    const b = await p.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    if (!b) return false;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await p.send('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 });
    return true;
  };
  const where = (p = page) => p.eval(`location.pathname + location.search`);
  const board = (p = page) => p.eval(`['todo', 'doing', 'done'].map((c) => [...document.querySelectorAll('#pane-kanban .col.' + c + ' .item')].map((x) => x.dataset.id).join(',')).join(' | ')`);
  const cards = (p = page) => p.eval(`[...document.querySelectorAll('#pane-kanban .item .text')].map((x) => x.textContent).join(' / ')`);
  const sections = (p = page) => p.eval(`[...document.querySelectorAll('#project-list .proj')].map((s) => s.dataset.project + (s.querySelector('.proj-head').getAttribute('aria-current') === 'true' ? '*' : '') + ':' + [...s.querySelectorAll('.chat-list:not(.archived) .chat-link')].map((a) => a.dataset.chat).join(',')).join(' | ')`);
  const curProj = (p = page) => p.eval(`(document.querySelector('.proj-head[aria-current="true"]') || {}).dataset?.project || null`);

  await page.goto(URL);
  await waitFor(`document.getElementById('meta').textContent.includes('live') && !!document.querySelector('#project-list .proj')`);
  check('PILOT_HOME: / opens the first project and the URL names it (?project=health-insurance-claim)', await where() === '/?project=health-insurance-claim');
  const sec = await sections();
  check('the sidebar groups chats under projects: health insurance claim (current, its three chats) and move flat (its two chats)', sec === 'health-insurance-claim*:c-hospital,c-invoices,main | move-flat:c-boxes,main', sec);
  check('the sidebar is open, its bar says "projects", "+ new project" at the top; the current chat is marked inside the current project', await page.eval(`!document.getElementById('chats').hidden && document.getElementById('chats-label').textContent === 'projects' && !document.getElementById('new-project').hidden && document.querySelector('.proj.current #chat-list .chat-link[aria-current="page"]').dataset.chat === 'main'`));
  check('the title bar and the tab title name the project and the chat', await page.eval(`document.getElementById('chat-name').textContent === '· health insurance claim / letter' && document.title === 'letter · health insurance claim · CLI Pilot'`));
  const startA = await board();
  check('the board of health insurance claim (the v0.12 kanban)', startA === 'task-4,task-5,task-7,task-8,task-9,task-11 | task-3,task-10 | task-1,task-2', startA);
  const lay = await page.eval(`(() => { const n = document.getElementById('chats').getBoundingClientRect(), b = document.getElementById('bench').getBoundingClientRect(); return { navRight: Math.round(n.right), benchLeft: Math.round(b.left), h: document.documentElement.scrollWidth > innerWidth, longest: Math.max(...[...document.querySelectorAll('.proj-head')].map((h) => h.scrollWidth - h.clientWidth)) }; })()`);
  check('1280 px: the sidebar is its own column, headers fit (no overflow), no horizontal scroll', lay.navRight <= lay.benchLeft && !lay.h && lay.longest <= 0, JSON.stringify(lay));
  await shot('v13-start.png');

  // ---- switch project: the board changes ----
  await click('.chat-link[data-project="move-flat"][data-chat="main"]');
  await waitFor(`location.search === '?project=move-flat' && !document.querySelector('#pane-kanban .item[data-id="task-11"]') && !!document.querySelector('#pane-kanban .item[data-id="task-4"]') && !document.getElementById('pane-map') && document.getElementById('log').textContent.includes('Lindenstrasse')`);
  const startB = await board();
  check('a click on "flat search" under move flat: the URL says ?project=move-flat, the board is that project\'s (four tasks), its log', await where() === '/?project=move-flat' && startB === 'task-2,task-3,task-4 | task-1 | ' && await cards() === 'book a moving van for the 29th / collect boxes from the supermarket / label every box with its room / give notice on the old flat by Friday', `${startB}`);
  check('move flat is now the current project (its header marked, its chats in the live list); no map pane there', await curProj() === 'move-flat' && await page.eval(`document.querySelector('.proj.current').dataset.project === 'move-flat' && !document.getElementById('pane-map')`));
  await sleep(300);
  check('metrics.jsonl of move flat: project_switch {from health-insurance-claim, to move-flat, how sidebar}; nothing of it in the other project', events('move-flat').some((e) => e.event === 'project_switch' && e.from === 'health-insurance-claim' && e.to === 'move-flat' && e.how === 'sidebar') && !events('health-insurance-claim').some((e) => e.event === 'project_switch'));
  await shot('v13-switch.png');
  await page.eval(`history.back()`);
  await waitFor(`location.search === '?project=health-insurance-claim' && !!document.querySelector('#pane-kanban .item[data-id="task-11"]')`);
  check('Back returns to health insurance claim and its board', await where() === '/?project=health-insurance-claim' && await board() === startA && await curProj() === 'health-insurance-claim');

  // ---- a second tab stays in health insurance claim ----
  const tab2 = await page.newTab();
  await tab2.goto(`${URL}?project=health-insurance-claim&chat=c-invoices`);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`, 4000, tab2);
  check('tab 2 at ?project=health-insurance-claim&chat=c-invoices shows that project and chat', await where(tab2) === '/?project=health-insurance-claim&chat=c-invoices' && await tab2.eval(`document.getElementById('log').textContent.includes('pharmacy receipts')`));

  // ---- + new chat inside another project ----
  await click('.new-chat-in[data-project="move-flat"]');
  await waitFor(`/^\\?project=move-flat&chat=c-[0-9a-f]{6}$/.test(location.search)`);
  const nc = (await where()).split('chat=')[1];
  check('"+ new chat" under move flat: tab 1 opens move flat at a new chat (?project=move-flat&chat=c-…); its chats.json lists it, the other project\'s does not', /^c-[0-9a-f]{6}$/.test(nc || '') && JSON.parse(fs.readFileSync(file('move-flat', 'chats.json'))).chats.some((c) => c.id === nc) && !JSON.parse(fs.readFileSync(file('health-insurance-claim', 'chats.json'))).chats.some((c) => c.id === nc));
  await page.submit('Task: order a new kitchen lamp.', 300);
  const t = await waitFor(`!!document.querySelector('#pane-kanban .item[data-id="task-5"]')`, 6000);
  check('the task lands on move flat\'s board (task-5, dashed, tagged with the new chat) and in move-flat/state.json only', t !== null && items('move-flat').some((i) => i.id === 'task-5' && i.text === 'order a new kitchen lamp' && i.fromChat === nc) && !items('health-insurance-claim').some((i) => /kitchen lamp/.test(i.text)), `${t} ms`);
  await sleep(500);
  check('tab 2 (health insurance claim) never shows it: its board is unchanged', await board(tab2) === startA && !(await cards(tab2)).includes('kitchen lamp'));
  await page.goto(`${URL}?project=move-flat&chat=${nc}`);
  await waitFor(`document.getElementById('meta').textContent.includes('live')`);
  check('a reload keeps tab 1 in move flat at the new chat', await where() === `/?project=move-flat&chat=${nc}` && await curProj() === 'move-flat' && await page.eval(`document.querySelector('#chat-list .chat-link[aria-current="page"]').dataset.chat === ${JSON.stringify(nc)}`));

  // ---- + new project ----
  await click('#new-project');
  check('"+ new project" puts /project new in the input (the name is yours to type)', await page.eval(`document.getElementById('input').value === '/project new ' && document.activeElement.id === 'input'`));
  await page.type('tax return'); await page.key('Enter');
  await waitFor(`location.search === '?project=tax-return' && document.querySelector('.proj-head[aria-current="true"]')?.dataset.project === 'tax-return' && !document.getElementById('pane-kanban')`, 4000);
  const pj = JSON.parse(fs.readFileSync(path.join(APP, ENV.dir, 'projects.json'), 'utf8'));
  check('/project new tax return: ?project=tax-return, its own dir with rules.json, listed third in projects.json; an empty workbench (no side panes)', await where() === '/?project=tax-return' && pj.projects.map((x) => x.id).join(',') === 'health-insurance-claim,move-flat,tax-return' && fs.existsSync(file('tax-return', 'rules.json')) && await page.eval(`!document.querySelector('.pane.side') && !document.getElementById('pane-kanban')`));
  check('the new project shows in the sidebar as current, with "+ new chat" and its one chat', (await sections()).endsWith('tax-return*:main'), await sections());
  await shot('v13-new-project.png');

  // ---- collapse a project header (kept in this browser) ----
  await waitFor(`document.getAnimations().length === 0`);   // the pane change animates (View Transition); a click during it reaches the transition, not the page
  await click('.proj-head[data-project="health-insurance-claim"]');
  check('a click on a header collapses that project (aria-expanded false, its chats hidden)', await page.eval(`(() => { const h = document.querySelector('.proj-head[data-project="health-insurance-claim"]'); return h.getAttribute('aria-expanded') === 'false' && h.nextElementSibling.hidden; })()`));
  await page.goto(`${URL}?project=tax-return`);
  await waitFor(`document.getElementById('meta').textContent.includes('live') && !!document.querySelector('.proj-head')`);
  check('collapsed stays collapsed after a reload; a second click expands it', await page.eval(`document.querySelector('.proj-head[data-project="health-insurance-claim"]').getAttribute('aria-expanded') === 'false'`) && (await click('.proj-head[data-project="health-insurance-claim"]'), await page.eval(`document.querySelector('.proj-head[data-project="health-insurance-claim"]').getAttribute('aria-expanded') === 'true'`)));

  // ---- keyboard: Alt+S, arrows over headers and chats ----
  const altS = () => page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 1 }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 's', code: 'KeyS', windowsVirtualKeyCode: 83, modifiers: 1 }));
  await page.eval(`document.getElementById('input').focus()`);
  await altS(); await sleep(100);
  const f1 = await page.eval(`document.activeElement.dataset.chat + '@' + (document.activeElement.closest('.proj') || {}).dataset?.project`);
  await page.key('ArrowUp'); await sleep(50);
  const f2 = await page.eval(`document.activeElement.className`);
  await page.key('Escape'); await sleep(50);
  check('Alt+S focuses the current chat of the current project; ↑ reaches its "+ new chat"; Escape returns to the input', f1 === 'main@tax-return' && /new-chat/.test(f2) && await page.eval(`document.activeElement.id === 'input'`), `${f1} / ${f2}`);

  // ---- the drawer below 900 px ----
  await page.send('Emulation.setDeviceMetricsOverride', { width: 820, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check('820 px: the sidebar is a closed drawer; ☰ opens it over the page with the project groups; no horizontal scroll', await page.eval(`document.getElementById('chats').hidden`) && (await click('#chats-btn'), await sleep(200), await page.eval(`!document.getElementById('chats').hidden && getComputedStyle(document.getElementById('chats')).position === 'fixed' && document.querySelectorAll('#project-list .proj').length === 3 && document.documentElement.scrollWidth <= innerWidth`)));
  await shot('v13-drawer.png');
  await click('.chat-link[data-project="move-flat"][data-chat="c-boxes"]');
  await waitFor(`location.search === '?project=move-flat&chat=c-boxes'`);
  await sleep(200);
  check('a chat of another project picked in the drawer opens that project and chat, and the drawer closes', await where() === '/?project=move-flat&chat=c-boxes' && await page.eval(`document.getElementById('chats').hidden`) && await curProj() === 'move-flat');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(200);

  // ---- archive (nothing deleted) ----
  await page.submit('/project archive tax return', 700);
  check('/project archive tax return: hidden from the list behind "archived projects: 1 (show)", its dir stays', !(await sections()).includes('tax-return') && await page.eval(`document.getElementById('archived-projects-toggle').textContent === 'archived projects: 1 (show)'`) && fs.existsSync(file('tax-return', 'rules.json')) && JSON.parse(fs.readFileSync(path.join(APP, ENV.dir, 'projects.json'), 'utf8')).projects.find((x) => x.id === 'tax-return').archived === true);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await sleep(150);
  check('light mode: the current project header keeps its marker (lavender edge)', await page.eval(`(() => { const h = document.querySelector('.proj-head[aria-current="true"]'); const cs = getComputedStyle(h); return cs.borderLeftStyle === 'solid' && cs.borderLeftWidth === '3px'; })()`));
  await shot('v13-light.png');
  await page.send('Emulation.setEmulatedMedia', { features: [] });
  check('tab 2 is still in health insurance claim at c-invoices', await where(tab2) === '/?project=health-insurance-claim&chat=c-invoices');
  tab2.close();
}

const SCENARIOS = { p1, p2, v03, v04, v05, v06, v07, v08, v09, v10, v11, v12, v13 };
const ENVS = {
  v03: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4765;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5766/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5767/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5767/v1';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v03b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4765/', fakes: [5766, 5767], dir: '.pilot-verify-v03b', config: file, cdp: 9343 };
  },
  v04: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4775;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5776/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5777/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5777/v1';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v04b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4775/', fakes: [5776, 5777], dir: '.pilot-verify-v04b', config: file, cdp: 9353 };
  },
  v05: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4785;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5786/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5787/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5787/v1';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v05b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4785/', fakes: [5786, 5787], dir: '.pilot-verify-v05b', config: file, cdp: 9363 };
  },
  v06: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4795;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5796/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5797/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5797/v1';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v06b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4795/', fakes: [5796, 5797], dir: '.pilot-verify-v06b', config: file, cdp: 9373 };
  },
  v07: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4805;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5806/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5807/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5807/v1';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v07b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4805/', fakes: [5806, 5807], dir: '.pilot-verify-v07b', config: file, cdp: 9383 };
  },
  v08: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4815;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5816/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5817/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5817/v1';
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v08b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4815/', fakes: [5816, 5817], dir: '.pilot-verify-v08b', config: file, cdp: 9393 };
  },
  v09: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4825;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5826/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5827/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5827/v1';
    c.experiments = { settledInput: false, settleMs: 400 };
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v09b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4825/', fakes: [5826, 5827], dir: '.pilot-verify-v09b', config: file, cdp: 9403 };
  },
  v10: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'pilot.config.dev.json'), 'utf8'));
    c.port = 4835;
    c.roles.chat.candidates[0].baseUrl = 'http://127.0.0.1:5836/v1';
    c.roles.chat.candidates[1].baseUrl = 'http://127.0.0.1:5837/v1';
    c.roles.extract.candidates[0].baseUrl = 'http://127.0.0.1:5837/v1';
    c.roles.frame.candidates[0].baseUrl = 'http://127.0.0.1:5837/v1';
    c.experiments = { settledInput: false, settleMs: 1800, frameProposals: false };
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v10b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4835/', fakes: [5836, 5837], dir: '.pilot-verify-v10b', config: file, cdp: 9413 };
  },
  // pilot-v0.11: the v0.11 demo config (kanban shown, experiments off, a frame role) on this scenario's ports
  v11: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'demo', 'fixtures', 'v0.11', 'pilot.config.json'), 'utf8'));
    c.port = 4845;
    for (const r of Object.values(c.roles)) for (const k of r.candidates) k.baseUrl = k.baseUrl.replace(':5788/', ':5846/').replace(':5789/', ':5847/');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v11b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4845/', fakes: [5846, 5847], dir: '.pilot-verify-v11b', config: file, cdp: 9423 };
  },
  // pilot-v0.12: the v0.12 demo config (three chats and an archived one, a title role on morrow) on this scenario's ports
  v12: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'demo', 'fixtures', 'v0.12', 'pilot.config.json'), 'utf8'));
    c.port = 4855;
    for (const r of Object.values(c.roles)) for (const k of r.candidates) k.baseUrl = k.baseUrl.replace(':5794/', ':5856/').replace(':5795/', ':5857/');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v12b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4855/', fakes: [5856, 5857], dir: '.pilot-verify-v12b', config: file, cdp: 9433 };
  },
  // pilot-v0.13: the v0.13 demo config (a projects home with two projects) on this scenario's ports, PILOT_HOME
  v13: () => {
    const c = JSON.parse(fs.readFileSync(path.join(APP, 'demo', 'fixtures', 'v0.13', 'pilot.config.json'), 'utf8'));
    c.port = 4865;
    for (const r of Object.values(c.roles)) for (const k of r.candidates) k.baseUrl = k.baseUrl.replace(':5800/', ':5866/').replace(':5801/', ':5867/');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-v13b-')), 'config.json');
    fs.writeFileSync(file, JSON.stringify(c));
    return { url: 'http://127.0.0.1:4865/', fakes: [5866, 5867], dir: '.pilot-verify-v13b', config: file, cdp: 9443, home: true };
  },
};

(async () => {
  const which = process.argv[2] || 'all';
  const list = which === 'all' ? ['p1', 'p2'] : [which];
  if (!list.every((n) => SCENARIOS[n])) { console.error(`unknown scenario "${which}". Use: ${Object.keys(SCENARIOS).join(', ')}, all`); process.exit(2); }
  let page;
  try {
    for (const name of list) {
      console.log(`== ${name}`);
      ENV = ENVS[name] ? ENVS[name]() : { url: 'http://127.0.0.1:4747/', fakes: [5701, 5702], dir: '.pilot', config: 'pilot.config.dev.json', cdp: 9333 };
      URL = ENV.url;
      fs.rmSync(path.join(APP, ENV.dir), { recursive: true, force: true });
      start('f1', ['dev/fake-model.js', String(ENV.fakes[0]), 'frontier']);
      start('f2', ['dev/fake-model.js', String(ENV.fakes[1]), 'morrow']);
      await sleep(300);
      await startServer();
      page = await openBrowser();
      await SCENARIOS[name](page);
      check('no uncaught page errors', page.errors.length === 0, page.errors.join(' | '));
      const external = page.net.filter((n) => !n.url.startsWith(URL) && !n.url.startsWith('data:') && n.url !== 'about:blank');
      check('page made no request outside its own server', external.length === 0, external.map((n) => n.url).join(', '));
      page.close(); page = null;
      for (const k of Object.keys(procs)) await stop(k);
    }
  } catch (err) { console.error('ERROR', err); fails++; }
  finally {
    if (page) page.close();
    for (const k of Object.keys(procs)) await stop(k);
    if (ENV.dir !== '.pilot') fs.rmSync(path.join(APP, ENV.dir), { recursive: true, force: true });
    if (ENV.home) fs.rmSync(path.join(APP, `${ENV.dir}-default`), { recursive: true, force: true });
  }
  console.log(fails ? `\n${fails} BROWSER CHECK(S) FAILED` : '\nALL BROWSER CHECKS PASSED');
  process.exitCode = fails ? 1 : 0;
})();
