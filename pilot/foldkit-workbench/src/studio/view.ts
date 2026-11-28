/**
 * Studio view: rail · conversation · Blackboard.
 *
 * Every catalogue primitive has exactly one host renderer here. Interactive
 * objects render as buttons (keyboard reachable) that dispatch typed messages;
 * nothing in a representation can attach its own handler.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'
import { Option } from 'effect'

import { artifactDocument } from './artifact.js'
import { labelOf } from './context.js'
import { starters } from './director.js'
import { blocks, inlines, streamSafe } from './markdown.js'
import { Message, type ExplicitAction } from './message.js'
import { type ChatEntry, type Conversation, type Model, type Pane, active, assumptionValues } from './model.js'
import { FollowStudioChat } from './mount.js'
import { evaluate, objectIndex, type Expr, type Node, type Tone } from './spec.js'
import { undiscussed } from './update.js'
import { OverviewId, overviewOf, promotable } from './derive.js'

type H = HtmlBuilder<Message>
type Html = ReturnType<H['div']>

const nf = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 1 })
const fmt = (value: number, unit?: string) => {
  if (!Number.isFinite(value)) return '—'
  const compact = unit === 'CHF' && Math.abs(value) >= 10_000 ? `${nf.format(value / 1000)}k` : nf.format(value)
  return unit && unit !== '%' ? `${compact} ${unit}` : unit === '%' ? `${compact} %` : compact
}
const fmtFull = (value: number, unit?: string) => (Number.isFinite(value) ? `${nf.format(value)}${unit ? (unit === '%' ? ' %' : ` ${unit}`) : ''}` : '—')

const time = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
}

const scenarioGlyph: Record<Conversation['scenario'], string> = { architecture: '◇', budget: '◐', research: '◎', open: '○' }

export const studioView = (model: Model, h: H, deps: { restoreNote: string | undefined; bootedAt: string }): Document => {
  const c = active(model)
  const selected = new Set(c.selection.map((s) => s.objectId))
  const values = assumptionValues(c)

  // ------------------------------------------------------------ inline text
  const inlineNodes = (text: string): Array<Html | string> =>
    inlines(text).map((part) => {
      switch (part.kind) {
        case 'text': return part.text
        case 'strong': return h.strong([], [part.text])
        case 'em': return h.em([], [part.text])
        case 'code': return h.code([], [part.text])
        case 'ref': {
          const label = labelOf(c, part.id)
          if (!label) return h.span([h.Class('ref missing'), h.Title('Nicht mehr auf der Arbeitsfläche')], [part.id])
          return h.button([
            h.Type('button'), h.Class(`ref${selected.has(part.id) ? ' on' : ''}`),
            h.Title(`${label.kind} auf der Arbeitsfläche zeigen`),
            h.OnClick(Message.ClickedRef({ objectId: part.id })),
          ], [label.label])
        }
      }
    })

  const prose = (markdown: string, cls = 'prose'): Html =>
    h.div([h.Class(cls)], blocks(markdown).map((b) => {
      switch (b.kind) {
        case 'heading': return h.h4([], inlineNodes(b.text))
        case 'paragraph': return h.p([], inlineNodes(b.text))
        case 'quote': return h.blockquote([], inlineNodes(b.text))
        case 'code': return h.pre([], [h.code([], [b.text])])
        case 'list': return (b.ordered ? h.ol : h.ul)([], b.items.map((i) => h.li([], inlineNodes(i))))
        case 'table': return h.div([h.Class('md-table')], [h.table([], [
          h.thead([], [h.tr([], b.head.map((cell, i) => h.th([h.Class(b.align[i] === 'end' ? 'num' : '')], inlineNodes(cell))))]),
          h.tbody([], b.rows.map((row) => h.tr([], row.map((cell, i) => h.td([h.Class(b.align[i] === 'end' ? 'num' : '')], inlineNodes(cell)))))),
        ])])
      }
    }))

  // ------------------------------------------------------------ rail
  const recentPanes = model.conversations.flatMap((conv) => conv.panes.filter((p) => p.pinned).map((p) => ({ conv, p }))).slice(0, 6)
  const rail = h.nav([h.Class('rail'), h.AriaLabel('Navigation')], [
    h.div([h.Class('brand')], [
      h.span([h.Class('mark'), h.AriaHidden(true)], []),
      h.span([], ['Blackboard']),
    ]),
    h.button([h.Type('button'), h.Class('new-chat'), h.OnClick(Message.StartedConversation())], ['Neues Gespräch']),
    h.div([h.Class('rail-group')], [
      h.h3([], ['Projekte']),
      h.div([h.Class('rail-item current')], [h.span([h.Class('dot')], []), 'Blackboard Labor']),
    ]),
    h.div([h.Class('rail-group grow')], [
      h.h3([], ['Gespräche']),
      ...model.conversations.map((conv) =>
        h.button([
          h.Type('button'),
          h.Class(`rail-item conv${conv.id === c.id ? ' current' : ''}`),
          h.AriaCurrent(conv.id === c.id ? 'page' : 'false'),
          h.OnClick(Message.SelectedConversation({ id: conv.id })),
        ], [
          h.span([h.Class('glyph'), h.AriaHidden(true)], [scenarioGlyph[conv.scenario]]),
          h.span([h.Class('conv-title')], [conv.title]),
        ])),
    ]),
    h.div([h.Class('rail-group')], [
      h.h3([], ['Aktuelle Sitzung']),
      h.dl([h.Class('session')], [
        h.dt([], ['Darstellungen']), h.dd([], [String(c.panes.length)]),
        h.dt([], ['Interaktionen']), h.dd([], [String(c.interactions.length)]),
        h.dt([], ['Eigene Änderungen']), h.dd([], [String(Object.keys(c.assumptions).length + Object.keys(c.cards).length)]),
      ]),
    ]),
    ...(recentPanes.length ? [h.div([h.Class('rail-group')], [
      h.h3([], ['Angeheftete Arbeitsflächen']),
      ...recentPanes.map(({ conv, p }) => h.button([
        h.Type('button'), h.Class('rail-item small'),
        h.OnClick(Message.OpenedRecentPane({ conversationId: conv.id, paneId: p.rep.id })),
      ], [pinIcon(h), h.span([h.Class('conv-title')], [p.rep.title]), h.span([h.Class('faint')], [conv.title.split(' ')[0] ?? ''])])),
    ])] : []),
    h.div([h.Class('rail-foot')], [
      h.p([], ['Synthetischer Modus — Antworten stammen aus Fixtures, nicht aus einem Modell.']),
      h.button([h.Type('button'), h.Class('link'), h.OnClick(Message.ResetStudio())], ['Labor zurücksetzen']),
    ]),
  ])

  // ------------------------------------------------------------ chat
  const streaming = model.streaming && model.streaming.conversationId === c.id ? model.streaming : null
  const message = (entry: ChatEntry, live = false): Html => entry.role === 'user'
    ? h.li([h.Class('msg user')], [
        ...(entry.context.length ? [h.div([h.Class('msg-context')], entry.context.map((ref) =>
          h.button([h.Type('button'), h.Class('ref small'), h.OnClick(Message.ClickedRef({ objectId: ref.objectId }))], [h.span([h.Class('kind')], [ref.kind]), ' ', ref.label])))] : []),
        h.div([h.Class('bubble')], [prose(entry.markdown)]),
        ...(entry.packet ? [h.button([h.Type('button'), h.Class('packet-link'), h.OnClick(Message.InspectedPacket({ messageId: entry.id }))], ['Was die KI sieht'])] : []),
      ])
    : h.li([h.Class(`msg assistant${live ? ' live' : ''}`)], [
        prose(live ? streamSafe(entry.markdown) : entry.markdown),
        ...(entry.refused ? [h.p([h.Class('refused'), h.Role('status')], [entry.refused])] : []),
        ...(!live ? promotable(entry).map((index) => {
          const id = `chat.${entry.id}.b${index}`
          const there = c.panes.some((p) => p.rep.id === id)
          return h.button([
            h.Type('button'), h.Class(`promote${there ? ' done' : ''}`),
            h.OnClick(there ? Message.FocusedPane({ paneId: id }) : Message.PromotedBlock({ messageId: entry.id, block: index })),
          ], [there ? 'Auf dem Blackboard' : (blocks(entry.markdown)[index]?.kind === 'table' ? 'Tabelle aufs Blackboard' : 'Liste aufs Blackboard')])
        }) : []),
        ...(!live && entry.touched.length ? [h.div([h.Class('touched')], [
          h.span([h.Class('faint')], ['Arbeitsfläche: ']),
          ...entry.touched.map((id) => {
            const pane = c.panes.find((p) => p.rep.id === id)
            return pane
              ? h.button([h.Type('button'), h.Class('pane-chip'), h.OnClick(Message.FocusedPane({ paneId: id }))], [pane.rep.title])
              : h.span([h.Class('pane-chip gone')], [id])
          }),
        ])] : []),
      ])

  const emptyChat = h.div([h.Class('empty')], [
    h.h1([], ['Woran denken wir heute?']),
    h.p([], ['Das Gespräch bleibt hier. Was wir dabei verstehen, entscheiden und berechnen, entsteht rechts auf dem Blackboard — und bleibt dort.']),
    h.div([h.Class('starters')], starters.map((s) => h.button([h.Type('button'), h.Class('starter'), h.OnClick(Message.ClickedStarter({ prompt: s.prompt }))], [
      h.span([h.Class('starter-label')], [s.label]),
      h.span([h.Class('starter-prompt')], [s.prompt]),
    ]))),
  ])

  // Context tray: what the workspace is telling the conversation.
  const edits = undiscussed(c, 'edit-assumption')
  const moves = undiscussed(c, 'move-card')
  const kinds = new Set(c.selection.map((s) => s.kind))
  const one = c.selection.length === 1 ? c.selection[0] : undefined
  const actions: Array<[ExplicitAction, string]> = []
  if (c.selection.length >= 2 && kinds.size === 1 && (kinds.has('Option') || kinds.has('Befund'))) actions.push(['compare', 'Vergleichen'])
  if (one && ['Entscheidung', 'Option', 'Befund'].includes(one.kind)) actions.push(['ask-why', 'Warum?'])
  if (one && (one.kind === 'Quelle' || one.objectId.startsWith('s.'))) actions.push(['inspect-source', 'Relevanz prüfen'])
  if (one && ['Komponente', 'Datenpunkt', 'Offene Frage', 'Aufgabe', 'Phase', 'Kennzahl'].includes(one.kind)) actions.push(['investigate', 'Untersuchen'])
  const tray = (c.selection.length || edits.length || moves.length || c.pendingArtifact)
    ? h.div([h.Class('tray'), h.AriaLabel('Kontext aus der Arbeitsfläche')], [
        ...(c.selection.length ? [h.div([h.Class('tray-row')], [
          h.span([h.Class('tray-label')], ['Auswahl']),
          ...c.selection.map((s) => h.span([h.Class('chip')], [
            h.span([h.Class('kind')], [s.kind]), ' ', s.label,
            h.button([h.Type('button'), h.Class('chip-x'), h.AriaLabel(`${s.label} aus dem Kontext entfernen`), h.OnClick(Message.RemovedContext({ objectId: s.objectId }))], ['×']),
          ])),
          h.span([h.Class('spacer')], []),
          ...actions.map(([action, label]) => h.button([h.Type('button'), h.Class('act'), h.Disabled(!!model.streaming), h.OnClick(Message.ClickedAction({ action }))], [label])),
        ])] : []),
        ...(edits.length ? [h.div([h.Class('tray-row')], [
          h.span([h.Class('tray-label')], ['Geändert']),
          h.span([h.Class('chip edit')], [`${new Set(edits.flatMap((e) => e.objectIds)).size} Annahme${new Set(edits.flatMap((e) => e.objectIds)).size === 1 ? '' : 'n'}`]),
          h.span([h.Class('spacer')], []),
          h.button([h.Type('button'), h.Class('act'), h.Disabled(!!model.streaming), h.OnClick(Message.ClickedAction({ action: 'edit-assumption' }))], ['Auswirkungen besprechen']),
        ])] : []),
        ...(moves.length ? [h.div([h.Class('tray-row')], [
          h.span([h.Class('tray-label')], ['Verschoben']),
          h.span([h.Class('chip edit')], [`${new Set(moves.flatMap((e) => e.objectIds)).size} Aufgabe${moves.length === 1 ? '' : 'n'}`]),
          h.span([h.Class('spacer')], []),
          h.button([h.Type('button'), h.Class('act'), h.Disabled(!!model.streaming), h.OnClick(Message.ClickedAction({ action: 'move-card' }))], ['Plan neu bewerten']),
        ])] : []),
        ...(c.pendingArtifact ? [h.div([h.Class('tray-row')], [
          h.span([h.Class('tray-label')], ['Artefakt']),
          h.span([h.Class('chip edit')], [`Szenario: ${String(c.pendingArtifact.payload['weeks'] ?? '?').replace('.', ',')} Wochen`]),
          h.span([h.Class('spacer')], []),
          h.button([h.Type('button'), h.Class('ghost small'), h.OnClick(Message.DiscardedArtifactEvent())], ['Verwerfen']),
          h.button([h.Type('button'), h.Class('act'), h.Disabled(!!model.streaming), h.OnClick(Message.ClickedAction({ action: 'artifact-event' }))], ['Im Gespräch aufgreifen']),
        ])] : []),
      ])
    : null

  const composer = h.form([h.Class('composer'), h.OnSubmit(Message.SubmittedDraft())], [
    ...(tray ? [tray] : []),
    h.div([h.Class('composer-box')], [
      h.textarea([
        h.AriaLabel('Nachricht'), h.Rows(1),
        h.Placeholder(c.selection.length ? 'Frage zur Auswahl stellen …' : 'Nachricht an Blackboard …'),
        h.Value(c.draft), h.OnInput((value) => Message.ChangedDraft({ value })),
        h.OnKeyDownPreventDefault((key, mods) => key === 'Enter' && !mods.shiftKey && !mods.altKey && !mods.metaKey && !mods.ctrlKey
          ? Option.some(Message.SubmittedDraft()) : Option.none()),
      ]),
      h.button([h.Type('submit'), h.Class('send'), h.AriaLabel('Senden'), h.Disabled(!c.draft.trim() || !!model.streaming)], ['↑']),
    ]),
    h.p([h.Class('composer-note')], ['Auswahl auf dem Blackboard wird als Kontext mitgeschickt. Klicken allein löst keine Antwort aus.']),
  ])

  const packetEntry = model.inspectPacket ? c.messages.find((m) => m.id === model.inspectPacket) : undefined

  const chat = h.main([h.Class('chat'), h.AriaLabel('Gespräch')], [
    h.header([h.Class('chat-head')], [
      h.button([h.Type('button'), h.Class('icon rail-toggle'), h.AriaLabel('Navigation ein- oder ausblenden'), h.OnClick(Message.ToggledRail())], ['☰']),
      h.div([h.Class('chat-title')], [h.h1([], [c.title]), h.span([h.Class('faint')], [c.project])]),
      h.div([h.Class('segmented narrow-only'), h.Role('tablist')], [
        h.button([h.Type('button'), h.Role('tab'), h.AriaSelected(model.narrowView === 'chat'), h.Class(model.narrowView === 'chat' ? 'on' : ''), h.OnClick(Message.SelectedNarrowView({ view: 'chat' }))], ['Chat']),
        h.button([h.Type('button'), h.Role('tab'), h.AriaSelected(model.narrowView === 'board'), h.Class(model.narrowView === 'board' ? 'on' : ''), h.OnClick(Message.SelectedNarrowView({ view: 'board' }))], [`Blackboard${c.panes.length ? ` · ${c.panes.length}` : ''}`]),
      ]),
    ]),
    ...(deps.restoreNote && c.messages.length && (c.messages.at(-1)?.at ?? '') < deps.bootedAt ? [h.p([h.Class('restore')], [deps.restoreNote])] : []),
    c.messages.length === 0 && !streaming
      ? emptyChat
      : h.ol([h.Class('messages'), h.OnMount(FollowStudioChat())], [
          ...c.messages.map((m) => message(m)),
          ...(streaming ? [message({ ...streaming.entry, markdown: streaming.entry.markdown.slice(0, streaming.shown) || '' }, true)] : []),
        ]),
    composer,
    ...(packetEntry?.packet ? [h.div([h.Class('sheet'), h.Role('dialog'), h.AriaLabel('Kontextpaket')], [
      h.div([h.Class('sheet-head')], [
        h.strong([], ['Was die KI sieht']),
        h.span([h.Class('faint')], ['Begrenztes Kontextpaket dieses Turns']),
        h.button([h.Type('button'), h.Class('icon'), h.AriaLabel('Schliessen'), h.OnClick(Message.ClosedPacket())], ['×']),
      ]),
      h.pre([h.Class('packet')], [packetEntry.packet]),
    ])] : []),
  ])

  // ------------------------------------------------------------ node renderers
  const sel = (id: string) => (selected.has(id) ? ' selected' : '')
  const pick = (paneId: string, id: string) => Message.ToggledObject({ paneId, objectId: id })
  const toneClass = (tone: Tone | undefined) => (tone ? ` tone-${tone}` : '')

  const render = (node: Node, pane: Pane): Html => {
    const paneId = pane.rep.id
    const derived = pane.rep.derived ?? {}
    const valueOf = (ref: string) => (ref in values ? values[ref]! : evaluate({ ref } as Expr, values, derived))
    switch (node.type) {
      case 'section':
        return h.section([h.Class('n-section')], [
          ...(node.title ? [h.h3([h.Class('n-title')], [node.title])] : []),
          ...(node.note ? [h.p([h.Class('faint')], [node.note])] : []),
          ...node.children.map((child) => render(child, pane)),
        ])
      case 'grid':
        return h.div([h.Class('n-grid'), h.Style({ '--cols': String(Math.min(4, Math.max(1, node.columns))) })], node.children.map((child) => render(child, pane)))
      case 'text':
        return prose(node.markdown)
      case 'callout':
        return h.div([h.Class(`n-callout${toneClass(node.tone)}`)], [
          ...(node.title ? [h.strong([], [node.title])] : []),
          prose(node.markdown),
        ])
      case 'metric': {
        const value = node.derived ? valueOf(node.derived) : (node.value ?? Number.NaN)
        const tone = node.tone ?? (node.derived === 'reserve' || node.derived === 'reserveShare' ? (value < 0 ? 'critical' : node.derived === 'reserveShare' && value < 8 ? 'caution' : undefined) : undefined)
        return h.button([h.Type('button'), h.Class(`n-metric${sel(node.id)}${toneClass(tone)}`), h.AriaPressed(String(selected.has(node.id))), h.OnClick(pick(paneId, node.id))], [
          h.span([h.Class('metric-label')], [node.label]),
          h.span([h.Class('metric-value')], [
            node.unit === 'CHF' && Math.abs(value) >= 10_000 ? nf.format(value / 1000) + 'k' : nf.format(Number.isFinite(value) ? value : NaN).replace('NaN', '—'),
            ...(node.unit ? [h.small([], [node.unit === 'CHF' ? ' CHF' : ` ${node.unit}`])] : []),
          ]),
          ...(node.note ? [h.span([h.Class('metric-note')], [node.note])] : []),
        ])
      }
      case 'table':
        return h.div([h.Class('n-table')], [h.table([], [
          h.thead([], [h.tr([], node.columns.map((col) => h.th([h.Class(col.align === 'end' ? 'num' : '')], [col.label])))]),
          h.tbody([], node.rows.map((row) => h.tr([
            h.Class(`${node.selectable ? 'pickable' : ''}${sel(row.id)}${toneClass(row.tone)}`),
            ...(node.selectable ? [h.Tabindex(0), h.OnClick(pick(paneId, row.id)), h.OnKeyDownPreventDefault((key) => (key === 'Enter' || key === ' ' ? Option.some(pick(paneId, row.id)) : Option.none()))] : []),
          ], node.columns.map((col) => {
            const v = row.cells[col.key]
            return h.td([h.Class(col.align === 'end' ? 'num' : '')], [typeof v === 'number' ? nf.format(v) : (v ?? '')])
          })))),
        ])])
      case 'matrix': {
        const total = (id: string) => node.criteria.reduce((sum, cr) => sum + (node.scores[id]?.[cr.id] ?? 0) * cr.weight, 0)
        const max = node.criteria.reduce((sum, cr) => sum + 5 * cr.weight, 0)
        const best = [...node.options].sort((a, b) => total(b.id) - total(a.id))[0]?.id
        return h.div([h.Class('n-matrix')], [h.table([], [
          h.thead([], [h.tr([], [
            h.th([h.Class('crit')], ['Kriterium']),
            ...node.options.map((o) => h.th([], [h.button([h.Type('button'), h.Class(`opt-head${sel(o.id)}`), h.AriaPressed(String(selected.has(o.id))), h.OnClick(pick(paneId, o.id))], [o.label])])),
          ])]),
          h.tbody([], [
            ...node.criteria.map((cr) => h.tr([], [
              h.th([h.Class('crit')], [cr.label, h.span([h.Class('weight')], [`×${cr.weight}`])]),
              ...node.options.map((o) => {
                const s = node.scores[o.id]?.[cr.id] ?? 0
                return h.td([h.Class(`score${sel(o.id)}`), h.Title(`${s} von 5`)], [
                  h.span([h.Class('dots'), h.AriaLabel(`${s} von 5`)], [0, 1, 2, 3, 4].map((i) => h.span([h.Class(i < s ? 'd on' : 'd')], []))),
                ])
              }),
            ])),
            h.tr([h.Class('total')], [
              h.th([h.Class('crit')], ['Gewichtet']),
              ...node.options.map((o) => h.td([h.Class(`${o.id === best ? 'best' : ''}${sel(o.id)}`)], [
                h.span([h.Class('total-bar')], [h.span([h.Style({ width: `${(total(o.id) / max) * 100}%` })], [])]),
                h.span([h.Class('total-num')], [`${total(o.id)}`]),
              ])),
            ]),
          ]),
        ])])
      }
      case 'bars': {
        const items = node.items.map((i) => ({ ...i, v: i.assumption ? valueOf(i.assumption) : (i.value ?? 0) }))
        const max = Math.max(1, ...items.map((i) => Math.abs(i.v)))
        return h.figure([h.Class('n-bars')], [
          ...(node.title ? [h.figcaption([], [node.title])] : []),
          h.ul([], items.map((i) => h.li([], [h.button([
            h.Type('button'), h.Class(`bar-row${sel(i.id)}${toneClass(i.tone)}${i.v < 0 ? ' negative' : ''}`),
            h.AriaPressed(String(selected.has(i.id))), h.OnClick(pick(paneId, i.id)),
          ], [
            h.span([h.Class('bar-label')], [i.label]),
            h.span([h.Class('bar-track')], [h.span([h.Class('bar-fill'), h.Style({ width: `${Math.max(0.5, (Math.abs(i.v) / max) * 100)}%` })], [])]),
            h.span([h.Class('bar-value')], [fmt(i.v, node.unit)]),
          ])]))),
        ])
      }
      case 'diagram': return diagram(h, node, paneId, selected)
      case 'timeline': {
        const weeks = Array.from({ length: Math.max(1, node.span) }, (_, i) => i)
        return h.div([h.Class('n-timeline'), h.Style({ '--span': String(node.span) })], [
          h.div([h.Class('tl-head')], [h.span([], []), ...weeks.map((w) => h.span([], [`W${w + 1}`]))]),
          ...node.items.flatMap((item, index) => [
            ...(item.lane && item.lane !== node.items[index - 1]?.lane ? [h.div([h.Class('tl-group')], [item.lane])] : []),
            h.div([h.Class('tl-row')], [
              h.span([h.Class(`tl-label${sel(item.id)}`)], [item.label]),
              h.button([
                h.Type('button'),
                h.Class(`tl-bar${item.milestone ? ' milestone' : ''}${toneClass(item.tone)}${sel(item.id)}`),
                h.Style({ gridColumn: `${item.start + 2} / span ${Math.max(1, item.length)}` }),
                h.AriaLabel(`${item.label}: Woche ${item.start + 1} bis ${item.start + item.length}`),
                h.OnClick(pick(paneId, item.id)),
              ], [item.milestone ? '◆' : '']),
            ]),
          ]),
        ])
      }
      case 'board': {
        const laneOf = (id: string, proposed: string) => c.cards[id] ?? proposed
        return h.div([h.Class('n-board'), h.Style({ '--lanes': String(node.lanes.length) })], node.lanes.map((lane, li) =>
          h.section([
            h.Class(`lane${model.dragCard ? ' droppable' : ''}`), h.AriaLabel(lane.label),
            h.AllowDrop(), h.OnDrop(Message.DroppedCard({ paneId, lane: lane.id })),
          ], [
            h.h3([], [lane.label, h.span([h.Class('count')], [String(node.cards.filter((card) => laneOf(card.id, card.lane) === lane.id).length)])]),
            ...node.cards.filter((card) => laneOf(card.id, card.lane) === lane.id).map((card) => {
              const moved = c.cards[card.id] !== undefined
              return h.div([
                h.Class(`card${sel(card.id)}${moved ? ' moved' : ''}`), h.Draggable(true),
                h.OnDragStart(Message.StartedCardDrag({ cardId: card.id })),
              ], [
                h.button([h.Type('button'), h.Class('card-main'), h.OnClick(pick(paneId, card.id))], [
                  h.span([h.Class('card-title')], [card.title]),
                  ...(card.owner ? [h.span([h.Class('card-owner')], [card.owner])] : []),
                ]),
                h.div([h.Class('card-moves')], [
                  ...(li > 0 ? [h.button([h.Type('button'), h.Class('mini'), h.AriaLabel(`${card.title} nach ${node.lanes[li - 1]!.label}`), h.OnClick(Message.MovedCard({ paneId, cardId: card.id, lane: node.lanes[li - 1]!.id }))], ['←'])] : []),
                  ...(li < node.lanes.length - 1 ? [h.button([h.Type('button'), h.Class('mini'), h.AriaLabel(`${card.title} nach ${node.lanes[li + 1]!.label}`), h.OnClick(Message.MovedCard({ paneId, cardId: card.id, lane: node.lanes[li + 1]!.id }))], ['→'])] : []),
                ]),
              ])
            }),
          ])))
      }
      case 'records':
        return h.ul([h.Class(`n-records v-${node.variant}`)], node.items.map((item, index) => h.li([], [h.button([
          h.Type('button'), h.Class(`record${sel(item.id)}${toneClass(item.tone)}`),
          h.AriaPressed(String(selected.has(item.id))), h.OnClick(pick(paneId, item.id)),
        ], [
          h.span([h.Class('rec-mark'), h.AriaHidden(true)], [
            node.variant === 'option' ? String.fromCharCode(65 + index)
              : node.variant === 'decision' ? '◆'
              : node.variant === 'question' ? '?'
              : node.variant === 'risk' ? '!'
              : '',
          ]),
          h.span([h.Class('rec-body')], [
            h.span([h.Class('rec-title')], [item.title]),
            ...(item.detail ? [h.span([h.Class('rec-detail')], [item.detail])] : []),
            ...(item.sources?.length || item.strength ? [h.span([h.Class('rec-meta')], [
              ...(item.strength ? [h.span([h.Class('strength'), h.Title(`Belegstärke ${item.strength} von 3`)], [0, 1, 2].map((i) => h.span([h.Class(i < item.strength! ? 'd on' : 'd')], [])))] : []),
              ...(item.sources ?? []).map((s) => h.span([h.Class('src-tag')], [labelOf(c, s)?.label ?? s])),
            ])] : []),
          ]),
          ...(item.meta ? [h.span([h.Class('rec-badge')], [item.meta])] : []),
        ])])))
      case 'sources':
        return h.ul([h.Class('n-sources')], node.items.map((s) => h.li([], [h.button([
          h.Type('button'), h.Class(`source${sel(s.id)}`), h.AriaPressed(String(selected.has(s.id))), h.OnClick(pick(paneId, s.id)),
        ], [
          h.span([h.Class('src-title')], [s.title]),
          h.span([h.Class('src-origin')], [[s.origin, s.year ? String(s.year) : '', s.kind ?? ''].filter(Boolean).join(' · ')]),
          ...(s.excerpt ? [h.span([h.Class('src-excerpt')], [`„${s.excerpt}“`])] : []),
        ])])))
      case 'assumptions':
        return h.div([h.Class('n-assumptions')], node.items.map((item) => {
          const edit = c.assumptions[item.id]
          const value = values[item.id] ?? item.value
          return h.div([h.Class(`assumption${edit ? ' edited' : ''}${sel(item.id)}`)], [
            h.div([h.Class('as-row')], [
              h.button([h.Type('button'), h.Class('as-label'), h.OnClick(pick(paneId, item.id))], [item.label]),
              h.output([h.Class('as-value')], [fmtFull(value, item.unit)]),
            ]),
            h.input([
              h.Type('range'), h.Min(String(item.min)), h.Max(String(item.max)), h.Step(String(item.step)), h.Value(String(value)),
              h.AriaLabel(item.label),
              h.OnInput((v) => Message.ChangedAssumption({ paneId, id: item.id, value: Number(v) })),
            ]),
            ...(edit ? [h.div([h.Class('as-edit')], [
              h.span([], [`Ihre Änderung · Vorschlag ${fmtFull(edit.proposed, item.unit)}`]),
              h.button([h.Type('button'), h.Class('link'), h.OnClick(Message.ResetAssumption({ id: item.id }))], ['zurücksetzen']),
            ])] : []),
          ])
        }))
      case 'action':
        return h.button([h.Type('button'), h.Class('n-action'), h.Disabled(!!model.streaming), h.OnClick(Message.ClickedPaneAction({ paneId, prompt: node.prompt }))], [node.label])
      case 'artifact':
        return h.figure([h.Class('n-artifact')], [
          h.figcaption([], [h.span([], [node.title]), h.span([h.Class('sandbox-tag')], ['Sandbox'])]),
          h.keyed('iframe')(`${paneId}/${node.id}/${pane.revision}/${prefersDark() ? 'd' : 'l'}`, [
            h.Title(node.title),
            h.Sandbox('allow-scripts'),
            h.Attribute('referrerpolicy', 'no-referrer'),
            h.Attribute('allow', ''),
            h.DataAttribute('artifact-id', node.id),
            h.DataAttribute('pane-id', paneId),
            h.Srcdoc(artifactDocument(node.html, prefersDark())),
            h.Style({ height: `${Math.min(720, Math.max(120, model.artifactHeights[`${paneId}/${node.id}`] ?? node.height ?? 280))}px` }),
          ], []),
        ])
    }
  }

  // ------------------------------------------------------------ board
  const overview = overviewOf(c)
  const overviewPane: Pane | undefined = overview ? { rep: overview, revision: 0, turnId: '', pinned: false, history: [] } : undefined
  const focus = c.focusPaneId === OverviewId && overviewPane ? overviewPane : (c.panes.find((p) => p.rep.id === c.focusPaneId) ?? c.panes[0])
  const ordered = [...(overviewPane ? [overviewPane] : []), ...c.panes.filter((p) => p.pinned), ...c.panes.filter((p) => !p.pinned)]
  const pendingPatch = streaming?.patch as { upsert: Array<{ id: string; title: string }> } | null | undefined
  const secondary = model.split ? c.panes.find((p) => p.pinned && p !== focus) : undefined
  const canSplit = c.panes.some((p) => p.pinned && p !== focus)
  const paneView = (pane: Pane, role: 'primary' | 'secondary'): Html => {
    const derivedPane = pane.rep.id === OverviewId
    return h.div([h.Class(`pane ${role}${streaming && pendingPatch?.upsert.some((r) => r.id === pane.rep.id) ? ' refreshing' : ''}`), h.Key(`${role}/${pane.rep.id}`), h.AriaLabel(pane.rep.title)], [
      h.div([h.Class('pane-head')], [
        h.div([], [
          h.h2([], [pane.rep.title]),
          ...(pane.rep.purpose ? [h.p([h.Class('purpose')], [pane.rep.purpose])] : []),
        ]),
        ...(derivedPane ? [] : [h.div([h.Class('pane-tools')], [
          h.button([h.Type('button'), h.Class(`tool${pane.pinned ? ' on' : ''}`), h.AriaPressed(String(pane.pinned)), h.OnClick(Message.ToggledPin({ paneId: pane.rep.id }))], [...(pane.pinned ? [pinIcon(h)] : []), pane.pinned ? 'Angeheftet' : 'Anheften']),
          ...(pane.history.length && !pane.pinned ? [h.button([h.Type('button'), h.Class('tool'), h.Title('Vorherige Fassung wiederherstellen'), h.OnClick(Message.RestoredRevision({ paneId: pane.rep.id }))], ['Vorherige'])] : []),
          ...(!pane.pinned ? [h.button([h.Type('button'), h.Class('tool icon'), h.AriaLabel('Darstellung schliessen'), h.OnClick(Message.ClosedPane({ paneId: pane.rep.id }))], ['×'])] : []),
        ])]),
      ]),
      ...(derivedPane ? [h.p([h.Class('provenance')], ['Live aus dem Sitzungszustand'])] : [h.p([h.Class('provenance')], [
        `Rev. ${pane.revision}`,
        ' · ',
        (() => {
          const turn = c.messages.find((m) => m.id === pane.turnId)
          return turn ? `aus der Antwort von ${time(turn.at)}` : 'aus einer früheren Antwort'
        })(),
        ...((() => {
          const ids = objectIndex(pane.rep.root)
          return [...Object.keys(c.assumptions), ...Object.keys(c.cards)].some((id) => ids.has(id))
        })() ? [' · ', h.span([h.Class('human')], ['enthält Ihre Änderungen'])] : []),
      ])]),
      h.div([h.Class('pane-body')], [render(pane.rep.root, pane)]),
    ])
  }
  const board = h.aside([h.Class(`board${secondary ? ' split' : ''}`), h.AriaLabel('Blackboard'), h.Style({ '--board-w': `${model.boardWidth}px` })], [
    h.div([
      h.Class('handle'), h.Role('separator'), h.AriaOrientation('vertical'), h.AriaLabel('Breite des Blackboards'), h.Tabindex(0),
      h.AriaValuenow(model.boardWidth),
      h.OnPointerDown(() => Option.some(Message.StartedResize())),
      h.OnKeyDownPreventDefault((key) => key === 'ArrowLeft' ? Option.some(Message.NudgedBoard({ delta: 40 })) : key === 'ArrowRight' ? Option.some(Message.NudgedBoard({ delta: -40 })) : Option.none()),
    ], []),
    h.header([h.Class('board-head')], [
      h.div([h.Class('tabs'), h.Role('tablist'), h.AriaLabel('Darstellungen')], [
        ...ordered.map((p) => h.button([
          h.Type('button'), h.Role('tab'), h.AriaSelected(p === focus),
          h.Class(`tab${p === focus ? ' on' : ''}${p === secondary ? ' beside' : ''}${p.pinned ? ' pinned' : ''}${p === overviewPane ? ' overview' : ''}${pendingPatch?.upsert.some((r) => r.id === p.rep.id) ? ' updating' : ''}`),
          h.OnClick(Message.FocusedPane({ paneId: p.rep.id })),
        ], [
          ...(p.pinned ? [pinIcon(h)] : []),
          p.rep.title,
        ])),
        ...(pendingPatch?.upsert.filter((r) => !c.panes.some((p) => p.rep.id === r.id)).map((r) => h.span([h.Class('tab ghost-tab')], [r.title])) ?? []),
      ]),
      h.button([
        h.Type('button'), h.Class(`icon split-toggle${model.split ? ' on' : ''}`), h.Disabled(!canSplit),
        h.AriaPressed(String(model.split)), h.AriaLabel('Angeheftete Darstellung daneben zeigen'),
        h.Title(canSplit ? 'Angeheftete Darstellung daneben zeigen' : 'Heften Sie eine Darstellung an, um sie daneben zu zeigen'),
        h.OnClick(Message.ToggledSplit()),
      ], [splitIcon(h)]),
      h.button([h.Type('button'), h.Class(`icon log-toggle${model.showLog ? ' on' : ''}`), h.AriaLabel('Interaktionsprotokoll'), h.Title('Interaktionsprotokoll'), h.OnClick(Message.ToggledLog())], ['≡']),
    ]),
    focus
      ? (secondary ? h.div([h.Class('panes')], [paneView(focus, 'primary'), paneView(secondary, 'secondary')]) : paneView(focus, 'primary'))
      : h.div([h.Class('board-empty')], [
          ...(streaming && pendingPatch ? [h.div([h.Class('skeleton')], [h.span([], []), h.span([], []), h.span([], [])]), h.p([], ['Darstellung entsteht …'])] : [
            h.p([h.Class('board-empty-title')], ['Das Blackboard ist leer']),
            h.p([], ['Sobald das Gespräch Struktur bekommt — Alternativen, Zahlen, Befunde —, erscheint sie hier und bleibt erhalten.']),
          ]),
        ]),
    ...(model.showLog ? [h.div([h.Class('log'), h.AriaLabel('Interaktionsprotokoll')], [
      h.h3([], ['Interaktionen', h.span([h.Class('faint')], [' · typisiert, neueste zuerst'])]),
      h.ol([], [...c.interactions].reverse().slice(0, 14).map((i) => h.li([h.Class(i.explicit ? 'explicit' : '')], [
        h.code([], [i.type]),
        ' ', i.objectIds.map((id) => labelOf(c, id)?.label ?? id).join(', '),
        h.span([h.Class('faint')], [` · ${i.paneId || '—'} r${i.paneRevision} · ${time(i.at)}${i.explicit ? ' · Turn' : ''}`]),
      ]))),
      ...(model.bridgeLog.length ? [
        h.h3([], ['Artefakt-Brücke']),
        h.ol([], model.bridgeLog.slice(0, 6).map((b) => h.li([h.Class(b.accepted ? '' : 'rejected')], [b.accepted ? '✓ ' : '✕ ', b.detail, h.span([h.Class('faint')], [` · ${b.artifactId}`])]))),
      ] : []),
    ])] : []),
  ])

  return {
    title: `${c.title} · Blackboard`,
    lang: 'de',
    body: h.div([
      h.Class(`studio${model.railOpen ? '' : ' rail-closed'}${model.resizing ? ' resizing' : ''} view-${model.narrowView}`),
      h.Style({ '--board-w': `${model.boardWidth}px` }),
    ], [
      rail,
      chat,
      board,
      ...(model.saveFailed ? [h.div([h.Class('toast'), h.Role('alert')], ['Lokales Speichern ist fehlgeschlagen. Änderungen gehen beim Neuladen verloren.'])] : []),
      ...(model.notice ? [h.div([h.Class('toast'), h.Role('status')], [model.notice, h.button([h.Type('button'), h.Class('link'), h.OnClick(Message.DismissedNotice())], ['OK'])])] : []),
    ]),
  }
}

const prefersDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

// ------------------------------------------------------------ diagram

const diagram = (h: H, node: Extract<Node, { type: 'diagram' }>, paneId: string, selected: ReadonlySet<string>): Html => {
  const layers = Math.max(1, ...node.nodes.map((n) => n.layer + 1))
  const nodeW = 124, gapX = 34, nodeH = 48, gapY = 16, top = node.layers ? 30 : 10
  const W = Math.max(nodeW + 16, layers * nodeW + (layers - 1) * gapX + 16)
  const perLayer = Array.from({ length: layers }, (_, l) => node.nodes.filter((n) => n.layer === l))
  const tallest = Math.max(...perLayer.map((l) => l.length))
  const H = top + tallest * (nodeH + gapY) + 8
  const colX = (l: number) => (layers === 1 ? (W - nodeW) / 2 : 8 + (l * (W - 16 - nodeW)) / (layers - 1))
  const pos = new Map<string, { x: number; y: number }>()
  perLayer.forEach((list, l) => {
    const offset = ((tallest - list.length) * (nodeH + gapY)) / 2
    list.forEach((n, i) => pos.set(n.id, { x: colX(l), y: top + offset + i * (nodeH + gapY) }))
  })
  const hasSelection = node.nodes.some((n) => selected.has(n.id))
  const touches = (e: { from: string; to: string }) => selected.has(e.from) || selected.has(e.to)
  const edge = (e: (typeof node.edges)[number], i: number) => {
    const a = pos.get(e.from), b = pos.get(e.to)
    if (!a || !b) return h.g([], [])
    let d: string
    if (b.x > a.x) {
      const x1 = a.x + nodeW, y1 = a.y + nodeH / 2, x2 = b.x - 4, y2 = b.y + nodeH / 2, mx = (x1 + x2) / 2
      d = `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
    } else if (b.x < a.x) {
      const x1 = a.x + nodeW / 2, y1 = a.y + nodeH, x2 = b.x + nodeW / 2, y2 = b.y + nodeH + 4, low = Math.max(y1, y2) + 30
      d = `M${x1},${y1} C${x1},${low} ${x2},${low} ${x2},${y2}`
    } else {
      const x = a.x + nodeW / 2, y1 = a.y + (b.y > a.y ? nodeH : 0), y2 = b.y + (b.y > a.y ? -4 : nodeH + 4)
      d = `M${x},${y1} L${x},${y2}`
    }
    return h.path([h.Key(`e${i}`), h.D(d), h.Class(`edge${e.dashed ? ' dashed' : ''}${hasSelection ? (touches(e) ? ' lit' : ' dim') : ''}`), h.MarkerEnd('url(#arrow)')], [])
  }
  return h.figure([h.Class('n-diagram')], [h.svg([h.ViewBox(`0 0 ${W} ${H + 24}`), h.Role('group'), h.AriaLabel('Systemdiagramm')], [
    h.defs([], [h.marker([h.Id('arrow'), h.Attribute('viewBox', '0 0 8 8'), h.Attribute('refX', '7'), h.Attribute('refY', '4'), h.Attribute('markerWidth', '7'), h.Attribute('markerHeight', '7'), h.Attribute('orient', 'auto-start-reverse')], [
      h.path([h.D('M0,0 L8,4 L0,8 z'), h.Class('arrow-head')], []),
    ])]),
    ...(node.layers ?? []).map((label, l) => h.text([h.X(String(colX(l) + nodeW / 2)), h.Y('14'), h.TextAnchor('middle'), h.Class('layer-label')], [label])),
    ...node.edges.map(edge),
    ...node.nodes.map((n) => {
      const p = pos.get(n.id)!
      const on = selected.has(n.id)
      const near = hasSelection && node.edges.some((e) => (e.from === n.id && selected.has(e.to)) || (e.to === n.id && selected.has(e.from)))
      return h.g([
        h.Class(`dnode${on ? ' selected' : ''}${near ? ' near' : ''}${hasSelection && !on && !near ? ' dim' : ''}${n.tone ? ` tone-${n.tone}` : ''}`),
        h.Transform(`translate(${p.x},${p.y})`),
        h.Tabindex(0), h.Role('button'), h.AriaLabel(`${n.label}${n.detail ? `: ${n.detail}` : ''}`), h.AriaPressed(String(on)),
        h.OnClick(Message.ToggledObject({ paneId, objectId: n.id })),
        h.OnKeyDownPreventDefault((key) => (key === 'Enter' || key === ' ' ? Option.some(Message.ToggledObject({ paneId, objectId: n.id })) : Option.none())),
      ], [
        h.title([], [`${n.label}${n.detail ? ` — ${n.detail}` : ''}`]),
        h.rect([h.Width(String(nodeW)), h.Height(String(nodeH)), h.Rx('9')], []),
        h.text([h.X('12'), h.Y('19'), h.Class('dn-label')], [n.label]),
        ...(n.detail ? [h.text([h.X('12'), h.Y('35'), h.Class('dn-detail')], [n.detail.length > 19 ? n.detail.slice(0, 18) + '…' : n.detail])] : []),
      ])
    }),
  ])])
}

const pinIcon = (h: H): Html =>
  h.svg([h.Class('pin-icon'), h.ViewBox('0 0 12 12'), h.AriaHidden(true)], [
    h.path([h.D('M4 1.5h4l-.6 3.2L9.5 7H6.6v3.5L6 11l-.6-.5V7H2.5l2.1-2.3z')], []),
  ])
const splitIcon = (h: H): Html =>
  h.svg([h.Class('split-icon'), h.ViewBox('0 0 14 14'), h.AriaHidden(true)], [
    h.rect([h.X('1.5'), h.Y('2.5'), h.Width('11'), h.Height('9'), h.Rx('2')], []),
    h.path([h.D('M7 2.5v9')], []),
  ])
