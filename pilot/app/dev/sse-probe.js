#!/usr/bin/env node
// DEV ONLY. A small SSE client for dev/verify-v0.5.sh (an EventSource-like reader over fetch, no dependencies).
//   node dev/sse-probe.js listen <port> <ms> <out.jsonl>
//       writes every event as one JSON line {event, data, t} to out.jsonl (the hello first), exits after <ms>.
//   node dev/sse-probe.js latency <port> <state.json> <runs>
//       waits for hello, then <runs> times: flips the status of the first item in <state.json> by hand (plain
//       writeFileSync, like an editor), measures the time until the `change` event for state.json arrives and until
//       GET /state shows the new status. Prints {eventMs: [...], stateMs: [...], ok}.
// Every mode has a hard timeout, so it never hangs a verify run.
'use strict';
const fs = require('fs');

const [mode, port, a, b] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const hardStop = setTimeout(() => { console.error('sse-probe: timeout'); process.exit(3); }, mode === 'listen' ? Number(a) + 5000 : 30000);
hardStop.unref();

// Parses an SSE stream; calls onEvent({event, data}) per event. Resolves the AbortController.
function connect(onEvent) {
  const ac = new AbortController();
  (async () => {
    const res = await fetch(`${base}/events`, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let event = 'message', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) onEvent({ event, data: JSON.parse(data) });
      }
    }
  })().catch((err) => { if (!ac.signal.aborted) { console.error('sse-probe:', err.message); process.exit(4); } });
  return ac;
}

if (mode === 'listen') {
  const out = fs.openSync(b, 'w');
  const t0 = Date.now();
  const ac = connect((e) => fs.writeSync(out, JSON.stringify({ ...e, t: Date.now() - t0 }) + '\n'));
  setTimeout(() => { ac.abort(); fs.closeSync(out); process.exit(0); }, Number(a));
} else if (mode === 'latency') {
  const file = a, runs = Number(b) || 5;
  let waiter = null, hello;
  const helloSeen = new Promise((r) => { hello = r; });
  const ac = connect((e) => {
    if (e.event === 'hello') hello();
    if (e.event === 'change' && e.data.file === 'state.json' && waiter) { const w = waiter; waiter = null; w(); }
  });
  (async () => {
    await helloSeen;
    const eventMs = [], stateMs = [];
    let ok = true;
    for (let i = 0; i < runs; i++) {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      const it = doc.items[0];
      it.status = it.status === 'proposed' ? 'confirmed' : 'proposed';
      const got = new Promise((r) => { waiter = r; });
      const t0 = process.hrtime.bigint();
      fs.writeFileSync(file, JSON.stringify(doc, null, 2));
      await got;
      eventMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      const st = await (await fetch(`${base}/state?only=state.json`)).json();
      stateMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      if ((st.items.find((x) => x.id === it.id) || {}).status !== it.status) ok = false;
      await new Promise((r) => setTimeout(r, 300));   // let the debounce settle between runs
    }
    ac.abort();
    const r = (x) => Math.round(x);
    console.log(JSON.stringify({ eventMs: eventMs.map(r), stateMs: stateMs.map(r), ok }));
    process.exit(0);
  })();
} else {
  console.error('usage: sse-probe.js listen <port> <ms> <out> | latency <port> <state.json> <runs>');
  process.exit(2);
}
