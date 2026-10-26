# Pilot Cloud (C1)

Your personal Pilot at one private URL: a Cloudflare Worker with Claude and Mistral, streamed replies, and conversations kept in a Durable Object. Local Pilot (`pilot/app`) is unchanged.

Decisions and limits: [C0-RECON.md](C0-RECON.md). Overall plan: `pilot/cloud/BUILD-PLAN.md` (PR #6).

## Run locally
```sh
cd pilot/cloud
npm install
cp .dev.vars.example .dev.vars     # set DEV_AUTH_EMAIL and at least one key
npm run dev                        # http://127.0.0.1:8787, state in .wrangler/state
```
`DEV_AUTH_EMAIL` signs you in, but only on localhost. `.dev.vars` is never committed or deployed.

## Tests
```sh
npm test            # unit: Access JWT checks, provider adapters, key scrubbing, parity with pilot/app
npm run test:e2e    # wrangler dev + fake Claude/Mistral: streaming, persistence across restart, auth, no key leaks
```

## How it is protected
- **Every request is authenticated in the Worker**, including HTML, JS and CSS (`run_worker_first`). The Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) must have a valid signature from your team's keys, the right issuer and audience, not be expired, and carry an email in `ALLOWED_EMAILS`. If any of these settings is missing, every request fails.
- **Writes** need a same-origin `Origin` header and a JSON body.
- **Keys** are Worker secrets. The browser only learns whether a provider is configured. Replies and errors are scrubbed of key text, chat input that looks like a key is refused, and logs hold metadata only.
- **Model context** is the current conversation only (last 40 messages).
- **No public URL** (`workers_dev: false`, `preview_urls: false`): the Worker is reachable only on the route you protect with Access.

## Deploying (needs the owner's approval; not done yet)
1. `npx wrangler login` (or a scoped API token: Workers Scripts edit, Durable Objects, Workers Routes, Access read).
2. Pick a hostname on a zone in the account, e.g. `pilot.<your-domain>`, with no existing DNS record. Add `"routes": [{ "pattern": "pilot.<your-domain>", "custom_domain": true }]` to `wrangler.jsonc` (deploy creates the DNS record and certificate).
3. Zero Trust → Access → Applications → Self-hosted for that hostname, before the first deploy. Policy: Allow, Emails = you, identity provider of your choice (one-time PIN works). Copy the **Application Audience (AUD) tag** and the team domain (Zero Trust → Settings → Custom Pages).
4. `npx wrangler deploy`. Without the Access settings below, every request fails with 500.
5. Worker secrets, not `wrangler.jsonc` vars (this repo is public): `npx wrangler secret put` for `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS`, and `ANTHROPIC_API_KEY` and/or `MISTRAL_API_KEY`. Each one deploys a new version.
6. Open the URL on two devices, chat, reload, and check that a private window without login gets the Access page.

Rollback: `npx wrangler rollback`, or delete the route. Durable Object data stays with the Worker.
