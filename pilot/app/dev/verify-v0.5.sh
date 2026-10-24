#!/bin/bash
# DEV ONLY. pilot-v0.5 checks: live files (P4) and c/r only on a focused card. Against dev/fake-model.js only.
# Own ports (server 4780, chat fakes 5781/5782, extract on 5782; browser part 4785/5786/5787 + Chrome 9363; demo part
# shifted +200: 4958/5958/5959) and own dirs (.pilot-verify-v05/, .pilot-verify-v05b/, .pilot-demo-verify05/), so it
# never touches .pilot/ or a running `npm run demo`.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.5.sh
set -u
cd "$(dirname "$0")/.."
source dev/lib/safe-dir.sh
T=$(fixture_temp); FIXTURE_ROOT="$T"; PIDS=(); SERVER=""
DIR="$T/.pilot-verify-v05"
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4780 4958 5781 5782
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
node -e '
  const c=require("./pilot.config.dev.json"); c.port=4780;
  for (const k of c.roles.chat.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5781/").replace(":5702/",":5782/");
  c.roles.extract.candidates[0].baseUrl="http://127.0.0.1:5782/v1";
  require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$T/conf.json"
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
server() { PILOT_DIR="$DIR" PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -s -m 1 localhost:4780/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; }; }
chat() { curl -sN -X POST localhost:4780/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
cmd() { curl -s -X POST localhost:4780/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
post() { curl -s -w '\n%{http_code}' -X POST localhost:4780/answer -H 'content-type: application/json' -d "$1"; }
state() { curl -s "localhost:4780/state${1:-}"; }
settle() { for i in $(seq 1 100); do [ "$(state | q 'x.extracting')" = "false" ] && return; sleep 0.1; done; }
# listen <ms>: SSE events into $T/ev.jsonl in the background; returns once the hello has arrived
listen() { node dev/sse-probe.js listen 4780 "$1" "$T/ev.jsonl" & LISTEN=$!; PIDS+=($!); for i in $(seq 1 50); do grep -q '"hello"' "$T/ev.jsonl" 2>/dev/null && return; sleep 0.05; done; }
endlisten() { wait $LISTEN 2>/dev/null; }
rev() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).rev)' "$DIR/$1"; }
lines() { grep -c . "$DIR/$1"; }
SEED='{"rev":4,"items":[{"id":"dec-1","kind":"decision","text":"keep the claim local","status":"proposed","author":"model","model":"morrow","quote":"keep the claim local","fromMessage":"m-1","createdAt":"2026-10-17T09:00:00.000Z"},{"id":"dec-2","kind":"decision","text":"write in German","status":"proposed","author":"model","model":"morrow","quote":"write in German","fromMessage":"m-1","createdAt":"2026-10-17T09:00:00.000Z"},{"id":"task-1","kind":"task","text":"scan the invoice","status":"proposed","author":"user","createdAt":"2026-10-17T09:00:00.000Z","column":"todo"}]}'

fake 5781 frontier; fake 5782 morrow; sleep 0.3
fixture_reset "$DIR"; mkdir -p "$DIR"; printf '%s' "$SEED" > "$DIR/state.json"
node -e 'const f=process.argv[1],r=require("./rules.example.json");r.rules.find(x=>x.module==="index").threshold=2;require("fs").writeFileSync(f,JSON.stringify(r,null,2))' "$DIR/rules.json"
server; SPID=$SERVER

