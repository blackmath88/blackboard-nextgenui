#!/bin/bash
# DEV ONLY. P0 checks against two fake model endpoints (no real endpoint, no key).
# Usage (from anywhere): bash pilot/app/dev/verify-p0.sh
# WARNING: deletes pilot/app/.pilot/ first so the run starts clean.
set -u
cd "$(dirname "$0")/.."
L=$(mktemp -d)
rm -rf .pilot
node dev/fake-model.js 5701 frontier > $L/f1.log 2>&1 & F1=$!
node dev/fake-model.js 5702 morrow  > $L/f2.log 2>&1 & F2=$!
sleep 0.5
echo "== fake non-streaming"; curl -s -X POST localhost:5701/v1/chat/completions -d '{"messages":[{"role":"user","content":"hi"}]}'; echo
echo "== fake streaming (head)"; curl -sN -X POST localhost:5702/v1/chat/completions -d '{"stream":true,"messages":[{"role":"user","content":"hi"}]}' | head -3
PILOT_CONFIG=pilot.config.dev.json node server.js > $L/s1.log 2>&1 & S=$!
sleep 0.5
echo "== page"; curl -s -o /dev/null -w "%{http_code} %{content_type}\n" localhost:4747/
echo "== traversal"; curl -s --path-as-is -o /dev/null -w "%{http_code}\n" localhost:4747/../server.js; curl -s -o /dev/null -w "%{http_code}\n" localhost:4747/%2e%2e/pilot.config.json
echo "== chat 1 (streamed, timestamps per chunk)"; curl -sN -X POST localhost:4747/chat -H 'content-type: application/json' -d '{"text":"First message: hello pilot"}' | while IFS= read -r -n 12 c; do printf '%s|' "$c"; done; echo
echo "== chat 2"; curl -sN -X POST localhost:4747/chat -H 'content-type: application/json' -d '{"text":"Second message"}'; echo
echo "== transcript.jsonl"; cat .pilot/transcript.jsonl
echo "== tmp leftovers"; ls -a .pilot
kill $S; wait $S 2>/dev/null
PILOT_CONFIG=pilot.config.dev.json node server.js > $L/s2.log 2>&1 & S=$!
sleep 0.5
echo "== /state after restart"; curl -s localhost:4747/state | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("total",j.total);for(const l of j.transcript)console.log(l.role,l.model,JSON.stringify(l.text).slice(0,90))})'
echo "== frontier fake down -> morrow answers (P1 fallback; P0 wrote a system line here)"; kill $F1; wait $F1 2>/dev/null
curl -sN -X POST localhost:4747/chat -H 'content-type: application/json' -d '{"text":"Third, with frontier down"}'; echo
tail -2 .pilot/transcript.jsonl
kill $S $F2; wait 2>/dev/null
echo "== server logs"; cat $L/s1.log $L/s2.log
rm -rf "$L"
