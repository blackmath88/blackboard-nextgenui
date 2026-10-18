#!/bin/bash
# DEV ONLY. pilot-v0.12 checks: several chats in one project. A dir without chats.json behaves as before; chats.json and
# chats/<id>.jsonl are created on the first new chat (main stays transcript.jsonl, byte for byte); the model sees only
# the chat it answers in; the shared board records fromChat; the controller counts all chats and its lines go to the chat
# of the turn; the open question is visible from every chat; rename (who named it, file edits), archive (nothing is
# deleted), unarchive; path safety and a broken chats.json; SSE for chats/ files; /why citations into chats/<id>.jsonl;
# /stats (five verdicts, a chats block, continuity over all chats); chat_switch; the title role; the page
# (browser-check.js v12); the v0.12 demo.
# Against dev/fake-model.js only. Own ports (server 4850, fakes 5851/5852; browser part 4855/5856/5857 + Chrome 9433;
# demo part shifted +300: 5086/6094/6095) and own dirs (.pilot-verify-v12*/, .pilot-demo-verify12/), so it never touches
# .pilot/ or a running demo.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.12.sh
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); PIDS=(); SERVER=""
DIR=.pilot-verify-v12
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; rm -rf "$T" "$DIR" .pilot-demo-verify12; }
trap cleanup EXIT
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
server() { PILOT_DIR=$DIR PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -s -m 1 localhost:4850/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
post() { curl -s -w '\n%{http_code}' -X POST "localhost:4850$1" -H 'content-type: application/json' -d "$2"; }
cmd() { curl -s -X POST localhost:4850/command -H 'content-type: application/json' -d "{\"text\":\"$1\",\"chat\":\"${2:-main}\"}"; }
lines() { cmd "$1" "${2:-main}" | q 'x.lines.join("\n")'; }
say() { curl -s -X POST localhost:4850/chat -H 'content-type: application/json' -d "{\"text\":\"$1\",\"chat\":\"${2:-main}\"}" > /dev/null; sleep "${3:-1.2}"; }
st() { curl -s "localhost:4850/state${1:-}"; }
ev() { qa "$1" < "$DIR/metrics.jsonl"; }
has() { grep -qE -- "$1" <<< "$2"; }
sha() { shasum "$DIR/transcript.jsonl" | cut -d' ' -f1; }
conf() { node -e 'const c=require("./demo/fixtures/v0.12/pilot.config.json");c.port=4850;for(const r of Object.values(c.roles))for(const k of r.candidates)k.baseUrl=k.baseUrl.replace(":5794/",":5851/").replace(":5795/",":5852/");if(process.argv[2]==="notitle")c.roles.title.candidates=[];require("fs").writeFileSync(process.argv[1],JSON.stringify(c,null,2))' "$T/conf.json" "${1:-}"; }
newchat() { cmd "/chat new ${1:-}" "${2:-main}" | q 'x.chat'; }

fake 5851 frontier; fake 5852 morrow; sleep 0.3

echo "== 1. a dir without chats.json behaves as before (one chat, main = transcript.jsonl)"
rm -rf $DIR; mkdir $DIR; for f in transcript.jsonl metrics.jsonl state.json modules.json rules.json; do cp demo/fixtures/v0.11/$f $DIR/; done
conf; server
check "/state: chats.exists false, one chat (main, transcript.jsonl), its transcript is transcript.jsonl" "$(st | q 'x.chats.exists===false && x.chats.list.length===1 && x.chats.list[0].id==="main" && x.chats.list[0].file==="transcript.jsonl" && x.chat==="main" && x.total===117')"
check "items in /state carry no chat field while there is one chat" "$(st '?only=state.json' | q 'x.items.every(i=>!("chat" in i))')"
say 'Task: buy a folder for the receipts.' main 1.5
check "a turn in main: the lines go to transcript.jsonl, no chats.json and no chats/ appear" "$( [ ! -e $DIR/chats.json ] && [ ! -e $DIR/chats ] && [ "$(grep -c . $DIR/transcript.jsonl)" -ge 119 ] && echo true)"
check "the item proposed from main has no fromChat (missing = main; state.json keys as before)" "$(node -e 'const s=require("./'$DIR'/state.json");const t=s.items.find(i=>i.text==="buy a folder for the receipts");console.log(!!t && !("fromChat" in t))')"
check "an unknown chat: GET /state?chat=nope -> 404, POST /chat with it -> 404, nothing written" "$( [ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:4850/state?chat=nope')" = 404 ] && [ "$(post /chat '{"text":"hi","chat":"nope"}' | tail -1)" = 404 ] && [ ! -e $DIR/chats ] && echo true)"
check "a path as chat id (../transcript) -> 404" "$( [ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:4850/state?chat=..%2Ftranscript')" = 404 ] && echo true)"
check "/chats says one chat so far and how to start another" "$(has 'one chat so far: /chat new' "$(lines /chats)" && echo true)"
stop_server

