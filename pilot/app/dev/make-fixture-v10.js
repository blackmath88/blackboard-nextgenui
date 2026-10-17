#!/usr/bin/env node
// DEV ONLY. Writes demo/fixtures/v0.10/ from the v0.9 fixture: the same workbench (the map with its decisions, the index,
// the kanban as a tab; fading thresholds 20, so nothing fades or asks during the demo). pilot.config.json gets the demo
// ports (server 4778, fakes 5783/5784), a `frame` role on the morrow fake, experiments.frameProposals: true and
// settledInput: false (DEMO ONLY: the default everywhere else is off; settled input off, so Tab moves focus into the map
// as the try lines say). Data lines are copied verbatim (still "fixture": true). demo.json is written by hand.
// Usage: node dev/make-fixture-v10.js   (deterministic)
'use strict';
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'demo', 'fixtures');
const SRC = path.join(FIX, 'v0.9'), OUT = path.join(FIX, 'v0.10');
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['transcript.jsonl', 'metrics.jsonl', 'state.json', 'modules.json']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));

const rules = JSON.parse(fs.readFileSync(path.join(SRC, 'rules.json'), 'utf8'));
rules._notes = rules._notes.filter((n) => !n.startsWith('Demo fixture'));
rules._notes.push('Demo fixture v0.10 (from v0.9, see dev/make-fixture-v10.js): fading thresholds 20 so nothing fades or asks during the frame demo.');
fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');

const config = JSON.parse(fs.readFileSync(path.join(SRC, 'pilot.config.json'), 'utf8'));
config.port = 4778;
for (const r of Object.values(config.roles)) for (const c of r.candidates) c.baseUrl = c.baseUrl.replace(':5778/', ':5783/').replace(':5779/', ':5784/');
const roles = {};
for (const [k, v] of Object.entries(config.roles)) {
  roles[k] = v;
  if (k === 'extract') roles.frame = { policy: 'manual', candidates: [{ ...v.candidates[0] }] };
}
config.roles = roles;
config.experiments = { settledInput: false, settleMs: 1800, frameProposals: true };
config._notes = ['DEMO ONLY (npm run demo -- v0.10). Derived from the v0.9 demo config with own ports (server 4778, fakes 5783/5784). experiments.frameProposals is on for this demo only; the default is off. The frame role points at the morrow fake (--frame=good). Untested with a real model.'];
fs.writeFileSync(path.join(OUT, 'pilot.config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}/`);
