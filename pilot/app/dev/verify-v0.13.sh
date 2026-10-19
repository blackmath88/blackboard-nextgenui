#!/bin/bash
# DEV ONLY. pilot-v0.13 checks: projects that group chats. Single-dir mode (no PILOT_HOME) leaves a pilot dir byte for
# byte as v0.12 did and writes nothing about projects; with PILOT_HOME, projects.json is created lazily (the default dir
# listed first, by reference, never copied or moved); a new project gets its own dir with rules.json; an item, the
# counts, pins and flags of one project never show in another; SSE per project (a tab gets only its project's files);
# a project is watched only while a tab has it open; archive never deletes; path safety and a broken projects.json;
# the page (browser-check.js v13); the v0.13 demo; make-fixture-v13.js.
# Against dev/fake-model.js only. Own ports (server 4920, fakes 5921/5922, clear of every demo shifted +100 or +300;
# browser part 4865/5866/5867 + Chrome 9443; demo part shifted +300: 5090/6100/6101) and own dirs (.pilot-verify-v13*/,
# .pilot-demo-verify13/), so it never touches .pilot/, pilot/app/projects/ or a running demo.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.13.sh
set -u
cd "$(dirname "$0")/.."
T=$(mktemp -d); PIDS=(); SERVER=""
DIR=.pilot-verify-v13; HOMED=.pilot-verify-v13h; REF=.pilot-verify-v13ref
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; rm -rf "$T" "$DIR" "$HOMED" "$REF" .pilot-demo-verify13; }
trap cleanup EXIT
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
# server single|home: single = PILOT_DIR=$DIR; home = PILOT_HOME=$HOMED with PILOT_DIR=$REF (the default dir, by reference)
server() {
  if [ "$1" = single ]; then PILOT_HOME= PILOT_DIR=$DIR PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!
  else PILOT_HOME=$HOMED PILOT_DIR=$REF PILOT_CONFIG="$T/conf.json" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; fi
  PIDS+=($SERVER); for i in $(seq 1 50); do curl -s -m 1 localhost:4920/ > /dev/null && return; sleep 0.1; done
}
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
post() { curl -s -w '\n%{http_code}' -X POST "localhost:4920$1" -H 'content-type: application/json' -d "$2"; }
# cmd <text> [project]: a command in that project (missing = the default)
cmd() { curl -s -X POST localhost:4920/command -H 'content-type: application/json' -d "{\"text\":\"$1\"${2:+,\"project\":\"$2\"}}"; }
lines() { cmd "$1" "${2:-}" | q 'x.lines.join("\n")'; }
say() { curl -s -X POST localhost:4920/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"${2:+,\"project\":\"$2\"}}" > /dev/null; sleep "${3:-1.5}"; }
st() { curl -s "localhost:4920/state?${1:-}"; }
has() { grep -qE -- "$1" <<< "$2"; }
code() { curl -s -o /dev/null -w '%{http_code}' "localhost:4920$1"; }
# every file of a dir with its hash (metrics.jsonl left out: the server appends server_start to it, as v0.12 did)
hashes() { (cd "$1" && find . -type f ! -name metrics.jsonl | sort | xargs shasum); }
conf() { node -e 'const c=require("./demo/fixtures/v0.13/pilot.config.json");c.port=4920;for(const r of Object.values(c.roles))for(const k of r.candidates)k.baseUrl=k.baseUrl.replace(":5800/",":5921/").replace(":5801/",":5922/");require("fs").writeFileSync(process.argv[1],JSON.stringify(c,null,2))' "$T/conf.json"; }
seed() { rm -rf "$1"; mkdir "$1"; for f in transcript.jsonl metrics.jsonl state.json modules.json rules.json chats.json; do cp demo/fixtures/v0.12/$f "$1"/; done; cp -R demo/fixtures/v0.12/chats "$1"/; }

fake 5921 frontier; fake 5922 morrow; sleep 0.3; conf
PROJ_BEFORE=$( [ -e projects ] && (find projects -type f | sort | xargs shasum 2>/dev/null) || echo none)