echo "== 1. GET /events: hello with revs, then {file, rev} for own writes (PILOT_DIR=$DIR)"
listen 4500
chat "Decision: we test the watcher. Task: check the events." > /dev/null; settle; sleep 0.4
endlisten
check "hello first, with revs of the files in the dir (state.json 4, rules.json 1)" "$(head -1 "$T/ev.jsonl" | q 'x.event==="hello" && x.data.revs["state.json"]===4 && x.data.revs["rules.json"]===1')"
check "transcript.jsonl: rev = number of lines, the last event matches the file" "$(qa 'x.filter(e=>e.data.file==="transcript.jsonl").pop().data.rev' < "$T/ev.jsonl" | grep -qx "$(lines transcript.jsonl)" && echo true)"
check "state.json: rev = the file's rev field after the extraction write (5)" "$(qa 'x.filter(e=>e.data.file==="state.json").pop().data.rev===5' < "$T/ev.jsonl")"
check "modules.json pushed when the controller asked (rev 1); metrics.jsonl pushed with a line count" "$(qa 'x.some(e=>e.data.file==="modules.json"&&e.data.rev===1) && x.some(e=>e.data.file==="metrics.jsonl"&&Number.isInteger(e.data.rev))' < "$T/ev.jsonl")"
check "status events: extracting true, then false" "$(qa 'x.filter(e=>e.event==="status").map(e=>e.data.extracting).join()==="true,false"' < "$T/ev.jsonl")"
check "the server's temp files (.<name>.<pid>.<ts>.tmp) are never pushed" "$(qa '!x.some(e=>e.data.file&&(e.data.file.startsWith(".")||e.data.file.endsWith(".tmp")))' < "$T/ev.jsonl")"

echo "== 2. hand edit of state.json -> SSE event and /state (10 runs; the number is recorded in CHECKS.md)"
node dev/sse-probe.js latency 4780 "$DIR/state.json" 10 > "$T/lat.json"; cat "$T/lat.json" | sed 's/^/   /'
check "every hand edit: event and /state showing it within 1 s; /state has the new status" "$(q 'x.ok && x.stateMs.length===10 && Math.max(...x.stateMs)<1000' < "$T/lat.json")"
echo "   event latency: median $(q 'x.eventMs.slice().sort((a,b)=>a-b)[5]' < $T/lat.json) ms, max $(q 'Math.max(...x.eventMs)' < $T/lat.json) ms (150 ms of it is the debounce)"

echo "== 3. debounce 150 ms; every client gets every event"
node dev/sse-probe.js listen 4780 1500 "$T/ev2.jsonl" & L2=$!; PIDS+=($!)
listen 1500; until grep -q hello "$T/ev2.jsonl" 2>/dev/null; do sleep 0.05; done
node -e 'const fs=require("fs"),f=process.argv[1];let s=fs.readFileSync(f,"utf8");for(let i=0;i<5;i++){fs.writeFileSync(f,s.replace(/"text": "write in German[^"]*"/,`"text": "write in German ${i}"`));const t=Date.now();while(Date.now()-t<10){}}' "$DIR/state.json"
endlisten; wait $L2
check "5 hand writes within ~50 ms -> exactly 1 state.json event" "$(qa 'x.filter(e=>e.data.file==="state.json").length===1' < "$T/ev.jsonl")"
check "a second SSE client received the same event" "$(qa 'x.filter(e=>e.data.file==="state.json").length===1' < "$T/ev2.jsonl")"

echo "== 4. server writes bump rev (state.json, modules.json, roles.json)"
R=$(rev state.json); post '{"itemId":"dec-2","decision":"r"}' > /dev/null
check "decide: state.json rev $R -> $((R+1))" "$( [ "$(rev state.json)" = $((R+1)) ] && echo true)"
M=$(rev modules.json); post '{"module":"index","answer":"n"}' > /dev/null
check "consent answer: modules.json rev $M -> $((M+1))" "$( [ "$(rev modules.json)" = $((M+1)) ] && echo true)"
cmd '/model chat morrow' > /dev/null; RR=$(rev roles.json); cmd '/model chat auto' > /dev/null
check "/model: roles.json rev bumped on every write ($RR -> $((RR+1)))" "$( [ "$(rev roles.json)" = $((RR+1)) ] && echo true)"

