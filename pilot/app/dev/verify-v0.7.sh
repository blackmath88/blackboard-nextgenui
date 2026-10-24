#!/bin/bash
# DEV ONLY. pilot-v0.7 checks: /why (panes, items, the whole frame) from the files only, every cited source resolved
# back to its file (dev/why-cites.js), missing facts said plainly, read-only; the "why?" affordance and the layout fix
# in the browser (browser-check.js v07); the v0.7 demo. Against dev/fake-model.js only. Own ports (server 4800, fakes
# 5801/5802; browser part 4805/5806/5807 + Chrome 9383; demo part shifted +200: 4968/5968/5969) and own dirs
# (.pilot-verify-v07/, .pilot-verify-v07c/, .pilot-verify-v07b/, .pilot-demo-verify07/), so it never touches .pilot/
# or a running demo. Usage (from anywhere): bash pilot/app/dev/verify-v0.7.sh
set -u
cd "$(dirname "$0")/.."
source dev/lib/safe-dir.sh
APPDIR=$(pwd)
T=$(fixture_temp); FIXTURE_ROOT="$T"; PIDS=(); SERVER=""
DIR="$T/.pilot-verify-v07"; C="$T/.pilot-verify-v07c"
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4800 4968 5801 5802
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
node -e '
  const c=require("./pilot.config.dev.json"); c.port=4800;
  for (const k of c.roles.chat.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5801/").replace(":5702/",":5802/");
  c.roles.extract.candidates[0].baseUrl="http://127.0.0.1:5802/v1";
  require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$T/conf.json"
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
server() { PILOT_DIR="$1" PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -s -m 1 localhost:4800/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
chat() { curl -sN -X POST localhost:4800/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
cmdraw() { curl -s -w '\n%{http_code}' -X POST localhost:4800/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
why() { curl -s -X POST localhost:4800/command -H 'content-type: application/json' -d "{\"text\":\"/why $1\"}" | q 'x.lines.join("\n")'; }
post() { curl -s -w '\n%{http_code}' -X POST "localhost:4800/$1" -H 'content-type: application/json' -d "$2"; }
state() { curl -s "localhost:4800/state${1:-}"; }
settle() { for i in $(seq 1 100); do [ "$(state | q 'x.extracting')" = "false" ] && return; sleep 0.1; done; }
has() { grep -qE -- "$1" <<< "$2"; }   # status only; a check ends its chain with && echo true
editjs() { node -e "const f=process.argv[1],fs=require('fs'),s=JSON.parse(fs.readFileSync(f,'utf8'));$2;fs.writeFileSync(f,JSON.stringify(s,null,2))" "$3/$1"; }
sums() { find "$1" -type f -exec shasum {} + | sort; }

fake 5801 frontier; fake 5802 morrow; sleep 0.3

echo "== 1. /why on the v0.7 fixture (copy in $C)"
fixture_reset "$C"; mkdir -p "$C"
for f in demo/fixtures/v0.7/*; do case $(basename "$f") in demo.json|pilot.config.json) ;; *) cp "$f" "$C/" ;; esac; done
server "$C"
W=$(why "")
check "/why: one line per shown pane with its rule, the count when asked, your answer and the add" "$(has '^  index: messages ≥ 12; asked at 24 messages \(2026-10-15T14:14:22.000Z\); you said yes \(2026-10-15T14:14:33.000Z\); added by the controller  \[modules.json:14 panes index.rule; rules.json:[0-9]+ rules index; metrics.jsonl:60 controller_ask; transcript.jsonl:33 m-f033; metrics.jsonl:65 consent c-f03; metrics.jsonl:66 controller_add\]$' "$W" && has '^  map: decisions ≥ 2; asked at 2 decisions' "$W" && has '^  kanban: tasks ≥ 3; asked at 6 tasks .*you said always' "$W" && echo true)"
check "/why: items summary (16 by a model, task-7 by file edit; dec-8 status by file edit; task-1, task-2 edited)" "$(has '^  17 items: 16 proposed by a model \(extraction\), 1 added by you \(file edit\): task-7' "$W" && has 'status set by file edit: dec-8; other fields edited by file edit: task-1, task-2' "$W" && echo true)"
W=$(why map)
check "/why map: the rule recorded with the pane, citing the pane entry and rules.json" "$(has '^  rule recorded with the pane: decisions ≥ 2 \(rules.json says the same now\)  \[modules.json:5 panes map.rule; rules.json:[0-9]+ rules map\]$' "$(why map)" && echo true)"
check "/why map: the question with its count, threshold and text, the answer, the add, each with its line" "$(has '^  the controller asked at 2026-10-14T09:05:44.000Z: 2 decisions reached the threshold 2, "2 decisions so far. Add a reasoning map\?"  \[metrics.jsonl:12 controller_ask; transcript.jsonl:5 m-f005\]$' "$W" && has '^  you answered "yes" at 2026-10-14T09:05:52.000Z \(count 2\)  \[metrics.jsonl:13 consent c-f01\]$' "$W" && has 'the controller added the pane at .* allowed by your answer "yes" \(c-f01\)' "$W" && echo true)"
W=$(why index)
check "/why index: the full history (asked at 12, no; asked at 24, yes)" "$(has 'asked at 2026-10-14T09:23:17.000Z: 12 messages' "$W" && has 'you answered "no" at 2026-10-14T09:23:25' "$W" && has 'asked at 2026-10-15T14:14:22.000Z: 24 messages' "$W" && has 'you answered "yes" at 2026-10-15T14:14:33' "$W" && echo true)"
W=$(why dec-2)
check "/why dec-2: proposed by morrow (extraction), from your message m-f003 (not the extract event's m-f004), quote found, confirmed by you" "$(has '^  proposed by model morrow at 2026-10-14T09:05:44.000Z \(extraction, candidate morrow, model id fake-morrow\)' "$W" && has '^  from message m-f003 by you at 2026-10-14T09:05:17.000Z  \[transcript.jsonl:3 m-f003\]$' "$W" && has 'is in that message' "$W" && has '^  confirmed by you at 2026-10-14T09:06:32.000Z \(through the page\)  \[metrics.jsonl:18 decide dec-2\]$' "$W" && echo true)"
W=$(why dec-8)
check "/why dec-8: status set by file edit, 'when is not recorded' (no file_edit event in the fixture), the server last wrote proposed" "$(has 'status "confirmed" set by you \(file edit\), when is not recorded \(no file_edit event in metrics.jsonl\) \(the server last wrote "proposed"\)' "$W" && echo true)"
W=$(why task-7)
check "/why task-7: added by you (file edit) at the recorded time, citing the file_edit line" "$(has '^  added by you \(file edit\) at 2026-10-16T18:30:04.000Z  \[state.json:[0-9]+ items task-7; metrics.jsonl:131 file_edit task-7\]$' "$W" && has 'no source message recorded' "$W" && echo true)"
W=$(why task-1)
check "/why task-1: column edited by file edit: the server wrote \"todo\", the file says \"done\"" "$(has 'column edited by you \(file edit\), when is not recorded .*: the server wrote "todo", the file says "done"' "$W" && echo true)"
W=$(why chat)
check "/why chat: always there, not grown" "$(has 'always there' "$W" && echo true)"
OUT=$(cmdraw '/why nope')
check "/why <unknown>: 400, names the panes and the items" "$(echo "$OUT" | tail -1 | grep -qx 400 && has 'nothing called \\"nope\\". Panes: chat, index, map, kanban. Items: dec-1' "$OUT" && echo true)"
node dev/why-cites.js http://127.0.0.1:4800 "$C" > "$T/cites1.txt"; RC=$?
check "every source cited by /why, every pane and all 17 items resolves to the line it names ($(tail -1 $T/cites1.txt))" "$( [ $RC -eq 0 ] && echo true)"
[ $RC -ne 0 ] && head -20 "$T/cites1.txt"
sleep 0.3; sums "$C" > "$T/s1"
for t in "" map index kanban chat dec-2 dec-8 task-7 task-1 nope; do why "$t" > /dev/null; done; node dev/why-cites.js http://127.0.0.1:4800 "$C" > /dev/null; sleep 0.3
sums "$C" > "$T/s2"
check "/why is read-only (every file byte-identical after 31 explanations, no file added)" "$(cmp -s "$T/s1" "$T/s2" && echo true)"
stop_server

echo "== 2. live data: a fresh dir, real turns, consent and a decision"
fixture_reset "$DIR"; mkdir -p "$DIR"
node -e 'const f=process.argv[1],r=require("./rules.example.json");r.rules.find(x=>x.module==="index").threshold=2;r.rules.find(x=>x.module==="map").threshold=1;require("fs").writeFileSync(f,JSON.stringify(r,null,2))' "$DIR/rules.json"
server "$DIR"
chat "Decision: keep the claim local. Task: scan the invoice." > /dev/null; settle
post answer '{"module":"index","answer":"y"}' > /dev/null
chat "one more" > /dev/null; settle
post answer '{"module":"map","answer":"a"}' > /dev/null
post answer '{"itemId":"dec-1","decision":"c"}' > /dev/null
W=$(why "")
check "/why on live data: index and map shown, each from its question and your answer" "$(has '^  panes: chat \+ index \+ map' "$W" && has '^  index: messages ≥ 2; asked at 2 messages .*you said yes' "$W" && has '^  map: decisions ≥ 1; asked at 1 decisions .*you said always' "$W" && echo true)"
MSG=$(qa 'x.find(l=>l.role==="user").id' < "$DIR/transcript.jsonl")
W=$(why dec-1)
check "/why dec-1: proposed by morrow from your message $MSG, confirmed by you through the page" "$(has "^  from message $MSG by you" "$W" && has '^  proposed by model morrow at .*\(extraction' "$W" && has '^  confirmed by you at .* \(through the page\)  \[metrics.jsonl:[0-9]+ decide dec-1\]$' "$W" && echo true)"
node dev/why-cites.js http://127.0.0.1:4800 "$DIR" > "$T/cites2.txt"; RC=$?
check "every source cited on live data resolves ($(tail -1 $T/cites2.txt))" "$( [ $RC -eq 0 ] && echo true)"
[ $RC -ne 0 ] && head -20 "$T/cites2.txt"

echo "== 3. missing or hand-made facts are said plainly"
editjs state.json 's.items.find(i=>i.id==="task-1").text="scan the invoice twice"' "$DIR"; sleep 0.5
W=$(why task-1)
check "a hand edit while the server runs: 'text edited by you (file edit) at <ts>', citing the file_edit line" "$(has '^  text edited by you \(file edit\) at [0-9T:.-]+Z: the server wrote "scan the invoice", the file says "scan the invoice twice"  \[.*metrics.jsonl:[0-9]+ file_edit task-1\]$' "$W" && echo true)"
editjs state.json 's.items.push({id:"task-9",kind:"task",text:"buy stamps",status:"confirmed",author:"user",createdAt:"2026-10-17T09:00:00.000Z",column:"todo"})' "$DIR"; sleep 0.5
W=$(why task-9)
check "an item added by hand: 'added by you (file edit) at <ts>' (file_edit line), status set by file edit" "$(has '^  added by you \(file edit\) at [0-9T:.-]+Z  \[state.json:[0-9]+ items task-9; metrics.jsonl:[0-9]+ file_edit task-9\]$' "$W" && has 'status "confirmed" set by you \(file edit\) at' "$W" && echo true)"
editjs state.json 's.items.push({id:"dec-9",kind:"decision",text:"from an older build",status:"proposed",author:"model",model:"morrow",quote:"q",fromMessage:"m-gone",createdAt:"2026-10-17T09:00:00.000Z"})' "$DIR"; sleep 0.5
W=$(why dec-9)
check "a model item the server never wrote: 'the file says author model · morrow; the server never wrote it'" "$(has 'the file says author model · morrow; the server never wrote it \(no item_write in metrics.jsonl' "$W" && echo true)"
check "a fromMessage that is not in the transcript: 'which is not in transcript.jsonl'" "$(has 'from message m-gone, which is not in transcript.jsonl' "$W" && echo true)"
editjs modules.json 's.panes.push({module:"kanban",addedAt:"2026-10-17T09:00:00.000Z"})' "$DIR"; sleep 0.4
W=$(why kanban); WF=$(why "")
check "a pane added by hand without an answer: not shown (/state), /why says 'no recorded answer'" "$(state | q '!x.panes.includes("kanban")' | grep -q true && has '^  not shown: listed in modules.json, but there is no recorded answer' "$W" && has '^  no recorded answer  \[modules.json answers.kanban \(absent\)\]$' "$W" && has '^  kanban not shown: listed in modules.json without a recorded answer' "$WF" && echo true)"
check "... and 'the pane entry has no controller_add event: added by file edit, when is not recorded'" "$(has 'the pane entry has no controller_add event: added by file edit, when is not recorded \(the entry says addedAt 2026-10-17T09:00:00.000Z\)' "$W" && echo true)"
editjs modules.json 's.answers.kanban={answer:"yes",at:"2026-10-17T09:00:01.000Z",count:9}' "$DIR"; sleep 0.4
W=$(why kanban)
check "a hand-written yes (no consent event): shown, and /why says 'written by file edit, when is not recorded'" "$(state | q 'x.panes.includes("kanban")' | grep -q true && has 'answer on file: "yes" \(says 2026-10-17T09:00:01.000Z\), but no consent event matches it: written by file edit, when is not recorded' "$W" && echo true)"
editjs rules.json 's.rules.find(x=>x.module==="index").threshold=5' "$DIR"
check "rules.json changed after the pane was added: the recorded rule and 'rules.json says messages ≥ 5 now'" "$(W=$(why index); has 'rule recorded with the pane: messages ≥ 2  \[' "$W" && has 'rules.json says messages ≥ 5 now' "$W" && echo true)"
node dev/why-cites.js http://127.0.0.1:4800 "$DIR" > "$T/cites3.txt"; RC=$?
check "every source cited after the hand edits resolves ($(tail -1 $T/cites3.txt))" "$( [ $RC -eq 0 ] && echo true)"
[ $RC -ne 0 ] && head -20 "$T/cites3.txt"
cp "$DIR/state.json" "$T/st.json"; printf '{"rev": 9, "items": [' > "$DIR/state.json"; sleep 0.4
OUT=$(cmdraw '/why dec-1'); W=$(why "")
check "broken state.json: /why dec-1 answers (400, names the error), /why says items cannot be explained, the server lives" "$(echo "$OUT" | tail -1 | grep -qx 400 && has 'state.json is not valid JSON' "$OUT" && has 'state.json is not valid JSON.*items cannot be explained' "$W" && curl -s -m 1 localhost:4800/state > /dev/null && echo true)"
cp "$T/st.json" "$DIR/state.json"
cp "$DIR/modules.json" "$T/mo.json"; printf '{"panes": [' > "$DIR/modules.json"; sleep 0.4
check "broken modules.json: /why map says it cannot explain until the file is fixed" "$(has 'cannot explain: modules.json is not valid JSON' "$(why map)" && echo true)"
cp "$T/mo.json" "$DIR/modules.json"; sleep 0.3
sums "$DIR" > "$T/s3"; for t in "" index map kanban dec-1 dec-9 task-9 task-1; do why "$t" > /dev/null; done; sleep 0.3; sums "$DIR" > "$T/s4"
check "/why is read-only on live data too" "$(cmp -s "$T/s3" "$T/s4" && echo true)"
check "/help lists /why" "$(curl -s -X POST localhost:4800/command -H 'content-type: application/json' -d '{"text":"/help"}' | q 'x.lines.some(l=>l.startsWith("/why"))')"
stop_server

echo "== 4. page (headless Chrome): /why, links, the why? affordance, keyboard, layout at 800/1280/1600 (+820, 1000)"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v07 | tee "$T/browser.log"
  check "browser checks (v07) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
check "contrast-check.js passes, including the why? button and the /why lines" "$( [ $RC -eq 0 ] && grep -q 'why? button on pane bar' "$T/contrast.log" && echo true)"

echo "== 5. demo v0.7 within 30 s (ports +200, dir $T/.pilot-demo-verify07)"
PILOT_FIXTURE_ROOT="$T" DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR="$T/.pilot-demo-verify07" node scripts/demo.js v0.7 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 localhost:4968/state > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s: index, map and kanban grown from the fixtures" "$( [ -n "$UP" ] && q 'x.panes.join()==="map,index,kanban" && Object.values(x.paneInfo).every(p=>p.metric&&p.recorded)' < "$T/ds.json")"
DW=$(curl -s -X POST localhost:4968/command -H 'content-type: application/json' -d '{"text":"/why dec-2"}' | q 'x.lines.join("\n")')
check "demo /why dec-2 answers from the demo's files" "$(has 'from message m-f003 by you' "$DW" && echo true)"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
check "try lines: /why, /why map, /why dec-2, the why? click" "$(grep -q 'type /why' "$T/demo.log" && grep -q '/why map' "$T/demo.log" && grep -q '/why dec-2' "$T/demo.log" && grep -q 'Click "why?" on a pane bar' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 59(68|69)' > /dev/null && ! lsof -iTCP:4968 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.7 CHECKS PASSED" || echo "$FAILS v0.7 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
