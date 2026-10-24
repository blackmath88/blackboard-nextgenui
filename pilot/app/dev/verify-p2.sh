#!/bin/bash
# DEV ONLY. P2 checks (controller, consent, rules.json, modules.json) against fake endpoints. No real endpoint, no key.
# Usage (from anywhere): bash pilot/app/dev/verify-p2.sh
# Uses a fresh marked fixture; never touches the real .pilot/.
set -u
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T";
export PILOT_DIR="$T/data" PILOT_CONFIG="$T/dev.json"
node -e 'const c=require("./pilot.config.dev.json");c.port=4750;console.log(JSON.stringify(c))' > "$T/dev.json"
PIDS=()
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4750 5701 5702
FAILS=0
check() { if [ "$2" = "true" ] || [ "$2" = "true true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
server() { PILOT_CONFIG="$T/dev.json" node server.js > "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); sleep 0.5; }
restart() { kill $SERVER; wait $SERVER 2>/dev/null; server; }
fresh() { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; fixture_reset "$PILOT_DIR"; server; }
turn() { curl -sN -X POST localhost:4750/chat -H 'content-type: application/json' -d "{\"text\":\"${1:-a message}\"}" > /dev/null; }
answer() { curl -s -X POST localhost:4750/answer -H 'content-type: application/json' -d "{\"module\":\"$1\",\"answer\":\"$2\"}"; }
cmd() { curl -s -X POST localhost:4750/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
state() { curl -s localhost:4750/state; }
asks() { grep -c '"role":"controller".*"module":"index"' "$PILOT_DIR/transcript.jsonl"; }
msgs() { grep -c '"role":"\(user\|assistant\)"' "$PILOT_DIR/transcript.jsonl"; }
threshold() { node -e 'const f=process.env.PILOT_DIR+"/rules.json",r=JSON.parse(require("fs").readFileSync(f));r.rules.find(x=>x.module==="index").threshold='$1';require("fs").writeFileSync(f,JSON.stringify(r,null,2))'; }
edit_modules() { node -e 'const fs=require("fs"),f=process.env.PILOT_DIR+"/modules.json",m=JSON.parse(fs.readFileSync(f));'"$1"';fs.writeFileSync(f,JSON.stringify(m,null,2))'; }

node dev/fake-model.js 5701 frontier > /dev/null 2>&1 & PIDS+=($!)
node dev/fake-model.js 5702 morrow > /dev/null 2>&1 & PIDS+=($!)
sleep 0.3
fixture_reset "$PILOT_DIR"; server

echo "== seeding and threshold edit without restart"
check "rules.json seeded verbatim from rules.example.json" "$(cmp -s "$PILOT_DIR/rules.json" rules.example.json && echo true)"
turn "one"
check "2 messages, threshold 12: no question" "$(asks | q 'x===0')"
threshold 4
turn "two"
check "threshold edited to 4 in $PILOT_DIR/rules.json: asked on the next turn (4 messages), no restart" "$(asks | q 'x===1')"
check "modules.json pending=index, no pane yet" "$(state | q 'x.pending==="index" && x.panes.length===0')"
check "controller line text uses {n}" "$(grep '"role":"controller"' "$PILOT_DIR/transcript.jsonl" | q 'x.text.startsWith("4 messages.")')"

echo "== asks exactly once"
turn "three"; turn "four"
check "more turns while pending: still exactly 1 question" "$(asks | q 'x===1')"
restart; turn "five"
check "after restart: still exactly 1 question" "$(asks | q 'x===1')"
check "/rules shows the count and state" "$(cmd /rules | q 'x.lines[0].startsWith("index: messages 10 / 4  (asking now)")')"

echo "== x (never) survives restart"
check "answer x accepted" "$(answer index x | q 'x.answer==="never"')"
restart
for i in 1 2 3 4 5; do turn "after never $i"; done
check "never: $(msgs) messages (> 2x threshold) after restart, still exactly 1 question" "$(asks | q 'x===1')"
check "never: no pane, nothing pending" "$(state | q 'x.panes.length===0 && x.pending===null && x.answers.index.answer==="never"')"
check "answering when nothing is pending: 409" "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4750/answer -d '{"module":"index","answer":"y"}' | q 'x===409')"

echo "== y adds the index"
fresh; threshold 2; turn "hello"
check "asked at 2 messages" "$(asks | q 'x===1')"
check "bad answer: 400" "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4750/answer -d '{"module":"index","answer":"maybe"}' | q 'x===400')"
answer index y > /dev/null
check "y: /state lists the index pane" "$(state | q 'JSON.stringify(x.panes)==="[\"index\"]" && x.pending===null')"
check "y: modules.json records pane and answer, rev bumped" "$(cat "$PILOT_DIR/modules.json" | q 'x.panes[0].module==="index" && x.answers.index.answer==="yes" && x.rev===2')"
restart; turn "after yes"
check "y: pane persists after restart, no new question" "$(state | q 'x.panes[0]==="index"') $(asks | q 'x===1')"

echo "== n: ask again only when the count has doubled"
fresh; threshold 4; turn; turn
answer index n > /dev/null
turn
check "n at 4 messages: no question at 6" "$(asks | q 'x===1')"
turn
check "n: asked again at 8 messages" "$(asks | q 'x===2')"

echo "== a (always): pane added; re-added without asking if removed by hand"
answer index a > /dev/null
check "always: pane shown" "$(state | q 'x.panes[0]==="index"')"
edit_modules 'm.panes=[]'
turn
check "always: pane removed by hand is re-added on the next turn without a question" "$(state | q 'x.panes[0]==="index" && x.pending===null') $(grep -c 'you said always' "$PILOT_DIR/transcript.jsonl" | q 'x===1')"

echo "== no pane without a recorded answer"
edit_modules 'm.panes.push({module:"map",addedAt:new Date().toISOString(),atCount:0})'
check "hand-added map pane without an answer is not shown" "$(state | q 'JSON.stringify(x.panes)==="[\"index\"]"')"

echo "== malformed rules.json"
echo '{ not json' > "$PILOT_DIR/rules.json"
turn "rules broken"
check "turn still works; controller_error logged" "$(tail -1 "$PILOT_DIR/transcript.jsonl" | q 'x.role==="assistant"') $(grep -c controller_error "$PILOT_DIR/metrics.jsonl" | q 'x>=1')"

echo "== two turns at once cross the threshold: one question"
fresh; threshold 2
turn "parallel one" & P1=$!; turn "parallel two" & P2=$!; wait $P1 $P2; sleep 0.3
check "parallel turns: exactly 1 question" "$(asks | q 'x===1')"

echo; [ $FAILS -eq 0 ] && echo "ALL P2 CHECKS PASSED" || echo "$FAILS P2 CHECK(S) FAILED"