echo "== 2. the first new chat creates chats.json (main first, transcript.jsonl untouched) and chats/<id>.jsonl"
rm -rf $DIR; mkdir $DIR; for f in transcript.jsonl metrics.jsonl state.json modules.json rules.json; do cp demo/fixtures/v0.11/$f $DIR/; done
cp $DIR/transcript.jsonl "$T/main.jsonl"; S0=$(sha)
server
C1=$(newchat)
check "/chat new -> chat c-xxxxxx; chats.json {rev 1, chats: [main (transcript.jsonl), c-…]}; chats/<id>.jsonl exists, empty" "$(q "x.rev===1 && x.chats.length===2 && x.chats[0].id==='main' && x.chats[0].file==='transcript.jsonl' && x.chats[1].id==='$C1' && x.chats[1].file==='chats/$C1.jsonl'" < $DIR/chats.json | grep -q true && [[ "$C1" =~ ^c-[0-9a-f]{6}$ ]] && [ -f $DIR/chats/$C1.jsonl ] && [ ! -s $DIR/chats/$C1.jsonl ] && echo true)"
check "metrics: chat_new {chat, file, from main, created: chats.json}" "$(ev "x.some(e=>e.event==='chat_new'&&e.chat==='$C1'&&e.from==='main'&&e.created==='chats.json')")"
check "a second /chat new while that chat is still empty reuses it (no pile of empty chats)" "$( [ "$(newchat)" = "$C1" ] && [ "$(q 'x.chats.length' < $DIR/chats.json)" = 2 ] && echo true)"
say 'Task: call the pharmacy about the receipts.' $C1 1.8
check "the turn is in chats/<id>.jsonl (user + assistant), transcript.jsonl is byte for byte what it was" "$( [ "$(grep -c '"role":"user"' $DIR/chats/$C1.jsonl)" = 1 ] && [ "$(grep -c '"role":"assistant"' $DIR/chats/$C1.jsonl)" = 1 ] && cmp -s "$T/main.jsonl" $DIR/transcript.jsonl && [ "$(sha)" = "$S0" ] && echo true)"
check "the model saw only this chat's history (\"1 messages in context\")" "$(grep -q '1 messages in context' $DIR/chats/$C1.jsonl && echo true)"
check "the shared board: the task records fromChat $C1 and a fromMessage that is in chats/$C1.jsonl" "$(node -e 'const s=require("./'$DIR'/state.json");const t=s.items.find(i=>i.text==="call the pharmacy about the receipts");console.log(!!t && t.fromChat==="'$C1'" && require("fs").readFileSync("'$DIR'/chats/'$C1'.jsonl","utf8").includes(t.fromMessage))')"
check "/state?chat=$C1: that chat's 2 lines; /state (main): 117 lines; items carry chat ($C1 for the new task, main for the others)" "$(st "?chat=$C1" | q "x.chat==='$C1' && x.total===2 && x.items.find(i=>i.text==='call the pharmacy about the receipts').chat==='$C1' && x.items.find(i=>i.id==='task-4').chat==='main'" | grep -q true && st | q 'x.total===117' )"
check "the title role (morrow) named it after the first reply: chat_rename by model, \"call the pharmacy about\"" "$(ev "x.some(e=>e.event==='chat_rename'&&e.chat==='$C1'&&e.by==='model'&&e.model==='morrow'&&e.title==='call the pharmacy about')" | grep -q true && q "x.chats[1].title==='call the pharmacy about' && x.chats[1].titleBy==='model'" < $DIR/chats.json)"
check "the turn event carries chat and project-wide counts (lines of all chats)" "$(ev "(e=>e.chat==='$C1' && e.lines===117+2)(x.filter(e=>e.event==='turn').pop())")"
CN=$(newchat 'mine')
say 'Task: file the receipts.' $CN 1.8
check "a chat you named is never renamed by the title role (title \"mine\", no chat_rename by model for it)" "$(q "x.chats.find(c=>c.id==='$CN').title==='mine' && x.chats.find(c=>c.id==='$CN').titleBy==='user'" < $DIR/chats.json | grep -q true && ev "!x.some(e=>e.event==='chat_rename'&&e.chat==='$CN'&&e.by==='model')")"
stop_server

