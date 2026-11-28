#!/usr/bin/env node
/**
 * Reproducible acceptance run for the Blackboard studio.
 *
 * Usage (dev server running):  node scripts/studio-acceptance.mjs [baseUrl] [outDir]
 *   baseUrl default http://127.0.0.1:4330/studio.html
 *   outDir  default ../../docs/build/evidence/<label>
 *
 * Uses a fresh browser context (empty, synthetic storage) — never a real
 * profile. Runs the three reference conversations, exercises every
 * workspace→chat action, reloads, probes the artifact sandbox, scans with axe
 * and writes screenshots, a video, the interaction trace and a JSON report.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const base = process.argv[2] ?? 'http://127.0.0.1:4330/studio.html'
const label = process.env.LABEL ?? 'run'
const out = resolve(process.argv[3] ?? join(import.meta.dirname, '../../../docs/build/evidence', label))
mkdirSync(join(out, 'shots'), { recursive: true })
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const report = { base, startedAt: new Date().toISOString(), checks: [], axe: {}, overflow: {}, security: {} }
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
  ...(process.env.VIDEO === '1' ? { recordVideo: { dir: join(out, 'video'), size: { width: 1440, height: 900 } } } : {}),
  colorScheme: 'light',
  locale: 'de-CH',
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const cspBlocks = []
page.on('console', (m) => {
  if (m.type() !== 'error') return
  // The artifact's own isolation probe is expected to be refused by its CSP.
  if (/Content Security Policy/.test(m.text())) cspBlocks.push(m.text())
  else errors.push(m.text())
})

const shot = (name) => page.screenshot({ path: join(out, 'shots', `${name}.png`) })
const settle = async () => {
  await page.waitForTimeout(120)
  await page.waitForFunction(() => !document.querySelector('.msg.live'), null, { timeout: 15000 })
  await page.waitForTimeout(250)
}
const lastAssistant = () => page.locator('.msg.assistant').last().innerText()
const axe = async (name) => {
  await page.waitForTimeout(500)
  await page.addScriptTag({ content: axeSource })
  const result = await page.evaluate(async () => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, { resultTypes: ['violations'] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }))
  })
  report.axe[name] = result
}
const newConversation = async () => {
  await page.getByRole('button', { name: 'Neues Gespräch' }).click()
  await page.locator('.starter').first().waitFor()
}

await page.goto(base)
await page.locator('.starter').first().waitFor()
await shot('00-empty')
await axe('empty')

// ------------------------------------------------------------ 1 architecture
await page.locator('.starter', { hasText: 'Architektur erkunden' }).click()
await settle()
check('architecture: options pane composed', await page.locator('.n-matrix').isVisible())
check('architecture: reply references workspace objects', (await page.locator('.msg.assistant .ref').count()) >= 3)
await shot('01-architecture-opening')
await page.locator('.record', { hasText: 'Ereignisprotokoll mit abgeleitetem Zustand' }).click()
await page.locator('.record', { hasText: 'Gemeinsames Dokument (CRDT)' }).click()
check('selection does not start a turn', (await page.locator('.msg.live').count()) === 0 && (await page.locator('.msg').count()) === 2)
await shot('02-architecture-selection')
await page.getByRole('button', { name: 'Vergleichen' }).click()
await settle()
check('compare: new pane focused', (await page.locator('.pane-head h2').innerText()) === 'Gegenüberstellung')
check('compare: reply names both options', /Ereignisprotokoll[\s\S]*CRDT/.test(await lastAssistant()))
await shot('03-architecture-compare')
await page.getByRole('tab', { name: 'Systemlandkarte' }).click()
await page.locator('g.dnode', { hasText: 'Artefakt-Brücke' }).click()
await page.getByRole('button', { name: 'Untersuchen' }).click()
await settle()
check('investigate diagram node', /Vertrauensgrenze/.test(await lastAssistant()))
await shot('04-architecture-investigate')
await page.getByRole('tab', { name: 'Alternativen' }).click()
await page.locator('.record', { hasText: 'Interaktionen als Ereignisse protokollieren' }).click()
await page.getByRole('button', { name: 'Warum?' }).click()
await settle()
check('ask why on a decision', /Menschliche Änderungen/.test(await lastAssistant()))
await page.getByRole('slider', { name: 'Mehrbenutzer' }).fill('5')
await page.getByRole('slider', { name: 'Nachvollziehbarkeit' }).fill('1')
await page.getByRole('slider', { name: 'Schutz menschlicher Änderungen' }).fill('1')
await page.waitForTimeout(250)
check('weight edit re-ranks the matrix locally', /CRDT/.test(await page.locator('.n-matrix td.best').first().evaluate((td) => td.closest('table').querySelectorAll('thead th')[td.cellIndex].innerText)))
await shot('04b-architecture-weights')
await page.getByRole('button', { name: 'Auswirkungen besprechen' }).click()
await settle()
check('weight change explained as a flipped recommendation', /kippt die Empfehlung/.test(await lastAssistant()))
await page.getByLabel('Nachricht').fill('Mach daraus einen Umsetzungsplan.')
await page.getByLabel('Nachricht').press('Enter')
await settle()
await page.getByRole('button', { name: 'Artefakt-Brücke härten nach In Arbeit' }).click()
check('card move is local', (await page.locator('.msg.live').count()) === 0)
await page.getByRole('button', { name: 'Plan neu bewerten' }).click()
await settle()
check('reassess plan after move', /Artefakt-Brücke härten[\s\S]*In Arbeit/.test(await lastAssistant()))
await page.getByRole('button', { name: 'Anheften' }).click()
await shot('05-architecture-plan-pinned')
await axe('architecture')

// ------------------------------------------------------------ 2 budget
await newConversation()
await page.locator('.starter', { hasText: 'Budget planen' }).click()
await settle()
const reserveBefore = await page.locator('.n-metric', { hasText: 'Reserve' }).first().innerText()
await page.getByRole('slider', { name: 'Entwicklung' }).fill('320000')
await page.waitForTimeout(250)
const reserveAfter = await page.locator('.n-metric', { hasText: 'Reserve' }).first().innerText()
check('assumption edit recalculates locally', reserveBefore !== reserveAfter && /[−-]40/.test(reserveAfter), `${reserveBefore.replace(/\s+/g, ' ')} → ${reserveAfter.replace(/\s+/g, ' ')}`)
check('assumption edit makes no turn', (await page.locator('.msg').count()) === 2)
const callouts = await page.locator('.pane .n-callout').allInnerTexts()
check('interpretive copy follows the state (overdrawn warning, no stale advice)', callouts.some((t) => /Überzeichnet/.test(t)) && !callouts.some((t) => /Lesart/.test(t)), callouts.map((t) => t.split('\n')[0]).join(' | '))
await shot('06-budget-edited')
await page.getByRole('button', { name: 'Auswirkungen besprechen' }).click()
await settle()
check('implications cite the human value', /320.000/.test(await lastAssistant()))
await shot('07-budget-implications')
await page.getByLabel('Nachricht').fill('Was passiert, wenn wir zwei Personen einstellen?')
await page.getByLabel('Nachricht').press('Enter')
await settle()
check('later turn still uses the edit', /nicht/.test(await lastAssistant()))
await page.getByRole('tab', { name: 'Budget 2027' }).click()
await page.getByRole('button', { name: 'Anheften' }).click()
await shot('08-budget-followup')
await page.locator('.msg.assistant').first().hover()
await page.getByRole('button', { name: 'Tabelle aufs Blackboard' }).first().click()
await page.waitForTimeout(400)
await page.waitForTimeout(300)
check('promote: reply table becomes a pane with a chart', /Aus dem Gespräch übernommen/.test(await page.locator('.pane .purpose').first().innerText()) && await page.locator('.pane .n-bars').isVisible())
check('promote makes no turn', (await page.locator('.msg.live').count()) === 0)
await page.getByRole('tab', { name: 'Überblick' }).click()
await page.waitForTimeout(400)
check('overview lists the human edit', /Entwicklung[\s\S]*210[\s\S]*320/.test(await page.locator('.pane').innerText()))
await shot('08b-budget-overview')
await page.getByRole('tab', { name: 'Szenarien' }).click()
await page.getByRole('button', { name: 'Angeheftete Darstellung daneben zeigen' }).click()
await page.waitForTimeout(400)
check('split shows pinned pane beside focus', (await page.locator('.panes .pane').count()) === 2)
report.overflow.split = await page.evaluate(() => document.documentElement.scrollWidth)
check('split fits the viewport', report.overflow.split <= 1440, String(report.overflow.split))
await shot('08c-budget-split')
await page.getByRole('button', { name: 'Angeheftete Darstellung daneben zeigen' }).click()
await axe('budget')

// ------------------------------------------------------------ 3 research + artifact
await newConversation()
await page.locator('.starter', { hasText: 'Forschung verdichten' }).click()
await settle()
await shot('09-research-opening')
await page.getByRole('tab', { name: 'Evidenz' }).click()
await page.locator('.source', { hasText: 'Erfahrungsbericht' }).click()
await page.getByRole('button', { name: 'Relevanz prüfen' }).click()
await settle()
check('source relevance', /Einzelfall/.test(await lastAssistant()))
await page.getByLabel('Nachricht').fill('Baue mir einen interaktiven Simulator für die Einarbeitungszeit.')
await page.getByLabel('Nachricht').press('Enter')
await settle()
const frame = page.frameLocator('iframe[data-artifact-id="art.onboarding"]')
await frame.locator('#probe').filter({ hasText: 'Netzwerk' }).waitFor({ timeout: 5000 })
const probe = await frame.locator('#probe').innerText()
report.security.artifactSelfCheck = probe
check('artifact: storage, host DOM and network blocked', /Speicher: gesperrt/.test(probe) && /Host-DOM: gesperrt/.test(probe) && /Netzwerk: gesperrt/.test(probe), probe)
await frame.locator('#buddy').uncheck()
await frame.locator('#choose').click()
await page.locator('.tray', { hasText: 'Szenario' }).waitFor()
check('artifact event becomes pending context, no turn', (await page.locator('.msg.live').count()) === 0)
// A frame the host did not render must be refused.
const rogue = await page.evaluate(async () => {
  const f = document.createElement('iframe')
  f.setAttribute('sandbox', 'allow-scripts')
  f.srcdoc = `<script>parent.postMessage({jsonrpc:'2.0',method:'ui/event',params:{name:'scenario.chosen',payload:{weeks:1}}},'*')<\/script>`
  document.body.appendChild(f)
  await new Promise((r) => setTimeout(r, 500))
  f.remove()
  const art = document.querySelector('iframe[data-artifact-id]')
  let hostRead = 'blocked'
  try { hostRead = art.contentDocument === null ? 'null' : 'READABLE' } catch { hostRead = 'threw' }
  return { tray: document.querySelector('.tray')?.textContent ?? '', hostRead }
})
report.security.rogue = rogue
check('rogue frame cannot inject an event', /12 Wochen/.test(rogue.tray) && !/1 Wochen/.test(rogue.tray), rogue.tray)
check('host cannot read artifact document (opaque origin)', rogue.hostRead !== 'READABLE', rogue.hostRead)
await page.getByRole('button', { name: 'Interaktionsprotokoll' }).click()
await shot('10-research-artifact')
await page.getByRole('button', { name: 'Interaktionsprotokoll' }).click()
await page.getByRole('button', { name: 'Im Gespräch aufgreifen' }).click()
await settle()
check('artifact context reaches the reply', /ohne Buddy[\s\S]*12 Wochen/.test(await lastAssistant()))
await page.getByRole('tab', { name: 'Befunde' }).click()
await page.getByRole('tab', { name: 'Simulator' }).click()
await frame.locator('#weeks').filter({ hasText: '12' }).waitFor({ timeout: 5000 }).catch(() => undefined)
const restoredWeeks = await frame.locator('#weeks').innerText()
const restoredBuddy = await frame.locator('#buddy').isChecked()
check('artifact state survives remount (host replays last accepted state)', restoredWeeks === '12' && restoredBuddy === false, `weeks=${restoredWeeks} buddy=${restoredBuddy}`)
await shot('11-research-artifact-reply')
await axe('research')

// ------------------------------------------------------------ 3b learning plan
await newConversation()
await page.locator('.starter', { hasText: 'Lernplan entwerfen' }).click()
await settle()
check('learning plan composed (calculator + timeline + board + resources)', (await page.locator('.pane .n-timeline').count()) === 1 && (await page.locator('.pane .n-board').count()) === 1 && (await page.locator('.pane .n-sources').count()) === 1)
await page.getByRole('slider', { name: 'Stunden pro Woche' }).fill('3')
await page.waitForTimeout(250)
check('learning hours recalculate locally', /18/.test(await page.locator('.n-metric', { hasText: 'Lernzeit gesamt' }).innerText()))
await page.getByRole('button', { name: 'Auswirkungen besprechen' }).click()
await settle()
check('learning implications use the edited hours', /18 Stunden/.test(await lastAssistant()) && /knapp/.test(await lastAssistant()))
await page.getByRole('button', { name: 'Eigenes Projekt nach Läuft' }).click()
await page.getByRole('button', { name: 'Plan neu bewerten' }).click()
await settle()
check('learning reassessment warns about the dependency', /Fehlerkanal verstehen/.test(await lastAssistant()))
await shot('11b-learning')
await axe('learning')

// ------------------------------------------------------------ 3c replayed model-format reply (novel question)
await newConversation()
await page.getByLabel('Nachricht').fill('Sollen wir für den Sitzungsspeicher PostgreSQL oder SQLite verwenden?')
await page.getByLabel('Nachricht').press('Enter')
await settle()
check('replay: novel question composed via model contract', (await page.locator('.pane-head h2').innerText()) === 'Sitzungsspeicher' && (await page.locator('.msg.assistant .origin').count()) === 1)
// keyboard only: focus the PostgreSQL column head and select it with Enter
await page.locator('.opt-head', { hasText: 'PostgreSQL' }).focus()
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
check('keyboard selection reaches the context tray', /PostgreSQL/.test(await page.locator('.tray').innerText()))
await page.getByRole('slider', { name: 'Gleichzeitige Nutzer' }).fill('5')
await page.getByRole('slider', { name: 'Betriebsaufwand' }).fill('1')
await page.waitForTimeout(200)
await page.getByRole('button', { name: 'Auswirkungen besprechen' }).click()
await settle()
check('replay pane weights flip the recommendation', /kippt die Empfehlung/.test(await lastAssistant()))
await shot('11c-replay-decision')
await page.getByLabel('Nachricht').fill('Teste bitte eine ungültige Darstellung.')
await page.getByLabel('Nachricht').press('Enter')
await settle()
check('out-of-catalogue representation refused in the UI, workspace kept', (await page.locator('.refused').count()) === 1 && (await page.locator('.pane-head h2').innerText()) === 'Sitzungsspeicher')
await shot('11d-refused')

// ------------------------------------------------------------ 4 continuity
const before = await page.evaluate(() => localStorage.getItem('blackboard.studio.v1'))
await page.reload()
await page.locator('.messages').waitFor()
const after = await page.evaluate(() => localStorage.getItem('blackboard.studio.v1'))
const state = JSON.parse(after)
const budget = state.conversations.find((c) => c.scenario === 'budget')
const arch = state.conversations.find((c) => c.scenario === 'architecture')
check('reload keeps state byte-identical', before === after)
check('reload keeps human budget edit', budget?.assumptions?.['b.dev']?.value === 320000)
check('reload keeps moved card', arch?.cards?.['t.bridge'] === 'doing')
check('reload keeps pins', budget?.panes.some((p) => p.pinned) && arch?.panes.some((p) => p.pinned))
await page.locator('.rail-item.conv', { hasText: 'Budget' }).click()
await page.waitForTimeout(300)
const focusedTab = (await page.locator('.tab.on').innerText()).trim()
check('reopened conversation keeps its focused pane', focusedTab === 'Szenarien', focusedTab)
await page.getByRole('tab', { name: 'Budget 2027' }).click()
await page.waitForTimeout(300)
check('reopened budget shows the edit', /320/.test(await page.locator('.assumption.edited').first().innerText()))
await shot('12-reload-budget')
writeFileSync(join(out, 'trace.json'), JSON.stringify(state.conversations.map((c) => ({
  title: c.title,
  scenario: c.scenario,
  interactions: c.interactions,
  turns: c.messages.filter((m) => m.role === 'user').map((m) => ({ text: m.markdown, packet: JSON.parse(m.packet ?? 'null') })),
})), null, 2))

// ------------------------------------------------------------ 5 narrow
await page.setViewportSize({ width: 390, height: 844 })
await page.locator('.rail-item.conv', { hasText: 'Synchronisation' }).click({ force: true }).catch(() => undefined)
await page.waitForTimeout(300)
report.overflow.phoneChat = await page.evaluate(() => document.documentElement.scrollWidth)
await shot('13-phone-chat')
await page.getByRole('tab', { name: /^Blackboard/ }).click()
await page.waitForTimeout(300)
report.overflow.phoneBoard = await page.evaluate(() => document.documentElement.scrollWidth)
await shot('14-phone-board')
check('no horizontal overflow at 390 px', report.overflow.phoneChat <= 390 && report.overflow.phoneBoard <= 390, JSON.stringify(report.overflow))
await page.setViewportSize({ width: 1024, height: 768 })
report.overflow.tablet = await page.evaluate(() => document.documentElement.scrollWidth)
await shot('15-1024')
check('no horizontal overflow at 1024 px', report.overflow.tablet <= 1024)

report.security.cspBlocks = cspBlocks
check('artifact network attempt refused by CSP (console evidence)', cspBlocks.some((t) => /connect-src 'none'/.test(t)), `${cspBlocks.length} CSP refusals`)
await page.setViewportSize({ width: 1440, height: 900 })
await page.emulateMedia({ colorScheme: 'dark' })
await page.locator('.rail-item.conv', { hasText: 'Synchronisation' }).click()
await page.getByRole('tab', { name: 'Systemlandkarte' }).click()
await page.waitForTimeout(500)
await shot('16-dark-architecture')
await axe('dark-architecture')
await page.locator('.rail-item.conv', { hasText: 'Remote' }).click()
await page.getByRole('tab', { name: 'Simulator' }).click()
await page.waitForTimeout(800)
await shot('17-dark-research-artifact')
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
report.finishedAt = new Date().toISOString()
report.passed = report.checks.filter((c) => c.ok).length
report.failed = report.checks.filter((c) => !c.ok).length
await context.close()
await browser.close()
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\n${report.passed} passed, ${report.failed} failed → ${out}`)
console.log('axe:', Object.fromEntries(Object.entries(report.axe).map(([k, v]) => [k, v.map((x) => `${x.id}:${x.impact}×${x.nodes}`).join(', ') || 'clean'])))
process.exit(report.failed ? 1 : 0)
