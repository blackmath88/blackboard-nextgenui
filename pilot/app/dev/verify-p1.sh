#!/bin/bash
# DEV ONLY. P1 checks (roles, policies, /model, metrics) against fake endpoints. No real endpoint, no key.
# Usage (from anywhere): bash pilot/app/dev/verify-p1.sh
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
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=s.trim().split('\n').map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(v=>v!==null);const x=j.length===1?j[0]:j;console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
fake() { node dev/fake-model.js "$@" > "$T/fake-$1.log" 2>&1 & eval "FAKE_$1=$!"; PIDS+=($!); }
server() { PILOT_CONFIG="$1" node server.js > "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); sleep 0.5; }
stop_server() { kill $SERVER; wait $SERVER 2>/dev/null; }
chat() { curl -sN -X POST localhost:4750/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
cmd() { curl -s -X POST localhost:4750/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
last() { tail -1 "$PILOT_DIR/transcript.jsonl"; }
metrics_since() { tail -n +$(( $1 + 1 )) "$PILOT_DIR/metrics.jsonl" 2>/dev/null; }
mcount() { [ -f "$PILOT_DIR/metrics.jsonl" ] && wc -l < "$PILOT_DIR/metrics.jsonl" | tr -d ' ' || echo 0; }

fixture_reset "$PILOT_DIR"
fake 5701 frontier; fake 5702 morrow; sleep 0.3
server "$T/dev.json"

echo "== status bar data at start"; curl -s localhost:4750/state | q 'JSON.stringify(x.models)'
chat "hello" > /dev/null
check "first reply from frontier" "$(last | q 'x.role==="assistant" && x.model==="frontier" && x.text.startsWith("[fake:frontier]")')"

echo "== /model chat morrow"; cmd "/model chat morrow"; echo
chat "now private" > /dev/null
check "/model chat morrow: next assistant line records morrow" "$(last | q 'x.model==="morrow" && x.text.startsWith("[fake:morrow]")')"
check "system line records the switch" "$(grep -c 'model for chat switched to morrow' "$PILOT_DIR/transcript.jsonl" | q 'x===1')"
check "status data shows chat active=morrow" "$(curl -s localhost:4750/state | q 'x.models.chat.active==="morrow"')"
check "unknown candidate rejected" "$(cmd '/model chat nobody' | q 'x.ok===false')"
check "/help answers" "$(cmd '/help' | q 'x.ok && x.lines.length>0')"
check "commands are not sent or stored as user lines" "$(grep -c '"role":"user","text":"/' "$PILOT_DIR/transcript.jsonl" | q 'x===0')"

echo "== restart: /model choice persists"; stop_server; server "$T/dev.json"
check "after restart chat active=morrow" "$(curl -s localhost:4750/state | q 'x.models.chat.active==="morrow"')"
# ADAPTED in pilot-v0.3: was "/model chat frontier", which now pins frontier (no fallback). auto restores the policy.
cmd "/model chat auto" > /dev/null

echo "== fallback: frontier stopped"; kill $FAKE_5701; wait $FAKE_5701 2>/dev/null
M=$(mcount); chat "frontier is down" > /dev/null
check "second candidate answered" "$(last | q 'x.model==="morrow" && x.text.startsWith("[fake:morrow]")')"
metrics_since $M
check "metrics: failed frontier call, fallback, ok morrow call" "$(metrics_since $M | qa 'x.some(e=>e.event==="model_call"&&e.candidate==="frontier"&&!e.ok) && x.some(e=>e.event==="fallback"&&e.from==="frontier"&&e.to==="morrow") && x.some(e=>e.event==="model_call"&&e.candidate==="morrow"&&e.ok)')"
check "status data shows frontier→morrow (last answer)" "$(curl -s localhost:4750/state | q 'x.models.chat.active==="frontier" && x.models.chat.last==="morrow"')"

echo "== fallback on HTTP 500"; fake 5701 frontier --status=500; sleep 0.3
M=$(mcount); chat "frontier errors" > /dev/null
check "HTTP 500 falls back to morrow" "$(last | q 'x.model==="morrow"')"
check "metrics logs the HTTP 500" "$(metrics_since $M | qa 'x.some(e=>e.candidate==="frontier"&&/HTTP 500/.test(e.error))')"
kill $FAKE_5701; wait $FAKE_5701 2>/dev/null

echo "== fallback on timeout (temp config, timeoutMs 1000, frontier delays 5 s)"
stop_server
node -e 'const c=require(process.env.PILOT_CONFIG);c.roles.chat.candidates[0].timeoutMs=1000;console.log(JSON.stringify(c))' > "$T/timeout.json"
fake 5701 frontier --delay=5000; sleep 0.3; server "$T/timeout.json"
M=$(mcount); S0=$(date +%s); chat "frontier hangs" > /dev/null; S1=$(date +%s)
check "timeout falls back to morrow" "$(last | q 'x.model==="morrow"')"
check "metrics logs 'no reply within 1000 ms'" "$(metrics_since $M | qa 'x.some(e=>e.candidate==="frontier"&&/no reply within 1000 ms/.test(e.error))')"
echo "   took $((S1-S0)) s"
kill $FAKE_5701; wait $FAKE_5701 2>/dev/null

echo "== manual policy: no fallback"
stop_server
node -e 'const c=require(process.env.PILOT_CONFIG);c.roles.chat.policy="manual";console.log(JSON.stringify(c))' > "$T/manual.json"
server "$T/manual.json"
M=$(mcount); chat "manual and frontier down" > /dev/null
check "manual: failure becomes a system line, morrow not tried" "$(last | q 'x.role==="system" && /chat failed: frontier/.test(x.text)')"
check "manual: no fallback event" "$(metrics_since $M | qa '!x.some(e=>e.event==="fallback") && !x.some(e=>e.candidate==="morrow")')"

echo; [ $FAILS -eq 0 ] && echo "ALL P1 CHECKS PASSED" || echo "$FAILS P1 CHECK(S) FAILED"
