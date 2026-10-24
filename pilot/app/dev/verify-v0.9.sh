#!/bin/bash
# DEV ONLY. pilot-v0.9 checks: the settled-input experiment behind a flag. The heuristic (public/settle.js, as a node
# table), the flag (config default off, experiments.settledInput, /flag kept in flags.json, its precedence, a broken
# flags.json), POST /metric for settle_offer / settle_accept / settle_ignore / enter_send (only while on, no text, one
# outcome per offer), the /stats experiments block (= npm run stats), the page (browser-check.js v09) and the v0.9 demo.
# Against dev/fake-model.js only. Own ports (server 4820, fakes 5821/5822; browser part 4825/5826/5827 + Chrome 9403;
# demo part shifted +200: 4976/5978/5979) and own dirs (.pilot-verify-v09/, .pilot-verify-v09b/, .pilot-demo-verify09/),
# so it never touches .pilot/ or a running demo. Usage (from anywhere): bash pilot/app/dev/verify-v0.9.sh
set -u
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T"; PIDS=(); SERVER=""
DIR="$T/.pilot-verify-v09"
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4820 4976 5821 5822
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
# conf <file> <experiments JSON or "none">: the dev config on this script's ports
conf() { node -e '
  const c=require("./pilot.config.dev.json"); c.port=4820;
  for (const k of c.roles.chat.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5821/").replace(":5702/",":5822/");
  c.roles.extract.candidates[0].baseUrl="http://127.0.0.1:5822/v1";
  if (process.argv[2]==="none") delete c.experiments; else c.experiments=JSON.parse(process.argv[2]);
  require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$1" "$2"; }
fake() { node dev/fake-model.js "$1" "$2" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); }
server() { PILOT_DIR="$DIR" PILOT_CONFIG="$1" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -s -m 1 localhost:4820/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
cmd() { curl -s -X POST localhost:4820/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
lines() { cmd "$1" | q 'x.lines.join("\n")'; }
metric() { curl -s -w '\n%{http_code}' -X POST localhost:4820/metric -H 'content-type: application/json' -d "$1"; }
code() { metric "$1" | tail -1; }
flags() { curl -s "localhost:4820/state?only=flags.json" | q "$1"; }
ev() { qa "$1" < "$DIR/metrics.jsonl"; }
has() { grep -qE -- "$1" <<< "$2"; }

fake 5821 frontier; fake 5822 morrow; sleep 0.3

echo "== 1. the heuristic (public/settle.js, deterministic, no model)"
node -e '
  const { looksFinished } = require("./public/settle.js");
  const cases = [
    ["Is the envelope ready?", true, "question"], ["Send it now.  ", true, "punct"], ["Thanks!", true, "punct"],
    ["(see the map).", true, "punct"], ["He said \"done.\"", true, "punct"], ["Is that it?)", true, "question"],
    ["what is left for Monday", true, "question"], ["Decision: keep it local.", true, "punct"],
    ["this is not done,", false], ["and then:", false], ["wait...", false], ["I was thinking…", false], ["like e.g.", false],
    ["Step 3.", false], ["see https://x.org.", false], ["?", false], ["yes.", false], ["ok", false], ["/stats.", false],
    ["what about the", false], ["use `npm run", false], ["is it (really?", false], ["", false], ["   ", false],
  ];
  let bad = 0;
  for (const [t, fin, cue] of cases) {
    const r = looksFinished(t);
    const ok = r.finished === fin && (!fin || r.cue === cue);
    if (!ok) bad++;
    console.log(`   ${ok ? "ok " : "BAD"} ${JSON.stringify(t).padEnd(30)} -> ${r.finished ? "finished (" + r.cue + ")" : "not finished"}: ${r.why}`);
  }
  console.log(bad ? "BAD " + bad : "TABLE OK " + cases.length);' > "$T/table.txt"
cat "$T/table.txt"
check "every case of the heuristic table gives the documented verdict ($(tail -1 $T/table.txt))" "$(grep -q '^TABLE OK' "$T/table.txt" && echo true)"

echo "== 2. off by default: no experiments key, then experiments.settledInput false"
fixture_reset "$DIR"; mkdir -p "$DIR"
conf "$T/none.json" none; conf "$T/off.json" '{"settledInput":false}'; conf "$T/on.json" '{"settledInput":true,"settleMs":50}'
server "$T/none.json"
check "no experiments in the config: off, from the default, offer after 1800 ms" "$(flags 'x.flags.settledInput===false && x.flags.source==="default (off)" && x.flags.settleMs===1800')"
check "/flag shows it: settled-input: off (from default (off); offer after 1800 ms; Enter always sends)" "$(has '^settled-input: off  \(from default \(off\); offer after 1800 ms; Enter always sends\)$' "$(lines /flag)" && echo true)"
check "/help lists /flag" "$(cmd /help | q 'x.lines.some(l=>l.startsWith("/flag"))')"
OUT=$(metric '{"event":"settle_offer","offer":"so-a1","cue":"punct","chars":5,"words":1,"sinceKeyMs":1800}')
check "while off, POST /metric settle_offer is refused (400 'experiment is off') and nothing is logged" "$(echo "$OUT" | tail -1 | grep -qx 400 && has 'experiment is off' "$OUT" && ev '!x.some(e=>/^settle_|^enter_send$/.test(e.event))' | grep -q true && echo true)"
check "while off, no flags.json is written" "$( [ ! -e "$DIR/flags.json" ] && echo true)"
stop_server
server "$T/off.json"
check "experiments.settledInput false: off, from the config" "$(flags 'x.flags.settledInput===false && /experiments\.settledInput$/.test(x.flags.source)')"
stop_server
check "pilot.config.json and pilot.config.dev.json ship the flag off (settleMs 1800)" "$(node -e 'const a=require("./pilot.config.json").experiments,b=require("./pilot.config.dev.json").experiments;console.log(a.settledInput===false&&b.settledInput===false&&a.settleMs===1800)')"

echo "== 3. on through the config; /flag; flags.json wins and survives a restart"
server "$T/on.json"
check "experiments.settledInput true: on; settleMs 50 is clamped to 300" "$(flags 'x.flags.settledInput===true && x.flags.settleMs===300 && /experiments\.settledInput$/.test(x.flags.source)')"
check "/flag nope on -> 400 unknown flag; /flag settled-input maybe -> 400 usage" "$(cmd '/flag nope on' | q '!x.ok && /unknown flag/.test(x.lines[0])' | grep -q true && cmd '/flag settled-input maybe' | q '!x.ok && /usage: \/flag settled-input on\|off/.test(x.lines[0])')"
cmd '/flag settled-input off' > /dev/null
check "/flag settled-input off: flags.json {rev 1, experiments.settledInput false}, a system line, a flag event; /state says flags.json wins over the config" "$(q 'x.rev===1 && x.experiments.settledInput===false' < "$DIR/flags.json" | grep -q true && qa 'x.some(l=>l.role==="system"&&l.text==="experiment settled-input off (/flag)")' < "$DIR/transcript.jsonl" | grep -q true && ev 'x.some(e=>e.event==="flag"&&e.name==="settled-input"&&e.value===false&&e.was===true)' | grep -q true && flags 'x.flags.settledInput===false && /flags\.json \(\/flag\)$/.test(x.flags.source)')"
check "the /flag system line is not a turn" "$(curl -s localhost:4820/state | q 'x.turn===0')"
cmd '/flag settled-input on' > /dev/null
stop_server; server "$T/off.json"
check "after a restart with a config that says off, flags.json (on, rev 2) still wins" "$(flags 'x.flags.settledInput===true && x.flags.rev===2')"

echo "== 4. POST /metric settle events: validated, no text, one outcome per offer"
check "settle_offer with a bad offer id / a bad cue / a missing number -> 400" "$( [ "$(code '{"event":"settle_offer","offer":"x","cue":"punct","chars":5,"words":1,"sinceKeyMs":1}')" = 400 ] && [ "$(code '{"event":"settle_offer","offer":"so-b1","cue":"maybe","chars":5,"words":1,"sinceKeyMs":1}')" = 400 ] && [ "$(code '{"event":"settle_offer","offer":"so-b1","cue":"punct","words":1,"sinceKeyMs":1}')" = 400 ] && echo true)"
check "a valid settle_offer -> 200; extra fields (a text) are dropped; settleMs and turn are added; numbers rounded" "$( [ "$(code '{"event":"settle_offer","offer":"so-b1","cue":"question","chars":22,"words":4,"sinceKeyMs":1800.6,"text":"Is the envelope ready?"}')" = 200 ] && ! grep -q 'envelope' "$DIR/metrics.jsonl" && ev 'x.some(e=>e.event==="settle_offer"&&e.offer==="so-b1"&&e.sinceKeyMs===1801&&e.settleMs===1800&&e.turn===0&&!("text" in e))' | grep -q true && echo true)"
check "an outcome for an unknown offer -> 400" "$( [ "$(code '{"event":"settle_accept","offerRef":"so-zz","sinceKeyMs":1,"offerMs":1,"chars":3}')" = 400 ] && echo true)"
check "enter_send: offerShowing true needs offerRef, false must not have one -> 400" "$( [ "$(code '{"event":"enter_send","offerShowing":true,"sinceKeyMs":1,"chars":3}')" = 400 ] && [ "$(code '{"event":"enter_send","offerShowing":false,"offerRef":"so-b1","sinceKeyMs":1,"chars":3}')" = 400 ] && echo true)"
check "settle_accept so-b1 -> 200; a second outcome for it (ignore or Enter) -> 400" "$( [ "$(code '{"event":"settle_accept","offerRef":"so-b1","sinceKeyMs":2400,"offerMs":600,"chars":22}')" = 200 ] && [ "$(code '{"event":"settle_ignore","offerRef":"so-b1","how":"typed","offerMs":1}')" = 400 ] && [ "$(code '{"event":"enter_send","offerShowing":true,"offerRef":"so-b1","sinceKeyMs":1,"chars":3}')" = 400 ] && echo true)"
metric '{"event":"settle_offer","offer":"so-b2","cue":"punct","chars":10,"words":2,"sinceKeyMs":1800}' > /dev/null
metric '{"event":"settle_offer","offer":"so-b3","cue":"punct","chars":10,"words":2,"sinceKeyMs":1800}' > /dev/null
metric '{"event":"settle_offer","offer":"so-b4","cue":"punct","chars":10,"words":2,"sinceKeyMs":1800}' > /dev/null
stop_server; server "$T/off.json"
check "after a restart: an offer logged before is known (so-b2 ignore -> 200), an outcome logged before still blocks a second (so-b1 -> 400)" "$( [ "$(code '{"event":"settle_ignore","offerRef":"so-b2","how":"escape","offerMs":900}')" = 200 ] && [ "$(code '{"event":"settle_ignore","offerRef":"so-b1","how":"typed","offerMs":1}')" = 400 ] && echo true)"
metric '{"event":"enter_send","offerShowing":true,"offerRef":"so-b3","sinceKeyMs":2100,"chars":10}' > /dev/null
metric '{"event":"enter_send","offerShowing":false,"sinceKeyMs":300,"chars":4}' > /dev/null
metric '{"event":"enter_send","offerShowing":false,"sinceKeyMs":500,"chars":4}' > /dev/null

echo "== 5. /stats: the experiments block (measured, not judged), the same as npm run stats"
S=$(lines /stats)
echo "$S" | sed -n '/^experiments/,$p' | sed 's/^/   /'
check "experiments block: 4 offers, 1 Tab, 1 ignored (Escape), 1 Enter while showing, 1 unresolved (so-b4)" "$(has '^ +4 offers "send\?": 1 accepted with Tab, 1 ignored \(0 kept typing, 1 Escape\), 1 sent with Enter while showing, 1 unresolved$' "$S" && echo true)"
check "... 3 sent with Enter (1 with an offer, 2 without); medians: Tab 2.4 s, Enter with offer 2.1 s, Enter without 0.4 s" "$(has '^ +3 sent with Enter: 1 while an offer showed, 2 without one; 4 sends in all while the flag was on$' "$S" && has '^ +last keystroke to send \(median, n\): Tab 2\.4 s \(1\), Enter with offer 2\.1 s \(1\), Enter without 0\.4 s \(2\)$' "$S" && has '^ +settled-input: on in flags.json; switched 2 times with /flag$' "$S" && echo true)"
check "still exactly five verdict lines (PASS / NOT YET); the experiments lines have none" "$( [ "$(echo "$S" | grep -cE '^[a-z]+ +(PASS|NOT YET) ')" -eq 5 ] && ! echo "$S" | sed -n '/^experiments/,$p' | grep -qE 'PASS|NOT YET' && echo true)"
NPM=$(npm run -s stats -- "$DIR")
check "npm run stats -- $DIR prints exactly the lines of /stats" "$( [ "$NPM" = "$S" ] && echo true)"

echo "== 6. a broken flags.json: last good version, never overwritten"
printf '{"rev": 9, "experiments": {' > "$DIR/flags.json"; sleep 0.3
check "/state reports flags.json in fileErrors and keeps the last good value (on)" "$(curl -s localhost:4820/state | q 'x.fileErrors["flags.json"] && x.flags.settledInput===true')"
OUT=$(cmd '/flag settled-input off')
check "/flag refuses to write it (400), the file is unchanged" "$(q '!x.ok && /not valid JSON/.test(x.lines[0])' <<< "$OUT" | grep -q true && [ "$(cat "$DIR/flags.json")" = '{"rev": 9, "experiments": {' ] && echo true)"
printf '{"rev": 9, "experiments": {"settledInput": false}}\n' > "$DIR/flags.json"; sleep 0.3
check "a repaired hand edit is read: off, no file error" "$(curl -s localhost:4820/state | q '!x.fileErrors["flags.json"] && x.flags.settledInput===false')"
node dev/sse-probe.js listen 4820 1500 "$T/ev.jsonl" & L=$!; PIDS+=($!)
for i in $(seq 1 50); do grep -q '"hello"' "$T/ev.jsonl" 2>/dev/null && break; sleep 0.05; done
cmd '/flag settled-input on' > /dev/null; wait "$L" 2>/dev/null
check "/flag pushes a change event for flags.json (rev 10) to every open page" "$(qa 'x.some(e=>e.event==="change"&&e.data.file==="flags.json"&&e.data.rev===10)' < "$T/ev.jsonl")"
stop_server

echo "== 7. page (headless Chrome): off = today, the offer, Tab, Enter, Escape, /stats, narrow widths"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v09 | tee "$T/browser.log"
  check "browser checks (v09) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
check "contrast-check.js passes (the offer uses the checked --muted pair)" "$( [ $RC -eq 0 ] && echo true)"

echo "== 8. demo v0.9 within 30 s (ports +200, dir $T/.pilot-demo-verify09)"
PILOT_FIXTURE_ROOT="$T" DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR="$T/.pilot-demo-verify09" node scripts/demo.js v0.9 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -s -m 1 localhost:4976/state > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s with the flag on (demo config only), offer after 1800 ms (the default)" "$( [ -n "$UP" ] && q 'x.flags.settledInput===true && x.flags.settleMs===1800 && /demo\.config\.json experiments\.settledInput$/.test(x.flags.source) && x.faded.join()==="kanban"' < "$T/ds.json")"
curl -sN -X POST localhost:4976/chat -H 'content-type: application/json' -d '{"text":"what is left for Monday?"}' > /dev/null; sleep 0.5
check "demo: a message neither fades a pane nor asks a removal question (thresholds 20)" "$(curl -s localhost:4976/state | q 'x.faded.join()==="kanban" && !x.pending')"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
check "try lines: pause, Tab, keep typing, Enter still sends, /stats experiments, /flag settled-input off" "$(grep -q 'pause' "$T/demo.log" && grep -q 'Press Tab' "$T/demo.log" && grep -q 'keep typing' "$T/demo.log" && grep -q 'Enter still sends' "$T/demo.log" && grep -q '/flag settled-input off restores the default' "$T/demo.log" && echo true)"
OUT=$(curl -s -X POST localhost:4976/command -H 'content-type: application/json' -d '{"text":"/flag settled-input off"}')
check "demo: /flag settled-input off restores the default" "$(curl -s 'localhost:4976/state?only=flags.json' | q 'x.flags.settledInput===false')"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 597(8|9)' > /dev/null && ! lsof -iTCP:4976 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"
check "the v0.8 fixture is unchanged by the v0.9 generator" "$(git diff --quiet -- demo/fixtures/v0.8 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.9 CHECKS PASSED" || echo "$FAILS v0.9 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