echo "== 1. single-dir mode (no PILOT_HOME): the pilot dir byte for byte as before, nothing about projects written"
seed $DIR; H0=$(hashes $DIR); M0=$(shasum < $DIR/metrics.jsonl); MB=$(wc -c < $DIR/metrics.jsonl)
server single
st > "$T/s1.json"
check "/state: project = the dir's id, projects.home false, one project; chats and board as in v0.12" "$(q 'x.project==="pilot-verify-v13" && x.projects.home===false && x.projects.list.length===1 && x.chats.list.length===4 && x.items.length===21' < "$T/s1.json")"
SSE_PROJECT= node dev/sse-probe.js listen 4920 600 "$T/sse1.jsonl"
check "/projects names the one project and how to get several (PILOT_HOME); /project new is refused (400), nothing written" "$(has 'single-dir mode' "$(lines /projects)" && [ "$(post /command '{"text":"/project new tax"}' | tail -1)" = 400 ] && echo true)"
check "?project=<its id> works, any other project is 404 (nothing is created)" "$( [ "$(code '/state?project=pilot-verify-v13')" = 200 ] && [ "$(code '/state?project=other')" = 404 ] && [ "$(post /chat '{"text":"hi","project":"other"}' | tail -1)" = 404 ] && echo true)"
stop_server
check "after the run every file of the dir is byte for byte what it was; metrics.jsonl only grew at its end (server_start)" "$( [ "$(hashes $DIR)" = "$H0" ] && [ "$(head -c $MB $DIR/metrics.jsonl | shasum)" = "$M0" ] && echo true)"
check "no projects.json in the dir, no projects home created, pilot/app/projects/ untouched" "$( [ ! -e $DIR/projects.json ] && [ ! -e $HOMED ] && [ "$( [ -e projects ] && (find projects -type f | sort | xargs shasum 2>/dev/null) || echo none)" = "$PROJ_BEFORE" ] && echo true)"
server single; say 'Task: buy a folder for the receipts.' "" 1.8; stop_server
check "a turn in single-dir mode writes what v0.12 wrote (transcript, state.json, metrics) and still no projects.json" "$( [ "$(grep -c . $DIR/transcript.jsonl)" -ge 119 ] && grep -q 'buy a folder' $DIR/state.json && [ ! -e $DIR/projects.json ] && echo true)"

echo "== 2. PILOT_HOME: projects.json is created lazily; the default dir is listed by reference, never copied or moved"
seed $REF; rm -rf $HOMED
INO0=$(ls -di $REF | awk '{print $1}')
server home
check "an empty home: one project, the default dir (PILOT_DIR) by reference: id pilot-verify-v13ref, dir ../$REF; no projects.json yet" "$(st | q 'x.projects.home===true && x.projects.exists===false && x.projects.list.length===1 && x.projects.list[0].id==="pilot-verify-v13ref" && x.projects.list[0].dir==="../'$REF'" && x.projects.list[0].reference===true && x.items.length===21' | grep -q true && [ ! -e $HOMED/projects.json ] && echo true)"
say 'Decision: the claim folder stays on paper.' "" 1.8
check "a turn in it goes to the referenced dir's transcript.jsonl; still no projects.json" "$(grep -q 'claim folder stays on paper' $REF/transcript.jsonl && [ ! -e $HOMED/projects.json ] && echo true)"
OUT=$(cmd '/project new Move flat')
check "/project new Move flat -> project move-flat; projects.json {rev 1, [pilot-verify-v13ref (../$REF), move-flat (move-flat)]}" "$(q 'x.ok && x.project==="move-flat"' <<< "$OUT" | grep -q true && q 'x.rev===1 && x.projects.map(p=>p.id+"="+p.dir).join(",")==="pilot-verify-v13ref=../'$REF',move-flat=move-flat"' < $HOMED/projects.json)"
check "the new project's dir has rules.json seeded from rules.example.json (byte for byte), nothing else but its metrics" "$(cmp -s rules.example.json $HOMED/move-flat/rules.json && [ "$(ls $HOMED/move-flat | sort | tr '\n' ' ')" = "metrics.jsonl rules.json " ] && echo true)"
check "the referenced dir was not copied or moved: the same dir (inode), its transcript only grew at the end, the home holds only projects.json and move-flat/" "$( [ "$(ls -di $REF | awk '{print $1}')" = "$INO0" ] && [ "$(head -c $(wc -c < demo/fixtures/v0.12/transcript.jsonl) $REF/transcript.jsonl | shasum)" = "$(shasum < demo/fixtures/v0.12/transcript.jsonl)" ] && [ "$(ls -A $HOMED | sort | tr '\n' ' ')" = "move-flat projects.json " ] && echo true)"
check "metrics.jsonl of move-flat: project_new {project, name, from pilot-verify-v13ref, created projects.json}" "$(qa 'x.some(e=>e.event==="project_new"&&e.project==="move-flat"&&e.name==="Move flat"&&e.from==="pilot-verify-v13ref"&&e.created==="projects.json")' < $HOMED/move-flat/metrics.jsonl)"
check "/state without project opens the first listed (the reference); /state?project=move-flat the new one (empty board, main only)" "$(st 'only=projects.json' | q 'x.project==="pilot-verify-v13ref"' | grep -q true && st 'project=move-flat' | q 'x.project==="move-flat" && x.items.length===0 && x.total===0 && x.panes.length===0')"
check "a second project with the same name gets its own id and dir (move-flat-2); an existing dir is never reused" "$(mkdir $HOMED/tax; cmd '/project new tax' | q 'x.project==="tax-2"' | grep -q true && [ -f $HOMED/tax-2/rules.json ] && [ -z "$(ls -A $HOMED/tax)" ] && cmd '/project new Move flat' | q 'x.project==="move-flat-2"')"

