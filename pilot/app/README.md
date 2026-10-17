# CLI Pilot v1 (step P0)

A local, terminal-looking chat page served by a small Node server. The server proxies
chat to an OpenAI-compatible endpoint and keeps the conversation in `.pilot/transcript.jsonl`.
Node 20.3+, no dependencies, nothing to install.

## Run normally

1. Edit `pilot.config.json`. The model names and hosts in it are placeholders. P0 uses only the
   **first** candidate of role `chat`.
2. If that candidate has `keyEnv`, export that variable. Keys never go into the config or the browser.
3. Start the server and open the page:

```sh
cd pilot/app
export OPENAI_API_KEY=...        # only if the first chat candidate names keyEnv
node server.js
# open http://127.0.0.1:4747
```

The server listens on `127.0.0.1` only and creates `.pilot/` next to `server.js` on first run
(regardless of the directory you start it from). If the key variable is missing, no request is
sent and the transcript gets a `system` line explaining why.

## Run against the fake endpoint (dev only, no key, no spend)

`dev/fake-model.js` is a fake OpenAI-compatible `/v1/chat/completions` (streaming and
non-streaming, canned replies tagged `[fake:<name>]`). `pilot.config.dev.json` points the
candidates `frontier` and `morrow` at two local ports. Use three terminals:

```sh
cd pilot/app
node dev/fake-model.js 5701 frontier
node dev/fake-model.js 5702 morrow
PILOT_CONFIG=pilot.config.dev.json node server.js
# open http://127.0.0.1:4747
```

`PILOT_CONFIG` is resolved relative to `pilot/app/`; without it the server uses `pilot.config.json`.

Automated P0 checks (starts and stops everything itself; **wipes `.pilot/` first**):

```sh
bash pilot/app/dev/verify-p0.sh
```

To start over by hand, stop the server and delete `pilot/app/.pilot/`.

## Endpoints in P0

| Method | Path | Does |
|---|---|---|
| GET | `/` | the page (only files under `public/` are served) |
| GET | `/state` | `{transcript: last 500 lines, total}` |
| POST | `/chat` | `{text}`: appends the user line, streams the reply as `text/plain`, appends the assistant line |
