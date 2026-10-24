#!/bin/bash
# DEV ONLY. pilot-v0.3 checks: pins, local->cloud fallback rule, stall timeout, consent keys (browser),
# contrast, demo start. Fake endpoints only. Own ports (server 4760, fakes 5761/5762; browser part 4765/5766/5767,
# demo part shifted by +200) and own dirs (.pilot-verify-v03/, .pilot-verify-v03b/, .pilot-demo-verify/), so it
# never touches .pilot/ or a running `npm run demo`.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.3.sh
set -u
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T"; PIDS=(); SERVER=""
DIR="$T/.pilot-verify-v03"
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4760 4950 5761 5762
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
# mkconf <file> <js mutating c>: dev config moved to this script's ports, then mutated.
mkconf() { node -e '
  const c=require("./pilot.config.dev.json"); c.port=4760;
  for (const r of Object.values(c.roles)) for (const k of r.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5761/").replace(":5702/",":5762/");
  const chat=c.roles.chat, byName=(n)=>chat.candidates.find(k=>k.name===n);
  '"$2"'; require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$T/$1"; }
fake() { node dev/fake-model.js "$@" > "$T/fake-$1.log" 2>&1 & eval "FAKE_$1=$!"; PIDS+=($!); sleep 0.3; }
unfake() { eval "local p=\$FAKE_$1"; kill $p 2>/dev/null; wait $p 2>/dev/null; }
server() { PILOT_DIR="$DIR" PILOT_CONFIG="$T/$1" node server.js > "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); sleep 0.5; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; }; }
fresh() { stop_server; fixture_reset "$DIR"; server "$1"; }
chat() { curl -sN -X POST localhost:4760/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
cmd() { curl -s -X POST localhost:4760/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
state() { curl -s localhost:4760/state; }
last() { tail -${1:-1} "$DIR/transcript.jsonl" | head -1; }
mcount() { [ -f "$DIR/metrics.jsonl" ] && wc -l < "$DIR/metrics.jsonl" | tr -d ' ' || echo 0; }
since() { tail -n +$(( $1 + 1 )) "$DIR/metrics.jsonl" 2>/dev/null; }

mkconf dev.json ''
mkconf morrow-first.json 'chat.candidates.reverse()'
mkconf morrow-first-allow.json 'chat.candidates.reverse(); chat.allowCloudFallback=true'
mkconf morrow-first-nolocal.json 'chat.candidates.reverse(); delete byName("frontier").local'
mkconf stall.json 'c.stallMs=1000'

echo "== 1. explicit /model pins the role (no fallback), persists, shows in status"
fake 5761 frontier; fake 5762 morrow
fresh dev.json
check "/model chat morrow answers ok and says pinned" "$(cmd '/model chat morrow' | q 'x.ok && /pinned/.test(x.lines[0])')"
check "state: chat active=morrow, pinned=true" "$(state | q 'x.models.chat.active==="morrow" && x.models.chat.pinned===true')"
check "roles.json holds the pin" "$(cat "$DIR/roles.json" | q 'x.active.chat==="morrow"')"
stop_server; server dev.json
check "pin survives a restart" "$(state | q 'x.models.chat.pinned===true && x.models.chat.active==="morrow"')"
unfake 5762
M=$(mcount); chat "morrow is down, pinned" > /dev/null
check "pinned + morrow down: failure is a system line, no reply from frontier" "$(last | q 'x.role==="system" && /chat failed: morrow/.test(x.text) && /pinned/.test(x.text)')"
check "pinned: no fallback metric, frontier never called" "$(since $M | qa '!x.some(e=>e.event==="fallback") && !x.some(e=>e.event==="model_call"&&e.candidate==="frontier")')"

echo "== 2. /model chat auto restores the policy from the first candidate; cloud->local fallback allowed"
check "/model chat auto unpins" "$(cmd '/model chat auto' | q 'x.ok')"
check "state: chat active=frontier (first candidate), pinned=false" "$(state | q 'x.models.chat.active==="frontier" && x.models.chat.pinned===false')"
fake 5762 morrow; unfake 5761
M=$(mcount); chat "frontier down, unpinned" > /dev/null
check "auto: frontier (cloud) down -> morrow (local) answers" "$(last | q 'x.role==="assistant" && x.model==="morrow" && x.text.startsWith("[fake:morrow]")')"
check "metrics: fallback frontier -> morrow logged" "$(since $M | qa 'x.some(e=>e.event==="fallback"&&e.from==="frontier"&&e.to==="morrow")')"

echo "== 3. local -> cloud fallback blocked without allowCloudFallback"
fake 5761 frontier; unfake 5762
fresh morrow-first.json
M=$(mcount); chat "morrow first and down" > /dev/null
check "blocked: system line 'fallback to frontier blocked: morrow is local'" "$(grep -c '"text":"fallback to frontier blocked: morrow is local"' "$DIR/transcript.jsonl" | q 'x===1')"
check "blocked line carries kind=blocked" "$(grep 'fallback to frontier blocked' "$DIR/transcript.jsonl" | q 'x.kind==="blocked"')"
check "blocked: frontier never called" "$(since $M | qa '!x.some(e=>e.event==="model_call"&&e.candidate==="frontier")')"
check "blocked: no assistant line, then 'chat failed: morrow'" "$(grep -c '"role":"assistant"' "$DIR/transcript.jsonl" | q 'x===0' | grep -q true && last | q 'x.role==="system" && /chat failed: morrow/.test(x.text)')"
check "metrics: fallback_blocked {from morrow, to frontier}" "$(since $M | qa 'x.some(e=>e.event==="fallback_blocked"&&e.from==="morrow"&&e.to==="frontier"&&/morrow is local/.test(e.reason))')"
fresh morrow-first-nolocal.json
chat "frontier has no local flag" > /dev/null
check "missing 'local' counts as non-local: still blocked" "$(grep -c 'fallback to frontier blocked: morrow is local' "$DIR/transcript.jsonl" | q 'x===1')"

echo "== 4. local -> cloud allowed with allowCloudFallback: true"
fresh morrow-first-allow.json
M=$(mcount); chat "morrow down, cloud allowed" > /dev/null
check "allowCloudFallback: frontier answers" "$(last | q 'x.role==="assistant" && x.model==="frontier" && x.text.startsWith("[fake:frontier]")')"
check "allowCloudFallback: fallback logged, nothing blocked" "$(since $M | qa 'x.some(e=>e.event==="fallback"&&e.from==="morrow"&&e.to==="frontier") && !x.some(e=>e.event==="fallback_blocked")')"

echo "== 5. stall after the first token (stallMs 1000 in a temp config, frontier stalls after 3 tokens)"
unfake 5761; fake 5761 frontier --stall-after=3; fake 5762 morrow
fresh stall.json
M=$(mcount); S0=$(node -e 'console.log(Date.now())'); OUT=$(chat "this reply will stall"); S1=$(node -e 'console.log(Date.now())')
echo "   took $((S1-S0)) ms; streamed: $OUT"
check "stall aborts within stallMs + 1.5 s (no hang)" "$( [ $((S1-S0)) -lt 2500 ] && [ $((S1-S0)) -ge 1000 ] && echo true)"
check "partial text kept as an assistant line from frontier" "$(last 2 | q 'x.role==="assistant" && x.model==="frontier" && x.text.startsWith("[fake:frontier]") && x.text.length<40')"
check "system line: reply stalled, kind=stall" "$(last | q 'x.role==="system" && x.kind==="stall" && /stalled: frontier: no new token for 1000 ms/.test(x.text)')"
check "metrics: stall event logged with stallMs 1000" "$(since $M | qa 'x.some(e=>e.event==="stall"&&e.candidate==="frontier"&&e.stallMs===1000&&e.chars>0)')"
check "a stall after the first token never falls back (morrow not called)" "$(since $M | qa '!x.some(e=>e.event==="fallback") && !x.some(e=>e.candidate==="morrow")')"
unfake 5761; fake 5761 frontier
chat "normal" > /dev/null
check "same stallMs 1000: a steady reply (40 ms/token, ~1.5 s in total) is not cut" "$(last | q 'x.role==="assistant" && x.model==="frontier" && x.text.endsWith("context)")')"
stop_server; unfake 5761; unfake 5762

echo "== 6. consent keys only on an empty input; pin in the status bar; palette (headless Chrome)"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v03 | tee "$T/browser.log"
  check "browser checks (v03) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi

echo "== 7. contrast (WCAG AA) for every text/background pair, both themes"
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
grep -c '^PASS' "$T/contrast.log" | sed 's/^/   pairs and rules passed: /'; grep '^FAIL' "$T/contrast.log"
check "contrast-check.js passes" "$( [ $RC -eq 0 ] && echo true)"

echo "== 8. demo starts and serves /state within 30 s (ports shifted +200, dir $T/.pilot-demo-verify)"
PILOT_FIXTURE_ROOT="$T" DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR="$T/.pilot-demo-verify" node scripts/demo.js v0.3 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 localhost:4950/state > "$T/demo-state.json" 2>/dev/null && [ -s "$T/demo-state.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s" "$( [ -n "$UP" ] && echo true)"
check "demo state: chat pinned to morrow, index question pending, seeded transcript" "$(q 'x.models.chat.pinned && x.models.chat.active==="morrow" && x.pending==="index" && x.total>=10' < "$T/demo-state.json")"
check "demo printed URL and try-this lines" "$(grep -q 'http://127.0.0.1:4950' "$T/demo.log" && grep -qi 'try this' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null
sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 59(51|52)' > /dev/null && ! lsof -iTCP:4950 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"
check "demo did not touch $T/.pilot-demo/ or .pilot/" "$(grep -Fq "PILOT_DIR=$T/.pilot-demo-verify" "$T/demo.log" && echo true)"
node scripts/demo.js v9.99 > "$T/unknown.log" 2>&1; RC=$?
check "unknown demo version lists the available ones and exits non-zero" "$( [ $RC -ne 0 ] && grep -q 'v0.3' "$T/unknown.log" && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.3 CHECKS PASSED" || echo "$FAILS v0.3 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
