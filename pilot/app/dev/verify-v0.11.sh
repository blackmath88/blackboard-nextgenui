#!/bin/bash
# DEV ONLY. pilot-v0.11 checks: the kanban with drag and drop. The order rule (public/board.js, a node table), the
# schema copy, POST /move (column/order/movedBy/movedAt written on that task only, rev bump, stale 409, a proposed task
# stays proposed, a rejected one is refused, bad input, a broken file, no kanban shown), the metrics (item_move,
# item_write via move, a kanban touch, no file_edit for the server's own write), hand edits of column/order (live, "you
# (file edit)"), an applied kanban frame reset by a move (also with the experiment off; a broken frames.json never
# blocks a move), SSE to a second client, /why task-N with every source resolved, /stats unchanged, the page
# (browser-check.js v11: real mouse drags, Alt+arrows, touch, a second tab), the v0.11 demo.
# Against dev/fake-model.js only. Own ports (server 4840, fakes 5841/5842; browser part 4845/5846/5847 + Chrome 9423;
# demo part shifted +300: 5082/6088/6089) and own dirs (.pilot-verify-v11/, .pilot-verify-v11b/, .pilot-demo-verify11/),
# so it never touches .pilot/ or a running demo.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.11.sh
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); PIDS=(); SERVER=""
DIR=.pilot-verify-v11
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; rm -rf "$T" "$DIR" .pilot-demo-verify11; }
trap cleanup EXIT
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
server() { PILOT_DIR=$DIR PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -s -m 1 localhost:4840/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
cmd() { curl -s -X POST localhost:4840/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
lines() { cmd "$1" | q 'x.lines.join("\n")'; }
mv() { curl -s -w '\n%{http_code}' -X POST localhost:4840/move -H 'content-type: application/json' -d "$1"; }
code() { mv "$1" | tail -1; }
body() { mv "$1" | head -1; }
st() { curl -s "localhost:4840/state${1:-}"; }
ev() { qa "$1" < "$DIR/metrics.jsonl"; }
item() { node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1]));const i=s.items.find(i=>i.id===process.argv[2]);console.log(String((x=>eval(process.argv[3]))(i)))' "$DIR/state.json" "$1" "$2"; }
rev() { q 'x.rev' < "$DIR/state.json"; }
has() { grep -qE -- "$1" <<< "$2"; }
nev() { grep -c "\"event\":\"$1\"" "$DIR/metrics.jsonl" 2>/dev/null || true; }
edit() { node -e 'const f=process.argv[1],fs=require("fs"),x=JSON.parse(fs.readFileSync(f));(new Function("x",process.argv[2]))(x);fs.writeFileSync(f,JSON.stringify(x,null,2))' "$DIR/$1" "$2"; sleep 0.3; }
seed() { rm -rf $DIR; mkdir $DIR; for f in transcript.jsonl metrics.jsonl state.json modules.json rules.json; do cp demo/fixtures/v0.11/$f $DIR/; done; }

