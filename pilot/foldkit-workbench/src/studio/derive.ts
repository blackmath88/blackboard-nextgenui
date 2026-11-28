/**
 * Representations the host derives itself — no model call involved.
 *
 * - `promoteBlock` lifts a table or list out of a chat reply into a native,
 *   persistent Blackboard pane (with a chart when a column is numeric). This is
 *   the "emancipate in-chat visuals" move: the reply stays in the transcript,
 *   the structure becomes a workspace object with stable ids.
 * - `overviewOf` is the standing Überblick: decisions, human edits, pins and
 *   open questions, recomputed from session state on every render.
 */

import { labelOf } from './context.js'
import { blocks } from './markdown.js'
import type { ChatEntry, Conversation } from './model.js'
import type { Node, Representation } from './spec.js'

const plain = (text: string) => text.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*|`|\*/g, '').trim()

/** Parse "210 000 CHF", "43,8 %", "1'280" → number. */
export const numeric = (text: string): number | undefined => {
  const cleaned = text.replace(/[’'   ]/g, '').replace(/CHF|EUR|%|Wochen|W$/gi, '').replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined
  return Number(cleaned)
}

export const promotable = (entry: ChatEntry): number[] =>
  blocks(entry.markdown).flatMap((b, i) => (b.kind === 'table' || (b.kind === 'list' && b.items.length >= 3) ? [i] : []))

export const promoteBlock = (entry: ChatEntry, index: number, at: string): Representation | undefined => {
  const all = blocks(entry.markdown)
  const block = all[index]
  if (!block) return undefined
  const base = `chat.${entry.id}.b${index}`
  void at
  const heading = all.slice(0, index).reverse().find((b) => b.kind === 'heading')
  if (block.kind === 'table') {
    const columns = block.head.map((label, i) => ({ key: `c${i}`, label: plain(label) || `Spalte ${i + 1}`, ...(block.align[i] === 'end' ? { align: 'end' as const } : {}) }))
    const rows = block.rows.slice(0, 40).map((row, r) => ({
      id: `${base}.r${r}`,
      cells: Object.fromEntries(columns.map((c, i) => [c.key, plain(row[i] ?? '')])),
    }))
    const numericColumn = columns.findIndex((_, i) => i > 0 && rows.length > 1 && rows.every((row) => numeric(String(row.cells[`c${i}`] ?? '')) !== undefined))
    const children: Node[] = [{ type: 'table', id: `${base}.t`, columns: columns.slice(0, 8), rows, selectable: true }]
    if (numericColumn > 0) {
      const unitSample = block.rows[0]?.[numericColumn] ?? ''
      const unit = /CHF/.test(unitSample) ? 'CHF' : /%/.test(unitSample) ? '%' : undefined
      children.unshift({
        type: 'bars', id: `${base}.chart`, title: columns[numericColumn]!.label, ...(unit ? { unit } : {}),
        items: rows.slice(0, 16).map((row, r) => ({ id: `${row.id}.v`, label: String(row.cells['c0'] ?? `Zeile ${r + 1}`), value: numeric(String(row.cells[`c${numericColumn}`])) ?? 0 })),
      })
    }
    return {
      id: base,
      title: heading && heading.kind === 'heading' ? plain(heading.text).slice(0, 60) : `${columns.slice(0, 2).map((c) => c.label).join(' & ')} (aus dem Chat)`,
      purpose: 'Aus dem Gespräch übernommen — bleibt hier, auch wenn der Chat weiterläuft',
      root: { type: 'section', children },
    }
  }
  if (block.kind === 'list') {
    return {
      id: base,
      title: heading && heading.kind === 'heading' ? plain(heading.text).slice(0, 60) : `${plain(block.items[0] ?? 'Punkte').split(/\s+—\s+|:\s+/)[0]!.slice(0, 32)} … (aus dem Chat)`,
      purpose: 'Aus dem Gespräch übernommen — einzeln auswählbar',
      root: {
        type: 'records', id: `${base}.list`, variant: 'finding',
        items: block.items.slice(0, 20).map((item, i) => {
          const text = plain(item)
          const [title, ...rest] = text.split(/\s+—\s+|:\s+/)
          return { id: `${base}.i${i}`, title: (title ?? text).slice(0, 160), ...(rest.length ? { detail: rest.join(' — ').slice(0, 600) } : {}) }
        }),
      },
    }
  }
  return undefined
}

const collect = (node: Node): Node[] => (node.type === 'section' || node.type === 'grid' ? [node, ...node.children.flatMap(collect)] : [node])

export const OverviewId = 'overview'

export const overviewOf = (c: Conversation): Representation | undefined => {
  if (c.panes.length === 0) return undefined
  const nodes = c.panes.flatMap((p) => collect(p.rep.root))
  const decisions = nodes.flatMap((n) => (n.type === 'records' && n.variant === 'decision' ? n.items : []))
  const questions = nodes.flatMap((n) => (n.type === 'records' && n.variant === 'question' ? n.items : []))
  const edits = Object.entries(c.assumptions)
  const moves = Object.entries(c.cards)
  const explicit = c.interactions.filter((i) => i.explicit).length
  const children: Node[] = [
    {
      type: 'grid', columns: 4, children: [
        { type: 'metric', id: 'ov.turns', label: 'Antworten', value: c.messages.filter((m) => m.role === 'assistant').length },
        { type: 'metric', id: 'ov.panes', label: 'Darstellungen', value: c.panes.length, note: `${c.panes.filter((p) => p.pinned).length} angeheftet` },
        { type: 'metric', id: 'ov.edits', label: 'Ihre Änderungen', value: edits.length + moves.length, ...(edits.length + moves.length ? { tone: 'accent' as const } : {}) },
        { type: 'metric', id: 'ov.actions', label: 'Aus der Fläche gefragt', value: explicit },
      ],
    },
  ]
  if (edits.length || moves.length) {
    children.push({
      type: 'table', id: 'ov.human',
      columns: [{ key: 'what', label: 'Ihre Änderung' }, { key: 'from', label: 'Vorschlag', align: 'end' }, { key: 'to', label: 'Jetzt', align: 'end' }],
      rows: [
        ...edits.map(([id, e]) => ({ id: `ov.e.${id}`, cells: { what: labelOf(c, id)?.label ?? id, from: e.proposed.toLocaleString('de-CH'), to: e.value.toLocaleString('de-CH') }, tone: 'accent' as const })),
        ...moves.map(([id, lane]) => ({ id: `ov.m.${id}`, cells: { what: labelOf(c, id)?.label ?? id, from: 'verschoben', to: ({ open: 'Offen', doing: 'In Arbeit', done: 'Erledigt' } as Record<string, string>)[lane] ?? lane }, tone: 'accent' as const })),
      ],
    })
  }
  if (decisions.length) children.push({ type: 'section', title: 'Entscheidungen', children: [{ type: 'records', id: 'ov.decisions', variant: 'decision', items: decisions.map((d) => ({ ...d })) }] })
  if (questions.length) children.push({ type: 'section', title: 'Offene Fragen', children: [{ type: 'records', id: 'ov.questions', variant: 'question', items: questions.map((q) => ({ ...q })) }] })
  const pinned = c.panes.filter((p) => p.pinned)
  if (pinned.length) children.push({ type: 'callout', tone: 'neutral', title: 'Angeheftet', markdown: pinned.map((p) => `**${p.rep.title}** · Rev. ${p.revision}`).join(' · ') })
  if (!decisions.length && !questions.length && !edits.length && !moves.length) {
    children.push({ type: 'callout', tone: 'neutral', markdown: 'Noch keine Entscheidungen, offenen Fragen oder eigenen Änderungen. Sobald welche entstehen, sammeln sie sich hier.' })
  }
  return { id: OverviewId, title: 'Überblick', purpose: 'Was wir entschieden, geändert und offen gelassen haben — vom Host abgeleitet, ohne Modellaufruf', root: { type: 'section', children } }
}