echo "== 3. per-project isolation: items, counts, pins, flags"
say 'Task: buy packing tape.' move-flat 1.8
check "the task proposed in move-flat is in move-flat/state.json only (not in the referenced project)" "$(grep -q 'buy packing tape' $HOMED/move-flat/state.json && ! grep -q 'buy packing tape' $REF/state.json && echo true)"
check "/state of each project shows its own board (the other project's item never shows)" "$(st 'project=move-flat&only=state.json' | q 'x.items.length===1 && x.items[0].text==="buy packing tape"' | grep -q true && st 'only=state.json' | q '!x.items.some(i=>/packing tape/.test(i.text)) && x.items.length===22')"
check "the model saw only move-flat's chat (\"1 messages in context\")" "$(grep -q '1 messages in context' $HOMED/move-flat/transcript.jsonl && echo true)"
check "the controller counts per project: /rules says messages 2 in move-flat and 98+ in the other" "$(has 'index: messages 2 /' "$(lines /rules move-flat)" && has 'index: messages (9[89]|1[0-9][0-9]) /' "$(lines /rules)" && echo true)"
cmd '/model chat morrow' move-flat > /dev/null
check "pins per project: /model chat morrow in move-flat writes move-flat/roles.json; the other project stays unpinned" "$( [ -f $HOMED/move-flat/roles.json ] && [ ! -e $REF/roles.json ] && st 'project=move-flat&only=roles.json' | q 'x.models.chat.pinned===true && x.models.chat.active==="morrow"' | grep -q true && st 'only=roles.json' | q 'x.models.chat.pinned===false && x.models.chat.active==="frontier"')"
cmd '/flag settled-input on' move-flat > /dev/null
check "flags per project: /flag settled-input on in move-flat writes move-flat/flags.json; the other project stays off" "$( [ -f $HOMED/move-flat/flags.json ] && [ ! -e $REF/flags.json ] && st 'project=move-flat&only=flags.json' | q 'x.flags.settledInput===true' | grep -q true && st 'only=flags.json' | q 'x.flags.settledInput===false')"
check "/stats is per project: move-flat counts its 2 messages, not the other project's" "$(has 'quiet' "$(lines /stats move-flat)" && ! has '9[0-9] messages' "$(lines /stats move-flat)" && echo true)"
check "an unknown project is 404 everywhere (state, events, chat, command, answer, move)" "$( [ "$(code '/state?project=nope')" = 404 ] && [ "$(curl -s -o /dev/null -m 2 -w '%{http_code}' 'localhost:4920/events?project=nope')" = 404 ] && [ "$(post /chat '{"text":"x","project":"nope"}' | tail -1)" = 404 ] && [ "$(post /command '{"text":"/help","project":"nope"}' | tail -1)" = 404 ] && [ "$(post /answer '{"module":"index","answer":"y","project":"nope"}' | tail -1)" = 404 ] && [ "$(post /move '{"itemId":"task-1","column":"done","project":"nope"}' | tail -1)" = 404 ] && echo true)"