echo "== 1. the order rule (public/board.js, shared by the page and the server; no server)"
node -e '
  const B = require("./public/board.js");
  const T = (id, column, extra = {}) => ({ id, kind: "task", text: id, status: "confirmed", column, ...extra });
  let bad = 0; const ok = (name, c) => { if (!c) bad++; console.log(`   ${c ? "ok " : "BAD"} ${name}`); };
  const ids = (a) => a.map((i) => i.id).join(",");
  const items = [T("a", "todo"), { id: "d", kind: "decision", text: "d" }, T("b", "todo"), T("c", "doing"), T("r", "todo", { status: "rejected" }), T("e", undefined)];
  ok("no order anywhere: file order (exactly the board before v0.11); a task without a column is in todo", ids(B.column(items, "todo")) === "a,b,e");
  ok("rejected tasks are not on the board, decisions never", !B.column(items, "todo").some((i) => i.id === "r" || i.id === "d"));
  let p = B.place(items, items[0], "todo", 2);
  ok(`a to the end of todo: after e (file position 5) -> order 6 (got ${p.order})`, p.order === 6 && p.index === 2 && p.neighbours.join() === "e,");
  p = B.place(items, items[5], "todo", 0);
  ok(`e to the top of todo: before a (0) -> -1 (got ${p.order})`, p.order === -1);
  p = B.place(items, items[5], "todo", 1);
  ok(`e between a (0) and b (2) -> 1 (got ${p.order})`, p.order === 1 && p.neighbours.join() === "a,b");
  p = B.place(items, items[0], "done", 0);
  ok(`a into the empty done: its own file position 0 (got ${p.order})`, p.order === 0 && p.neighbours.join() === ",");
  p = B.place(items, items[0], "doing", 99);
  ok("an index past the end is clamped to the end", p.index === 1 && p.order === 4);
  const mixed = [T("x", "todo", { order: 10 }), T("y", "todo"), T("z", "todo", { order: 0.5 })];
  ok("order and file position mix: z (0.5), y (file 1), x (10)", ids(B.column(mixed, "todo")) === "z,y,x");
  ok("indexOf gives the place in the column; null for a rejected task", B.indexOf(mixed, mixed[0]) === 2 && B.indexOf(items, items[4]) === null);
  const tie = [T("p", "todo", { order: 1 }), T("q", "todo", { order: 1 })];
  ok("ties keep file order", ids(B.column(tie, "todo")) === "p,q");
  console.log(bad ? "BAD " + bad : "TABLE OK");' > "$T/table.txt"
cat "$T/table.txt"
check "every order-rule case gives the documented result" "$(grep -q '^TABLE OK' $T/table.txt && echo true)"

echo "== 2. the schema copy (pilot/app/schemas, never the original under pilot/cli-pilot-v1)"
check "state.schema.json (app copy) has order (number), movedBy (enum user), movedAt (date-time); additionalProperties stays false" "$(node -e 'const s=require("./schemas/state.schema.json"),p=s.properties.items.items;console.log(p.properties.order.type==="number"&&p.properties.movedBy.enum.join()==="user"&&p.properties.movedAt.format==="date-time"&&p.additionalProperties===false&&/pilot-v0\.11/.test(s.title))')"
check "the original pilot/cli-pilot-v1/schemas/state.schema.json is unchanged" "$(git diff --quiet HEAD -- ../cli-pilot-v1/schemas/state.schema.json && ! grep -q movedBy ../cli-pilot-v1/schemas/state.schema.json && echo true)"
check "every item of the v0.11 fixture uses only keys the schema copy knows" "$(node -e 'const s=require("./schemas/state.schema.json"),k=Object.keys(s.properties.items.items.properties);console.log(require("./demo/fixtures/v0.11/state.json").items.every(i=>Object.keys(i).every(x=>k.includes(x))))')"

