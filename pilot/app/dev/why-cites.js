#!/usr/bin/env node
// DEV ONLY (pilot-v0.7). Resolves every source cited by /why back to the file it names and checks it says what the
// citation claims. Usage: node dev/why-cites.js <server url> <pilot dir> [target ...]
// Without targets: /why, every pane (chat, index, map, kanban) and every item id in <dir>/state.json.
// Rules: `file.jsonl:N label` -> physical line N parses as JSON and matches the label (an event name and/or an id);
// `file.json:N label` -> line N of the file contains the entry's key ("id": "<id>", "module": "<m>", "<m>":, "items":);
// a citation without :N must say why (absent, no …, ×count, the whole file). Every non-heading statement must cite.
// Prints one FAIL line per bad citation and a summary line "CITES OK n" or "CITES BAD n"; exit 1 when bad.
'use strict';
const fs = require('fs');
const path = require('path');
const [url, dirArg, ...given] = process.argv.slice(2);
if (!url || !dirArg) { console.error('usage: node dev/why-cites.js <server url> <pilot dir> [target ...]'); process.exit(2); }
const dir = path.resolve(dirArg);
const lines = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').split('\n'); } catch { return []; } };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function checkCite(c) {
  const m = /^(\S+?\.jsonl?)(?::(\d+))?(?: (.*))?$/.exec(c);
  if (!m) return 'not of the form file[:line] label';
  const [, file, n, label = ''] = m;
  if (!fs.existsSync(path.join(dir, file)) && !/absent/.test(label)) return `${file} does not exist`;
  if (!n) return /absent|^\(|\(no |×|^panes$|^removals\.|^answers$|^items$|^rules$|^panes |^answers\.|^items |^rules |^$|not valid JSON/.test(label) ? null : `no line number and no reason: "${label}"`;
  const text = lines(file)[Number(n) - 1];
  if (text === undefined) return `${file} has no line ${n}`;
  const words = label.split(' ');
  if (file.endsWith('.jsonl')) {
    let o; try { o = JSON.parse(text); } catch { return `${file}:${n} is not JSON`; }
    if (file === 'transcript.jsonl') return o.id === words[0] ? null : `${file}:${n} is ${o.id}, not ${words[0]}`;
    if (o.event !== words[0]) return `${file}:${n} is event ${o.event}, not ${words[0]}`;
    const id = words[1];
    if (id && ![o.id, o.itemId, o.module].includes(id)) return `${file}:${n} has id ${o.id || o.itemId || o.module}, not ${id}`;   // pilot-v0.8: pane events name a module
    return null;
  }
  let re;
  if (/^items (\S+)/.test(label)) re = new RegExp(`"id"\\s*:\\s*"${esc(words[1])}"`);
  else if (/^items$/.test(label)) re = /"items"\s*:/;
  else if (/^(panes|rules) (\S+)/.test(label)) re = new RegExp(`"module"\\s*:\\s*"${esc(words[1].replace(/\.rule$/, ''))}"`);
  else if (/^answers\.(\S+)/.test(label)) re = new RegExp(`^\\s*"${esc(label.split(' ')[0].slice(8))}"\\s*:`);
  else if (/^pending/.test(label)) re = /"pending"\s*:/;
  else if (/^removals\.(\S+)/.test(label)) re = new RegExp(`^\\s*"${esc(label.split(' ')[0].slice(9))}"\\s*:`);   // pilot-v0.8
  else if (/^(fadeAfterTurns|askRemoveAfterTurns)\b/.test(label)) re = new RegExp(`"${words[0]}"\\s*:`);
  else return `unknown JSON label "${label}"`;
  return re.test(text) ? null : `${file}:${n} does not hold ${label} (it says ${text.trim()})`;
}

(async () => {
  let targets = given;
  if (!targets.length) {
    let items = [];
    try { items = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).items.map((i) => i.id); } catch { /* none */ }
    targets = ['', 'chat', 'index', 'map', 'kanban', ...items];
  }
  let ok = 0, bad = 0;
  for (const t of targets) {
    const r = await (await fetch(`${url}/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `/why ${t}`.trim() }) })).json();
    if (!Array.isArray(r.why)) { console.log(`FAIL /why ${t}: no statements`); bad++; continue; }
    if (r.lines.join('\n') !== r.why.map((s) => (s.head ? s.text : `  ${s.text}  [${s.cite.join('; ')}]`)).join('\n')) { console.log(`FAIL /why ${t}: lines and statements differ`); bad++; }
    for (const s of r.why) {
      if (s.head) continue;
      if (!s.cite || !s.cite.length) { console.log(`FAIL /why ${t}: "${s.text}" cites nothing`); bad++; continue; }
      for (const c of s.cite) { const e = checkCite(c); if (e) { console.log(`FAIL /why ${t}: [${c}] ${e}`); bad++; } else ok++; }
      if (s.msg && !lines('transcript.jsonl').some((l) => { try { return JSON.parse(l).id === s.msg; } catch { return false; } })) { console.log(`FAIL /why ${t}: link to ${s.msg}, which is not in transcript.jsonl`); bad++; }
    }
  }
  console.log(bad ? `CITES BAD ${bad} (ok ${ok})` : `CITES OK ${ok} in ${targets.length} explanations`);
  process.exitCode = bad ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