echo "== 5. a write with a stale rev is rejected (409 stale) and changes nothing"
R=$(rev state.json); cp "$DIR/state.json" "$T/before.json"
OUT=$(post "{\"itemId\":\"task-1\",\"decision\":\"c\",\"rev\":$((R-1))}")
check "decide with rev $((R-1)) (file is at $R): 409 {stale: true, file: state.json, rev: $R}" "$(echo "$OUT" | tail -1 | grep -qx 409 && echo "$OUT" | head -1 | q "x.stale===true && x.file==='state.json' && x.rev===$R" | grep -q true && echo true)"
check "state.json byte-identical after the stale write" "$(cmp -s "$DIR/state.json" "$T/before.json" && echo true)"
OUT=$(post "{\"itemId\":\"task-1\",\"decision\":\"c\",\"rev\":$R}")
check "decide with the current rev: 200" "$(echo "$OUT" | tail -1 | grep -qx 200 && echo true)"
check "decide without rev (curl, older checks): still accepted" "$(post '{"itemId":"dec-1","decision":"c"}' | tail -1 | grep -qx 200 && echo true)"
check "an already-decided item is a plain 409 (not stale)" "$(post '{"itemId":"dec-1","decision":"c"}' | head -1 | q '!x.stale')"
chat "one more message" > /dev/null; settle; chat "and another one to double the count" > /dev/null; settle
M=$(rev modules.json)
check "(setup) the index question is pending again" "$(state | q 'x.pending==="index"')"
OUT=$(post "{\"module\":\"index\",\"answer\":\"y\",\"rev\":$((M-1))}")
check "consent with a stale modules.json rev: 409 stale, still pending" "$(echo "$OUT" | tail -1 | grep -qx 409 && echo "$OUT" | head -1 | q 'x.stale===true && x.file==="modules.json"' | grep -q true && state | q 'x.pending==="index"')"
OUT=$(post "{\"module\":\"index\",\"answer\":\"y\",\"rev\":$M}")
check "consent with the current rev: 200, pane added" "$(echo "$OUT" | tail -1 | grep -qx 200 && state | q 'x.panes.includes("index")')"
check "/state reports stateRev and modulesRev for the page" "$(state | q "x.stateRev===$(rev state.json) && x.modulesRev===$(rev modules.json)")"

echo "== 6. invalid JSON in hand-edited files never crashes the server; last good version is shown"
N=$(state | q 'x.items.length'); cp "$DIR/state.json" "$T/good.json"
listen 1200
printf '%s' '{"rev": 9, "items": [ oops' > "$DIR/state.json"; cp "$DIR/state.json" "$T/broken.json"
sleep 0.5
check "broken state.json: /state still answers with the last good items ($N), stateError and fileErrors set" "$(state | q "x.items.length===$N && !!x.stateError && /state.json is not valid JSON/.test(x.fileErrors['state.json'])")"
endlisten
check "broken state.json: SSE change event with rev null and the error" "$(qa 'x.some(e=>e.data.file==="state.json"&&e.data.rev===null&&/not valid JSON/.test(e.data.error))' < "$T/ev.jsonl")"
OUT=$(post '{"itemId":"task-1","decision":"r"}')
check "deciding while broken: 409 (not stale), file untouched" "$(echo "$OUT" | tail -1 | grep -qx 409 && echo "$OUT" | head -1 | q '!x.stale' | grep -q true && cmp -s "$DIR/state.json" "$T/broken.json" && echo true)"
chat "Decision: this must not overwrite the broken state." > /dev/null; settle
check "a chat turn with extraction leaves the broken file alone" "$(cmp -s "$DIR/state.json" "$T/broken.json" && echo true)"
cp "$T/good.json" "$DIR/state.json"; sleep 0.3
check "fixed state.json: no fileErrors" "$(state | q '!x.stateError && Object.keys(x.fileErrors).length===0')"
P=$(state | q 'x.panes.join()'); cp "$DIR/modules.json" "$T/mgood.json"
printf '%s' '{"rev": 3, "panes": [' > "$DIR/modules.json"; cp "$DIR/modules.json" "$T/mbroken.json"
check "broken modules.json: /state answers (200) with the last good panes ($P) and fileErrors" "$(state | q "x.panes.join()==='$P' && /modules.json is not valid JSON/.test(x.fileErrors['modules.json'])")"
chat "a turn while modules.json is broken" > /dev/null; settle
check "broken modules.json: a turn does not overwrite it (controller_error logged)" "$(cmp -s "$DIR/modules.json" "$T/mbroken.json" && grep -q '"controller_error".*modules.json' "$DIR/metrics.jsonl" && echo true)"
check "broken modules.json: a consent answer -> 409" "$(post '{"module":"map","answer":"y"}' | tail -1 | grep -qx 409 && echo true)"
cp "$T/mgood.json" "$DIR/modules.json"
cmd '/model chat morrow' > /dev/null
printf '{"rev": ' > "$DIR/roles.json"
check "broken roles.json: the pin is kept from the last good version (chat still pinned to morrow)" "$(state | q 'x.models.chat.pinned===true && x.models.chat.active==="morrow" && !!x.fileErrors["roles.json"]')"
check "broken roles.json: the next reply still comes from morrow (no silent unpin)" "$(chat 'which model now?' | grep -q 'fake:morrow' && echo true)"
printf '{"rev": 9, "active": {}}' > "$DIR/roles.json"
check "the server process survived all of it (same PID, no uncaught error in its log)" "$(kill -0 $SPID 2>/dev/null && ! grep -q 'Uncaught\|TypeError\|ReferenceError' "$T/server.log" && echo true)"