echo "== 3. POST /move: column, order, movedBy, movedAt on that task only; rev; stale 409"
seed
node -e 'const c=require("./demo/fixtures/v0.11/pilot.config.json");c.port=4840;for(const r of Object.values(c.roles))for(const k of r.candidates)k.baseUrl=k.baseUrl.replace(":5788/",":5841/").replace(":5789/",":5842/");require("fs").writeFileSync(process.argv[1],JSON.stringify(c,null,2))' "$T/conf.json"
fake 5841 frontier; fake 5842 morrow; sleep 0.3
server
check "the fixture: the kanban shown, map and index tabs; board todo task-4,task-5,task-7,task-8 | doing task-3 | done task-1,task-2" "$(st | q 'x.panes.includes("kanban") && !x.faded.includes("kanban") && x.faded.includes("map") && x.faded.includes("index") && ["todo","doing","done"].map(c=>require("./public/board.js").column(x.items,c).map(i=>i.id).join(",")).join(" | ")==="task-4,task-5,task-7,task-8 | task-3 | task-1,task-2"')"
R0=$(rev); cp $DIR/state.json "$T/before.json"
OUT=$(mv "{\"itemId\":\"task-4\",\"column\":\"doing\",\"index\":1,\"rev\":$R0}")
check "move task-4 to doing below task-3 -> 200 {changed, from todo, to doing, index 1}, rev +1" "$(tail -1 <<< "$OUT" | grep -qx 200 && head -1 <<< "$OUT" | q 'x.changed===true && x.from==="todo" && x.to==="doing" && x.index===1' | grep -q true && [ "$(rev)" = $((R0+1)) ] && echo true)"
check "state.json: task-4 column doing, order 8 (after task-3's 7), movedBy user, movedAt; status/decidedAt/decidedBy unchanged" "$(item task-4 'i.column==="doing" && i.order===8 && i.movedBy==="user" && !isNaN(Date.parse(i.movedAt)) && i.status==="confirmed" && i.decidedAt==="2026-10-16T18:35:00.000Z" && i.decidedBy==="user"')"
check "no other item changed (the move writes only the moved task)" "$(node -e 'const a=require(process.argv[1]).items,b=JSON.parse(require("fs").readFileSync(process.argv[2])).items;console.log(a.length===b.length&&a.every((x,i)=>x.id==="task-4"||JSON.stringify(x)===JSON.stringify(b[i])))' "$T/before.json" "$PWD/$DIR/state.json")"
check "metrics: item_move {id task-4, from todo, to doing, order 8, by user}, item_write via move, pane_touch kanban how move (first touch of turn 44)" "$(ev 'x.some(e=>e.event==="item_move"&&e.id==="task-4"&&e.from==="todo"&&e.to==="doing"&&e.order===8&&e.by==="user"&&e.index===1) && x.some(e=>e.event==="item_write"&&e.via==="move"&&e.itemId==="task-4"&&e.item.order===8) && x.some(e=>e.event==="pane_touch"&&e.module==="kanban"&&e.how==="move"&&e.turn===44)')"
sleep 0.4
check "the server's own write is no file edit: no file_edit for task-4, /state task-4 has no prov" "$(ev '!x.some(e=>e.event==="file_edit"&&e.itemId==="task-4")' | grep -q true && st '?only=state.json' | q '!x.items.find(i=>i.id==="task-4").prov')"
OUT=$(mv "{\"itemId\":\"task-5\",\"column\":\"done\",\"index\":0,\"rev\":$R0}")
check "a stale rev -> 409 {stale: true, file: state.json}; nothing written" "$(tail -1 <<< "$OUT" | grep -qx 409 && head -1 <<< "$OUT" | q 'x.stale===true && x.file==="state.json"' | grep -q true && item task-5 'i.column==="todo" && i.movedBy===undefined' | grep -q true && [ "$(rev)" = $((R0+1)) ] && echo true)"
R1=$(rev)
SAME="{\"itemId\":\"task-4\",\"column\":\"doing\",\"index\":1,\"rev\":$R1}"
check "the same place again -> 200 changed false, no write (rev unchanged)" "$(body "$SAME" | q 'x.changed===false' | grep -q true && [ "$(rev)" = "$R1" ] && echo true)"
check "without rev (curl) a move is accepted: task-7 to the top of todo (order 10, just before task-5 at file position 11)" "$( [ "$(code '{"itemId":"task-7","column":"todo","index":0}')" = 200 ] && item task-7 'i.column==="todo" && i.order===10 && i.movedBy==="user"')"

