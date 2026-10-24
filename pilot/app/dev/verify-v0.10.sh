#!/bin/bash
# DEV ONLY. pilot-v0.10 checks: frame proposals behind a flag. The closed FrameIntent (frame.js + the schema, as a node
# table), the flag (off by default: no call, no file, no event), the frame role after a turn (frames.json, frame_propose),
# POST /frame apply/dismiss (rev, ids, re-check on apply), /frame reset, every rejection mode of the fake (rejected whole,
# logged, nothing written), pins / local-only fallback / stall for the frame role, a broken frames.json, /why map with
# every source resolved, modules.json and state.json untouched by any frame write, the page (browser-check.js v10), the
# v0.10 demo. Against dev/fake-model.js only. Own ports (server 4830; fakes: chat 5831/5832, frame 5833 and 5834;
# browser part 4835/5836/5837 + Chrome 9413; demo part shifted +200: 4978/5983/5984) and own dirs (.pilot-verify-v10/,
# .pilot-verify-v10b/, .pilot-demo-verify10/), so it never touches .pilot/ or a running demo.
# Usage (from anywhere): bash pilot/app/dev/verify-v0.10.sh
set -u
cd "$(dirname "$0")/.." || exit 1
source dev/lib/safe-dir.sh || exit 1
T=$(fixture_temp) || exit 1; fixture_root "$T"; FIXTURE_ROOT="$T"; PIDS=(); SERVER=""; F3=""; F4=""
DIR="$T/.pilot-verify-v10"
cleanup() { kill "${PIDS[@]}" 2>/dev/null; wait 2>/dev/null; fixture_remove "$T"; }
trap cleanup EXIT
fixture_ports 4830 4978 5831 5832 5833 5834
FAILS=0
check() { if [ "$2" = "true" ]; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS+1)); fi; }
q() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);console.log(String($1))})"; }
qa() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=s.trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));console.log(String($1))})"; }
# conf <file> <experiments JSON or "none"> [frame role JSON]: the dev config on this script's ports; the frame role
# defaults to one local candidate "morrow" on 5833
conf() { node -e '
  const c=require("./pilot.config.dev.json"); c.port=4830;
  for (const k of c.roles.chat.candidates) k.baseUrl=k.baseUrl.replace(":5701/",":5831/").replace(":5702/",":5832/");
  c.roles.extract.candidates[0].baseUrl="http://127.0.0.1:5832/v1";
  c.roles.frame.candidates[0].baseUrl="http://127.0.0.1:5833/v1";
  if (process.argv[3]) c.roles.frame=JSON.parse(process.argv[3]);
  if (process.argv[2]==="none") delete c.experiments; else c.experiments=JSON.parse(process.argv[2]);
  require("fs").writeFileSync(process.argv[1], JSON.stringify(c,null,2));' "$1" "$2" "${3:-}"; }
fake() { node dev/fake-model.js "$1" "$2" "${@:3}" > "$T/fake-$1.log" 2>&1 & PIDS+=($!); LASTFAKE=$!; }
# frame fakes: restartable, with a mode
frame3() { [ -n "$F3" ] && { kill $F3 2>/dev/null; wait $F3 2>/dev/null; }; F3=""; [ "$1" = "down" ] && return; fake 5833 morrow "$@"; F3=$LASTFAKE; sleep 0.3; }
frame4() { [ -n "$F4" ] && { kill $F4 2>/dev/null; wait $F4 2>/dev/null; }; F4=""; [ "$1" = "down" ] && return; fake 5834 frontier "$@"; F4=$LASTFAKE; sleep 0.3; }
server() { PILOT_DIR="$DIR" PILOT_CONFIG="$1" node server.js >> "$T/server.log" 2>&1 & SERVER=$!; PIDS+=($!); for i in $(seq 1 50); do curl -H 'x-pilot: 1' -s -m 1 localhost:4830/state > /dev/null && return; sleep 0.1; done; }
stop_server() { [ -n "$SERVER" ] && { kill $SERVER 2>/dev/null; wait $SERVER 2>/dev/null; SERVER=""; }; }
cmd() { curl -H 'x-pilot: 1' -s -X POST localhost:4830/command -H 'content-type: application/json' -d "{\"text\":\"$1\"}"; }
lines() { cmd "$1" | q 'x.lines.join("\n")'; }
chat() { curl -H 'x-pilot: 1' -sN -X POST localhost:4830/chat -H 'content-type: application/json' -d "{\"text\":\"$1\"}" > /dev/null; settle; }
# wait until extraction and the frame run of the last turn are done
settle() { for i in $(seq 1 100); do curl -H 'x-pilot: 1' -s localhost:4830/state | q '!x.extracting && !x.framing' | grep -q true && return; sleep 0.05; done; }
post() { curl -H 'x-pilot: 1' -s -w '\n%{http_code}' -X POST localhost:4830/frame -H 'content-type: application/json' -d "$1"; }
code() { post "$1" | tail -1; }
st() { curl -H 'x-pilot: 1' -s "localhost:4830/state${1:-}"; }
ev() { qa "$1" < "$DIR/metrics.jsonl"; }
fr() { q "$1" < "$DIR/frames.json"; }
has() { grep -qE -- "$1" <<< "$2"; }
nev() { grep -c "\"event\":\"$1\"" "$DIR/metrics.jsonl" 2>/dev/null || true; }
# the v0.10 fixture, with fading thresholds raised to 100 so the ~16 turns of this script never fade a pane or ask
seed() { fixture_reset "$DIR"; mkdir -p "$DIR"; printf '%s\n' '{"rev":1,"share":{"board":true},"changedBy":"frame-test"}' > "$DIR/context.json"; for f in transcript.jsonl metrics.jsonl state.json modules.json rules.json; do cp demo/fixtures/v0.10/$f "$DIR/"; done
  node -e 'const f=process.argv[1],fs=require("fs"),r=JSON.parse(fs.readFileSync(f));r.fadeAfterTurns=100;r.askRemoveAfterTurns=100;fs.writeFileSync(f,JSON.stringify(r,null,2))' "$DIR/rules.json"; }
sums() { shasum "$DIR/modules.json" "$DIR/state.json" | awk '{print $1}' | tr '\n' ' '; }

fake 5831 frontier; fake 5832 morrow; sleep 0.3

echo "== 1. the closed FrameIntent (frame.js + schemas/frame-intent.schema.json, no model)"
node -e '
  const frame = require("./frame.js");
  const items = require("./demo/fixtures/v0.10/state.json").items;
  const ctx = { visible: ["map", "index", "kanban"], faded: ["kanban"], items };
  const J = JSON.stringify;
  // [model text, expected: "ok" | "none" | reason]
  const cases = [
    [J({ pane: "map", focus: "dec-2", order: ["dec-2", "dec-4", "src-1"] }), "ok"],
    [J({ pane: "map", group: "status" }), "ok"],
    [J({ pane: "map", order: ["dec-5"], group: "author" }), "ok"],
    ["```json\n" + J({ pane: "map", focus: "dec-1" }) + "\n```", "ok"],
    ["{}", "none"],
    ["{\"pane\": \"map\", \"focus", "malformed"],
    ["[]", "schema"],
    [J({ focus: "dec-2" }), "schema"],
    [J({ pane: "index", focus: "dec-2" }), "schema"],
    [J({ pane: "chat" }), "schema"],
    [J({ pane: "map", focus: "dec-2", hide: ["dec-1"] }), "schema"],
    [J({ pane: "map", focus: "dec-2", status: { "dec-2": "confirmed" } }), "schema"],
    [J({ pane: "map", focus: "dec-2", text: "new title" }), "schema"],
    [J({ pane: "map", add: "kanban" }), "schema"],
    [J({ pane: "map", focus: 2 }), "schema"],
    [J({ pane: "map", order: "dec-2" }), "schema"],
    [J({ pane: "map", group: "kind" }), "schema"],
    [J({ pane: "map", focus: "" }), "schema"],
    [J({ pane: "map", order: Array.from({ length: 61 }, (_, i) => "dec-1") }), "schema"],
    [J({ pane: "map", focus: "dec-99" }), "id"],
    [J({ pane: "map", order: ["dec-2", "dec-99"] }), "id"],
    [J({ pane: "map", focus: "task-1" }), "id"],
    [J({ pane: "map", focus: "dec-3" }), "id"],
    [J({ pane: "map", order: ["dec-2", "dec-2"] }), "id"],
    [J({ pane: "map" }), "empty"],
    [J({ pane: "map", order: [] }), "empty"],
    [J({ pane: "kanban", focus: "task-1" }), "pane"],
  ];
  let bad = 0;
  for (const [text, want] of cases) {
    const p = frame.parse(text);
    const got = p.none ? "none" : p.error ? p.reason : (() => { const c = frame.check(p.intent, ctx); return c.ok ? "ok" : c.reason; })();
    const why = p.error || (p.intent && !frame.check(p.intent, ctx).ok ? frame.check(p.intent, ctx).errors.join("; ") : "");
    if (got !== want) bad++;
    console.log(`   ${got === want ? "ok " : "BAD"} ${text.replace(/\n/g, " ").slice(0, 70).padEnd(70)} -> ${got}${why ? ": " + why.slice(0, 90) : ""}`);
  }
  // a pane that is not consented, and a kanban that is shown
  const c2 = frame.check({ pane: "kanban", focus: "task-1" }, { visible: ["map"], faded: [], items });
  const c3 = frame.check({ pane: "kanban", focus: "task-1", order: ["task-7", "task-1"] }, { visible: ["map", "kanban"], faded: [], items });
  if (c2.ok || c2.reason !== "pane" || !c3.ok) bad++;
  console.log(`   ${!c2.ok && c2.reason === "pane" ? "ok " : "BAD"} kanban not consented -> ${c2.reason}: ${c2.errors && c2.errors[0]}`);
  console.log(`   ${c3.ok ? "ok " : "BAD"} kanban shown, task ids -> ok`);
  console.log(bad ? "BAD " + bad : "TABLE OK " + (cases.length + 2));' > "$T/table.txt"
cat "$T/table.txt"
check "every FrameIntent case gives the documented verdict ($(tail -1 "$T/table.txt"))" "$(grep -q '^TABLE OK' "$T/table.txt" && echo true)"
check "the schema is closed: additionalProperties false, keys pane/focus/order/group only, pane map|kanban, group status|author" "$(node -e 'const s=require("./schemas/frame-intent.schema.json");console.log(s.additionalProperties===false&&Object.keys(s.properties).join()==="pane,focus,order,group"&&s.properties.pane.enum.join()==="map,kanban"&&s.properties.group.enum.join()==="status,author")')"

echo "== 2. off by default: no frame call, no frames.json, no event"
seed
conf "$T/none.json" none; conf "$T/off.json" '{"frameProposals":false}'; conf "$T/on.json" '{"frameProposals":true}'
frame3 --frame=good
server "$T/none.json"
check "no experiments in the config: frame-proposals off, from the default; /flag shows both flags" "$(st '?only=flags.json' | q 'x.flags.frameProposals===false && x.flags.frameSource==="default (off)" && x.flags.settledInput===false')"
L=$(lines /flag)
check "/flag: the settled-input line unchanged and first, then frame-proposals: off" "$(has '^settled-input: off  \(from default \(off\); offer after 1800 ms; Enter always sends\)$' "$(head -1 <<< "$L")" && has '^frame-proposals: off  \(from default \(off\); the frame role only suggests, f applies, /frame reset undoes\)$' "$(sed -n 2p <<< "$L")" && echo true)"
check "/help lists /frame and /flag frame-proposals" "$(cmd /help | q 'x.lines.some(l=>l.startsWith("/frame"))&&x.lines.some(l=>l.startsWith("/flag frame-proposals"))')"
check "pilot.config.json and pilot.config.dev.json ship frameProposals false and a frame role (local morrow, structured)" "$(node -e 'const a=require("./pilot.config.json"),b=require("./pilot.config.dev.json");console.log([a,b].every(c=>c.experiments.frameProposals===false&&c.roles.frame.candidates.length===1&&c.roles.frame.candidates[0].local===true&&c.roles.frame.candidates[0].structured===true))')"
N0=$(wc -l < "$DIR/metrics.jsonl")
chat "what about keeping the claim local?"
check "off: a turn makes no frame call, writes no frames.json, logs no frame event (the frame fake saw nothing)" "$( [ ! -e "$DIR/frames.json" ] && tail -n +$((N0+1)) "$DIR/metrics.jsonl" | qa '!x.some(e=>e.role==="frame"||/^frame_/.test(e.event))' | grep -q true && ! grep -q '\[frame\]' "$T/fake-5833.log" && echo true)"
OUT=$(post '{"pane":"map","id":"fr-1","action":"apply"}')
check "off: POST /frame -> 409 'experiment is off'" "$(tail -1 <<< "$OUT" | grep -qx 409 && has 'experiment is off' "$OUT" && echo true)"
check "off: /frame says it is off and lists no frame" "$(has '^frame-proposals is off' "$(lines /frame)" && has '^map: no frame' "$(lines /frame)" && echo true)"
stop_server
server "$T/off.json"
check "experiments.frameProposals false: off, from the config" "$(st '?only=flags.json' | q 'x.flags.frameProposals===false && /experiments\.frameProposals$/.test(x.flags.frameSource)')"

echo "== 3. on with /flag: the frame role proposes after a turn; nothing else is written"
cmd '/flag frame-proposals on' > /dev/null
check "/flag frame-proposals on: flags.json, a system line, a flag event (was false); settled-input untouched" "$(q 'x.experiments.frameProposals===true && x.experiments.settledInput===undefined' < "$DIR/flags.json" | grep -q true && grep -q 'experiment frame-proposals on (/flag): after a turn the frame role may suggest' "$DIR/transcript.jsonl" && ev 'x.some(e=>e.event==="flag"&&e.name==="frame-proposals"&&e.value===true&&e.was===false)' | grep -q true && st '?only=flags.json' | q 'x.flags.frameProposals && !x.flags.settledInput && /flags\.json \(\/flag\)$/.test(x.flags.frameSource)')"
S0=$(sums)
chat "what about keeping the claim local?"
check "a turn yields proposal fr-1 for the map in frames.json: focus dec-2, author model, model morrow, fromMessage, turn" "$(fr 'x.rev===1 && x.pending.map.id==="fr-1" && x.pending.map.intent.focus==="dec-2" && x.pending.map.author==="model" && x.pending.map.model==="morrow" && /^m-/.test(x.pending.map.fromMessage) && x.pending.map.turn===39 && !Object.keys(x.applied).length')"
check "logged: model_call role frame (morrow), frame_propose fr-1 module map; the frame request carried response_format" "$(ev 'x.some(e=>e.event==="model_call"&&e.role==="frame"&&e.candidate==="morrow"&&e.ok) && x.some(e=>e.event==="frame_propose"&&e.id==="fr-1"&&e.module==="map"&&e.intent.focus==="dec-2")' | grep -q true && grep -q '\[frame\] mode=good response_format=yes' "$T/fake-5833.log" && echo true)"
check "the frame prompt lists only shown, non-faded panes and no rejected card (the kanban is a tab)" "$(grep -q '"order":\["dec-2"' "$T/fake-5833.log" && ! grep -q 'dec-3\|task-' "$T/fake-5833.log" && echo true)"
check "/state: frames.pending.map, framing false; a proposal changes nothing on screen (applied empty)" "$(st '?only=frames.json' | q 'x.frames.pending.map.id==="fr-1" && !x.frames.applied.map && x.framing===false')"

echo "== 4. POST /frame: only you apply or dismiss; rev, ids, a re-check on apply"
check "bad pane / bad action -> 400" "$( [ "$(code '{"pane":"index","id":"fr-1","action":"apply"}')" = 400 ] && [ "$(code '{"pane":"map","id":"fr-1","action":"confirm"}')" = 400 ] && echo true)"
OUT=$(post '{"pane":"map","id":"fr-1","action":"apply","rev":0}')
check "a stale rev -> 409 {stale: true, file: frames.json}" "$(tail -1 <<< "$OUT" | grep -qx 409 && head -1 <<< "$OUT" | q 'x.stale===true && x.file==="frames.json" && x.rev===1')"
check "a wrong id -> 409, nothing applied" "$( [ "$(code '{"pane":"map","id":"fr-9","action":"apply"}')" = 409 ] && fr '!x.applied.map && x.pending.map.id==="fr-1"')"
OUT=$(post '{"pane":"map","id":"fr-1","action":"apply","rev":1}')
check "apply -> 200: applied.map = fr-1 with appliedBy user and appliedAt, pending gone, rev 2" "$(tail -1 <<< "$OUT" | grep -qx 200 && fr 'x.rev===2 && x.applied.map.id==="fr-1" && x.applied.map.appliedBy==="user" && !!x.applied.map.appliedAt && !x.pending.map')"
check "recorded: frame_apply (by user, the intent, proposedAt) and a system line naming who suggested it" "$(ev 'x.some(e=>e.event==="frame_apply"&&e.id==="fr-1"&&e.by==="user"&&e.module==="map"&&e.intent.focus==="dec-2"&&!!e.proposedAt)' | grep -q true && grep -q 'map: frame fr-1 applied by you (suggested by morrow): focus dec-2' "$DIR/transcript.jsonl" && echo true)"
check "apply again -> 409 (no open proposal)" "$( [ "$(code '{"pane":"map","id":"fr-1","action":"apply"}')" = 409 ] && echo true)"
check "/frame lists it: map: frame fr-1 applied by you … (suggested by morrow)" "$(has '^map: frame fr-1 applied by you at .* \(suggested by morrow\): focus dec-2 · order dec-2, ' "$(lines /frame)" && echo true)"
chat "what about keeping the claim local?"
check "the same frame again is not proposed (frame_reject reason same, nothing written)" "$(fr 'x.rev===2 && !x.pending.map' | grep -q true && ev 'x.some(e=>e.event==="frame_reject"&&e.reason==="same")')"
chat "should the deadline go in the first paragraph?"
check "a different message: proposal fr-2 (focus dec-8)" "$(fr 'x.pending.map.id==="fr-2" && x.pending.map.intent.focus==="dec-8"')"
BODY="{\"pane\":\"map\",\"id\":\"fr-2\",\"action\":\"dismiss\",\"rev\":$(fr 'x.rev')}"
check "dismiss fr-2 -> 200: pending gone, applied fr-1 kept, frame_dismiss, a system line" "$( [ "$(code "$BODY")" = 200 ] && fr '!x.pending.map && x.applied.map.id==="fr-1"' | grep -q true && ev 'x.some(e=>e.event==="frame_dismiss"&&e.id==="fr-2"&&e.by==="user")' | grep -q true && grep -q 'map: frame fr-2 dismissed (suggested by morrow); nothing changed' "$DIR/transcript.jsonl" && echo true)"
check "modules.json and state.json were not written by propose, apply or dismiss" "$( [ "$(sums)" = "$S0" ] && echo true)"
chat "is the registered mail still the plan?"
cp "$DIR/state.json" "$T/state.before"
ID3=$(fr 'x.pending.map.id'); FOC=$(fr 'x.pending.map.intent.focus')
node -e 'const f=process.argv[1],fs=require("fs"),s=JSON.parse(fs.readFileSync(f));const i=s.items.find(i=>i.id===process.argv[2]);i.status="rejected";fs.writeFileSync(f,JSON.stringify(s,null,2))' "$DIR/state.json" "$FOC"; sleep 0.3
OUT=$(post "{\"pane\":\"map\",\"id\":\"$ID3\",\"action\":\"apply\"}")
check "re-check on apply: $ID3 focuses $FOC, which you then rejected by hand -> 409 'no longer fits', dropped, frame_reject stale, applied fr-1 kept" "$(tail -1 <<< "$OUT" | grep -qx 409 && has 'no longer fits' "$OUT" && fr '!x.pending.map && x.applied.map.id==="fr-1"' | grep -q true && ev "x.some(e=>e.event==='frame_reject'&&e.reason==='stale'&&e.id==='$ID3')")"
cp "$T/state.before" "$DIR/state.json"; sleep 0.3   # the hand edit undone
S0=$(sums)

echo "== 5. /frame reset; /why map with every source resolved"
W=$(lines '/why map')
echo "$W" | grep -E 'frame' | sed 's/^/   /'
check "/why map: the applied frame (what it does), suggested by morrow after which message, applied by you, rejected suggestions counted" "$(has '^  frame fr-1 applied: focus dec-2 .*\[frames\.json:[0-9]+ applied\.map\]$' "$W" && has '^  suggested by model morrow \(frame role, model id fake-morrow\) at .*, after message m-[0-9a-f]+ \(turn 39\); allographic.*\[metrics\.jsonl:[0-9]+ frame_propose fr-1; transcript\.jsonl:[0-9]+ m-' "$W" && has '^  applied by you at .* \(through the page\); /frame reset map puts the pane back in its own order  \[metrics\.jsonl:[0-9]+ frame_apply fr-1\]$' "$W" && has 'frame suggestions? for this pane rejected whole' "$W" && echo true)"
node dev/why-cites.js http://127.0.0.1:4830 "$DIR" '' map kanban index chat > "$T/cites.txt"; tail -1 "$T/cites.txt" | sed 's/^/   /'
check "every source /why and /why map cite resolves (why-cites.js, frames.json labels included)" "$(grep -q '^CITES OK' "$T/cites.txt" && echo true)"
check "/why (whole workbench) has one frames line" "$(has '^  frames: map fr-1 applied by you \(suggested by morrow\); a frame only arranges cards' "$(lines /why)" && echo true)"
check "/frame reset kanban: nothing to reset" "$(has '^nothing to reset: no frame applied to kanban$' "$(lines '/frame reset kanban')" && echo true)"
check "/frame reset map: applied gone, resets.map {by user, frame fr-1}, frame_reset, a system line" "$(has '^map: frame fr-1 reset' "$(lines '/frame reset map')" && fr '!x.applied.map && x.resets.map.frame==="fr-1" && x.resets.map.by==="user"' | grep -q true && ev 'x.some(e=>e.event==="frame_reset"&&e.id==="fr-1"&&e.by==="user")' | grep -q true && grep -q 'map: frame fr-1 reset by you; the pane shows its own order again' "$DIR/transcript.jsonl" && echo true)"
check "/why map after the reset says so, with sources" "$(has '^  no frame applied: frame fr-1 was reset by you at .*\[frames\.json:[0-9]+ resets\.map; metrics\.jsonl:[0-9]+ frame_reset fr-1\]$' "$(lines '/why map')" && echo true)"
check "/frame reset with a bad argument -> 400 usage" "$(cmd '/frame reset index' | q '!x.ok && /^usage: \/frame/.test(x.lines[0])')"
check "modules.json and state.json were not written by /frame reset; no item_write since the flag went on" "$( [ "$(sums)" = "$S0" ] && ev '!x.some(e=>e.event==="item_write"&&Date.parse(e.ts)>Date.parse(x.find(f=>f.event==="flag"&&f.name==="frame-proposals").ts))' | grep -q true && echo true)"

echo "== 6. every rejection mode of the fake: rejected whole, logged, nothing written"
i=0
for mode in bad badid badkey wrongpane malformed none; do
  i=$((i+1)); frame3 --frame=$mode
  R0=$(fr 'x.rev'); E0=$(nev frame_reject); X0=$(nev frame_none)
  chat "message $i about the claim letter"
  case $mode in
    none) check "--frame=none: {} is no suggestion (frame_none), nothing written" "$( [ "$(fr 'x.rev')" = "$R0" ] && [ "$(nev frame_none)" -gt "$X0" ] && echo true)" ;;
    *) R=$(ev 'JSON.stringify(x.filter(e=>e.event==="frame_reject").pop())')
       check "--frame=$mode: rejected whole and logged (frame_reject $(q 'x.reason+": "+x.errors.join("; ").slice(0,80)' <<< "$R")), frames.json unchanged" "$( [ "$(fr 'x.rev')" = "$R0" ] && [ "$(nev frame_reject)" -gt "$E0" ] && fr '!x.pending.map && !x.applied.map' | grep -q true && echo true)" ;;
  esac
