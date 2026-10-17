#!/usr/bin/env node
// DEV ONLY. WCAG contrast check for the page palette. Parses the colour tokens from public/style.css
// (dark :root block, light block under prefers-color-scheme, light block for /theme light), resolves var()
// chains, and checks every text/background pair the page uses against AA for normal text (4.5:1).
// Also checks that the two light blocks are identical and that no colour literal appears outside the token blocks.
// Usage: node dev/contrast-check.js     (prints PASS/FAIL lines, exit 1 on any failure)
'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? `  (${extra})` : ''}`); if (!ok) fails++; };

// ---- token blocks ----
function block(startRe) {
  const m = startRe.exec(css);
  if (!m) throw new Error(`block not found: ${startRe}`);
  const from = m.index + m[0].length;
  return { body: css.slice(from, css.indexOf('}', from)), start: m.index, end: css.indexOf('}', from) };
}
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
const dark = block(/(^|\n):root\s*\{/);
const lightMedia = block(/:root:not\(\[data-theme="dark"\]\)\s*\{/);
const lightAttr = block(/:root\[data-theme="light"\]\s*\{/);
const D = decls(dark.body), LM = decls(lightMedia.body), LA = decls(lightAttr.body);
check('light blocks (OS preference and /theme light) are identical', JSON.stringify(LM) === JSON.stringify(LA));
const MODES = { dark: D, light: { ...D, ...LM } };

// Colour literals only inside the token blocks (style.css) and nowhere in the page scripts or markup.
const tokenRanges = [dark, lightMedia, lightAttr];
const rawCss = css;
const literals = [...rawCss.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].filter((m) => !tokenRanges.some((r) => m.index > r.start && m.index < r.end));
check('style.css: colour literals only in the token blocks', literals.length === 0, literals.map((m) => m[0]).join(' '));
for (const f of ['app.js', 'pixel.js', 'index.html']) {
  const src = fs.readFileSync(path.join(PUB, f), 'utf8');
  const hits = src.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|rgba?\(/g) || [];
  check(`${f}: no colour literals (uses CSS variables)`, hits.length === 0, hits.join(' '));
}

// ---- colour maths ----
function resolve(tokens, name, seen = []) {
  if (seen.includes(name)) throw new Error(`var() cycle: ${seen.join(' -> ')}`);
  const v = tokens[name];
  if (v === undefined) throw new Error(`unknown token ${name}`);
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? resolve(tokens, m[1], [...seen, name]) : v;
}
function rgba(v) {
  if (v === 'transparent') return [0, 0, 0, 0];
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/.exec(v);
  if (m) { const p = m[1].split(',').map((x) => Number(x.trim())); return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]]; }
  throw new Error(`cannot parse colour ${v}`);
}
const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');

// ---- every text/background pair in use: [where, text token, background token, background underneath] ----
const PAIRS = [
  ['body text on page', '--text', '--base'],
  ['message text on panel', '--text', '--panel'],
  ['message text on a scanline row', '--text', '--scan', '--panel'],
  ['secondary text on panel (system lines, model tags, placeholder, index numbers, answered questions)', '--muted', '--panel'],
  ['secondary text on a scanline row', '--muted', '--scan', '--panel'],
  ['secondary text on pane bar (meta)', '--muted', '--base'],
  ['pane titles on pane bar', '--accent-fg', '--base'],
  ['prompt sign, command echo, key buttons on panel', '--accent-fg', '--panel'],
  ['you label', '--you-fg', '--you-bg', '--panel'],
  ['pilot (assistant) label', '--pilot-fg', '--pilot-bg', '--panel'],
  ['controller label', '--ctl-fg', '--ctl-bg', '--panel'],
  ['confirmed tag (answered yes/always)', '--ok-fg', '--ok-bg', '--panel'],
  ['rejected/blocked tag and label (no/never, blocked, stall, error)', '--bad-fg', '--bad-bg', '--panel'],
  // pilot-v0.6: author chips in the pane bar byline (rule = controller, answer = you) sit on the bar, not the panel
  ['you author chip on pane bar', '--you-fg', '--you-bg', '--base'],
  ['model author chip on pane bar', '--pilot-fg', '--pilot-bg', '--base'],
  ['controller author chip on pane bar', '--ctl-fg', '--ctl-bg', '--base'],
  ['why? button on pane bar (pilot-v0.7)', '--muted', '--base'],
  ['why? button on a card, /why sources on a scanline row (pilot-v0.7)', '--muted', '--scan', '--panel'],
  ['/why statement and "show m-…" button on a scanline row (pilot-v0.7)', '--text', '--scan', '--panel'],
  ['status bar text on lavender fill', '--onfill', '--lavender'],
  ['hovered key button text on lavender fill', '--onfill', '--lavender'],
];

for (const [mode, tokens] of Object.entries(MODES)) {
  for (const [where, fgT, bgT, underT] of PAIRS) {
    const under = underT ? rgba(resolve(tokens, underT)) : [0, 0, 0, 1];
    const bg = over(rgba(resolve(tokens, bgT)), underT ? under : rgba(resolve(tokens, '--base')));
    const fg = over(rgba(resolve(tokens, fgT)), bg);
    const r = ratio(fg, bg);
    check(`[${mode}] ${where}: ${fgT} ${hex(fg)} on ${bgT}${underT ? `/${underT}` : ''} ${hex(bg)}`, r >= 4.5, `${r.toFixed(2)}:1`);
  }
}
// Pastels as text in light mode are not allowed (they fail on the light base).
const PASTELS = ['--peach', '--sky', '--lavender', '--mint', '--rose'];
const textTokens = [...new Set(PAIRS.map((p) => p[1]))];
const light = MODES.light;
const pastelText = textTokens.filter((t) => PASTELS.some((p) => resolve(light, t) === resolve(light, p)));
check('[light] no pastel is used as a text colour', pastelText.length === 0, pastelText.join(' '));
// Documented: muted #9a97b0 cannot be text in light mode (ratio shown for the record).
console.log(`info: dark --muted ${D['--muted']} on light base ${LM['--base']} would be ${ratio(rgba(D['--muted']), rgba(LM['--base'])).toFixed(2)}:1, so light mode uses --muted ${LM['--muted']}`);

console.log(fails ? `\n${fails} CONTRAST CHECK(S) FAILED` : '\nALL CONTRAST CHECKS PASSED');
process.exitCode = fails ? 1 : 0;