echo "== 4. what a move never does: decide, move a rejected task, move a decision"
N0=$(nev decide)
check "the proposed task-8 moves to done and stays proposed (no decidedAt, no decidedBy, no decide event)" "$( [ "$(code '{"itemId":"task-8","column":"done","index":0}')" = 200 ] && item task-8 'i.column==="done" && i.status==="proposed" && !i.decidedAt && !i.decidedBy' | grep -q true && [ "$(nev decide)" = "$N0" ] && ev 'x.some(e=>e.event==="item_move"&&e.id==="task-8"&&e.status==="proposed")')"
check "/state still counts it as a proposal (status proposed, the pane holds it)" "$(st | q 'x.items.find(i=>i.id==="task-8").status==="proposed" && x.paneInfo.kanban.fade.holds.includes("task-8")')"
R2=$(rev)
OUT=$(mv '{"itemId":"task-6","column":"doing"}')
check "the rejected task-6 -> 409 'rejected tasks are not on the board and cannot be moved', nothing written" "$(tail -1 <<< "$OUT" | grep -qx 409 && has 'cannot be moved' "$OUT" && [ "$(rev)" = "$R2" ] && item task-6 'i.column==="todo" && !i.movedBy')"
check "a decision -> 400; a bad column -> 400; a bad index -> 400; an unknown id -> 404" "$( [ "$(code '{"itemId":"dec-1","column":"done"}')" = 400 ] && [ "$(code '{"itemId":"task-1","column":"later"}')" = 400 ] && [ "$(code '{"itemId":"task-1","column":"todo","index":-1}')" = 400 ] && [ "$(code '{"itemId":"task-1","column":"todo","index":1.5}')" = 400 ] && [ "$(code '{"itemId":"task-99","column":"todo"}')" = 404 ] && [ "$(rev)" = "$R2" ] && echo true)"

echo "== 5. files stay the truth: hand edits, a broken file, a pane that is not shown or is a tab"
edit state.json 'const t=x.items.find(i=>i.id==="task-1");t.column="doing";t.order=-5;'
check "a hand edit of column/order shows in /state with prov fields column, order (you (file edit)) and logs file_edit" "$(st '?only=state.json' | q '(t=>t.column==="doing" && t.prov && t.prov.fields.includes("column") && t.prov.fields.includes("order"))(x.items.find(i=>i.id==="task-1"))' | grep -q true && ev 'x.some(e=>e.event==="file_edit"&&e.itemId==="task-1"&&e.fields.includes("order"))')"
check "/why task-1: column and order edited by you (file edit), and its place on the board" "$(W=$(lines '/why task-1'); has '^  column edited by you \(file edit\) at ' "$W" && has '^  order edited by you \(file edit\) at .*the file says -5' "$W" && has '^  on the kanban now: doing, position 1 of ' "$W" && echo true)"
check "a page move after a hand edit takes over: task-1 to done -> those fields are the server's again (no prov for column/order)" "$( [ "$(code '{"itemId":"task-1","column":"done","index":1}')" = 200 ] && sleep 0.3 && st '?only=state.json' | q '(t=>!t.prov || !t.prov.fields.some(f=>["column","order","movedBy","movedAt"].includes(f)))(x.items.find(i=>i.id==="task-1"))')"
cp $DIR/state.json "$T/good.json"; printf '{"rev": 3, "items": [' > $DIR/state.json; sleep 0.3
check "a broken state.json: move -> 409, the file untouched" "$( [ "$(code '{"itemId":"task-5","column":"done"}')" = 409 ] && [ "$(cat $DIR/state.json)" = '{"rev": 3, "items": [' ] && echo true)"
cp "$T/good.json" $DIR/state.json; sleep 0.3
edit modules.json 'x.answers.kanban.answer="no";'
check "no kanban shown (answer no by hand): move -> 409 'no kanban pane shown'" "$(OUT=$(mv '{"itemId":"task-5","column":"done"}'); tail -1 <<< "$OUT" | grep -qx 409 && has 'no kanban pane shown' "$OUT" && echo true)"
edit modules.json 'x.answers.kanban.answer="always";const k=x.panes.find(p=>p.module==="kanban");k.state="faded";k.fadedAt=new Date().toISOString();k.fadedTurn=44;'
check "the kanban a tab (by hand): a move is a touch and brings it back (pane_touch move, unfaded)" "$( [ "$(code '{"itemId":"task-5","column":"doing","index":0}')" = 200 ] && st | q '!x.faded.includes("kanban")' | grep -q true && ev 'x.some(e=>e.event==="pane_touch"&&e.module==="kanban"&&e.how==="move"&&e.unfaded===true)')"