echo "== 7. page (headless Chrome): two tabs, hand edit -> DOM, stale rev, broken files, reconnect, fallback, c/r"
stop_server
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v05 | tee "$T/browser.log"
  check "browser checks (v05) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
check "contrast-check.js still passes (notice uses --text on the panel)" "$( [ $RC -eq 0 ] && echo true)"

echo "== 8. demo v0.5 within 30 s; the printed one-liners work as printed (ports +200, dir $T/.pilot-demo-verify05)"
PILOT_FIXTURE_ROOT="$T" DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR="$T/.pilot-demo-verify05" node scripts/demo.js v0.5 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 localhost:4958/state > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s: map pane, dec-2 proposed" "$( [ -n "$UP" ] && q 'x.panes.includes("map") && x.items.some(i=>i.id==="dec-2"&&i.status==="proposed")' < "$T/ds.json")"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
FLIP=$(grep -o "node -e '[^']*'" "$T/demo.log" | sed -n 1p); BREAK=$(grep -o "node -e '[^']*'" "$T/demo.log" | sed -n 2p)
check "try lines: two tabs, the flip and break one-liners point at the demo's own dir" "$(grep -qi 'two tabs' "$T/demo.log" && echo "$FLIP" | grep -q "$T/.pilot-demo-verify05/state.json" && echo "$BREAK" | grep -Fq "$T/.pilot-demo-verify05/state.json" && echo true)"
node dev/sse-probe.js listen 4958 1500 "$T/dev.jsonl" & DL=$!; PIDS+=($!)
for i in $(seq 1 50); do grep -q hello "$T/dev.jsonl" 2>/dev/null && break; sleep 0.05; done
eval "$FLIP"; wait $DL
check "the printed flip one-liner: SSE event for state.json, /state shows dec-2 confirmed" "$(qa 'x.some(e=>e.data.file==="state.json")' < "$T/dev.jsonl" | grep -q true && curl -s localhost:4958/state | q 'x.items.find(i=>i.id==="dec-2").status==="confirmed"')"
eval "$BREAK"; sleep 0.4
check "the printed break one-liner: fileErrors state.json; run again: repaired" "$(curl -s localhost:4958/state | q '!!x.fileErrors["state.json"]' | grep -q true && eval "$BREAK" && sleep 0.4 && curl -s localhost:4958/state | q '!x.fileErrors["state.json"]')"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 59(58|59)' > /dev/null && ! lsof -iTCP:4958 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.5 CHECKS PASSED" || echo "$FAILS v0.5 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
