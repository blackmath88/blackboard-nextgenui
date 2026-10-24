'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { spawn, spawnSync } = require('child_process');
const safety = require('./lib/safe-dir');
const root = process.argv[2]; safety.validateRoot(root);
const app = path.resolve(__dirname, '..'), cli = path.join(app, 'bin/pilot.js'), project = path.join(root, 'project');
const store = path.join(root, 'private', 'secrets.json'), key = 'sk-i1-SENTINEL-012345678901234567890123456789';
const env = { ...process.env, PILOT_SECRETS_FILE: store, I1_KEY: '', MISTRAL_API_KEY: '' };
const url = 'http://127.0.0.1:4850'; let output = '', logs = ''; const children = new Set();
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
  assert.equal(run(['--help']).status,0); assert.equal(run(['--version']).stdout.trim(),'0.12.0'); assert.equal(run(['unknown']).status,2); assert.equal(run(['start',path.join(root,'uninitialized')]).status,1); pass('CLI help/version/unknown and uninitialized refusal from unrelated cwd');
  assert.equal(run(['init',project]).status,0);
  const configFile=path.join(project,'pilot.config.json'), original=fs.readFileSync(configFile,'utf8'); assert.equal(JSON.parse(original).roles.chat.candidates[0].name,'mistral');
  fs.writeFileSync(path.join(project,'.pilot','sentinel'),'keep me');
  assert.equal(run(['init',project]).status,0); assert.equal(fs.readFileSync(configFile,'utf8'),original); assert.equal(fs.readFileSync(path.join(project,'.pilot','sentinel'),'utf8'),'keep me'); pass('init twice never overwrites config or project data');
  const candidate={name:'mistral-test',model:'fake',local:false,keyEnv:'I1_KEY',baseUrl:'http://127.0.0.1:5851/v1'};
  fs.writeFileSync(configFile,JSON.stringify({port:4850,roles:{chat:{candidates:[candidate]},extract:{candidates:[candidate]}}}));
  assert.equal(run(['key','set','I1_KEY'],project,key+'\n').status,0); assert.match(run(['key','status'],project).stdout,/I1_KEY: saved/);
  fs.writeFileSync(path.join(project,'notes.txt'),'A project note'); fs.mkdirSync(path.join(project,'node_modules')); fs.writeFileSync(path.join(project,'node_modules','hidden.txt'),'hidden');
  fs.symlinkSync(path.dirname(store),path.join(project,'escape'));
  const board={rev:1,items:[{id:'dec-i1',kind:'decision',text:'Keep the board',status:'confirmed',author:'user'}]}; fs.writeFileSync(path.join(project,'.pilot','state.json'),JSON.stringify(board));
  const legacy=JSON.stringify({id:'legacy',role:'user',text:'legacy conversation',model:null,ts:new Date().toISOString()}); fs.writeFileSync(path.join(project,'.pilot','transcript.jsonl'),legacy+'\n');
  start([path.join(app,'dev/fake-model.js'),'5851','mistral']); await ready('http://127.0.0.1:5851');
  assert.equal(run(['doctor',project]).status,0); pass('key set/status and doctor with fake models endpoint');
  let server=start([cli,'start',project,'--port','4850']);await ready(url);
  assert.equal((await req('/')).status,200); assert.equal((await req('/state?chat=c-1')).json.transcript[0].id,'legacy');
  const first=(await req('/chats',{action:'new',title:'First'})).json.chat;
  await req('/chat',{chat:first,text:'Decision: keep the first history.'}); await idle();
  const second=(await req('/chats',{action:'new',title:'Second'})).json.chat;
  await req('/chat',{chat:second,text:'hello from second history'});await idle();
  let state=(await req('/state?chat='+first)).json;assert(state.transcript.some(l=>l.role==='user'&&l.text==='Decision: keep the first history.'));assert(!state.transcript.some(l=>l.text==='hello from second history'));assert(!state.transcript.some(l=>l.id==='legacy'));
  assert.equal(fs.readFileSync(path.join(project,'.pilot','transcript.jsonl'),'utf8').split('\n')[0],legacy); pass('two chats have separate histories and legacy c-1 rows are unchanged');
  await stop(server);server=start([cli,'start',project,'--port','4850']);await ready(url);
  state=(await req('/state?chat='+second)).json;assert(state.chats.some(c=>c.id===first));assert(state.chats.some(c=>c.id===second));assert(state.items.some(i=>i.id==='dec-i1'));assert(state.transcript.some(l=>l.text==='hello from second history'));pass('restart preserves both conversations, messages and shared board');
  const files=(await req('/files')).json.files;assert(files.includes('notes.txt'));assert(!files.some(n=>n.includes('.pilot')||n.includes('escape')||n.includes('node_modules')));assert.equal((await req('/files/read?path=notes.txt')).json.text,'A project note');
  for(const name of ['../private/secrets.json','escape/secrets.json','.pilot/state.json',store,'node_modules/hidden.txt'])assert.equal((await req('/files/read?path='+encodeURIComponent(name))).status,400);
  fs.writeFileSync(path.join(project,'big.txt'),'x'.repeat(205000)); assert.equal((await req('/files/read?path=big.txt')).status,400);pass('Files is bounded/read-only and rejects traversal, dot data, dependencies, symlink escape and large content');
  await stop(server);let persisted='';for(const name of fs.readdirSync(path.join(project,'.pilot')))persisted+=fs.readFileSync(path.join(project,'.pilot',name),'utf8');assert(![output,logs,persisted].some(s=>s.includes(key)));pass('key sentinel absent from every response, CLI/server log and project state');
  assert.equal(run(['key','rm','I1_KEY'],project).status,0);assert.match(run(['key','status'],project).stdout,/missing/);
  // Selected XDG store lives in the project, reached through an external symlinked ancestor.
  const configDir=path.join(project,'config'), configLink=path.join(root,'config-link');
  fs.mkdirSync(configDir); fs.symlinkSync(configDir,configLink);
  delete env.PILOT_SECRETS_FILE; env.XDG_CONFIG_HOME=configLink;
  assert.equal(run(['key','set','I1_KEY'],project,key+'\n').status,0);
  assert.match(run(['key','status'],project).stdout,/I1_KEY: saved/);
  const selected=path.join(configDir,'pilot','secrets.json'), alias=path.join(project,'secret-alias.txt');
  assert.equal(fs.statSync(selected).mode & 0o777,0o600); assert.equal(fs.statSync(path.dirname(selected)).mode & 0o777,0o700);
  fs.linkSync(selected,alias);
  server=start([cli,'start',project,'--port','4850']);await ready(url);
  const listed=(await req('/files')).json.files;
  assert(listed.includes('notes.txt')); assert(!listed.includes('config/pilot/secrets.json')); assert(!listed.includes('secret-alias.txt'));
  for(const name of ['config/pilot/secrets.json','secret-alias.txt']) assert.equal((await req('/files/read?path='+encodeURIComponent(name))).status,400);
  assert.equal((await req('/settings/keys')).json.keys[0].source,'saved');
  pass('Files excludes symlink-ancestor XDG store and hard-link alias by physical identity');
  fs.renameSync(selected,selected+'.saved'); fs.symlinkSync('missing.json',selected);
  assert.equal((await req('/files')).status,400); assert.equal((await req('/files/read?path=notes.txt')).status,400);
  fs.unlinkSync(selected); fs.renameSync(selected+'.saved',selected);
  await stop(server);
  assert(![output,logs].some(s=>s.includes(key)));
  assert(logs.includes(`config: ${configFile}, data: ${path.join(project,'.pilot')}/`));
  pass('unresolvable existing store fails closed; no sentinel in responses/logs; CLI startup paths are absolute');
  console.log('ALL I1 HTTP/CLI CHECKS PASSED');
 } finally { await Promise.all([...children].map(stop)); }
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>Promise.all([...children].map(stop)).then(()=>process.exit(1)));
main().catch(e=>{console.error('FAIL I1:',e.message.replaceAll(key,'[redacted]'));process.exitCode=1;});
