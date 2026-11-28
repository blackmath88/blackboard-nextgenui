/**
 * Generated HTML artifacts and their bridge.
 *
 * Boundary, stated once:
 * - The artifact renders in `<iframe sandbox="allow-scripts">` from `srcdoc`.
 *   Without `allow-same-origin` it runs in an opaque origin: no access to the
 *   host DOM, cookies, localStorage or IndexedDB; no top navigation, popups or
 *   forms.
 * - A CSP meta tag (MCP Apps' default policy) forbids every network request,
 *   nested frame, plugin and base-URI change.
 * - The host accepts a message only when `event.source` is the contentWindow of
 *   the iframe carrying that artifact id (origin is "null" and cannot be used).
 *   The payload is decoded with a schema, bounded in size, and its event name
 *   must be in the artifact's own `allowedEvents`.
 * - The host sends the artifact only the data it was generated with.
 *
 * Wire format follows MCP Apps' JSON-RPC 2.0 naming where it fits.
 */

import { Schema } from 'effect'
import type { Representation } from './spec.js'

export const ArtifactCsp =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

export const MaxArtifactMessage = 2048

const Scalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean])

export const ArtifactRpc = Schema.Union([
  Schema.Struct({ jsonrpc: Schema.Literal('2.0'), method: Schema.Literal('ui/notifications/initialized') }),
  Schema.Struct({
    jsonrpc: Schema.Literal('2.0'),
    method: Schema.Literal('ui/event'),
    params: Schema.Struct({
      name: Schema.String.check(Schema.isMaxLength(64)),
      payload: Schema.Record(Schema.String, Scalar),
    }),
  }),
])
export type ArtifactRpc = typeof ArtifactRpc.Type

export type BridgeVerdict =
  | { readonly _tag: 'Initialized' }
  | { readonly _tag: 'Event'; readonly name: string; readonly payload: Readonly<Record<string, string | number | boolean>> }
  | { readonly _tag: 'Rejected'; readonly reason: string }

/** Validate one untrusted message that already passed the sender check. */
export const reviewArtifactMessage = (raw: unknown, allowedEvents: ReadonlyArray<string>): BridgeVerdict => {
  let size: number
  try {
    size = JSON.stringify(raw)?.length ?? Infinity
  } catch {
    return { _tag: 'Rejected', reason: 'nicht serialisierbar' }
  }
  if (size > MaxArtifactMessage) return { _tag: 'Rejected', reason: `zu gross (${size} Zeichen)` }
  const decoded = Schema.decodeUnknownResult(ArtifactRpc)(raw)
  if (decoded._tag === 'Failure') return { _tag: 'Rejected', reason: 'ungültiges Format' }
  const message = decoded.success
  if (message.method === 'ui/notifications/initialized') return { _tag: 'Initialized' }
  if (!allowedEvents.includes(message.params.name)) return { _tag: 'Rejected', reason: `Ereignis „${message.params.name}“ nicht erlaubt` }
  if (Object.keys(message.params.payload).length > 12) return { _tag: 'Rejected', reason: 'zu viele Felder' }
  return { _tag: 'Event', name: message.params.name, payload: message.params.payload }
}

/** The document the iframe receives. The artifact HTML is wrapped, never trusted. */
export const artifactDocument = (html: string, dark: boolean): string => `<!doctype html>
<html lang="de" data-theme="${dark ? 'dark' : 'light'}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ArtifactCsp}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark;--fg:#1d1d1f;--muted:#6e6e73;--line:#e5e5ea;--accent:#0a63d6;--bg:#fff;--soft:#f5f5f7;--good:#1f8a4c}
[data-theme=dark]{--fg:#f2f2f7;--muted:#a1a1a6;--line:#38383a;--accent:#4c9aff;--bg:#1c1c1e;--soft:#2c2c2e;--good:#4cc27a}
html,body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",sans-serif}
</style>
<script>
(() => {
  const send = (message) => parent.postMessage(message, '*');
  window.blackboard = Object.freeze({
    emit(name, payload) { send({ jsonrpc: '2.0', method: 'ui/event', params: { name: String(name), payload: payload || {} } }); },
  });
  addEventListener('load', () => send({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }));
})();
</script></head><body>${html}</body></html>`

// ---------------------------------------------------------------- a bespoke artifact

