#!/usr/bin/env node
// DEV ONLY. Drives the real page in headless Chrome over the DevTools protocol and prints PASS/FAIL.
// p1/p2: start their own fake models and server (PILOT_CONFIG=pilot.config.dev.json, ports 4747/5701/5702)
// and WIPE .pilot/ first. v03: own ports (4765/5766/5767, Chrome 9343) and its own dir .pilot-verify-v03b/,
// so it never touches .pilot/ or a running demo. v04 (pilot-v0.4 proposals): ports 4775/5776/5777, Chrome 9353,
// dir .pilot-verify-v04b/. v05 (pilot-v0.5 live files, c/r only on a focused card): ports 4785/5786/5787,
// Chrome 9363, dir .pilot-verify-v05b/; opens a second tab.
// Needs Node 22+ (global WebSocket) and Google Chrome. No dependencies.
// Usage: node dev/browser-check.js [p1|p2|v03|v04|v05|all]     (CHROME=/path/to/chrome to override; all = p1 p2)
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
async function startServer() { start('server', ['server.js'], { PILOT_CONFIG: ENV.config, PILOT_DIR: ENV.dir }); await waitHttp(URL); }
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
    async key(k) {
      const ARROWS = { ArrowUp: 38, ArrowDown: 40, Tab: 9, Escape: 27 };
      if (ARROWS[k]) {
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: ARROWS[k] });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: ARROWS[k] });
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
  check('kanban question counts proposed + confirmed tasks (3)', await page.eval(`/^3 tasks/.test(document.querySelector('.ln.controller.pending').textContent)`));
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

const SCENARIOS = { p1, p2, v03, v04, v05 };
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
  }
  console.log(fails ? `\n${fails} BROWSER CHECK(S) FAILED` : '\nALL BROWSER CHECKS PASSED');
  process.exitCode = fails ? 1 : 0;
})();
