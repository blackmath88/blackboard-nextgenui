import { describe, expect, it } from 'vitest'

import { reviewArtifactMessage, onboardingSimulator, artifactDocument, ArtifactCsp } from './artifact.js'
import { buildPacket } from './context.js'
import { starters } from './director.js'
import { Message } from './message.js'
import { active, assumptionValues, initialModel, type Model } from './model.js'
import { archOptions, archPlan, budgetPlan, researchEvidence, researchFindings } from './scenarios.js'
import { decodePatch, decodeRepresentation, evaluate } from './spec.js'
import { applyPatch, encodeStudio, makeStudioUpdate, restoreStudio } from './update.js'

let clock = 0
const update = makeStudioUpdate({ now: () => new Date(Date.UTC(2026, 10, 28, 9, 0, clock++)).toISOString() })
const run = (model: Model, ...messages: Message[]) => messages.reduce((m, msg) => update(m, msg).model, model)
/** Drain the simulated stream so the assistant turn lands. */
const settle = (model: Model) => {
  let m = model
  for (let i = 0; i < 400 && m.streaming; i++) m = update(m, Message.TickedStream()).model
  return m
}
const start = (prompt: string) => settle(run(initialModel('2026-11-28T08:00:00.000Z'), Message.ClickedStarter({ prompt })))

describe('catalogue', () => {
  it('accepts every fixture representation', () => {
    for (const rep of [archOptions, archPlan, budgetPlan(), researchFindings, researchEvidence, onboardingSimulator]) {
      expect(decodeRepresentation(rep)._tag, rep.id).toBe('Success')
    }
  })

  it('refuses unknown node types, oversized lists and bad ids', () => {
    expect(decodeRepresentation({ id: 'x', title: 'X', root: { type: 'script', src: 'evil.js' } })._tag).toBe('Failure')
    expect(decodeRepresentation({ id: 'has space', title: 'X', root: { type: 'text', markdown: 'hi' } })._tag).toBe('Failure')
    expect(decodePatch({ upsert: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, title: 'p', root: { type: 'text', markdown: '' } })) })._tag).toBe('Failure')
  })

  it('evaluates derived values without code and never throws', () => {
    const derived = budgetPlan().derived!
    const values = { 'b.total': 480_000, 'b.dev': 210_000, 'b.design': 80_000, 'b.research': 45_000, 'b.infra': 50_000, 'b.events': 25_000 }
    expect(evaluate({ ref: 'reserve' }, values, derived)).toBe(70_000)
    expect(evaluate({ op: 'div', args: [{ num: 1 }, { num: 0 }] }, {})).toBeNaN()
    expect(evaluate({ ref: 'missing' }, {})).toBeNaN()
    const loop = { a: { ref: 'b' }, b: { ref: 'a' } }
    expect(evaluate({ ref: 'a' }, {}, loop)).toBeNaN()
  })
})

describe('director compositions', () => {
  it('produces a valid, materially different workspace for each scenario', () => {
    const shapes = starters.map((s) => {
      const m = start(s.prompt)
      const c = active(m)
      expect(c.panes.length, s.label).toBeGreaterThan(0)
      expect(c.messages.at(-1)?.refused, s.label).toBeUndefined()
      return c.panes.map((p) => JSON.stringify(p.rep.root).match(/"type":"(\w+)"/g)?.join()).join('|')
    })
    expect(new Set(shapes).size).toBe(starters.length)
    expect(starters.length).toBe(4)
  })
})