echo "== 4. SSE per project; one watcher per open project"
SSE_PROJECT=pilot-verify-v13ref node dev/sse-probe.js listen 4920 2500 "$T/sseA.jsonl" & PA=$!; PIDS+=($PA)
SSE_PROJECT=move-flat node dev/sse-probe.js listen 4920 2500 "$T/sseB.jsonl" & PB=$!; PIDS+=($PB)
sleep 0.5
say 'Task: label the boxes.' move-flat 1.2
node -e 'const f="'$HOMED'/move-flat/state.json",fs=require("fs"),s=JSON.parse(fs.readFileSync(f));s.items[0].text="buy strong packing tape";fs.writeFileSync(f,JSON.stringify(s,null,2))'
wait $PA $PB
check "a tab on move-flat gets its changes (transcript.jsonl, state.json)" "$(qa 'x.some(e=>e.event==="change"&&e.data.file==="transcript.jsonl") && x.some(e=>e.event==="change"&&e.data.file==="state.json")' < "$T/sseB.jsonl")"
check "a tab on the other project gets none of them (only its hello)" "$(qa 'x[0].event==="hello" && !x.some(e=>e.event==="change")' < "$T/sseA.jsonl")"
sleep 0.4
check "while a tab had move-flat open, a hand edit of its state.json was seen (file_edit logged)" "$(qa 'x.some(e=>e.event==="file_edit"&&e.itemId==="task-1")' < $HOMED/move-flat/metrics.jsonl)"
sleep 5.5   # UNWATCH_MS 5000 after the last tab left
FE=$(grep -c '"file_edit"' $HOMED/move-flat/metrics.jsonl)
node -e 'const f="'$HOMED'/move-flat/state.json",fs=require("fs"),s=JSON.parse(fs.readFileSync(f));s.items[0].text="buy tape";fs.writeFileSync(f,JSON.stringify(s,null,2))'; sleep 0.5
check "5 s after its last tab left, move-flat is no longer watched: a hand edit logs no file_edit (the ledger still attributes it)" "$( [ "$(grep -c '"file_edit"' $HOMED/move-flat/metrics.jsonl)" = "$FE" ] && st 'project=move-flat&only=state.json' | q 'x.items[0].text==="buy tape" && !!x.items[0].prov')"
SSE_PROJECT=move-flat node dev/sse-probe.js listen 4920 1200 "$T/sseC.jsonl" & PC=$!; PIDS+=($PC); sleep 0.4
node -e 'const f="'$HOMED'/move-flat/state.json",fs=require("fs"),s=JSON.parse(fs.readFileSync(f));s.items[0].text="buy packing tape";fs.writeFileSync(f,JSON.stringify(s,null,2))'
wait $PC
check "a tab opening it again starts the watcher again (the change is pushed)" "$(qa 'x.some(e=>e.event==="change"&&e.data.file==="state.json")' < "$T/sseC.jsonl")"
SSE_PROJECT=move-flat node dev/sse-probe.js listen 4920 1200 "$T/sseD.jsonl" & PD=$!; PIDS+=($PD); sleep 0.4
cmd '/project rename Moving house' move-flat > /dev/null; wait $PD
check "a projects.json change is pushed to every open tab (change projects.json)" "$(qa 'x.some(e=>e.event==="change"&&e.data.file==="projects.json")' < "$T/sseD.jsonl")"

echo "== 5. rename, archive (nothing deleted), unarchive"
check "/project rename: projects.json name, project_rename by user in that project's metrics" "$(q 'x.projects.find(p=>p.id==="move-flat").name==="Moving house"' < $HOMED/projects.json | grep -q true && qa 'x.some(e=>e.event==="project_rename"&&e.name==="Moving house"&&e.was==="Move flat"&&e.by==="user")' < $HOMED/move-flat/metrics.jsonl)"
F0=$(cd $HOMED/move-flat && find . -type f | sort | xargs shasum)
OUT=$(cmd '/project archive' move-flat)
check "/project archive (the project you are in): archived: true, you are taken to the first listed project; every file stays" "$(q 'x.ok && x.project==="pilot-verify-v13ref"' <<< "$OUT" | grep -q true && q 'x.projects.find(p=>p.id==="move-flat").archived===true' < $HOMED/projects.json | grep -q true && [ "$(cd $HOMED/move-flat && find . -type f ! -name metrics.jsonl | sort | xargs shasum)" = "$(grep -v metrics.jsonl <<< "$F0")" ] && echo true)"
check "/projects hides it (\"1 archived\"), /projects all lists it; it still opens by its id" "$(! has 'move-flat ' "$(lines /projects)" && has '1 archived' "$(lines /projects)" && has 'move-flat .*archived' "$(lines '/projects all')" && [ "$(code '/state?project=move-flat')" = 200 ] && echo true)"
cmd '/project archive tax-2' > /dev/null; cmd '/project archive move-flat-2' > /dev/null
check "the last listed project cannot be archived" "$(cmd '/project archive' | q '!x.ok && /last project/.test(x.lines[0])')"
check "/project unarchive Moving house: back in the list" "$(cmd '/project unarchive Moving house' | q 'x.ok' | grep -q true && q 'x.projects.find(p=>p.id==="move-flat").archived===undefined' < $HOMED/projects.json)"
check "/project <name>: switches (returns the project id); an unknown one says so" "$(cmd '/project moving' | q 'x.project==="move-flat"' | grep -q true && cmd '/project nothing-like-this' | q '!x.ok')"