echo "== 6. an applied kanban frame is reset by a manual move (the experiment is off here, the reset happens anyway)"
check "the experiment is off in this config" "$(st '?only=flags.json' | q 'x.flags.frameProposals===false')"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"rev": 1, "pending": {}, "applied": {"kanban": {"id": "fr-1", "pane": "kanban", "intent": {"pane": "kanban", "focus": "task-2"}, "author": "model", "model": "morrow", "at": "%s", "appliedBy": "user", "appliedAt": "%s"}}, "resets": {}}\n' "$NOW" "$NOW" > $DIR/frames.json; sleep 0.3
OUT=$(body '{"itemId":"task-2","column":"todo","index":0}')
check "move -> 200 with frameReset fr-1; frames.json: applied.kanban gone, resets.kanban {by user, frame fr-1, reason manual move}" "$(q 'x.frameReset && x.frameReset.id==="fr-1"' <<< "$OUT" | grep -q true && q '!x.applied.kanban && x.resets.kanban.reason==="manual move" && x.resets.kanban.frame==="fr-1" && x.resets.kanban.by==="user" && x.rev===2' < $DIR/frames.json)"
check "recorded like /frame reset: frame_reset {reason manual move} and a system line saying why" "$(ev 'x.some(e=>e.event==="frame_reset"&&e.id==="fr-1"&&e.module==="kanban"&&e.reason==="manual move"&&e.by==="user")' | grep -q true && grep -q 'kanban: frame fr-1 reset by your manual move (suggested by morrow); the pane shows your order now' $DIR/transcript.jsonl && echo true)"
check "/why kanban says the frame was reset by your manual move; /why task-2 says this move reset it" "$(has 'frame fr-1 was reset by your manual move \(you arranged the pane yourself\)' "$(lines '/why kanban')" && has '^  moved by you from done to todo \(position 1\) at .*; this reset kanban frame fr-1  \[metrics\.jsonl:[0-9]+ item_move task-2; metrics\.jsonl:[0-9]+ frame_reset fr-1\]$' "$(lines '/why task-2')" && echo true)"
R3=$(q 'x.rev' < $DIR/frames.json)
check "a move with no frame applied leaves frames.json alone" "$( [ "$(code '{"itemId":"task-2","column":"todo","index":1}')" = 200 ] && [ "$(q 'x.rev' < $DIR/frames.json)" = "$R3" ] && echo true)"
printf '{"rev": 9, "pending": {}, "applied": {"kanban": {"id": "fr-2", "pane": "kanban", "intent": {"pane": "kanban", "focus": "task-2"}, "model": "morrow"}}, "resets": {}}\n' > $DIR/frames.json; sleep 0.3; st > /dev/null
printf '{"rev": 9, "applied": {' > $DIR/frames.json; sleep 0.3
check "a broken frames.json never blocks a move: 200, the file untouched, frame_error logged" "$( [ "$(code '{"itemId":"task-2","column":"done","index":0}')" = 200 ] && [ "$(cat $DIR/frames.json)" = '{"rev": 9, "applied": {' ] && ev 'x.some(e=>e.event==="frame_error"&&e.module==="kanban"&&/manual move/.test(e.error))' | grep -q true && echo true)"
rm $DIR/frames.json; sleep 0.2