done
check "--frame=bad (unknown key hide and unknown id dec-99): rejected by the schema for the key, before any id is looked at" "$(ev 'x.some(e=>e.event==="frame_reject"&&e.reason==="schema"&&/unexpected "hide"/.test(e.errors[0]))')"
check "--frame=badid: unknown id dec-99; --frame=badkey: unexpected status; --frame=wrongpane: pane enum" "$(ev 'x.some(e=>e.event==="frame_reject"&&e.reason==="id"&&/unknown id "dec-99"/.test(e.errors[0])) && x.some(e=>e.event==="frame_reject"&&/unexpected "status"/.test(e.errors[0])) && x.some(e=>e.event==="frame_reject"&&/\$\.pane: must be one of map, kanban/.test(e.errors[0])) && x.some(e=>e.event==="frame_reject"&&e.reason==="malformed")')"
check "state.json and modules.json still untouched" "$( [ "$(sums)" = "$S0" ] && echo true)"
stop_server

echo "== 7. the frame role obeys pins, local-only fallback and stall"
FR2='{"policy":"fallback","candidates":[{"name":"morrow","local":true,"baseUrl":"http://127.0.0.1:5833/v1","model":"fake-morrow","structured":true,"timeoutMs":3000},{"name":"frontier","local":false,"baseUrl":"http://127.0.0.1:5834/v1","model":"fake-frontier","structured":true,"timeoutMs":3000}]}'
conf "$T/two.json" '{"frameProposals":true}' "$FR2"
frame3 down; frame4 --frame=good
server "$T/two.json"
N0=$(wc -l < "$DIR/metrics.jsonl")
chat "first message after the restart about the claim"
check "local morrow down: fallback to the cloud candidate is blocked (fallback_blocked role frame), frame_error, nothing proposed" "$(tail -n +$((N0+1)) "$DIR/metrics.jsonl" | qa 'x.some(e=>e.event==="fallback_blocked"&&e.role==="frame"&&e.to==="frontier") && x.some(e=>e.event==="frame_error"&&e.reason==="model") && !x.some(e=>e.event==="frame_propose")' | grep -q true && ! grep -q '\[frame\]' "$T/fake-5834.log" && echo true)"
cmd '/model frame frontier' > /dev/null
N0=$(wc -l < "$DIR/metrics.jsonl")
chat "second message after the restart about the deadline"
check "/model frame frontier pins it: the frame comes from frontier (an explicit choice), recorded as model frontier" "$(fr 'x.pending.map.model==="frontier"' | grep -q true && grep -q '\[frame\]' "$T/fake-5834.log" && echo true)"
frame4 down; frame3 --frame=good
N0=$(wc -l < "$DIR/metrics.jsonl")
chat "third message about the registered mail"
check "pinned frontier down: no fallback to morrow (morrow is up), frame_error" "$(tail -n +$((N0+1)) "$DIR/metrics.jsonl" | qa 'x.some(e=>e.event==="frame_error"&&/pinned to frontier/.test(e.error)) && !x.some(e=>e.event==="model_call"&&e.role==="frame"&&e.candidate==="morrow")')"
cmd '/model frame auto' > /dev/null
stop_server
FR3='{"policy":"manual","candidates":[{"name":"morrow","local":true,"baseUrl":"http://127.0.0.1:5833/v1","model":"fake-morrow","structured":true,"timeoutMs":3000,"stallMs":600}]}'
conf "$T/stall.json" '{"frameProposals":true}' "$FR3"
frame3 --frame=good --stall-after=1
server "$T/stall.json"
R0=$(fr 'x.rev'); N0=$(wc -l < "$DIR/metrics.jsonl")
chat "fourth message about the stamps"; sleep 0.8; settle
check "a frame reply that stalls is cut off (stall role frame, frame_error stall), nothing proposed" "$(tail -n +$((N0+1)) "$DIR/metrics.jsonl" | qa 'x.some(e=>e.event==="stall"&&e.role==="frame") && x.some(e=>e.event==="frame_error"&&e.reason==="stall")' | grep -q true && [ "$(fr 'x.rev')" = "$R0" ] && echo true)"
stop_server

