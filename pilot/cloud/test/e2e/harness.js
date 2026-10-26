// Starts `wrangler dev` (local workerd, persisted Durable Object state) and a fake Claude/Mistral endpoint.
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const KEYS = { ANTHROPIC_API_KEY: 'sk-ant-E2E-FAKE-KEY-aaaaaaaaaaaaaaaaaaaaaaaa', MISTRAL_API_KEY: 'mistral-E2E-FAKE-KEY-mmmmmmmmmmmmmmmmmmmmm' };

export const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake provider. Reply depends on the last user message: "echo key" streams back the received key in pieces,
// "fail" returns 500, anything else streams "reply from <provider> #<n>" in several delayed chunks.
export async function fakeProvider() {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    const provider = req.url === '/v1/messages' ? 'claude' : req.url === '/v1/chat/completions' ? 'mistral' : null;
    const key = provider === 'claude' ? req.headers['x-api-key'] : String(req.headers.authorization || '').replace(/^Bearer /, '');
    calls.push({ provider, url: req.url, headers: req.headers, body, key });
    if (!provider) { res.writeHead(404).end(); return; }
    const last = [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
    if (last.includes('fail')) { res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { type: 'api_error', message: 'boom ' + key } })); return; }
    const text = last.includes('echo key') ? `your key is ${key} ok` : `reply from ${provider} #${calls.length}`;
    const pieces = text.match(/.{1,6}/g);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const p of pieces) {
      res.write(provider === 'claude'
        ? `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: p } })}\n\n`
        : `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
      await sleep(last.includes('slow') ? 150 : 40);
    }
    res.end(provider === 'claude' ? 'data: {"type":"message_stop"}\n\n' : 'data: [DONE]\n\n');
  });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return { port, calls, close: () => new Promise((r) => server.close(r)) };
}

export async function startWorker({ persist, vars }) {
  const port = await freePort(), inspector = await freePort();
  const args = ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector),
    '--persist-to', persist, '--show-interactive-dev-session=false', '--log-level', 'info'];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const child = spawn('npx', args, { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error('wrangler exited:\n' + out);
    try { await fetch(base + '/'); return { base, child, logs: () => out, stop: () => stop(child) }; } catch { await sleep(200); }
  }
  stop(child); throw new Error('wrangler did not start:\n' + out);
}

function stop(child) {
  return new Promise((r) => {
    if (child.exitCode !== null) return r();
    child.once('exit', () => r());
    try { process.kill(-child.pid, 'SIGTERM'); } catch { r(); }
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000);
  });
}