echo "== 7. a second client follows by SSE; /why task-N with every source resolved; /stats unchanged"
node dev/sse-probe.js listen 4840 1500 "$T/sse.jsonl" & PROBE=$!; PIDS+=($!); sleep 0.4
code '{"itemId":"task-4","column":"todo","index":0}' > /dev/null
wait $PROBE 2>/dev/null
check "SSE: a change {file state.json, rev} reaches another client after a move" "$(qa "x.some(e=>e.event==='change'&&e.data.file==='state.json'&&e.data.rev===$(rev))" < "$T/sse.jsonl")"
W=$(lines '/why task-4')
echo "$W" | grep -E 'moved|kanban now' | head -3 | sed 's/^/   /'
check "/why task-4: its place now and every move, each citing metrics.jsonl:N item_move task-4" "$(has '^  on the kanban now: todo, position 1 of ' "$W" && [ "$(grep -cE '^  moved by you .*\[metrics\.jsonl:[0-9]+ item_move task-4\]$' <<< "$W")" = 2 ] && echo true)"
check "/why task-3 (moved in the fixture) and /why task-6 (rejected: not on the kanban)" "$(has '^  moved by you from todo to doing \(position 1\) at 2026-10-17T' "$(lines '/why task-3')" && has 'not on the kanban: rejected tasks' "$(lines '/why task-6')" && echo true)"
node dev/why-cites.js http://127.0.0.1:4840 $DIR > "$T/cites.txt"; tail -1 "$T/cites.txt" | sed 's/^/   /'
check "every source /why cites resolves (why-cites.js: all panes and items, item_move and frame_reset included)" "$(grep -q '^CITES OK' "$T/cites.txt" && echo true)"
check "/stats still prints five verdict lines and equals npm run stats" "$(S=$(lines /stats); [ "$(echo "$S" | grep -cE '^[a-z]+ +(PASS|NOT YET) ')" -eq 5 ] && [ "$(npm run -s stats -- $DIR)" = "$S" ] && echo true)"
check "every item in state.json still uses only keys of the schema copy" "$(node -e 'const s=require("./schemas/state.schema.json"),k=Object.keys(s.properties.items.items.properties);console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).items.every(i=>Object.keys(i).every(x=>k.includes(x))))' "$DIR/state.json")"
stop_server

echo "== 8. page (headless Chrome): real drags, Alt+arrows, stale snap-back, two tabs, hand edit, frame reset, touch, reduced motion"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v11 | tee "$T/browser.log"
  check "browser checks (v11) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; check "contrast-check.js still passes (no new text colour)" "$( [ $? -eq 0 ] && echo true)"

echo "== 9. demo v0.11 within 30 s (ports +300, dir .pilot-demo-verify11)"
DEMO_PORT_SHIFT=300 PILOT_DEMO_DIR=.pilot-demo-verify11 node scripts/demo.js v0.11 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 localhost:5082/state > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s: the kanban shown (map, index tabs), 7 tasks on the board, task-8 proposed, experiments off" "$( [ -n "$UP" ] && q '!x.faded.includes("kanban") && x.panes.includes("kanban") && x.faded.length===2 && x.items.filter(i=>i.kind==="task"&&i.status!=="rejected").length===7 && x.items.find(i=>i.id==="task-8").status==="proposed" && !x.flags.frameProposals && !x.flags.settledInput' < "$T/ds.json")"
R=$(q 'x.stateRev' < "$T/ds.json")
DM="{\"itemId\":\"task-4\",\"column\":\"doing\",\"index\":1,\"rev\":$R}"
check "demo: a move works at once (task-4 to doing)" "$(curl -s -X POST localhost:5082/move -H 'content-type: application/json' -d "$DM" | q 'x.ok && x.changed')"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
check "try lines: drag to doing, reorder, the keyboard way (Alt+arrows), a second tab, /why task-N" "$(grep -q 'onto \"doing\"' "$T/demo.log" && grep -q 'Reorder within a column' "$T/demo.log" && grep -q 'Alt+→ / Alt+←' "$T/demo.log" && grep -q 'second tab' "$T/demo.log" && grep -q '/why task-3' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 608(8|9)' > /dev/null && ! lsof -iTCP:5082 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"
S1=$(cat demo/fixtures/v0.11/* | shasum); node dev/make-fixture-v11.js > /dev/null; S2=$(cat demo/fixtures/v0.11/* | shasum)
check "make-fixture-v11.js is deterministic (the fixture is unchanged by a re-run); the v0.10 fixture is untouched" "$( [ "$S1" = "$S2" ] && git diff --quiet HEAD -- demo/fixtures/v0.10 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.11 CHECKS PASSED" || echo "$FAILS v0.11 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