echo "== 8. a broken frames.json: last good version, never written; frames never stop or bring back a pane"
frame3 --frame=good
server "$T/on.json"
chat "fifth message about the folder"
GOOD=$(fr 'x.pending.map.id')
printf '{"rev": 99, "pending": {' > "$DIR/frames.json"; sleep 0.3
check "/state reports frames.json in fileErrors and keeps the last good proposal ($GOOD)" "$(st | q "x.fileErrors['frames.json'] && x.frames.pending.map.id==='$GOOD'")"
BODY="{\"pane\":\"map\",\"id\":\"$GOOD\",\"action\":\"apply\"}"
check "POST /frame and /frame reset refuse (409 / 400); the file is unchanged" "$( [ "$(code "$BODY")" = 409 ] && cmd '/frame reset map' | q '!x.ok && /not valid JSON/.test(x.lines[0])' | grep -q true && [ "$(cat "$DIR/frames.json")" = '{"rev": 99, "pending": {' ] && echo true)"
chat "sixth message about the envelopes"
check "a turn with a broken frames.json: frame_error (frames), the file is unchanged" "$(ev 'x.some(e=>e.event==="frame_error"&&e.reason==="frames")' | grep -q true && [ "$(cat "$DIR/frames.json")" = '{"rev": 99, "pending": {' ] && echo true)"
printf '{"rev": 99, "pending": {}, "applied": {}}\n' > "$DIR/frames.json"; sleep 0.3
check "a repaired hand edit is read (no file error)" "$(st | q '!x.fileErrors["frames.json"] && !x.frames.pending.map')"
check "fading ignores frames: fade.status counts item proposals only (a frame proposal never keeps a pane from fading)" "$(node -e 'const fade=require("./fade.js");const s=fade.status({module:"map",lastTouch:{turn:1}},{lines:[],turn:30,rulesDoc:{fadeAfterTurns:8},items:[]});console.log(s.fadeDue===true&&s.holds.length===0)')"
node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f));const p=m.panes.find(p=>p.module==="map");p.state="faded";p.fadedAt=new Date().toISOString();p.fadedTurn=40;fs.writeFileSync(f,JSON.stringify(m,null,2))' "$DIR/modules.json"; sleep 0.3
N0=$(wc -l < "$DIR/metrics.jsonl")
chat "seventh message about the claim"
check "the map faded to a tab (by hand): no frame call at all, the map stays a tab (a frame never brings a pane back)" "$(tail -n +$((N0+1)) "$DIR/metrics.jsonl" | qa '!x.some(e=>e.role==="frame"||/^frame_/.test(e.event)||e.event==="pane_unfade")' | grep -q true && st | q 'x.faded.includes("map") && x.faded.includes("kanban")')"
node -e 'const f=process.argv[1],fs=require("fs"),m=JSON.parse(fs.readFileSync(f));const p=m.panes.find(p=>p.module==="kanban");delete p.state;delete p.fadedAt;delete p.fadedTurn;p.lastTouch={at:new Date().toISOString(),turn:49,how:"tab"};fs.writeFileSync(f,JSON.stringify(m,null,2))' "$DIR/modules.json"; sleep 0.3
L0=$(wc -l < "$T/fake-5833.log")
chat "who calls the insurer about the deadline?"
check "map a tab, kanban shown (by hand): the proposal is for the kanban (focus task-2), the prompt had tasks only" "$(fr '!x.pending.map && x.pending.kanban.intent.focus==="task-2" && x.pending.kanban.intent.order.every(id=>id.startsWith("task-"))' | grep -q true && ! tail -n +$((L0+1)) "$T/fake-5833.log" | grep -q 'dec-' && echo true)"
check "/stats still prints five verdict lines and equals npm run stats" "$(S=$(lines /stats); [ "$(echo "$S" | grep -cE '^[a-z]+ +(PASS|NOT YET) ')" -eq 5 ] && [ "$(npm run -s stats -- "$DIR")" = "$S" ] && echo true)"
stop_server