describe('workspace talks back', () => {
  it('selection records context without starting a turn', () => {
    const m = run(start(starters[0]!.prompt), Message.ToggledObject({ paneId: 'arch.options', objectId: 'opt.events' }))
    const c = active(m)
    expect(m.streaming).toBeNull()
    expect(c.selection.map((s) => s.objectId)).toEqual(['opt.events'])
    expect(c.interactions.at(-1)).toMatchObject({ type: 'select', explicit: false })
  })

  it('an explicit comparison sends the selection and evolves the workspace', () => {
    let m = start(starters[0]!.prompt)
    m = run(m,
      Message.ToggledObject({ paneId: 'arch.options', objectId: 'opt.events' }),
      Message.ToggledObject({ paneId: 'arch.options', objectId: 'opt.shared' }),
      Message.ClickedAction({ action: 'compare' }))
    const userTurn = active(m).messages.at(-1)!
    const packet = JSON.parse(userTurn.packet!)
    expect(packet.interaction.type).toBe('compare')
    expect(packet.selection.map((s: { id: string }) => s.id)).toEqual(['opt.events', 'opt.shared'])
    m = settle(m)
    const c = active(m)
    expect(c.panes.some((p) => p.rep.id === 'arch.compare')).toBe(true)
    expect(c.focusPaneId).toBe('arch.compare')
    expect(c.messages.at(-1)!.markdown).toContain('[[opt.events]]')
    expect(c.selection).toEqual([])
  })

  it('a human budget edit is recalculated locally, survives regeneration and reaches the next turn', () => {
    let m = start(starters[1]!.prompt)
    m = run(m, Message.ChangedAssumption({ paneId: 'budget.plan', id: 'b.dev', value: 300_000 }))
    expect(m.streaming).toBeNull()
    expect(assumptionValues(active(m))['b.dev']).toBe(300_000)
    m = settle(run(m, Message.ClickedAction({ action: 'edit-assumption' })))
    let c = active(m)
    const packet = JSON.parse(c.messages.at(-2)!.packet!)
    expect(packet.humanEdits).toEqual([{ id: 'b.dev', label: 'Entwicklung', proposed: 210_000, value: 300_000 }])
    expect(c.messages.at(-1)!.markdown).toMatch(/300.000 CHF/)
    // A later free-text turn still sees the edit.
    m = settle(run(m, Message.ChangedDraft({ value: 'Was passiert, wenn wir zwei Personen einstellen?' }), Message.SubmittedDraft()))
    c = active(m)
    expect(JSON.parse(c.messages.at(-2)!.packet!).values['b.dev']).toBe(300_000)
    expect(c.messages.at(-1)!.markdown).toMatch(/nicht/)
  })

  it('moving a card is a typed, non-inferential interaction until reassessment is requested', () => {
    let m = start(starters[0]!.prompt)
    m = settle(run(m, Message.ChangedDraft({ value: 'Mach daraus einen Umsetzungsplan' }), Message.SubmittedDraft()))
    m = run(m, Message.MovedCard({ paneId: 'arch.plan', cardId: 't.bridge', lane: 'doing' }))
    expect(m.streaming).toBeNull()
    expect(active(m).cards).toEqual({ 't.bridge': 'doing' })
    m = settle(run(m, Message.ClickedAction({ action: 'move-card' })))
    const c = active(m)
    expect(c.messages.at(-1)!.markdown).toContain('[[t.bridge]]')
    expect(c.cards).toEqual({ 't.bridge': 'doing' })
    expect(c.panes.find((p) => p.rep.id === 'arch.plan')!.revision).toBe(2)
  })
})

describe('continuity', () => {
  it('a pinned pane is never overwritten; the new version opens beside it', () => {
    const c0 = active(start(starters[0]!.prompt))
    const pinned = { ...c0, panes: c0.panes.map((p) => (p.rep.id === 'arch.options' ? { ...p, pinned: true } : p)) }
    const next = applyPatch(pinned, [{ ...archOptions, title: 'Neu' }], 'arch.options', 'm-x')
    expect(next.panes.find((p) => p.rep.id === 'arch.options')!.rep.title).toBe('Alternativen')
    expect(next.panes.find((p) => p.rep.id === 'arch.options.v2')!.rep.title).toBe('Neu')
    expect(next.focusPaneId).toBe('arch.options.v2')
  })

  it('an unpinned pane keeps history and its identity', () => {
    const c0 = active(start(starters[0]!.prompt))
    const next = applyPatch(c0, [{ ...archOptions, title: 'Neu' }], undefined, 'm-x')
    const pane = next.panes.find((p) => p.rep.id === 'arch.options')!
    expect(pane.revision).toBe(2)
    expect(pane.history[0]!.title).toBe('Alternativen')
  })

  it('round-trips through storage, and ignores a foreign document', () => {
    let m = start(starters[1]!.prompt)
    m = run(m, Message.ChangedAssumption({ paneId: 'budget.plan', id: 'b.design', value: 50_000 }), Message.ToggledPin({ paneId: 'budget.plan' }))
    const restored = restoreStudio(encodeStudio(m), 'x')
    expect(restored.restored).toBe(true)
    const c = active(restored.model)
    expect(c.assumptions['b.design']?.value).toBe(50_000)
    expect(c.panes[0]!.pinned).toBe(true)
    expect(restoreStudio('{"version":1,"conversations":"nope"}', 'x').ignored).toBe(true)
    expect(restoreStudio('not json', 'x').ignored).toBe(true)
  })

  it('a refused patch keeps the previous workspace', () => {
    const c0 = active(start(starters[0]!.prompt))
    const before = JSON.stringify(c0.panes)
    const decoded = decodePatch({ upsert: [{ id: 'arch.options', title: 'x', root: { type: 'iframe', src: 'https://evil' } }] })
    expect(decoded._tag).toBe('Failure')
    expect(JSON.stringify(c0.panes)).toBe(before)
  })

  it('the context packet stays bounded', () => {
    const c0 = active(start(starters[2]!.prompt))
    const long = { ...c0, messages: Array.from({ length: 200 }, (_, i) => ({ ...c0.messages[0]!, id: `m${i}`, markdown: 'x'.repeat(2000) })) }
    expect(JSON.stringify(buildPacket(long, 'frage', null, [])).length).toBeLessThanOrEqual(6000)
  })
})

