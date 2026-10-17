#!/usr/bin/env node
// DEV ONLY. Drives the real page in headless Chrome over the DevTools protocol and prints PASS/FAIL.
// p1/p2: start their own fake models and server (PILOT_CONFIG=pilot.config.dev.json, ports 4747/5701/5702)
// and WIPE .pilot/ first. v03: own ports (4765/5766/5767, Chrome 9343) and its own dir .pilot-verify-v03b/,
// so it never touches .pilot/ or a running demo.
// Needs Node 22+ (global WebSocket) and Google Chrome. No dependencies.
// Usage: node dev/browser-check.js [p1|p2|v03|all]     (CHROME=/path/to/chrome to override; all = p1 p2)
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
      const enter = k === 'Enter';
      const vk = enter ? 13 : k.toUpperCase().charCodeAt(0);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: enter ? 'Enter' : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: vk, text: enter ? '\r' : k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: vk });
    },
    async type(text) { await page.eval(`document.getElementById('input').focus()`); await send('Input.insertText', { text }); },
    async submit(text, wait = 1800) { await page.type(text); await page.key('Enter'); await sleep(wait); },
    status() { return page.eval(`document.getElementById('models').textContent`); },
    close() { ws.close(); chrome.kill(); setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 300); },
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

const SCENARIOS = { p1, p2, v03 };
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
