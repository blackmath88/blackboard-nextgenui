#!/bin/bash
# DEV ONLY. pilot-v0.4 checks: proposals (P3). Extraction against dev/fake-model.js's fake extractor only
# (UNTESTED WITH A REAL MODEL). Own ports (server 4770, chat fakes 5771/5772, extract fake 5773; browser part
# 4775/5776/5777 + Chrome 9353; demo part shifted +200: 4954/5954/5955) and own dirs (.pilot-verify-v04/,
# .pilot-verify-v04b/, .pilot-demo-verify04/), so it never touches .pilot/ or a running `npm run demo`.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.4.sh
set -u
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T"; PIDS=(); SERVER=""
DIR="$T/.pilot-verify-v04"
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4770 4954 5771 5772 5773
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
all() { for a in "$@"; do [ "$a" = true ] || { echo false; return; }; done; echo true; }   # all "true"?
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
# mkconf <file> <js mutating c>: dev config on this script's ports; the extract role gets its own fake (5773).
mkconf() { node -e '
  const c=require("./pilot.config.dev.json"); c.port=4770;
  for (const k of c.roles.chat.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5771/").replace(":5702/",":5772/");
  c.roles.extract.candidates[0].baseUrl="http://127.0.0.1:5773/v1";
  const ex=c.roles.extract;
  '"$2"'; require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$T/$1"; }
fake() { local port=$1; shift; node dev/fake-model.js "$port" "$@" > "$T/fake-$port.log" 2>&1 & eval "FAKE_$port=$!"; PIDS+=($!); sleep 0.3; }
unfake() { eval "local p=\${FAKE_$1:-}"; [ -n "$p" ] && { kill $p 2>/dev/null; wait $p 2>/dev/null; }; }
refake() { local port=$1; unfake "$port"; fake "$@"; }
server() { PILOT_DIR="$DIR" PILOT_CONFIG="$T/$1" node server.js > "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); sleep 0.5; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; }; }
fresh() { stop_server; fixture_reset "$DIR"; mkdir -p "$DIR"; [ -n "${2:-}" ] && printf '%s' "$2" > "$DIR/state.json"; server "$1"; }
chat() { curl -H 'x-pilot: 1' -sN -X POST localhost:4770/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
cmd() { curl -H 'x-pilot: 1' -s -X POST localhost:4770/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
decide() { curl -H 'x-pilot: 1' -s -w '\n%{http_code}' -X POST localhost:4770/answer -H 'content-type: application/json' -d "{\"itemId\":\"$1\",\"decision\":\"$2\"}"; }
answer() { curl -H 'x-pilot: 1' -s -X POST localhost:4770/answer -H 'content-type: application/json' -d "{\"module\":\"$1\",\"answer\":\"$2\"}"; }
state() { curl -H 'x-pilot: 1' -s localhost:4770/state; }
# wait until no extraction is queued or running (max 10 s)
settle() { for i in $(seq 1 100); do [ "$(state | q 'x.extracting')" = "false" ] && return; sleep 0.1; done; echo "   (extraction still running after 10 s)"; }
items() { [ -f "$DIR/state.json" ] && cat "$DIR/state.json" || echo '{"rev":0,"items":[]}'; }
mcount() { [ -f "$DIR/metrics.jsonl" ] && wc -l < "$DIR/metrics.jsonl" | tr -d ' ' || echo 0; }
since() { tail -n +$(( $1 + 1 )) "$DIR/metrics.jsonl" 2>/dev/null; }
now() { node -e 'console.log(Date.now())'; }
ITEM_USER='{"rev":3,"_notes":["hand-edited"],"items":[{"id":"dec-1","kind":"decision","text":"keep the claim local","status":"confirmed","author":"user","createdAt":"2026-10-17T09:00:00.000Z","note":"mine"},{"id":"task-7","kind":"task","text":"scan the invoice","status":"proposed","author":"user","createdAt":"2026-10-17T09:00:00.000Z"}]}'

mkconf good.json ''
mkconf unstructured.json 'ex.candidates[0].structured=false'
mkconf max2.json 'ex.maxItems=2'
mkconf every2.json 'ex.everyNTurns=2'
mkconf exfallback.json 'ex.policy="fallback"; ex.candidates.push({name:"frontier",local:false,baseUrl:"http://127.0.0.1:5771/v1",model:"fake-frontier",structured:true,timeoutMs:10000})'
mkconf exfallback-allow.json 'ex.policy="fallback"; ex.allowCloudFallback=true; ex.candidates.push({name:"frontier",local:false,baseUrl:"http://127.0.0.1:5771/v1",model:"fake-frontier",structured:true,timeoutMs:10000})'
mkconf stall.json 'c.stallMs=1000'
fake 5771 frontier; fake 5772 morrow

echo "== 1. a turn with a clear decision -> proposed items (dashed in the page: see section 9)"
fake 5773 morrow-x
fresh good.json
chat "Decision: we keep the claim local. Task: write the letter by Friday. See https://example.org/claims." > /dev/null; settle
check "state.json: dec-1, task-1, src-1 proposed, author model, model morrow" "$(items | q 'x.items.map(i=>i.id).join()==="dec-1,task-1,src-1" && x.items.every(i=>i.status==="proposed"&&i.author==="model"&&i.model==="morrow")')"
U=$(grep '"role":"user"' "$DIR/transcript.jsonl" | tail -1 | q 'x.id')
check "each item has quote (in the turn), fromMessage (the user line), createdAt; task column todo; source url" "$(items | q 'x.items.every(i=>i.quote&&i.fromMessage==="'$U'"&&i.createdAt) && x.items[1].column==="todo" && x.items[2].url==="https://example.org/claims"')"
check "state.json rev 1 after the first write; no temp files left" "$(all "$(items | q 'x.rev===1')" "$( [ -z "$(ls -A "$DIR" | grep '\.tmp$')" ] && echo true)")"
check "GET /state returns items and extracting:false" "$(state | q 'x.items.length===3 && x.extracting===false && x.stateRev===1')"
check "metrics: extract event (3 proposed) and an ok model_call for role extract" "$(cat "$DIR/metrics.jsonl" | qa 'x.some(e=>e.event==="extract"&&e.proposed===3&&e.candidate==="morrow") && x.some(e=>e.event==="model_call"&&e.role==="extract"&&e.ok)')"
check "structured: true -> request carried response_format" "$(grep -q 'response_format=yes items=3' "$T/fake-5773.log" && echo true)"
check "extraction never sent to the chat model fakes" "$(! grep -q '^\[extract\]' "$T/fake-5771.log" "$T/fake-5772.log" && echo true)"
fresh unstructured.json
chat "Decision: no structured output here." > /dev/null; settle
check "structured: false -> no response_format (role marker in the prompt), item still proposed" "$(grep -q 'response_format=no items=1' "$T/fake-5773.log" && items | q 'x.items.length===1')"

echo "== 2. extraction never delays the chat reply (extract fake answers after 4 s)"
refake 5773 morrow-x --extract-delay=4000
fresh good.json
S0=$(now); chat "Decision: slow extraction must not block me." > /dev/null; S1=$(now)
check "chat reply done in < 2.5 s although extraction takes > 4 s ($((S1-S0)) ms)" "$( [ $((S1-S0)) -lt 2500 ] && echo true)"
check "right after the reply: assistant line written, no item yet, /state says extracting" "$(tail -1 "$DIR/transcript.jsonl" | q 'x.role==="assistant"' | grep -q true && state | q 'x.extracting===true && x.items.length===0')"
S2=$(now); chat "A second message while the first extraction runs." > /dev/null; S3=$(now)
check "a second chat turn is not blocked either ($((S3-S2)) ms)" "$( [ $((S3-S2)) -lt 2500 ] && echo true)"
settle
check "the proposal arrives afterwards (extraction runs queued, one at a time)" "$(items | q 'x.items.length===1 && x.items[0].id==="dec-1"')"

echo "== 3. malformed extractor output writes nothing and is logged"
refake 5773 morrow-x --extract=malformed
fresh good.json
M=$(mcount); chat "Decision: this one comes back broken." > /dev/null; settle
check "malformed: no state.json written" "$( [ ! -f "$DIR/state.json" ] && echo true)"
check "malformed: extract_error reason malformed in metrics.jsonl" "$(since $M | qa 'x.some(e=>e.event==="extract_error"&&e.reason==="malformed")')"
fresh good.json "$ITEM_USER"
cp "$DIR/state.json" "$T/before.json"
chat "Decision: broken again, with a hand-edited state.json present." > /dev/null; settle
check "malformed: existing state.json unchanged byte for byte" "$(cmp -s "$DIR/state.json" "$T/before.json" && echo true)"

echo "== 4. a proposal whose quote is not in the turn is dropped"
refake 5773 morrow-x --extract=badquote
fresh good.json
M=$(mcount); chat "Decision: first one gets a bad quote. Task: second one is fine." > /dev/null; settle
check "badquote: only task-1 written (the decision with the invented quote is dropped)" "$(items | q 'x.items.map(i=>i.id).join()==="task-1"')"
check "badquote: extract_drop reason quote logged" "$(since $M | qa 'x.some(e=>e.event==="extract_drop"&&e.reason==="quote"&&e.kind==="decision")')"
chat "Quote check ignores case and whitespace." > /dev/null; settle
refake 5773 morrow-x
chat "decision:   KEEP   spacing   weird." > /dev/null; settle
check "quote match normalises whitespace and case (fake quotes the sentence verbatim)" "$(items | q 'x.items.some(i=>i.kind==="decision"&&/KEEP/.test(i.text))')"

echo "== 5. never more than 3 proposals per turn"
refake 5773 morrow-x --extract=many
fresh good.json
M=$(mcount); chat "Decision: one. Decision: two two. Decision: three. Decision: four four. Decision: five." > /dev/null; settle
check "many: 5 items violate the closed schema (maxItems 3) -> nothing written (fail closed)" "$( [ ! -f "$DIR/state.json" ] && echo true)"
check "many: extract_error reason schema, '5 items, at most 3'" "$(since $M | qa 'x.some(e=>e.event==="extract_error"&&e.reason==="schema"&&/5 items, at most 3/.test(e.error))')"
refake 5773 morrow-x
fresh max2.json
M=$(mcount); chat "Decision: alpha plan. Decision: beta plan. Decision: gamma plan." > /dev/null; settle
check "maxItems 2 in the config: 3 valid items -> 2 written, 1 dropped as maxItems" "$(items | q 'x.items.length===2' | grep -q true && since $M | qa 'x.filter(e=>e.event==="extract_drop"&&e.reason==="maxItems").length===1')"
check "no extract event in this run ever proposed more than 3" "$(cat "$DIR/metrics.jsonl" | qa 'x.filter(e=>e.event==="extract").every(e=>e.proposed<=3)')"

echo "== 6. near-duplicates are dropped (of state.json and within the batch); rejected items do not block"
refake 5773 morrow-x --extract=dupes
fresh good.json "$ITEM_USER"
# This legacy fake derives its duplicate from the prompt; explicitly authorize that board access.
cmd "/context share board on" > /dev/null
M=$(mcount); chat "Decision: we send it by registered mail." > /dev/null; settle
check "dupes: only the first of 'X' / 'X!' (capitals) / 'the <dec-1 title>' is written (dec-2)" "$(items | q 'x.items.length===3 && x.items[2].id==="dec-2" && x.items[2].text==="we send it by registered mail"')"
check "dupes: two extract_drop duplicate events (one of dec-1, one within the batch)" "$(since $M | qa 'x.filter(e=>e.event==="extract_drop"&&e.reason==="duplicate").length===2 && x.some(e=>e.reason==="duplicate"&&e.of==="dec-1")')"
check "hand-edited fields survive the write (_notes, item note), rev bumped 3 -> 4" "$(items | q 'x.rev===4 && x._notes[0]==="hand-edited" && x.items[0].note==="mine"')"
refake 5773 morrow-x
chat "Task: next one please." > /dev/null; settle
check "ids continue after hand-added ones (task-7 exists -> the next task is task-8)" "$(items | q 'x.items.some(i=>i.id==="task-8")')"
decide dec-2 reject > /dev/null
chat "Decision: we send it by registered mail." > /dev/null; settle
check "a near-duplicate of a REJECTED item is not blocked (proposed again as dec-3)" "$(items | q 'x.items.some(i=>i.id==="dec-3"&&i.status==="proposed")')"

echo "== 7. c confirms, r rejects (POST /answer {itemId, decision}): recorded with time and author"
R0=$(items | q 'x.rev')
OUT=$(decide dec-3 c)
check "confirm: 200, status confirmed, decidedAt, decidedBy user" "$(echo "$OUT" | tail -1 | grep -q 200 && items | q '(i=>i.status==="confirmed" && !isNaN(Date.parse(i.decidedAt)) && i.decidedBy==="user")(x.items.find(i=>i.id==="dec-3"))')"
check "confirm: rev bumped, system line 'dec-3 confirmed: ...', decide metric with author model" "$(all "$(items | q 'x.rev==='$((R0+1)))" "$(tail -1 "$DIR/transcript.jsonl" | q 'x.role==="system"&&/^dec-3 confirmed: /.test(x.text)')" "$(tail -1 "$DIR/metrics.jsonl" | q 'x.event==="decide"&&x.decision==="confirmed"&&x.author==="model"&&x.decidedBy==="user"')")"
check "reject task-8 (word 'reject'): status rejected, decidedBy user" "$(decide task-8 reject > /dev/null; items | q '(i=>i.status==="rejected" && i.decidedBy==="user" && !!i.decidedAt)(x.items.find(i=>i.id==="task-8"))')"
check "deciding again -> 409; unknown id -> 404; bad decision -> 400" "$( [ "$(decide dec-3 r | tail -1)$(decide nope-1 c | tail -1)$(decide task-7 maybe | tail -1)" = "409404400" ] && echo true)"
check "a hand-added proposal (author user) can be decided too" "$(decide task-7 c | tail -1 | grep -q 200 && echo true)"

echo "== 8. broken hand edit of state.json: reported, never overwritten"
fresh good.json '{"rev": 2, "items": [ oops'
cp "$DIR/state.json" "$T/broken.json"
M=$(mcount); chat "Decision: this must not overwrite the broken file." > /dev/null; settle
check "broken state.json: file unchanged, extract_error reason state" "$(cmp -s "$DIR/state.json" "$T/broken.json" && since $M | qa 'x.some(e=>e.event==="extract_error"&&e.reason==="state")')"
check "broken state.json: /state reports stateError, chat still works, decide -> 409" "$(state | q '!!x.stateError && x.items.length===0' | grep -q true && tail -1 "$DIR/transcript.jsonl" | q 'x.role==="assistant"' | grep -q true && decide dec-1 c | tail -1 | grep -q 409 && echo true)"

echo "== 9. everyNTurns 2: extraction on every second complete reply only"
fresh every2.json
M=$(mcount); chat "Decision: turn one." > /dev/null; settle
check "everyNTurns 2: no extract call after reply 1" "$(since $M | qa '!x.some(e=>e.role==="extract")')"
chat "Decision: turn two." > /dev/null; settle
check "everyNTurns 2: extract call after reply 2 (dec-1 = turn two)" "$(since $M | qa 'x.filter(e=>e.event==="model_call"&&e.role==="extract").length===1' | grep -q true && items | q 'x.items.length===1 && x.items[0].text==="turn two"')"

echo "== 10. the extract role follows the v0.3 rules (pins, local->cloud block, stall)"
unfake 5773
fresh exfallback.json
M=$(mcount); chat "Decision: morrow-x is down." > /dev/null; settle
check "local extract candidate down: fallback to frontier blocked (logged, system line), frontier not asked to extract" "$(since $M | qa 'x.some(e=>e.event==="fallback_blocked"&&e.role==="extract"&&e.from==="morrow"&&e.to==="frontier") && !x.some(e=>e.role==="extract"&&e.candidate==="frontier")' | grep -q true && grep -q 'fallback to frontier blocked: morrow is local' "$DIR/transcript.jsonl" && ! grep -q '^\[extract\]' "$T/fake-5771.log" && echo true)"
check "blocked: nothing written, extract_error reason model" "$( [ ! -f "$DIR/state.json" ] && since $M | qa 'x.some(e=>e.event==="extract_error"&&e.reason==="model")')"
check "the chat reply itself was unaffected" "$(grep '"role":"assistant"' "$DIR/transcript.jsonl" | tail -1 | q 'x.model==="frontier"')"
fresh exfallback-allow.json
chat "Decision: cloud extraction allowed now." > /dev/null; settle
check "allowCloudFallback on extract: frontier extracts, item records model frontier" "$(items | q 'x.items.length===1 && x.items[0].model==="frontier"')"
fake 5773 morrow-x
fresh exfallback.json
check "/model extract frontier pins the role" "$(all "$(cmd '/model extract frontier' | q 'x.ok')" "$(state | q 'x.models.extract.pinned && x.models.extract.active==="frontier"')")"
chat "Decision: pinned extraction goes to frontier." > /dev/null; settle
check "pinned extract: frontier answered although morrow-x is up" "$(items | q 'x.items.length===1 && x.items[0].model==="frontier"')"
refake 5773 morrow-x --stall-after=2
fresh stall.json
M=$(mcount); S0=$(now); chat "Decision: the extractor stalls." > /dev/null; S1=$(now); settle
check "extract stall (stallMs 1000): stall metric role extract, extract_error reason stall, nothing written" "$(since $M | qa 'x.some(e=>e.event==="stall"&&e.role==="extract") && x.some(e=>e.event==="extract_error"&&e.reason==="stall")' | grep -q true && [ ! -f "$DIR/state.json" ] && echo true)"
check "extract stall did not delay the chat reply ($((S1-S0)) ms)" "$( [ $((S1-S0)) -lt 2500 ] && echo true)"
refake 5773 morrow-x

echo "== 11. consent for map/kanban: counts proposed + confirmed, not rejected; no pane without an answer"
fresh good.json
node -e 'const f=process.argv[1],fs=require("fs"),r=JSON.parse(fs.readFileSync(f));r.rules.find(x=>x.module==="map").threshold=2;r.rules.find(x=>x.module==="kanban").threshold=2;fs.writeFileSync(f,JSON.stringify(r,null,2))' "$DIR/rules.json"
chat "Decision: one decision only." > /dev/null; settle
check "1 decision, threshold 2: no question" "$(state | q 'x.pending===null')"
chat "Decision: a second decision." > /dev/null; settle
check "2 decisions (proposed): controller asks for the map after the extraction" "$(all "$(state | q 'x.pending==="map"')" "$(grep '"role":"controller"' "$DIR/transcript.jsonl" | tail -1 | q '/^2 decisions so far/.test(x.text)')")"
check "no map pane before the answer" "$(state | q 'x.panes.length===0')"
answer map y > /dev/null
check "y -> map pane, answer count = 2 decisions (the rule's metric)" "$(all "$(state | q 'x.panes.includes("map")')" "$(cat "$DIR/modules.json" | q 'x.answers.map.count===2 && x.answers.map.answer==="yes"')")"
chat "Task: first task. Task: second task." > /dev/null; settle
check "2 tasks: kanban asked" "$(state | q 'x.pending==="kanban"')"
answer kanban n > /dev/null
check "n recorded with count 2 (tasks, not messages)" "$(cat "$DIR/modules.json" | q 'x.answers.kanban.answer==="no" && x.answers.kanban.count===2')"
chat "Task: third task." > /dev/null; settle
check "3 tasks after no at 2: not asked yet" "$(state | q 'x.pending===null')"
chat "Task: fourth task." > /dev/null; settle
check "4 tasks (doubled): asked again" "$(state | q 'x.pending==="kanban"')"
answer kanban x > /dev/null
decide task-1 r > /dev/null; decide task-2 r > /dev/null
check "rejected items are not counted (/rules: tasks 2 after rejecting 2 of 4)" "$(cmd '/rules' | q 'x.lines.some(l=>/^kanban: tasks 2 \//.test(l)) && x.lines.some(l=>/^map: decisions 2 \//.test(l))')"
check "/rules no longer says 'not built yet' for map/kanban" "$(cmd '/rules' | q '!x.lines.some(l=>/not built/.test(l))')"

echo "== 12. page: dashed proposals, c/r keys, buttons, toggle, pickup without reload (headless Chrome)"
stop_server; unfake 5771; unfake 5772; unfake 5773
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v04 | tee "$T/browser.log"
  check "browser checks (v04) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
check "contrast-check.js still passes with the item styles" "$( [ $RC -eq 0 ] && echo true)"

echo "== 13. demo v0.4 starts within 30 s and shows a proposal after one message (ports +200, dir $T/.pilot-demo-verify04)"
PILOT_FIXTURE_ROOT="$T" DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR="$T/.pilot-demo-verify04" node scripts/demo.js v0.4 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -H 'x-pilot: 1' -s -m 1 localhost:4954/state > "$T/demo-state.json" 2>/dev/null && [ -s "$T/demo-state.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s" "$( [ -n "$UP" ] && echo true)"
check "demo state: map pane shown, dec-2 proposed, nothing pending" "$(q 'x.panes.includes("map") && x.items.some(i=>i.id==="dec-2"&&i.status==="proposed") && x.pending===null' < "$T/demo-state.json")"
P0=$(now)
curl -H 'x-pilot: 1' -sN -X POST localhost:4954/chat -H 'content-type: application/json' -d '{"text":"Decision: we send the letter by registered mail. Task: draft the letter tonight."}' > /dev/null
for i in $(seq 1 50); do curl -H 'x-pilot: 1' -s localhost:4954/state > "$T/demo-state.json"; [ "$(q 'x.extracting' < "$T/demo-state.json")" = "false" ] && break; sleep 0.1; done
echo "   proposal after $(( $(now) - P0 )) ms"
check "demo: one message -> dashed dec-4 + task-3 proposed, kanban question pending" "$(q 'x.items.some(i=>i.id==="dec-4"&&i.status==="proposed") && x.items.some(i=>i.id==="task-3"&&i.status==="proposed") && x.pending==="kanban"' < "$T/demo-state.json")"
check "demo printed URL and try-this lines" "$(grep -q 'http://127.0.0.1:4954' "$T/demo.log" && grep -qi 'try this' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null
sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 59(54|55)' > /dev/null && ! lsof -iTCP:4954 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.4 CHECKS PASSED" || echo "$FAILS v0.4 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