echo "== 3. the controller counts every chat; its lines go to the chat of the turn; the question shows everywhere"
rm -rf $DIR; mkdir $DIR
node -e 'const r=require("./rules.example.json");r.rules.find(x=>x.module==="index").threshold=4;require("fs").writeFileSync("'$DIR'/rules.json",JSON.stringify(r,null,2))'
conf notitle; server
say 'Hello from the first chat.' main 1.2
C2=$(newchat 'second')
say 'Hello from the second chat.' $C2 1.5
check "4 messages over two chats (2 + 2) reach the index threshold 4: the question is asked" "$(st | q 'x.pending==="index"')"
check "the question line is in chats/$C2.jsonl (the chat of the turn), not in transcript.jsonl" "$(grep -q '"role":"controller"' $DIR/chats/$C2.jsonl && ! grep -q '"role":"controller"' $DIR/transcript.jsonl && echo true)"
check "/state of main has the open question as pendingLine {chat $C2} (the page shows it in every chat)" "$(st | q "x.pendingLine && x.pendingLine.chat==='$C2' && x.pendingLine.line.module==='index'")"
check "/rules counts all chats: messages 4 / 4" "$(has '^index: messages 4 / 4' "$(lines /rules)" && echo true)"
S1=$(sha)
check "answered y from main: pane added, the system line goes to main (where you answered)" "$( [ "$(post /answer '{"module":"index","answer":"y","chat":"main"}' | tail -1)" = 200 ] && st | q 'x.panes.includes("index")' | grep -q true && tail -1 $DIR/transcript.jsonl | grep -q 'index: yes, pane added' && echo true)"
check "/chat new [title]: named by you at once (chat_new with title, by user)" "$(q "x.chats.find(c=>c.id==='$C2').title==='second' && x.chats.find(c=>c.id==='$C2').titleBy==='user'" < $DIR/chats.json | grep -q true && ev "x.some(e=>e.event==='chat_new'&&e.chat==='$C2'&&e.title==='second'&&e.by==='user')")"
check "no title role in this config: the title role is not called (no model_call role title)" "$(ev '!x.some(e=>e.event==="model_call"&&e.role==="title")')"
stop_server

