#!/usr/bin/env node
// DEV ONLY. Writes demo/fixtures/v0.9/ from the v0.8 fixture: the same workbench (map, index, kanban as a tab), with
// rules.json's fadeAfterTurns / askRemoveAfterTurns raised from 8 to 20, so the v0.8 fade and removal question do not
// interrupt the settled-input demo (the map would fade at turn 50, the kanban question at turn 50; the demo starts at
// turn 37). pilot.config.json gets the demo ports (server 4776, fakes 5778/5779) and experiments.settledInput: true
// (DEMO ONLY: the default everywhere else is off, D9). Data lines are copied verbatim (still "fixture": true).
// demo.json is written by hand. Usage: node dev/make-fixture-v09.js   (deterministic)
'use strict';
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'demo', 'fixtures');
const SRC = path.join(FIX, 'v0.8'), OUT = path.join(FIX, 'v0.9');
fs.mkdirSync(OUT, { recursive: true });
for (const f of ['transcript.jsonl', 'metrics.jsonl', 'state.json', 'modules.json']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));

const rules = JSON.parse(fs.readFileSync(path.join(SRC, 'rules.json'), 'utf8'));
rules.fadeAfterTurns = 20;
rules.askRemoveAfterTurns = 20;
rules._notes = rules._notes.filter((n) => !n.startsWith('Demo fixture'));
rules._notes.push('Demo fixture v0.9 (from v0.8, see dev/make-fixture-v09.js): fading thresholds raised to 20 so nothing fades or asks during the settled-input demo.');
fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(rules, null, 2) + '\n');

const config = JSON.parse(fs.readFileSync(path.join(SRC, 'pilot.config.json'), 'utf8'));
config.port = 4776;
for (const r of Object.values(config.roles)) for (const c of r.candidates) c.baseUrl = c.baseUrl.replace(':5772/', ':5778/').replace(':5773/', ':5779/');
config.experiments = { settledInput: true, settleMs: 1800 };
config._notes = ['DEMO ONLY (npm run demo -- v0.9). Derived from pilot.config.dev.json with own ports (server 4776, fakes 5778/5779). experiments.settledInput is on for this demo only; the default is off (D9). Untested with a real model.'];
fs.writeFileSync(path.join(OUT, 'pilot.config.json'), JSON.stringify(config, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), OUT)}/`);