/** A miniature simulator the research conversation can generate. Synthetic model. */
const simulatorHtml = `
<style>
.wrap{padding:14px 16px 16px}
.row{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
label{display:flex;gap:6px;align-items:center;color:var(--muted)}
input[type=range]{width:140px;accent-color:var(--accent)}
.big{font-size:30px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.muted{color:var(--muted)}
canvas{width:100%;height:150px;display:block;border-top:1px solid var(--line);margin-top:6px}
button{font:inherit;border:1px solid var(--line);background:var(--soft);color:var(--fg);border-radius:7px;padding:5px 10px;cursor:pointer}
button:hover{border-color:var(--accent)}
#probe{color:var(--muted);font-size:11px;margin-top:8px}
</style>
<div class="wrap">
  <div class="row">
    <label><input type="checkbox" id="buddy" checked> Buddy</label>
    <label><input type="checkbox" id="docs" checked> Dokumentation</label>
    <label>Teamgrösse <input type="range" id="team" min="3" max="20" value="8"><span id="teamv">8</span></label>
  </div>
  <div class="row" style="justify-content:space-between">
    <div><div class="big" id="weeks">8</div><div class="muted">Wochen bis zur vollen Produktivität</div></div>
    <button id="choose">Szenario übernehmen</button>
  </div>
  <canvas id="curve" width="560" height="150"></canvas>
  <div id="probe"></div>
</div>
<script>
const $ = (id) => document.getElementById(id);
const weeksFor = () => {
  let w = 14;
  if ($('buddy').checked) w -= 5;
  if ($('docs').checked) w -= $('buddy').checked ? 1 : 2;
  w += Math.max(0, (+$('team').value - 10) * 0.25);
  return Math.round(w * 10) / 10;
};
const draw = () => {
  const c = $('curve'), g = c.getContext('2d'), w = weeksFor();
  const css = getComputedStyle(document.documentElement);
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = css.getPropertyValue('--line'); g.lineWidth = 1;
  for (let i = 0; i <= 16; i += 4) { const x = 20 + i / 16 * 520; g.beginPath(); g.moveTo(x, 10); g.lineTo(x, 135); g.stroke(); g.fillStyle = css.getPropertyValue('--muted'); g.fillText(i + ' W', x - 8, 148); }
  g.strokeStyle = css.getPropertyValue('--accent'); g.lineWidth = 2.5; g.beginPath();
  for (let t = 0; t <= 16; t += 0.25) { const p = 1 - Math.exp(-3 * t / w); const x = 20 + t / 16 * 520, y = 130 - p * 115; t ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  $('weeks').textContent = String(w).replace('.', ',');
  $('teamv').textContent = $('team').value;
};
['buddy', 'docs', 'team'].forEach((id) => $(id).addEventListener('input', draw));
$('choose').addEventListener('click', () => blackboard.emit('scenario.chosen', { weeks: weeksFor(), buddy: $('buddy').checked, docs: $('docs').checked, team: +$('team').value }));
draw();
// Isolation self-check, visible inside the artifact.
const probes = [];
try { localStorage.length; probes.push('Speicher: offen'); } catch { probes.push('Speicher: gesperrt'); }
try { parent.document.title; probes.push('Host-DOM: offen'); } catch { probes.push('Host-DOM: gesperrt'); }
fetch('https://example.org/').then(() => { probes.push('Netzwerk: offen'); show(); }, () => { probes.push('Netzwerk: gesperrt'); show(); });
const show = () => { $('probe').textContent = 'Sandbox · ' + probes.join(' · '); blackboard.emit('sandbox.probe', { storage: probes.join(',').includes('Speicher: gesperrt'), dom: probes.join(',').includes('Host-DOM: gesperrt'), network: probes.join(',').includes('Netzwerk: gesperrt') }); };
</script>`

export const onboardingSimulator: Representation = {
  id: 'research.simulator',
  title: 'Simulator',
  purpose: 'Interaktives HTML-Artefakt · isoliert · synthetisches Modell',
  root: {
    type: 'section',
    children: [
      { type: 'artifact', id: 'art.onboarding', title: 'Einarbeitungs-Simulator', html: simulatorHtml, allowedEvents: ['scenario.chosen', 'sandbox.probe'], height: 300 },
      { type: 'callout', tone: 'neutral', markdown: 'Das Artefakt läuft ohne Zugriff auf Speicher, Netzwerk oder diese Seite. Nur die Ereignisse *scenario.chosen* und *sandbox.probe* werden angenommen und geprüft.' },
    ],
  },
}