echo "== 4. rename, archive (nothing deleted), unarchive; hand edits; a broken chats.json; path safety"
server
check "/chat rename letter (in main): titleBy user, chat_rename {by user, was <first sentence>}" "$(cmd '/chat rename letter' main | q 'x.ok' | grep -q true && q "x.chats[0].title==='letter' && x.chats[0].titleBy==='user'" < $DIR/chats.json | grep -q true && ev 'x.some(e=>e.event==="chat_rename"&&e.chat==="main"&&e.by==="user"&&e.was==="Hello from the first chat.")')"
node -e 'const f="'$DIR'/chats.json",fs=require("fs"),x=JSON.parse(fs.readFileSync(f));x.chats[1].title="second (edited)";fs.writeFileSync(f,JSON.stringify(x,null,2))'; sleep 0.3
check "a hand edit of a title shows as named by \"you (file edit)\"" "$(st '?only=chats.json' | q "x.chats.list.find(c=>c.id==='$C2').titleBy==='you (file edit)' && x.chats.list.find(c=>c.id==='$C2').title==='second (edited)'")"
SZ=$(shasum $DIR/chats/$C2.jsonl); N0=$(ls $DIR/chats | wc -l)
check "/chat archive second (from main): archived true, hidden from /chats, chats/$C2.jsonl unchanged on disk" "$(cmd '/chat archive second (edited)' main | q 'x.ok' | grep -q true && q "x.chats.find(c=>c.id==='$C2').archived===true" < $DIR/chats.json | grep -q true && ! has "$C2" "$(lines /chats)" && [ "$(shasum $DIR/chats/$C2.jsonl)" = "$SZ" ] && echo true)"
check "/chats all lists it as archived; its lines still count (messages 4 in /rules)" "$(has "$C2.*archived" "$(lines '/chats all')" && has '^index: messages 4 ' "$(lines /rules)" && echo true)"
check "/chat archive in the chat you are in names the chat to go to (the most recent one left)" "$(C3=$(newchat 'third'); cmd '/chat archive' $C3 | q "x.ok && x.chat==='main'")"
check "main cannot be archived" "$(cmd '/chat archive main' main | q '!x.ok && /cannot be archived/.test(x.lines[0])')"
check "/chat unarchive second: back in the list (archived removed); metrics chat_archive {archived false}" "$(cmd '/chat unarchive second' main | q 'x.ok' | grep -q true && q "x.chats.find(c=>c.id==='$C2').archived===undefined" < $DIR/chats.json | grep -q true && ev "x.some(e=>e.event==='chat_archive'&&e.chat==='$C2'&&e.archived===false)")"
check "nothing was ever removed from chats/ (files only added)" "$( [ "$(ls $DIR/chats | wc -l)" -ge "$N0" ] && echo true)"
cp $DIR/chats.json "$T/chats.good"
node -e 'const f="'$DIR'/chats.json",fs=require("fs"),x=JSON.parse(fs.readFileSync(f));x.chats.push({id:"evil",file:"../../server.js"},{id:"../up",file:"chats/../up.jsonl"});fs.writeFileSync(f,JSON.stringify(x,null,2))'; sleep 0.3
check "a hand-added entry whose file is not chats/<id>.jsonl, or whose id is a path, is ignored (not listed, 404)" "$(st '?only=chats.json' | q '!x.chats.list.some(c=>c.id==="evil"||c.id==="../up")' | grep -q true && [ "$(curl -s -o /dev/null -w '%{http_code}' 'localhost:4850/state?chat=evil')" = 404 ] && echo true)"
printf '{"rev": 9, "chats": [' > $DIR/chats.json; sleep 0.3
check "a broken chats.json: fileErrors names it, the list is the last good version, /chat new refuses, the file is untouched" "$(st | q 'x.fileErrors["chats.json"] && x.chats.list.length>=3' | grep -q true && cmd '/chat new' main | q '!x.ok && /not valid JSON/.test(x.lines[0])' | grep -q true && [ "$(cat $DIR/chats.json)" = '{"rev": 9, "chats": [' ] && echo true)"
B="{\"text\":\"still here\",\"chat\":\"$C2\"}"
check "a turn in a chat still works while chats.json is broken (last good list)" "$( [ "$(post /chat "$B" | tail -1)" = 200 ] && grep -q 'still here' $DIR/chats/$C2.jsonl && echo true)"
cp "$T/chats.good" $DIR/chats.json; sleep 0.3
check "fixed by hand: no fileErrors" "$(st | q '!x.fileErrors["chats.json"]')"