echo "== 6. path safety, a missing dir, a broken projects.json"
node -e 'const f="'$HOMED'/projects.json",fs=require("fs"),x=JSON.parse(fs.readFileSync(f));x.projects.push({id:"evil",name:"evil",dir:"../../.."},{id:"Bad Id",name:"bad",dir:"bad"},{id:"gone",name:"gone",dir:"gone"},{id:"home",name:"home",dir:"."});fs.writeFileSync(f,JSON.stringify(x,null,2))'; sleep 0.3
check "an entry outside pilot/app/, a bad id, the home itself: not listed, 404" "$(! has 'evil|Bad Id|home ' "$(lines '/projects all')" && [ "$(code '/state?project=evil')" = 404 ] && [ "$(code '/state?project=home')" = 404 ] && echo true)"
check "an entry whose dir does not exist: listed as missing, 404, and the dir is not created" "$(has 'gone .*dir missing' "$(lines '/projects all')" && [ "$(code '/state?project=gone')" = 404 ] && [ ! -e $HOMED/gone ] && echo true)"
cp $HOMED/projects.json "$T/pj.json"; printf '{ broken' > $HOMED/projects.json; sleep 0.3
check "a broken projects.json: the last good list is used, /project new is refused and the file is not overwritten" "$(st 'project=move-flat&only=projects.json' | q 'x.projects.list.some(p=>p.id==="move-flat") && /not valid JSON/.test(x.projects.error)' | grep -q true && cmd '/project new x' | q '!x.ok && /not valid JSON/.test(x.lines[0])' | grep -q true && [ "$(cat $HOMED/projects.json)" = '{ broken' ] && echo true)"
cp "$T/pj.json" $HOMED/projects.json
stop_server
check "PILOT_HOME outside pilot/app/ is refused at start" "$(PILOT_HOME=../.. PILOT_CONFIG="$T/conf.json" node server.js > "$T/bad.log" 2>&1; grep -q 'PILOT_HOME must be a folder inside' "$T/bad.log" && echo true)"
check "every earlier project file still there after all of it (nothing deleted): the reference's chats, move-flat, tax-2" "$( [ -f $REF/chats/c-scratch.jsonl ] && [ -f $REF/transcript.jsonl ] && [ -f $HOMED/move-flat/state.json ] && [ -f $HOMED/tax-2/rules.json ] && echo true)"

echo "== 7. the page (browser-check.js v13)"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v13 | tee "$T/browser.log"
  check "browser checks (v13) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi

echo "== 8. demo v0.13 within 30 s (ports +300, dir .pilot-demo-verify13)"
DEMO_PORT_SHIFT=300 PILOT_DEMO_DIR=.pilot-demo-verify13 node scripts/demo.js v0.13 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 'localhost:5090/state?only=projects.json,state.json' > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves within 30 s: two projects (health insurance claim with 4 chats, move flat with 2), the first one's board" "$( [ -n "$UP" ] && q 'x.projects.home && x.projects.list.map(p=>p.name+":"+p.chats.length).join(",")==="health insurance claim:4,move flat:2" && x.items.length===21' < "$T/ds.json")"
check "demo: move flat has its own, different board (5 items, the kanban shown)" "$(curl -s 'localhost:5090/state?project=move-flat' | q 'x.items.length===5 && x.items.some(i=>i.text==="give notice on the old flat by Friday") && x.panes.join()==="kanban"')"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
check "try lines: switch project (board changes), + new chat in a project, + new project, a second tab in another project" "$(grep -q 'board changes' "$T/demo.log" && grep -q '+ new chat' "$T/demo.log" && grep -q '+ new project' "$T/demo.log" && grep -q 'second tab' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 610(0|1)' > /dev/null && ! lsof -iTCP:5090 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"
S1=$(find demo/fixtures/v0.13 -type f | sort | xargs cat | shasum); node dev/make-fixture-v13.js > /dev/null; S2=$(find demo/fixtures/v0.13 -type f | sort | xargs cat | shasum)
check "make-fixture-v13.js is deterministic; health insurance claim is the v0.12 fixture byte for byte" "$( [ "$S1" = "$S2" ] && for f in transcript.jsonl metrics.jsonl state.json modules.json rules.json chats.json chats/c-hospital.jsonl chats/c-invoices.jsonl chats/c-scratch.jsonl; do cmp -s demo/fixtures/v0.12/$f demo/fixtures/v0.13/health-insurance-claim/$f || exit 1; done && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.13 CHECKS PASSED" || echo "$FAILS v0.13 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