echo "== 9. page (headless Chrome): off = today, the note, f, apply, reset, dismiss, narrow widths, flag off"
if node -e 'process.exit(typeof WebSocket==="function"?0:1)' && [ -x "${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" ]; then
  node dev/browser-check.js v10 | tee "$T/browser.log"
  check "browser checks (v10) all passed" "$(grep -q 'ALL BROWSER CHECKS PASSED' "$T/browser.log" && echo true)"
else
  echo "SKIP browser checks: need Node 22+ and Google Chrome"; FAILS=$((FAILS+1))
fi
node dev/contrast-check.js > "$T/contrast.log"; RC=$?
check "contrast-check.js passes (frame note, byline and keys use checked pairs)" "$( [ $RC -eq 0 ] && grep -q 'frame proposal text on panel' "$T/contrast.log" && echo true)"

echo "== 10. demo v0.10 within 30 s (ports +200, dir $T/.pilot-demo-verify10)"
PILOT_FIXTURE_ROOT="$T" DEMO_PORT_SHIFT=200 PILOT_DEMO_DIR="$T/.pilot-demo-verify10" node scripts/demo.js v0.10 < /dev/null > "$T/demo.log" 2>&1 & DEMO=$!; PIDS+=($!)
D0=$(date +%s); UP=""
for i in $(seq 1 60); do if curl -H 'x-pilot: 1' -s -m 1 localhost:4978/state > "$T/ds.json" 2>/dev/null && [ -s "$T/ds.json" ]; then UP=1; break; fi; sleep 0.5; done
echo "   up after $(( $(date +%s) - D0 )) s"
check "demo serves /state within 30 s: frame-proposals on (demo config only), settled-input off, the map shown with 6 decisions (+3 rejected)" "$( [ -n "$UP" ] && q 'x.flags.frameProposals===true && x.flags.settledInput===false && /demo\.config\.json experiments\.frameProposals$/.test(x.flags.frameSource) && x.panes.includes("map") && !x.faded.includes("map") && x.items.filter(i=>i.kind==="decision"&&i.status!=="rejected").length===6' < "$T/ds.json")"
curl -H 'x-pilot: 1' -s -X POST localhost:4978/command -H 'content-type: application/json' -d '{"text":"/context share board on"}' > /dev/null
curl -H 'x-pilot: 1' -sN -X POST localhost:4978/chat -H 'content-type: application/json' -d '{"text":"what about keeping the claim local?"}' > /dev/null
for i in $(seq 1 40); do curl -H 'x-pilot: 1' -s localhost:4978/state | q '!!(x.frames.pending.map)' | grep -q true && break; sleep 0.1; done
check "demo: the next message yields a frame proposal for the map (focus dec-2) within about a second" "$(curl -H 'x-pilot: 1' -s localhost:4978/state | q 'x.frames.pending.map.intent.focus==="dec-2" && x.frames.pending.map.model==="morrow"')"
for i in $(seq 1 20); do grep -q 'Ctrl+C stops' "$T/demo.log" && break; sleep 0.2; done
check "try lines: the note, apply with f, /why map, /frame reset map" "$(grep -q 'model suggests: focus dec-2' "$T/demo.log" && grep -q 'press f' "$T/demo.log" && grep -q '/why map explains the applied frame' "$T/demo.log" && grep -q '/frame reset map' "$T/demo.log" && echo true)"
kill -INT $DEMO; wait $DEMO 2>/dev/null; sleep 0.5
check "Ctrl+C on the demo leaves no processes on its ports" "$( ! pgrep -f 'fake-model.js 598(3|4)' > /dev/null && ! lsof -iTCP:4978 -sTCP:LISTEN > /dev/null 2>&1 && echo true)"
check "the v0.9 fixture is unchanged by the v0.10 generator" "$(git diff --quiet -- demo/fixtures/v0.9 && echo true)"

echo; [ $FAILS -eq 0 ] && echo "ALL v0.10 CHECKS PASSED" || echo "$FAILS v0.10 CHECK(S) FAILED"
exit $(( FAILS > 0 ))