echo "== 5. SSE: chats/<id>.jsonl and chats.json changes reach another client; chat_switch"
node dev/sse-probe.js listen 4850 1500 "$T/sse.jsonl" & PROBE=$!; PIDS+=($!); sleep 0.4
echo '{"id":"m-hand0001","ts":"2026-10-18T12:00:00.000Z","role":"user","text":"a line added by hand","model":null}' >> $DIR/chats/$C2.jsonl
cmd '/chat rename second again' $C2 > /dev/null
wait $PROBE 2>/dev/null
check "SSE: change {file chats/$C2.jsonl, rev = its line count} for a hand edit; change {file chats.json} for a rename" "$(qa "x.some(e=>e.event==='change'&&e.data.file==='chats/$C2.jsonl'&&e.data.rev===$(grep -c . $DIR/chats/$C2.jsonl)) && x.some(e=>e.event==='change'&&e.data.file==='chats.json')" < "$T/sse.jsonl")"
B="{\"event\":\"chat_switch\",\"from\":\"main\",\"to\":\"$C2\",\"how\":\"sidebar\"}"
check "POST /metric chat_switch {from, to, how}: logged with the turn; an unknown chat or from = to -> 400" "$( [ "$(post /metric "$B" | tail -1)" = 200 ] && [ "$(post /metric '{"event":"chat_switch","from":"main","to":"nope"}' | tail -1)" = 400 ] && [ "$(post /metric '{"event":"chat_switch","from":"main","to":"main"}' | tail -1)" = 400 ] && ev "x.some(e=>e.event==='chat_switch'&&e.to==='$C2'&&e.how==='sidebar'&&Number.isInteger(e.turn))")"
check "an index jump to a message in another chat is logged with its chat" "$( [ "$(post /metric '{"event":"index_jump","target":"m-hand0001"}' | tail -1)" = 200 ] && ev "x.some(e=>e.event==='index_jump'&&e.target==='m-hand0001'&&e.chat==='$C2')")"
stop_server

echo "== 6. the demo fixture: /why cites the chat file and line, every source resolves; /stats over all chats"
rm -rf $DIR; cp -R demo/fixtures/v0.12 $DIR; rm $DIR/demo.json $DIR/pilot.config.json
conf; server
W=$(lines '/why task-9')
echo "$W" | grep -E 'from (message|chat)' | sed 's/^/   /'
check "/why task-9: from message m-f203 [chats/c-invoices.jsonl:1 m-f203]; from chat c-invoices \"invoices\" [chats.json:N chats c-invoices]" "$(has '^  from message m-f203 by you at .*\[chats/c-invoices\.jsonl:1 m-f203\]$' "$W" && has '^  from chat c-invoices "invoices" \(chats/c-invoices\.jsonl, line 1\)  \[state\.json:[0-9]+ items task-9; chats\.json:[0-9]+ chats c-invoices; chats/c-invoices\.jsonl:1 m-f203\]$' "$W" && echo true)"
check "/why task-4 (older, no fromChat): the message is cited in transcript.jsonl, and the item names no chat" "$(has 'transcript\.jsonl:[0-9]+ m-f' "$(lines '/why task-4')" && has 'the item names no chat \(older than pilot-v0.12\); its message is in main "letter"' "$(lines '/why task-4')" && echo true)"
check "/why index: the rule counts messages in all 4 chats; the pane lists the chat you are in" "$(has 'the rule counts messages in all 4 chats \(main 88, c-scratch 2, c-invoices 4, c-hospital 4\); the pane lists the messages of the chat you are in' "$(lines '/why index')" && echo true)"
check "/why kanban: the turns since are counted over all chats" "$(has 'transcript\.jsonl \+ chats/\*\.jsonl user lines ×49 \(all chats\)' "$(lines '/why kanban')" && echo true)"
node dev/why-cites.js http://127.0.0.1:4850 $DIR > "$T/cites.txt"; tail -1 "$T/cites.txt" | sed 's/^/   /'
check "every source /why cites resolves (why-cites.js: chats/<id>.jsonl lines, chats.json entries, links into other chats)" "$(grep -q '^CITES OK' "$T/cites.txt" && echo true)"
S=$(lines /stats)
check "/stats: five verdict lines, then a chats block (measured): 4 chats (1 archived), the chat events; equal to npm run stats" "$( [ "$(echo "$S" | grep -cE '^[a-z]+ +(PASS|NOT YET) ')" -eq 5 ] && has '^chats \(measured, not judged' "$S" && has '4 chats \(1 archived\): main 88 messages, c-scratch 2 messages, c-invoices 4 messages, c-hospital 4 messages' "$S" && has 'chat_new 3, chat_switch 3 \(archive 1, new 2\)|chat_new 3, chat_switch 3 \(new 2, archive 1\)' "$S" && [ "$(npm run -s stats -- $DIR)" = "$S" ] && echo true)"
check "/stats quiet and usefulness count the messages of every chat (transcript lines of all chats: 117 + 11)" "$(node -e 'const s=require("./stats.js").computeStats("'$DIR'");console.log(s.lines===117+2+4+5)')"
check "every item of the v0.12 fixture uses only keys of the schema copy (fromChat included)" "$(node -e 'const s=require("./schemas/state.schema.json"),k=Object.keys(s.properties.items.items.properties);console.log(require("./demo/fixtures/v0.12/state.json").items.every(i=>Object.keys(i).every(x=>k.includes(x))) && k.includes("fromChat"))')"
stop_server