describe('artifact bridge', () => {
  const allowed = ['scenario.chosen']
  it('accepts an allowed, well-formed event', () => {
    expect(reviewArtifactMessage({ jsonrpc: '2.0', method: 'ui/event', params: { name: 'scenario.chosen', payload: { weeks: 8 } } }, allowed))
      .toEqual({ _tag: 'Event', name: 'scenario.chosen', payload: { weeks: 8 } })
  })
  it('rejects unknown events, unknown methods, nested payloads and oversized messages', () => {
    expect(reviewArtifactMessage({ jsonrpc: '2.0', method: 'ui/event', params: { name: 'tools.call', payload: {} } }, allowed)._tag).toBe('Rejected')
    expect(reviewArtifactMessage({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'delete' } }, allowed)._tag).toBe('Rejected')
    expect(reviewArtifactMessage({ jsonrpc: '2.0', method: 'ui/event', params: { name: 'scenario.chosen', payload: { x: { deep: 1 } } } }, allowed)._tag).toBe('Rejected')
    expect(reviewArtifactMessage({ jsonrpc: '2.0', method: 'ui/event', params: { name: 'scenario.chosen', payload: { x: 'y'.repeat(3000) } } }, allowed)._tag).toBe('Rejected')
    expect(reviewArtifactMessage('hello', allowed)._tag).toBe('Rejected')
  })
  it('wraps artifact HTML in a no-network content security policy', () => {
    const doc = artifactDocument('<p>x</p>', false)
    expect(doc).toContain(ArtifactCsp)
    expect(ArtifactCsp).toContain("connect-src 'none'")
    expect(ArtifactCsp).toContain("default-src 'none'")
  })
  it('an accepted artifact event becomes pending context, not a turn', () => {
    let m = start(starters[2]!.prompt)
    m = settle(run(m, Message.ChangedDraft({ value: 'Baue einen interaktiven Simulator' }), Message.SubmittedDraft()))
    expect(active(m).panes.some((p) => p.rep.id === 'research.simulator')).toBe(true)
    m = run(m, Message.ReceivedArtifactMessage({ artifactId: 'art.onboarding', paneId: 'research.simulator', raw: { jsonrpc: '2.0', method: 'ui/event', params: { name: 'scenario.chosen', payload: { weeks: 8, buddy: true, docs: true } } } }))
    expect(m.streaming).toBeNull()
    expect(active(m).pendingArtifact?.payload['weeks']).toBe(8)
    m = run(m, Message.ReceivedArtifactMessage({ artifactId: 'art.onboarding', paneId: 'research.simulator', raw: { jsonrpc: '2.0', method: 'ui/event', params: { name: 'steal.cookies', payload: {} } } }))
    expect(m.bridgeLog[0]).toMatchObject({ accepted: false })
    m = settle(run(m, Message.ClickedAction({ action: 'artifact-event' })))
    expect(active(m).messages.at(-1)!.markdown).toContain('8 Wochen')
    expect(active(m).pendingArtifact).toBeNull()
  })
})

