#!/usr/bin/env node
// npm run stats -- <pilotDir>   (pilot-v0.6). Prints the same lines as /stats in the page: the five P5 measures from
// metrics.jsonl and the files in <pilotDir>, PASS / NOT YET. Read-only: creates and writes nothing, starts no server,
// calls no model. <pilotDir> is resolved against the directory you ran npm from (INIT_CWD; npm itself runs scripts
// in pilot/app), default pilot/app/.pilot.
'use strict';
const fs = require('fs');
const path = require('path');
const stats = require('../stats.js');

const APP = path.join(__dirname, '..');
const arg = process.argv[2];
const dir = arg ? path.resolve(process.env.INIT_CWD || process.cwd(), arg) : path.join(APP, '.pilot');
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  console.error(`no pilot dir at ${dir}\nusage: npm run stats -- <pilotDir>   (e.g. npm run stats -- .pilot-demo)`);
  process.exit(2);
}
const rel = path.relative(APP, dir);
const label = !rel.startsWith('..') && !path.isAbsolute(rel) ? `${rel}/` : `${dir}/`;   // same label as /stats inside pilot/app
for (const l of stats.formatStats(stats.computeStats(dir), label)) console.log(l);