echo "== 7. page (headless Chrome): sidebar, new chat, shared board, chat tags, /why links, two tabs, Alt+S, drawer"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v12 | tee "$T/browser.log"
  check "browser checks (v12) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; check "contrast-check.js passes, with the sidebar pairs (both themes)" "$( [ $? -eq 0 ] && grep -q 'current chat title on the bar colour' "$T/contrast.log" && echo true)"

echo "== 8. demo v0.12 within 30 s (ports +300, dir .pilot-demo-verify12)"
DEMO_PORT_SHIFT=300 PILOT_DEMO_DIR=.pilot-demo-verify12 node scripts/demo.js v0.12 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 'localhost:5086/state?only=chats.json,state.json' > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves within 30 s: 4 chats (3 listed, 1 archived), tasks from 3 chats on the board, chats/ seeded" "$( [ -n "$UP" ] && q 'x.chats.list.length===4 && x.chats.list.filter(c=>c.archived).length===1 && new Set(x.items.filter(i=>i.kind==="task"&&i.chat).map(i=>i.chat)).size===3' < "$T/ds.json" | grep -q true && [ -f .pilot-demo-verify12/chats/c-invoices.jsonl ] && echo true)"
NC=$(curl -s -X POST localhost:5086/command -H 'content-type: application/json' -d '{"text":"/chat new"}' | q 'x.chat')
curl -s -X POST localhost:5086/chat -H 'content-type: application/json' -d "{\"text\":\"Task: call the pharmacy about the receipts.\",\"chat\":\"$NC\"}" > /dev/null; sleep 1.5
check "demo: a new chat and a task in it land on the shared board with fromChat" "$(curl -s 'localhost:5086/state?only=state.json' | q "x.items.some(i=>i.fromChat==='$NC'&&i.chat==='$NC')")"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
check "try lines: the sidebar, + new chat with a Task, the chat tag, a second tab, Alt+S, the drawer" "$(grep -q 'sidebar on the left' "$T/demo.log" && grep -q '+ new chat' "$T/demo.log" && grep -q 'chat tag on a card' "$T/demo.log" && grep -q 'second tab' "$T/demo.log" && grep -q 'Alt+S' "$T/demo.log" && grep -q 'drawer' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 609(4|5)' > /dev/null && ! lsof -iTCP:5086 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"
S1=$(find demo/fixtures/v0.12 -type f | sort | xargs cat | shasum); node dev/make-fixture-v12.js > /dev/null; S2=$(find demo/fixtures/v0.12 -type f | sort | xargs cat | shasum)
check "make-fixture-v12.js is deterministic; its main transcript is the v0.11 one byte for byte; the v0.11 fixture is untouched" "$( [ "$S1" = "$S2" ] && cmp -s demo/fixtures/v0.11/transcript.jsonl demo/fixtures/v0.12/transcript.jsonl && git diff --quiet HEAD -- demo/fixtures/v0.11 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.12 CHECKS PASSED" || echo "$FAILS v0.12 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
