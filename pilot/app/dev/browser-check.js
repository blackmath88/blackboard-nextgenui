#!/usr/bin/env node
// DEV ONLY. Drives the real page in headless Chrome over the DevTools protocol and prints PASS/FAIL.
// Starts its own fake models and server (PILOT_CONFIG=pilot.config.dev.json) and WIPES .pilot/ first.
// Needs Node 22+ (global WebSocket) and Google Chrome. No dependencies.
// Usage: node dev/browser-check.js [p1|p2|all]     (CHROME=/path/to/chrome to override)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.join(__dirname, '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://127.0.0.1:4747/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (!ok) fails++; };

// ---- processes ----
const procs = {};
function start(key, args, env = {}) {
  procs[key] = spawn(process.execPath, args, { cwd: APP, env: { ...process.env, ...env }, stdio: 'ignore' });
}
async function stop(key) { const p = procs[key]; if (!p) return; p.kill(); await new Promise((r) => p.exitCode !== null ? r() : p.once('exit', r)); delete procs[key]; }
async function startServer() { start('server', ['server.js'], { PILOT_CONFIG: 'pilot.config.dev.json' }); await waitHttp(URL); }
async function waitHttp(url) { for (let i = 0; i < 50; i++) { try { await fetch(url); return; } catch { await sleep(100); } } throw new Error(`${url} did not come up`); }

// ---- minimal CDP client ----
async function openBrowser() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-cdp-'));
  const port = 9333;
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
  const page = {
    net, errors,
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
  check('status bar shows chat: morrow after /model', /chat: morrow( ·|$)/.test(s), s);
  await page.submit('this is private now');
  check('next assistant line records morrow', await page.eval(`(() => { const l = [...document.querySelectorAll('.ln.assistant')].pop(); return l.textContent.includes('[fake:morrow]') && l.querySelector('.model').textContent === 'morrow'; })()`));

  await page.submit('/model chat frontier', 600);
  await stop('f1');
  await page.submit('frontier is down now');
  s = await page.status();
  check('status bar shows frontier→morrow after a fallback', /chat: frontier→morrow/.test(s), s);

  await stop('server'); await startServer(); await page.goto(URL);
  s = await page.status();
  check('status bar after restart shows the persisted choice', /chat: frontier( ·|$)/.test(s) && /extract: morrow/.test(s), s);
  start('f1', ['dev/fake-model.js', '5701', 'frontier']); await sleep(300);
}

const SCENARIOS = { p1 };

(async () => {
  const which = process.argv[2] || 'all';
  const list = which === 'all' ? Object.keys(SCENARIOS) : [which];
  let page;
  try {
    for (const name of list) {
      console.log(`== ${name}`);
      fs.rmSync(path.join(APP, '.pilot'), { recursive: true, force: true });
      start('f1', ['dev/fake-model.js', '5701', 'frontier']);
      start('f2', ['dev/fake-model.js', '5702', 'morrow']);
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
  }
  console.log(fails ? `\n${fails} BROWSER CHECK(S) FAILED` : '\nALL BROWSER CHECKS PASSED');
  process.exitCode = fails ? 1 : 0;
})();
