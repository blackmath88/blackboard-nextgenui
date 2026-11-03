'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const safety = require('./lib/safe-dir');
const root = process.argv[2]; safety.validateRoot(root);
const app = path.resolve(__dirname, '..'), cli = path.join(app, 'bin/pilot.js'), project = path.join(root, 'project');
const store = path.join(root, 'private', 'secrets.json'), key = 'sk-i1-SENTINEL-012345678901234567890123456789';
const env = { ...process.env, PILOT_SECRETS_FILE: store, KNOWLEDGE_KEY: '', MISTRAL_API_KEY: '' };
const url = 'http://127.0.0.1:4862'; let output = '', logs = ''; const children = new Set();
function run(args, cwd = root, input) { const r = spawnSync(process.execPath, [cli, ...args], { cwd, env, input, encoding: 'utf8' }); output += r.stdout + r.stderr; return r; }
function start(args) { const p = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore','pipe','pipe'] }); children.add(p); p.stdout.on('data', x=>logs+=x); p.stderr.on('data', x=>logs+=x); return p; }
async function stop(p) { if (p.exitCode === null && p.signalCode === null) { const exited = new Promise(r=>p.once('exit',r)); p.kill('SIGTERM'); await exited; } children.delete(p); }
const sleep = n=>new Promise(r=>setTimeout(r,n));
async function ready(base) { for(let i=0;i<80;i++) { try { await fetch(base); return; } catch { await sleep(50); } } throw new Error('server did not start'); }
async function req(route, body) { const r = await fetch(url+route, { method: body ? 'POST':'GET', headers:{'content-type':'application/json','x-pilot':'1'}, ...(body ? {body:JSON.stringify(body)}:{}) }); const text = await r.text(); output+=text; let json;try{json=JSON.parse(text);}catch{} return {status:r.status,text,json}; }
async function idle() { for(let i=0;i<100;i++){const s=(await req('/state')).json;if(!s.extracting&&!s.framing)return;await sleep(30);}throw new Error('model work did not finish');}
const pass = text=>console.log('PASS '+text);
async function main() {
 try {
  assert.equal(run(['init',project]).status,0);
  const candidate={name:'knowledge-fixture',model:'fake',local:true,baseUrl:'http://127.0.0.1:5862/v1'};
  fs.writeFileSync(path.join(project,'pilot.config.json'),JSON.stringify({port:4862,roles:{chat:{candidates:[candidate]},extract:{candidates:[candidate]}}}));
  start([path.join(app,'dev/fake-model.js'),'5862','knowledge','--extract-delay=1500']); await ready('http://127.0.0.1:5862');
  let server=start([cli,'start',project,'--port','4862']); await ready(url);
  for(const view of ['summary','index','kanban']) assert.equal((await req('/#knowledge-'+view)).status,200);
  assert.equal((await req('/state')).json.context.share.board,false);
  await req('/chat',{text:'Decision: keep records local. Task: verify recovery. Task: inspect evidence.'}); await idle();
  let state=(await req('/state')).json;
  assert.equal(state.items.length,3); assert(state.items.every(i=>i.status==='proposed' && i.quote && i.fromMessage && i.author==='model'));
  const [decision, task, pending]=state.items; const oldRev=state.stateRev;
  assert.equal((await req('/move',{itemId:task.id,column:'doing',rev:oldRev})).status,409);
  assert.equal((await req('/answer',{itemId:decision.id,decision:'confirm',rev:oldRev})).status,200);
  const stale=await req('/answer',{itemId:task.id,decision:'confirm',rev:oldRev}); assert.equal(stale.status,409); assert.equal(stale.json.stale,true);
  state=(await req('/state')).json;
  assert.equal((await req('/answer',{itemId:task.id,decision:'confirm',rev:state.stateRev})).status,200);
  state=(await req('/state')).json;
  assert.equal((await req('/move',{itemId:task.id,column:'doing',rev:state.stateRev})).status,200);
  const before=(await req('/state')).json;
  pass('fake extraction provenance, explicit acceptance, stale refusal and accepted task movement');
  await stop(server); server=start([cli,'start',project,'--port','4862']); await ready(url);
  state=(await req('/state')).json;
  assert.deepEqual(state.items,before.items); assert.equal(state.stateRev,before.stateRev);
  assert.equal(state.items.find(i=>i.id===pending.id).status,'proposed');
  assert.equal((await req('/answer',{itemId:task.id,decision:'confirm',rev:oldRev})).status,409);
  assert.equal((await req('/state')).json.stateRev,before.stateRev);
  pass('restart while review is pending restores accepted/proposed records; retry cannot duplicate acceptance');
  await req('/command',{text:'/context share board on'});
  state=(await req('/state')).json;
  assert(state.context.nextMessage.content.includes(decision.id)); assert(state.context.nextMessage.content.includes(task.id)); assert(!state.context.nextMessage.content.includes(pending.id));
  pass('opt-in accepted context excludes pending knowledge after restart');
  // Interrupt extraction before its durable proposal write; a restart must not promote or duplicate work.
  await req('/chat',{text:'Task: interrupted extraction should not commit.'});
  assert.equal((await req('/state')).json.extracting,true);
  await stop(server); server=start([cli,'start',project,'--port','4862']); await ready(url);
  state=(await req('/state')).json;
  assert.equal(state.extracting,false); assert.deepEqual(state.items,before.items);
  pass('interrupted in-flight extraction leaves persisted knowledge unchanged and activity clears on restart');
  console.log('ALL KNOWLEDGE SLICE CHECKS PASSED');
 } finally { await Promise.all([...children].map(stop)); }
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>Promise.all([...children].map(stop)).then(()=>process.exit(1)));
main().catch(e=>{console.error('FAIL knowledge:',e.stack);process.exitCode=1;});
