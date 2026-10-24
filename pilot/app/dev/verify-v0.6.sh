#!/bin/bash
# DEV ONLY. pilot-v0.6 checks: authorship (item_write ledger, "you (file edit)"), the P5 metrics events, /stats and
# `npm run stats`. Against dev/fake-model.js only. Own ports (server 4790, fakes 5791/5792; browser part
# 4795/5796/5797 + Chrome 9373; demo part shifted +200: 4964/5964/5965) and own dirs (.pilot-verify-v06/,
# .pilot-verify-v06c/, .pilot-verify-v06b/, .pilot-demo-verify06/), so it never touches .pilot/ or a running demo.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.6.sh
set -u
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
APPDIR=$(pwd)
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T"; PIDS=(); SERVER=""
DIR="$T/.pilot-verify-v06"
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4790 4964 5791 5792
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
node -e '
  const c=require("./pilot.config.dev.json"); c.port=4790;
  for (const k of c.roles.chat.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5791/").replace(":5702/",":5792/");
  c.roles.extract.candidates[0].baseUrl="http://127.0.0.1:5792/v1";
  require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$T/conf.json"
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
server() { PILOT_DIR="$1" PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -s -m 1 localhost:4790/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
chat() { curl -sN -X POST localhost:4790/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
cmd() { curl -s -X POST localhost:4790/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
post() { curl -s -w '\n%{http_code}' -X POST "localhost:4790/$1" -H 'content-type: application/json' -d "$2"; }
state() { curl -s "localhost:4790/state${1:-}"; }
settle() { for i in $(seq 1 100); do [ "$(state | q 'x.extracting')" = "false" ] && return; sleep 0.1; done; }
ev() { qa "$1" < "$DIR/metrics.jsonl"; }
editjs() { node -e "const f=process.argv[1],fs=require('fs'),s=JSON.parse(fs.readFileSync(f,'utf8'));$2;fs.writeFileSync(f,JSON.stringify(s,null,2))" "$DIR/$1"; }
statlines() { cmd '/stats' | q 'x.lines.join("\n")'; }
verdicts() { grep -E '^[a-z]+ +(PASS|NOT YET) ' | sed -E 's/^([a-z]+) +(PASS|NOT YET) .*/\1 \2/' | tr '\n' ',' ; }

fake 5791 frontier; fake 5792 morrow; sleep 0.3
fixture_reset "$DIR"; mkdir -p "$DIR"
node -e 'const f=process.argv[1],r=require("./rules.example.json");r.rules.find(x=>x.module==="index").threshold=2;r.rules.find(x=>x.module==="map").threshold=1;require("fs").writeFileSync(f,JSON.stringify(r,null,2))' "$DIR/rules.json"
server "$DIR"

echo "== 1. P5 events: server_start, turn, consent id -> controller_add answerRef"
check "server_start at boot with counts (lines 0, items 0, panes 0, answers 0)" "$(ev 'x[0].event==="server_start" && x[0].lines===0 && x[0].items===0 && x[0].panes===0 && x[0].answers===0 && Number.isInteger(x[0].pid)')"
cp "$DIR/metrics.jsonl" "$T/m0.jsonl"
chat "Decision: keep the claim local. Task: scan the invoice." > /dev/null; settle
check "turn event after the reply: ok, lines and messages as in the transcript" "$(ev "x.some(e=>e.event==='turn'&&e.ok&&e.messages===2&&e.lines<=$(grep -c . "$DIR/transcript.jsonl"))")"
check "(setup) the controller asked for the index (threshold 2)" "$(state | q 'x.pending==="index"')"
post answer '{"module":"index","answer":"y"}' > /dev/null
CID=$(qa 'x.filter(e=>e.event==="consent").pop().id' < "$DIR/metrics.jsonl")
check "consent event has an id ($CID); modules.json answers.index.consentId is the same" "$( [ -n "$CID" ] && node -e 'console.log(require(process.argv[1]).answers.index.consentId===process.argv[2])' "$DIR/modules.json" "$CID")"
check "controller_add {module: index, answer: yes, answerRef: $CID} logged with the consent" "$(ev "x.some(e=>e.event==='controller_add'&&e.module==='index'&&e.answer==='yes'&&e.answerRef==='$CID')")"
check "the pane entry records its rule {metric: messages, threshold: 2}" "$(node -e 'const p=require(process.argv[1]).panes.find(p=>p.module==="index");console.log(p.rule.metric==="messages"&&p.rule.threshold===2)' "$DIR/modules.json")"
check "/state paneInfo.index: rule, answer yes, recorded" "$(state | q 'x.paneInfo.index.metric==="messages" && x.paneInfo.index.threshold===2 && x.paneInfo.index.answer==="yes" && x.paneInfo.index.recorded===true')"
chat "one more" > /dev/null; settle
check "(setup) map asked (decisions 1)" "$(state | q 'x.pending==="map"')"
post answer '{"module":"map","answer":"a"}' > /dev/null
AID=$(qa 'x.filter(e=>e.event==="consent").pop().id' < "$DIR/metrics.jsonl")
editjs modules.json 's.panes=s.panes.filter(p=>p.module!=="map")'
chat "the map pane was removed by hand" > /dev/null; settle
check "always path: the controller re-adds map, controller_add answer always with answerRef = the always answer ($AID)" "$(ev "x.filter(e=>e.event==='controller_add'&&e.module==='map'&&e.answer==='always'&&e.answerRef==='$AID').length===2")"
check "metrics.jsonl is append-only (the content before this section is an unchanged prefix)" "$(head -c $(wc -c < "$T/m0.jsonl") "$DIR/metrics.jsonl" | cmp -s - "$T/m0.jsonl" && echo true)"

echo "== 2. POST /metric: only index_jump with a message id that exists"
TGT=$(head -1 "$DIR/transcript.jsonl" | q 'x.id'); N0=$(grep -c . "$DIR/metrics.jsonl")
OUT=$(post metric "{\"event\":\"index_jump\",\"target\":\"$TGT\"}")
check "index_jump to $TGT: 200, logged with target and position 1" "$(echo "$OUT" | tail -1 | grep -qx 200 && ev "x[x.length-1].event==='index_jump'&&x[x.length-1].target==='$TGT'&&x[x.length-1].position===1")"
check "unknown target -> 400" "$(post metric '{"event":"index_jump","target":"m-nope"}' | tail -1 | grep -qx 400 && echo true)"
check "any other event -> 400" "$(post metric '{"event":"consent","module":"index","answer":"yes"}' | tail -1 | grep -qx 400 && echo true)"
check "not JSON -> 400" "$(post metric 'oops' | tail -1 | grep -qx 400 && echo true)"
check "rejected posts logged nothing (exactly one new line)" "$( [ $(grep -c . "$DIR/metrics.jsonl") -eq $((N0+1)) ] && echo true)"

echo "== 3. authorship: item_write ledger, hand edits as file edits"
check "extraction: one item_write per new item, equal to the item in state.json" "$(node -e '
  const fs=require("fs"),d=process.argv[1],st=JSON.parse(fs.readFileSync(d+"/state.json","utf8")).items;
  const w=fs.readFileSync(d+"/metrics.jsonl","utf8").trim().split("\n").map(JSON.parse).filter(e=>e.event==="item_write");
  console.log(st.length===2 && st.every(i=>{const e=w.filter(x=>x.itemId===i.id);return e.length===1&&e[0].via==="extract"&&JSON.stringify(e[0].item)===JSON.stringify(i)}))' "$DIR")"
check "/state: untouched model items carry no prov" "$(state | q 'x.items.every(i=>!i.prov)')"
post answer '{"itemId":"dec-1","decision":"c"}' > /dev/null
check "decide: item_write via decide, then decide as the last metrics line" "$(ev 'x[x.length-2].event==="item_write"&&x[x.length-2].via==="decide"&&x[x.length-2].item.status==="confirmed"&&x[x.length-1].event==="decide"')"
check "/state: dec-1 decided through the server -> no prov (decidedBy user)" "$(state | q 'x.items.find(i=>i.id==="dec-1").decidedBy==="user" && !x.items.find(i=>i.id==="dec-1").prov')"
editjs state.json 's.items.find(i=>i.id==="task-1").text="scan the invoice twice"'; sleep 0.5
check "hand edit of task-1 text -> /state prov {added: false, fields: [text]}" "$(state | q 'JSON.stringify(x.items.find(i=>i.id==="task-1").prov)===JSON.stringify({added:false,fields:["text"]})')"
check "the watcher logged file_edit {file: state.json, itemId: task-1, fields: [text]}" "$(ev 'x.some(e=>e.event==="file_edit"&&e.file==="state.json"&&e.itemId==="task-1"&&e.fields.join()==="text")')"
post answer '{"itemId":"task-1","decision":"c"}' > /dev/null
check "then confirmed through the server: the hand-edited text stays attributed (handFields [text])" "$(state | q 'JSON.stringify(x.items.find(i=>i.id==="task-1").prov)===JSON.stringify({added:false,fields:["text"]})' | grep -q true && ev 'x.filter(e=>e.event==="item_write"&&e.itemId==="task-1").pop().handFields.join()==="text"')"
editjs state.json 's.items.find(i=>i.id==="dec-1").text="keep the claim local!"'; sleep 0.4
editjs state.json 's.items.find(i=>i.id==="dec-1").text="keep the claim local"'; sleep 0.4
check "a hand edit undone by hand -> no prov again" "$(state | q '!x.items.find(i=>i.id==="dec-1").prov')"
stop_server
editjs state.json 's.items.find(i=>i.id==="dec-1").status="rejected"; s.items.push({id:"task-9",kind:"task",text:"buy stamps",status:"confirmed",author:"user",createdAt:"2026-10-17T09:00:00.000Z",column:"todo"}); s.items.push({id:"dec-9",kind:"decision",text:"an item from an older build",status:"proposed",author:"model",model:"morrow",quote:"q",fromMessage:"m-x",createdAt:"2026-10-17T09:00:00.000Z"})'
server "$DIR"
check "edited while the server was down: dec-1 status -> prov fields [status]" "$(state | q 'x.items.find(i=>i.id==="dec-1").prov.fields.join()==="status"')"
check "hand-added user item task-9 -> prov added" "$(state | q 'x.items.find(i=>i.id==="task-9").prov.added===true')"
check "a model item without ledger entry (older data) -> no prov: the declared author is shown" "$(state | q '!x.items.find(i=>i.id==="dec-9").prov')"
check "state.json carries no authorship field the server added (keys only from the schema)" "$(node -e 'const ok=["id","kind","text","status","author","model","quote","fromMessage","createdAt","decidedAt","decidedBy","column","url"];console.log(require(process.argv[1]).items.every(i=>Object.keys(i).every(k=>ok.includes(k))))' "$DIR/state.json")"

echo "== 4. continuity across a restart"
check "second server_start: lines = the last turn's lines or more" "$(ev '((s,t)=>s.length===2&&s[1].lines>=t.lines)(x.filter(e=>e.event==="server_start"),x.filter(e=>e.event==="turn").pop())')"
check "/stats continuity PASS after 1 restart" "$(statlines | grep -q '^continuity  PASS ' && statlines | grep -q '2 server starts (1 restart)' && echo true)"
cp "$DIR/transcript.jsonl" "$T/tr.jsonl"; stop_server; head -2 "$T/tr.jsonl" > "$DIR/transcript.jsonl"; server "$DIR"
check "a transcript cut while the server was down -> continuity NOT YET, 'LOST ... transcript lines'" "$(statlines | grep -q '^continuity  NOT YET' && statlines | grep -q 'LOST at the start of .*transcript lines' && echo true)"
stop_server; cp "$T/tr.jsonl" "$DIR/transcript.jsonl"

echo "== 5. /stats and npm run stats on the v0.6 fixture"
C="$T/.pilot-verify-v06c"; fixture_reset "$C"; mkdir -p "$C"
for f in demo/fixtures/v0.6/*; do case $(basename "$f") in demo.json|pilot.config.json) ;; *) cp "$f" "$C/" ;; esac; done
NPMOUT=$(npm run -s stats -- "$C"); RC=$?
check "npm run stats -- $C: exit 0, five measures" "$( [ $RC -eq 0 ] && [ $(echo "$NPMOUT" | grep -cE '^[a-z]+ +(PASS|NOT YET) ') -eq 5 ] && echo true)"
check "fixture verdicts: continuity PASS, consent PASS, usefulness NOT YET, signal PASS, quiet NOT YET" "$( [ "$(echo "$NPMOUT" | verdicts)" = "continuity PASS,consent PASS,usefulness NOT YET,signal PASS,quiet NOT YET," ] && echo true)"
check "labelled as fixture data (FIXTURE DATA: 130 of 130 metrics events ...)" "$(echo "$NPMOUT" | grep -q '^FIXTURE DATA: 130 of 130 metrics events and 64 of 64 transcript lines' && echo true)"
check "each measure names its threshold from 04-build-plan.md and the numbers behind it" "$(echo "$NPMOUT" | grep -q 'at least 3 times in one session' && echo "$NPMOUT" | grep -q '8 confirmed, 3 rejected (73% confirmed)' && echo "$NPMOUT" | grep -q '5 controller questions in 1.5 h of work' && echo true)"
(cd "$T" && npm --prefix "$APPDIR" run -s stats -- "$C" > "$T/abs.txt" 2>&1)
check "npm run stats from another directory with an absolute path: same output" "$(diff -q <(echo "$NPMOUT") "$T/abs.txt" > /dev/null && echo true)"
(cd "$APPDIR/.." && npm --prefix app run -s stats -- "app/${C#"$APPDIR/"}" > "$T/rel.txt" 2>&1)
check "a relative path resolves against the directory npm was run from (INIT_CWD)" "$(diff -q <(echo "$NPMOUT") "$T/rel.txt" > /dev/null && echo true)"
find "$C" -type f -exec shasum {} + | sort > "$T/sum1"; npm run -s stats -- "$C" > /dev/null; find "$C" -type f -exec shasum {} + | sort > "$T/sum2"
check "npm run stats is read-only (every file byte-identical, no file added)" "$(cmp -s "$T/sum1" "$T/sum2" && echo true)"
npm run -s stats -- "$T/.pilot-verify-v06-missing" > "$T/miss.txt" 2>&1; RC=$?
check "a missing dir: exit 2, usage, nothing created" "$( [ $RC -eq 2 ] && grep -q usage "$T/miss.txt" && [ ! -e "$T/.pilot-verify-v06-missing" ] && echo true)"
server "$C"
NPM2=$(npm run -s stats -- "$C"); WEB=$(statlines)
check "/stats in the server prints exactly the lines of npm run stats (same dir, same moment)" "$( [ "$NPM2" = "$WEB" ] && echo true)"
check "the live server_start counts as a restart: '4 server starts (3 restarts)', nothing lost" "$(echo "$WEB" | grep -q '4 server starts (3 restarts)' && echo "$WEB" | grep -q 'nothing lost' && echo true)"
for id in m-f002 m-f010 m-f014; do post metric "{\"event\":\"index_jump\",\"target\":\"$id\"}" > /dev/null; done
check "three index jumps now -> usefulness PASS (3 in this session)" "$(statlines | grep -q '^usefulness  PASS ' && statlines | grep -q 'most in one session: 3' && echo true)"
cp "$C/modules.json" "$T/mods.json"; sed -i '' 's/"consentId": "c-f03"/"consentId": "c-hand"/' "$C/modules.json"
check "a hand-written answer in modules.json -> consent NOT YET, 'pane index ... no consent event (file edit)'" "$(statlines | grep -q '^consent     NOT YET' && statlines | grep -q 'pane index is shown with answer "yes" that has no consent event (file edit)' && echo true)"
cp "$T/mods.json" "$C/modules.json"
check "signal counts the hand-made decision of dec-8 as 'decided by file edit'" "$(statlines | grep -q '1 decided by file edit' && echo true)"
stop_server

echo "== 6. page (headless Chrome): authorship on lines, cards and panes; hand edit -> 'you (file edit)'; jumps; /stats"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v06 | tee "$T/browser.log"
  check "browser checks (v06) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
check "contrast-check.js passes, including the new author chips on the pane bar" "$( [ $RC -eq 0 ] && grep -q 'author chip on pane bar' "$T/contrast.log" && echo true)"

echo "== 7. demo v0.6 within 30 s (ports +200, dir $T/.pilot-demo-verify06)"
PILOT_FIXTURE_ROOT="$T" DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR="$T/.pilot-demo-verify06" node scripts/demo.js v0.6 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 localhost:4964/state > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s: three panes with rule and answer; items from model, you, and file edits" "$( [ -n "$UP" ] && q 'x.panes.length===3 && Object.values(x.paneInfo).every(p=>p.metric&&p.recorded) && x.items.some(i=>i.author==="model"&&!i.prov) && x.items.some(i=>i.decidedBy==="user"&&!i.prov) && x.items.some(i=>i.prov&&i.prov.fields.includes("status")) && x.items.some(i=>i.author==="user"&&i.prov.added)' < "$T/ds.json")"
DS=$(curl -s -X POST localhost:4964/command -H 'content-type: application/json' -d '{"text":"/stats"}' | q 'x.lines.join("\n")')
check "demo /stats: 3 PASS, 2 NOT YET, labelled as fixture data" "$(echo "$DS" | grep -q '^3 PASS, 2 NOT YET' && echo "$DS" | grep -q '^FIXTURE DATA: 130 of 131 metrics events' && echo true)"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
FLIP=$(sed -n "s/^.*: \(node -e .*\)$/\1/p" "$T/demo.log" | sed -n 1p)
STATS=$(sed -n 's/^.*Same from the shell: //p' "$T/demo.log")
check "try lines: /stats, index clicks, the npm run stats line and the flip one-liner for the demo's own dir" "$(grep -q '/stats' "$T/demo.log" && grep -qi 'click three entries in the index' "$T/demo.log" && echo "$STATS" | grep -Fq ".pilot-demo-verify06" && echo "$FLIP" | grep -Fq ".pilot-demo-verify06/state.json" && echo true)"
eval "$FLIP"; sleep 0.5
check "the printed flip one-liner: dec-7 confirmed, /state prov fields [status] (\"confirmed by you (file edit)\")" "$(curl -s localhost:4964/state | q '(d=>d.status==="confirmed"&&d.prov.fields.join()==="status")(x.items.find(i=>i.id==="dec-7"))')"
check "the printed npm run stats line works as printed (FIXTURE DATA, five measures)" "$(eval "$STATS" 2>/dev/null | grep -q '^FIXTURE DATA' && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 59(64|65)' > /dev/null && ! lsof -iTCP:4964 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.6 CHECKS PASSED" || echo "$FAILS v0.6 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
