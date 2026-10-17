#!/bin/bash
# DEV ONLY. pilot-v0.8 checks: panes can go. Fading after fadeAfterTurns untouched turns, never the chat, never a pane
# holding a proposal; touches (POST /touch, decisions) and their once-per-turn rule; the removal question once per pane,
# answered like any consent (y/n/x, no always), and what each answer does to growth; /why explains fading with sources
# (dev/why-cites.js); the page (browser-check.js v08); the v0.8 demo. Against dev/fake-model.js only. Own ports
# (server 4810, fakes 5811/5812; browser part 4815/5816/5817 + Chrome 9393; demo part shifted +200: 4972/5972/5973)
# and own dirs (.pilot-verify-v08/, .pilot-verify-v08c/, .pilot-verify-v08b/, .pilot-demo-verify08/), so it never
# touches .pilot/ or a running demo. Usage (from anywhere): bash pilot/app/dev/verify-v0.8.sh
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); PIDS=(); SERVER=""
DIR=.pilot-verify-v08; C=.pilot-verify-v08c
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; rm -rf "$T" "$DIR" "$C" .pilot-demo-verify08; }
trap cleanup EXIT
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
node -e '
  const c=require("./pilot.config.dev.json"); c.port=4810;
  for (const k of c.roles.chat.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5811/").replace(":5702/",":5812/");
  c.roles.extract.candidates[0].baseUrl="http://127.0.0.1:5812/v1";
  require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$T/conf.json"
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
server() { PILOT_DIR=$1 PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -s -m 1 localhost:4810/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
chat() { curl -sN -X POST localhost:4810/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}" > /dev/null; settle; }
why() { curl -s -X POST localhost:4810/command -H 'content-type: application/json' -d "{\"text\":\"/why $1\"}" | q 'x.lines.join("\n")'; }
cmd() { curl -s -X POST localhost:4810/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}" | q 'x.lines.join("\n")'; }
post() { curl -s -w '\n%{http_code}' -X POST "localhost:4810/$1" -H 'content-type: application/json' -d "$2"; }
state() { curl -s "localhost:4810/state${1:-}"; }
settle() { for i in $(seq 1 100); do [ "$(state | q 'x.extracting')" = "false" ] && return; sleep 0.1; done; }
has() { grep -qE -- "$1" <<< "$2"; }   # status only; a check ends its chain with && echo true
ev() { qa "$1" < "$2/metrics.jsonl"; }   # an expression over the metrics events x
mo() { q "$1" < "$2/modules.json"; }     # an expression over modules.json x
editjs() { node -e "const f=process.argv[1],fs=require('fs'),s=JSON.parse(fs.readFileSync(f,'utf8'));$2;fs.writeFileSync(f,JSON.stringify(s,null,2))" "$3/$1"; }

fake 5811 frontier; fake 5812 morrow; sleep 0.3

echo "== 1. the v0.8 fixture (copy in $C): the map fades after one message, the kanban removal question is due"
rm -rf $C; mkdir $C
for f in demo/fixtures/v0.8/*; do case $(basename $f) in demo.json|pilot.config.json) ;; *) cp $f $C/ ;; esac; done
server $C
check "before: kanban is a tab (faded at turn 30), map and index shown, turn 37" "$(state | q 'x.faded.join()==="kanban" && x.panes.join()==="map,index,kanban" && x.turn===37 && x.paneInfo.kanban.fade.fadedTurn===30 && !x.paneInfo.map.fade.faded')"
W=$(why map)
check "/why map before: last touch click at turn 30, 7 turns since, fades after turn 38 if nobody touches it" "$(has '^  last touch: click at 2026-10-17T08:55:02.000Z \(turn 30\)  \[modules.json:[0-9]+ panes map; metrics.jsonl:[0-9]+ pane_touch map\]$' "$W" && has '^  turns since: 7 \(now turn 37' "$W" && has 'threshold: fades after 8 untouched turns \(the default\); fades after turn 38 if nobody touches it  \[rules.json:[0-9]+ fadeAfterTurns\]$' "$W" && echo true)"
chat "what is left for Monday?"
S=$(state)
check "after one message: the map faded (untouched 8 turns), it is still in modules.json with state faded" "$(q 'x.faded.join()==="map,kanban" && x.panes.includes("map")' <<< "$S" | grep -q true && mo 'x.panes.find(p=>p.module==="map").state==="faded" && x.panes.find(p=>p.module==="map").fadedTurn===38' $C)"
check "... logged pane_fade map (idle 8, fadeAfterTurns 8, last touch turn 30) and said so in a controller line" "$(ev 'x.some(e=>e.event==="pane_fade"&&e.module==="map"&&e.idle===8&&e.fadeAfterTurns===8&&e.lastTouchTurn===30&&!e.fixture)' $C | grep -q true && qa 'x.some(l=>l.role==="controller"&&l.pane==="map"&&/map pane faded to a tab: untouched for 8 turns/.test(l.text))' < $C/transcript.jsonl)"
check "... and asks once: \"Remove the kanban pane?\" (pending kanban, pendingKind remove, controller_ask question remove)" "$(q 'x.pending==="kanban" && x.pendingKind==="remove"' <<< "$S" | grep -q true && ev 'x.filter(e=>e.event==="controller_ask"&&e.question==="remove"&&e.module==="kanban"&&e.fadedFor===8&&e.askRemoveAfterTurns===8).length===1' $C | grep -q true && qa 'x.some(l=>l.role==="controller"&&l.module==="kanban"&&l.question==="remove"&&/Remove the kanban pane\?/.test(l.text))' < $C/transcript.jsonl)"
W=$(why map)
check "/why map after: faded to a tab at turn 38, the pane_fade line, 8 turns since, threshold 8, removal question at turn 46" "$(has '^  faded to a tab at .* \(turn 38\), a tab for 0 turns now; it stays in modules.json' "$W" && has 'metrics.jsonl:[0-9]+ pane_fade map' "$W" && has '^  turns since: 8 \(now turn 38' "$W" && has '^  removal question after 8 turns as a tab \(the default\): at turn 46; only your answer removes a pane' "$W" && echo true)"
check "/why: panes line marks the tabs" "$(has '^  panes: chat \+ index \+ map \(tab\) \+ kanban \(tab\) \(chat is always there and never fades\)' "$(why "")" && echo true)"
OUT=$(post answer '{"module":"kanban","answer":"a"}')
check "the removal question refuses a (always): 400, still pending" "$(echo "$OUT" | tail -1 | grep -qx 400 && has 'takes y/n/x' "$OUT" && mo 'x.pending==="kanban"' $C)"
post answer '{"module":"kanban","answer":"n"}' > /dev/null
check "n keeps the kanban as a tab and is recorded like any consent (removals.kanban, consent question remove with id)" "$(mo 'x.removals.kanban.answer==="no" && x.panes.find(p=>p.module==="kanban").state==="faded" && !x.pending && x.answers.kanban.answer==="always"' $C | grep -q true && ev 'x.some(e=>e.event==="consent"&&e.question==="remove"&&e.module==="kanban"&&e.answer==="no"&&e.id)' $C)"
chat "and the envelope?"; chat "and the stamps?"
check "after n the question is not asked again (once per pane)" "$(ev 'x.filter(e=>e.event==="controller_ask"&&e.question==="remove"&&e.module==="kanban").length===1' $C)"
W=$(why kanban)
check "/why kanban: the removal question and your no, with sources" "$(has 'asked at .* \(turn 38\) whether to remove it: a tab for 8 turns, askRemoveAfterTurns 8' "$W" && has 'you answered "no" to removing it at' "$W" && has '^  removal question already asked for this pane \(asked once per pane\); your answer: "no"' "$W" && has 'modules.json:[0-9]+ removals.kanban' "$W" && echo true)"
check "/stats Consent still passes (removal answers are not growth answers)" "$(has '^consent +PASS' "$(cmd /stats)" && echo true)"
node dev/why-cites.js http://127.0.0.1:4810 $C > $T/cites1.txt; RC=$?
check "every source cited by /why, every pane and every item resolves ($(tail -1 $T/cites1.txt))" "$( [ $RC -eq 0 ] && echo true)"
[ $RC -ne 0 ] && head -20 $T/cites1.txt
stop_server

echo "== 2. live data: touches, the proposal guard, removal yes/never and growth afterwards"
rm -rf $DIR; mkdir -p $DIR
node -e 'const f=process.argv[1],r=require("./rules.example.json");r.rules.find(x=>x.module==="index").threshold=2;r.rules.find(x=>x.module==="map").threshold=1;r.fadeAfterTurns=3;r.askRemoveAfterTurns=2;r.rules.find(x=>x.module==="map").fadeAfterTurns=4;require("fs").writeFileSync(f,JSON.stringify(r,null,2))' "$DIR/rules.json"
server $DIR
chat "Decision: keep the claim local."
post answer '{"module":"index","answer":"a"}' > /dev/null
chat "hello"
post answer '{"module":"map","answer":"y"}' > /dev/null
check "setup: index (always) and map (yes) added; each pane starts with lastTouch how added" "$(mo 'x.panes.length===2 && x.panes.every(p=>p.lastTouch&&p.lastTouch.how==="added")' $DIR)"
OUT=$(post touch '{"module":"chat","how":"click"}'); O2=$(post touch '{"module":"index","how":"poke"}'); O3=$(post touch '{"module":"kanban","how":"click"}')
check "POST /touch: chat 400 (never fades), unknown how 400, a pane that is not shown 404" "$(echo "$OUT" | tail -1 | grep -qx 400 && has 'never fades' "$OUT" && echo "$O2" | tail -1 | grep -qx 400 && echo "$O3" | tail -1 | grep -qx 404 && echo true)"
R0=$(mo 'x.rev' $DIR)
post touch '{"module":"index","how":"click"}' > /dev/null; R1=$(mo 'x.rev' $DIR)
OUT=$(post touch '{"module":"index","how":"scroll"}'); R2=$(mo 'x.rev' $DIR)
check "a touch moves lastTouch and logs pane_touch; a second touch in the same turn writes nothing (changed false, rev $R1 kept)" "$( [ $R1 -eq $((R0+1)) ] && [ $R2 -eq $R1 ] && has '"changed":false' "$OUT" && ev 'x.filter(e=>e.event==="pane_touch"&&e.module==="index").length===1' $DIR | grep -q true && mo 'x.panes.find(p=>p.module==="index").lastTouch.how==="click"' $DIR)"
for i in 1 2 3 4 5 6; do chat "turn $i"; done
check "dec-1 is an unanswered proposal on the map" "$(q 'x.items.some(i=>i.id==="dec-1"&&i.status==="proposed")' < <(state))"
check "the index faded after 3 untouched turns (default); the map, holding dec-1, never faded (its own fadeAfterTurns 4 long passed)" "$(state | q 'x.faded.join()==="index" && x.paneInfo.map.fade.idle>=6 && x.paneInfo.map.fade.fadeAfter===4 && x.paneInfo.map.fade.holds.join()==="dec-1"' | grep -q true && ev '!x.some(e=>e.event==="pane_fade"&&e.module==="map")' $DIR)"
check "/why map says why it does not fade: it holds dec-1, a tab would hide a decision; the per-rule threshold is cited" "$(W=$(why map); has 'threshold: fades after 4 untouched turns \(this rule\), but it holds an unanswered proposal \(dec-1\), so it does not fade: a tab would hide a decision  \[rules.json:[0-9]+ fadeAfterTurns map; state.json:[0-9]+ items dec-1\]$' "$W" && echo true)"
check "the removal question for the index came after 2 turns as a tab" "$(state | q 'x.pending==="index" && x.pendingKind==="remove"')"
post touch '{"module":"index","how":"tab"}' > /dev/null
check "a touch on the tab brings the index back and withdraws its open removal question (system line, controller_withdraw)" "$(state | q '!x.faded.length && !x.pending' | grep -q true && ev 'x.some(e=>e.event==="controller_withdraw"&&e.module==="index")' $DIR | grep -q true && qa 'x.some(l=>l.role==="system"&&/remove index: question withdrawn, you used the pane/.test(l.text))' < $DIR/transcript.jsonl)"
T0=$(state | q 'x.turn')
post answer '{"itemId":"dec-1","decision":"c"}' > /dev/null
check "confirming dec-1 is a touch of the map (pane_touch how decide at turn $T0)" "$(ev "x.some(e=>e.event===\"pane_touch\"&&e.module===\"map\"&&e.how===\"decide\"&&e.turn===$T0)" $DIR | grep -q true && mo 'x.panes.find(p=>p.module==="map").lastTouch.how==="decide"' $DIR)"
for i in 1 2 3 4; do chat "quiet $i"; done
check "4 turns later the map fades (its rule's fadeAfterTurns 4), and so does the index again (3)" "$(state | q 'x.faded.slice().sort().join()==="index,map"')"
editjs state.json 's.items.push({id:"dec-9",kind:"decision",text:"a proposal written into the file",status:"proposed",author:"model",model:"morrow",createdAt:"2026-10-17T09:00:00.000Z"})' $DIR; sleep 0.4
chat "after the hand edit"
check "a proposal arriving in a faded map brings the map back (pane_unfade reason proposal, not a touch, controller line)" "$(state | q '!x.faded.includes("map")' | grep -q true && ev 'x.some(e=>e.event==="pane_unfade"&&e.module==="map"&&e.reason==="proposal"&&e.holds.includes("dec-9"))' $DIR | grep -q true && ev '!x.some(e=>e.event==="pane_touch"&&e.module==="map"&&e.unfaded)' $DIR | grep -q true && qa 'x.some(l=>l.role==="controller"&&l.pane==="map"&&/holds a proposal \(dec-9\)/.test(l.text))' < $DIR/transcript.jsonl)"
# the index: fade -> removal question -> yes
for i in 1 2 3 4 5; do [ "$(mo 'x.pending' $DIR)" = "index" ] && break; chat "wait $i"; done
check "a withdrawn question does not count as asked: the index faded again and, 2 turns later, is asked again" "$(mo 'x.pending==="index" && x.pendingKind==="remove" && x.panes.find(p=>p.module==="index").removalAsked===true' $DIR | grep -q true && ev 'x.filter(e=>e.event==="controller_ask"&&e.question==="remove"&&e.module==="index").length===2' $DIR)"
post answer '{"module":"index","answer":"n"}' > /dev/null
for i in 1 2 3; do chat "after no $i"; done
check "an answered question is not asked again (once per pane): after n, three more turns, still 2 asks" "$(ev 'x.filter(e=>e.event==="controller_ask"&&e.question==="remove"&&e.module==="index").length===2' $DIR)"
stop_server

echo "== 3. removal yes and never, and what growth does afterwards (fresh dir)"
rm -rf $DIR; mkdir -p $DIR
node -e 'const f=process.argv[1],r=require("./rules.example.json");r.rules.find(x=>x.module==="index").threshold=2;r.fadeAfterTurns=1;r.askRemoveAfterTurns=1;require("fs").writeFileSync(f,JSON.stringify(r,null,2))' "$DIR/rules.json"
server $DIR
chat "one"
post answer '{"module":"index","answer":"a"}' > /dev/null
chat "two"; chat "three"
check "index faded after 1 untouched turn, removal question after 1 turn as a tab" "$(state | q 'x.faded.join()==="index" && x.pending==="index" && x.pendingKind==="remove"')"
post answer '{"module":"index","answer":"y"}' > /dev/null
N=$(mo 'x.removals.index.count' $DIR)
check "y removes the pane (not in modules.json panes, removals.index yes, pane_remove with answerRef = the consent id)" "$(mo '!x.panes.length && x.removals.index.answer==="yes"' $DIR | grep -q true && ev 'x.some(e=>e.event==="pane_remove"&&e.module==="index"&&x.some(c=>c.event==="consent"&&c.question==="remove"&&c.id===e.answerRef&&c.answer==="yes"))' $DIR)"
chat "four"
check "after removal the old \"always\" does not re-add it, and the rule does not ask before the count doubles ($N messages at removal)" "$(mo '!x.panes.length && !x.pending' $DIR)"
for i in $(seq 1 $(( N / 2 + 1 ))); do [ "$(mo 'x.pending' $DIR)" = "index" ] && break; chat "more $i"; done
M=$(state | q 'x.transcript.filter(l=>l.role==="user"||l.role==="assistant").length')
check "the rule asks again once the count doubled ($M ≥ 2 × $N): a growth question, not an automatic add" "$(mo 'x.pending==="index" && !x.pendingKind && !x.panes.length' $DIR | grep -q true && [ "$M" -ge $((2*N)) ] && echo true)"
check "/why index while removed: removed with your answer yes, its rule is asking again" "$(has 'index not shown: removed, you said yes to removing it .*; its rule is asking again now' "$(why "")" && echo true)"
post answer '{"module":"index","answer":"y"}' > /dev/null
check "yes adds a new index pane (a new pane: no removalAsked)" "$(mo 'x.panes.length===1 && !x.panes[0].removalAsked' $DIR)"
chat "five"; chat "six"
check "the new pane fades and is offered for removal again (once per pane, this is a new one)" "$(mo 'x.pending==="index" && x.pendingKind==="remove"' $DIR)"
post answer '{"module":"index","answer":"x"}' > /dev/null
N=$(mo 'x.removals.index.count' $DIR)
for i in $(seq 1 $(( N / 2 + 3 ))); do chat "later $i"; done
check "x removes it for good: no growth question even after the count more than doubled" "$(mo '!x.panes.length && !x.pending && x.removals.index.answer==="never"' $DIR | grep -q true && ev 'x.filter(e=>e.event==="controller_ask"&&e.module==="index"&&!e.question).length===2' $DIR)"
check "no pane ever left modules.json without a removal consent yes/never (every pane_remove has one)" "$(ev 'x.filter(e=>e.event==="pane_remove").length===2 && x.filter(e=>e.event==="pane_remove").every(e=>x.some(c=>c.event==="consent"&&c.question==="remove"&&c.id===e.answerRef&&["yes","never"].includes(c.answer)))' $DIR)"
check "/rules and /panes show the removal" "$(has 'index: messages [0-9]+ / 2  \(removed \(never\)\)' "$(cmd /rules)" && has '^remove index: never' "$(cmd /panes)" && echo true)"
node dev/why-cites.js http://127.0.0.1:4810 $DIR > $T/cites2.txt; RC=$?
check "every source cited on live data resolves ($(tail -1 $T/cites2.txt))" "$( [ $RC -eq 0 ] && echo true)"
[ $RC -ne 0 ] && head -20 $T/cites2.txt
editjs rules.json 'delete s.fadeAfterTurns' $DIR
check "without fadeAfterTurns fading is off and /why says so" "$(state | q 'Object.values(x.paneInfo).every(p=>!p.fade||p.fade.fadeAfter===null)' | grep -q true && echo true)"
stop_server

echo "== 4. page (headless Chrome): tabs, bring-back, touches, the removal question"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v08 | tee "$T/browser.log"
  check "browser checks (v08) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
check "contrast-check.js passes (the tab reuses the checked pane-title and meta pairs)" "$( [ $RC -eq 0 ] && echo true)"

echo "== 5. demo v0.8 within 30 s (ports +200, dir .pilot-demo-verify08)"
DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR=.pilot-demo-verify08 node scripts/demo.js v0.8 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 localhost:4972/state > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s: kanban a tab, map and index shown" "$( [ -n "$UP" ] && q 'x.faded.join()==="kanban" && x.panes.join()==="map,index,kanban"' < "$T/ds.json")"
curl -sN -X POST localhost:4972/chat -H 'content-type: application/json' -d '{"text":"what is left for Monday?"}' > /dev/null; sleep 0.5
check "demo: one message fades the map and asks to remove the kanban" "$(curl -s localhost:4972/state | q 'x.faded.join()==="map,kanban" && x.pending==="kanban" && x.pendingKind==="remove"')"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
check "try lines: the tab, /why map, the message that fades the map and the removal question, clicking a tab" "$(grep -q 'slim "kanban" tab' "$T/demo.log" && grep -q '/why map' "$T/demo.log" && grep -q 'Remove the kanban pane' "$T/demo.log" && grep -q 'Click the map tab' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 59(72|73)' > /dev/null && ! lsof -iTCP:4972 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.8 CHECKS PASSED" || echo "$FAILS v0.8 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