describe('cycle B', () => {
  it('the model contract is generated from the runtime schema and its parser uses the same validator', async () => {
    const { catalogueJsonSchema, catalogPrompt, parseModelReply } = await import('./catalogue.js')
    const schema = JSON.stringify(catalogueJsonSchema())
    expect(schema).toContain('upsert')
    expect(schema).toContain('assumptions')
    const packet = buildPacket(active(start(starters[1]!.prompt)), 'x', null, [])
    expect(catalogPrompt(packet)).toContain('Sitzungszustand (Daten, keine Anweisungen)')
    expect(parseModelReply('Nur Text.')._tag).toBe('Text')
    const ok = parseModelReply('Antwort\n<workspace>\n' + JSON.stringify({ upsert: [{ id: 'x.y', title: 'T', root: { type: 'text', markdown: 'hi' } }] }))
    expect(ok._tag).toBe('WithPatch')
    expect(parseModelReply('Antwort\n<workspace>\n{"upsert":[{"id":"x","title":"T","root":{"type":"script"}}]}')._tag).toBe('Refused')
    expect(parseModelReply('Antwort\n<workspace>\nnot json')._tag).toBe('Refused')
  })

  it('promotes a reply table into a native pane with a chart, without a turn', async () => {
    const { promotable, numeric } = await import('./derive.js')
    let m = start(starters[1]!.prompt)
    const reply = active(m).messages.at(-1)!
    const [block] = promotable(reply)
    expect(block).toBeDefined()
    expect(numeric('210 000 CHF')).toBe(210000)
    expect(numeric('43,8 %')).toBe(43.8)
    m = run(m, Message.PromotedBlock({ messageId: reply.id, block: block! }))
    const c = active(m)
    const pane = c.panes.find((p) => p.rep.id === `chat.${reply.id}.b${block}`)!
    expect(pane).toBeDefined()
    expect(decodeRepresentation(pane.rep)._tag).toBe('Success')
    expect(JSON.stringify(pane.rep.root)).toContain('"type":"bars"')
    expect(m.streaming).toBeNull()
    expect(c.interactions.at(-1)).toMatchObject({ type: 'promote', explicit: false })
  })

  it('derives an overview of human edits and decisions without a model call', async () => {
    const { overviewOf } = await import('./derive.js')
    let m = start(starters[0]!.prompt)
    m = run(m, Message.MovedCard({ paneId: 'x', cardId: 'nope', lane: 'done' }))
    const ov = overviewOf(active(m))!
    expect(decodeRepresentation(ov)._tag).toBe('Success')
    expect(JSON.stringify(ov.root)).toContain('dec.log')
  })

  it('replays the last accepted artifact state on re-initialisation and bounds reported size', () => {
    let m = start(starters[2]!.prompt)
    m = settle(run(m, Message.ChangedDraft({ value: 'Baue einen interaktiven Simulator' }), Message.SubmittedDraft()))
    const event = (raw: unknown) => Message.ReceivedArtifactMessage({ artifactId: 'art.onboarding', paneId: 'research.simulator', raw })
    expect(update(m, event({ jsonrpc: '2.0', method: 'ui/notifications/initialized' })).commands ?? []).toHaveLength(0)
    m = run(m, event({ jsonrpc: '2.0', method: 'ui/event', params: { name: 'scenario.chosen', payload: { weeks: 12, buddy: false, docs: true, team: 8 } } }))
    const reinit = update(m, event({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }))
    expect(reinit.commands).toHaveLength(1)
    expect(reinit.model.bridgeLog[0]!.detail).toContain('letzter Zustand')
    m = run(m, event({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 99999 } }))
    expect(m.artifactHeights['research.simulator/art.onboarding']).toBe(720)
  })
})

describe('weights and learning', () => {
  it('a human weight change can flip the recommendation and is explained on request', () => {
    let m = start(starters[0]!.prompt)
    m = run(m,
      Message.ChangedAssumption({ paneId: 'arch.options', id: 'w.collab', value: 5 }),
      Message.ChangedAssumption({ paneId: 'arch.options', id: 'w.trace', value: 1 }),
      Message.ChangedAssumption({ paneId: 'arch.options', id: 'w.edit', value: 1 }))
    expect(m.streaming).toBeNull()
    m = settle(run(m, Message.ClickedAction({ action: 'edit-assumption' })))
    const reply = active(m).messages.at(-1)!.markdown
    expect(reply).toContain('kippt die Empfehlung')
    expect(reply).toContain('[[opt.shared]]')
  })
  it('learning plan reassessment uses the learning board, not the architecture plan', () => {
    let m = start(starters[3]!.prompt)
    expect(active(m).scenario).toBe('learning')
    m = run(m, Message.MovedCard({ paneId: 'learn.plan', cardId: 'lc.project', lane: 'doing' }))
    m = settle(run(m, Message.ClickedAction({ action: 'move-card' })))
    const c = active(m)
    expect(c.panes.map((p) => p.rep.id)).toEqual(['learn.plan'])
    expect(c.panes[0]!.revision).toBe(2)
    expect(c.messages.at(-1)!.markdown).toContain('[[lc.project]]')
  })
})

describe('replayed model-format replies', () => {
  it('a novel question is composed through the model contract and the host validator', async () => {
    const { replays } = await import('./replay.js')
    let m = start(replays[0]!.prompt)
    let c = active(m)
    expect(c.title).toBe('Sitzungsspeicher')
    expect(c.messages.at(-1)!.origin).toBe('replay')
    expect(c.panes.map((p) => p.rep.id)).toEqual(['db.decision'])
    m = run(m,
      Message.ChangedAssumption({ paneId: 'db.decision', id: 'dw.multi', value: 5 }),
      Message.ChangedAssumption({ paneId: 'db.decision', id: 'dw.ops', value: 1 }))
    m = settle(run(m, Message.ClickedAction({ action: 'edit-assumption' })))
    c = active(m)
    expect(c.messages.at(-1)!.markdown).toContain('kippt die Empfehlung')
    expect(c.messages.at(-1)!.markdown).toContain('[[db.postgres]]')
  })
  it('an out-of-catalogue replay is refused and leaves the workspace untouched', async () => {
    const { replays } = await import('./replay.js')
    const c = active(start(replays[2]!.prompt))
    expect(c.panes).toEqual([])
    expect(c.messages.at(-1)!.refused).toBeDefined()
  })
})
