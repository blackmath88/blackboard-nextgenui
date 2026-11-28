/**
 * The Blackboard component catalogue.
 *
 * A representation is a tree of typed, host-owned primitives. A model (or the
 * synthetic director) may only *describe* a representation with this
 * vocabulary; the host decides how each primitive renders and which
 * interactions it offers. Anything that does not decode is refused before it
 * reaches the workspace, so the last usable view survives.
 *
 * Every interactive object carries a stable `id`. Selection, pins, human edits
 * and provenance attach to those ids, not to positions, so they survive a
 * regenerated representation.
 */

import { Schema } from 'effect'

const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/))
const Text = Schema.String.check(Schema.isMaxLength(4000))
const Label = Schema.String.check(Schema.isMaxLength(160))

export const Tone = Schema.Literals(['neutral', 'positive', 'caution', 'critical', 'accent'])
export type Tone = typeof Tone.Type

// ---------------------------------------------------------------- leaves

export const TextNode = Schema.Struct({ type: Schema.Literal('text'), markdown: Text })

export const CalloutNode = Schema.Struct({
  type: Schema.Literal('callout'),
  tone: Tone,
  title: Schema.optional(Label),
  markdown: Text,
})

/** A single figure. `value` may be a literal or the name of a derived value. */
export const MetricNode = Schema.Struct({
  type: Schema.Literal('metric'),
  id: Id,
  label: Label,
  value: Schema.optional(Schema.Number),
  derived: Schema.optional(Id),
  unit: Schema.optional(Label),
  note: Schema.optional(Label),
  tone: Schema.optional(Tone),
})

export const Column = Schema.Struct({
  key: Id,
  label: Label,
  align: Schema.optional(Schema.Literals(['start', 'end'])),
})

export const TableNode = Schema.Struct({
  type: Schema.Literal('table'),
  id: Id,
  columns: Schema.Array(Column).check(Schema.isMaxLength(8)),
  rows: Schema.Array(Schema.Struct({
    id: Id,
    cells: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
    tone: Schema.optional(Tone),
  })).check(Schema.isMaxLength(40)),
  selectable: Schema.optional(Schema.Boolean),
})

/** Options scored against weighted criteria (0–5). */
export const MatrixNode = Schema.Struct({
  type: Schema.Literal('matrix'),
  id: Id,
  options: Schema.Array(Schema.Struct({ id: Id, label: Label, summary: Schema.optional(Label) })).check(Schema.isMaxLength(6)),
  criteria: Schema.Array(Schema.Struct({ id: Id, label: Label, weight: Schema.Number })).check(Schema.isMaxLength(8)),
  scores: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)),
})

export const BarsNode = Schema.Struct({
  type: Schema.Literal('bars'),
  id: Id,
  title: Schema.optional(Label),
  unit: Schema.optional(Label),
  /** A bar's value may be bound to an assumption so it moves with an edit. */
  items: Schema.Array(Schema.Struct({
    id: Id,
    label: Label,
    value: Schema.optional(Schema.Number),
    assumption: Schema.optional(Id),
    tone: Schema.optional(Tone),
  })).check(Schema.isMaxLength(16)),
})

export const DiagramNode = Schema.Struct({
  type: Schema.Literal('diagram'),
  id: Id,
  /** Nodes are laid out in columns by `layer`, top to bottom by order. */
  nodes: Schema.Array(Schema.Struct({
    id: Id,
    label: Label,
    layer: Schema.Number,
    detail: Schema.optional(Label),
    tone: Schema.optional(Tone),
  })).check(Schema.isMaxLength(24)),
  edges: Schema.Array(Schema.Struct({ from: Id, to: Id, label: Schema.optional(Label), dashed: Schema.optional(Schema.Boolean) })).check(Schema.isMaxLength(48)),
  layers: Schema.optional(Schema.Array(Label)),
})

export const TimelineNode = Schema.Struct({
  type: Schema.Literal('timeline'),
  id: Id,
  /** Week numbers from the start of the plan. */
  span: Schema.Number,
  items: Schema.Array(Schema.Struct({
    id: Id,
    label: Label,
    start: Schema.Number,
    length: Schema.Number,
    lane: Schema.optional(Label),
    tone: Schema.optional(Tone),
    milestone: Schema.optional(Schema.Boolean),
  })).check(Schema.isMaxLength(20)),
})

export const BoardNode = Schema.Struct({
  type: Schema.Literal('board'),
  id: Id,
  lanes: Schema.Array(Schema.Struct({ id: Id, label: Label })).check(Schema.isMaxLength(5)),
  cards: Schema.Array(Schema.Struct({
    id: Id,
    title: Label,
    lane: Id,
    detail: Schema.optional(Label),
    owner: Schema.optional(Label),
  })).check(Schema.isMaxLength(30)),
})

/** Records the user can select, compare and ask about. */
export const RecordsNode = Schema.Struct({
  type: Schema.Literal('records'),
  id: Id,
  variant: Schema.Literals(['finding', 'decision', 'question', 'risk', 'option']),
  items: Schema.Array(Schema.Struct({
    id: Id,
    title: Label,
    detail: Schema.optional(Text),
    meta: Schema.optional(Label),
    strength: Schema.optional(Schema.Number),
    sources: Schema.optional(Schema.Array(Id)),
    tone: Schema.optional(Tone),
  })).check(Schema.isMaxLength(20)),
})

export const SourcesNode = Schema.Struct({
  type: Schema.Literal('sources'),
  id: Id,
  items: Schema.Array(Schema.Struct({
    id: Id,
    title: Label,
    origin: Label,
    year: Schema.optional(Schema.Number),
    kind: Schema.optional(Label),
    excerpt: Schema.optional(Text),
  })).check(Schema.isMaxLength(20)),
})

/** Human-owned numbers. Their edited values are kept by the host, not the spec. */
export const AssumptionsNode = Schema.Struct({
  type: Schema.Literal('assumptions'),
  id: Id,
  items: Schema.Array(Schema.Struct({
    id: Id,
    label: Label,
    value: Schema.Number,
    min: Schema.Number,
    max: Schema.Number,
    step: Schema.Number,
    unit: Schema.optional(Label),
  })).check(Schema.isMaxLength(12)),
})

/** A button that turns into an explicit conversational action. */
export const ActionNode = Schema.Struct({
  type: Schema.Literal('action'),
  id: Id,
  label: Label,
  prompt: Label,
})

export const ArtifactNode = Schema.Struct({
  type: Schema.Literal('artifact'),
  id: Id,
  title: Label,
  /** Bespoke HTML. Rendered only inside an opaque-origin sandbox. */
  html: Schema.String.check(Schema.isMaxLength(60_000)),
  /** The only event names the host will accept from this artifact. */
  allowedEvents: Schema.Array(Id).check(Schema.isMaxLength(8)),
  height: Schema.optional(Schema.Number),
})

// ---------------------------------------------------------------- containers

export interface Section {
  readonly type: 'section'
  readonly title?: string | undefined
  readonly note?: string | undefined
  readonly children: ReadonlyArray<Node>
}
export interface Grid {
  readonly type: 'grid'
  readonly columns: number
  readonly children: ReadonlyArray<Node>
}

export type Leaf =
  | typeof TextNode.Type | typeof CalloutNode.Type | typeof MetricNode.Type | typeof TableNode.Type
  | typeof MatrixNode.Type | typeof BarsNode.Type | typeof DiagramNode.Type | typeof TimelineNode.Type
  | typeof BoardNode.Type | typeof RecordsNode.Type | typeof SourcesNode.Type | typeof AssumptionsNode.Type
  | typeof ActionNode.Type | typeof ArtifactNode.Type
export type Node = Leaf | Section | Grid

const Leaves = [
  TextNode, CalloutNode, MetricNode, TableNode, MatrixNode, BarsNode, DiagramNode, TimelineNode,
  BoardNode, RecordsNode, SourcesNode, AssumptionsNode, ActionNode, ArtifactNode,
] as const

export const Node: Schema.Codec<Node> = Schema.Union([
  ...Leaves,
  Schema.Struct({
    type: Schema.Literal('section'),
    title: Schema.optional(Label),
    note: Schema.optional(Label),
    children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)).check(Schema.isMaxLength(16)),
  }),
  Schema.Struct({
    type: Schema.Literal('grid'),
    columns: Schema.Number,
    children: Schema.Array(Schema.suspend((): Schema.Codec<Node> => Node)).check(Schema.isMaxLength(12)),
  }),
])

/** Calculated values the host evaluates from assumptions. No code, only a tiny closed algebra. */
export type Expr =
  | { readonly ref: string }
  | { readonly num: number }
  | { readonly op: 'add' | 'sub' | 'mul' | 'div' | 'min' | 'max'; readonly args: ReadonlyArray<Expr> }
export const Expr: Schema.Codec<Expr> = Schema.Union([
  Schema.Struct({ ref: Id }),
  Schema.Struct({ num: Schema.Number }),
  Schema.Struct({
    op: Schema.Literals(['add', 'sub', 'mul', 'div', 'min', 'max']),
    args: Schema.Array(Schema.suspend((): Schema.Codec<Expr> => Expr)).check(Schema.isMaxLength(12)),
  }),
])

export const Representation = Schema.Struct({
  /** Stable semantic identity. A later turn with the same id evolves this pane. */
  id: Id,
  title: Label,
  /** One short line describing what this view is for. */
  purpose: Schema.optional(Label),
  root: Node,
  derived: Schema.optional(Schema.Record(Schema.String, Expr)),
})
export type Representation = typeof Representation.Type

/** What a single assistant turn proposes for the workspace. */
export const WorkspacePatch = Schema.Struct({
  upsert: Schema.Array(Representation).check(Schema.isMaxLength(4)),
  focus: Schema.optional(Id),
})
export type WorkspacePatch = typeof WorkspacePatch.Type

export const decodeRepresentation = Schema.decodeUnknownResult(Representation)
export const decodePatch = Schema.decodeUnknownResult(WorkspacePatch)

/** Evaluate a derived value. Unknown references and division by zero yield NaN, never throw. */
export const evaluate = (expr: Expr, values: Readonly<Record<string, number>>, derived: Readonly<Record<string, Expr>> = {}, depth = 0): number => {
  if (depth > 16) return Number.NaN
  if ('num' in expr) return expr.num
  if ('ref' in expr) {
    if (expr.ref in values) return values[expr.ref] ?? Number.NaN
    const next = derived[expr.ref]
    return next === undefined ? Number.NaN : evaluate(next, values, derived, depth + 1)
  }
  const args = expr.args.map((arg) => evaluate(arg, values, derived, depth + 1))
  switch (expr.op) {
    case 'add': return args.reduce((a, b) => a + b, 0)
    case 'mul': return args.reduce((a, b) => a * b, 1)
    case 'sub': return args.length === 0 ? Number.NaN : args.slice(1).reduce((a, b) => a - b, args[0]!)
    case 'div': return args.length !== 2 || args[1] === 0 ? Number.NaN : args[0]! / args[1]!
    case 'min': return args.length ? Math.min(...args) : Number.NaN
    case 'max': return args.length ? Math.max(...args) : Number.NaN
  }
}

/** Every id that a representation exposes for selection. */
export const objectIndex = (node: Node, into: Map<string, { kind: string; label: string }> = new Map()) => {
  switch (node.type) {
    case 'section': case 'grid': node.children.forEach((child) => objectIndex(child, into)); break
    case 'metric': into.set(node.id, { kind: 'Kennzahl', label: node.label }); break
    case 'table': node.rows.forEach((row) => into.set(row.id, { kind: 'Zeile', label: String(Object.values(row.cells)[0] ?? row.id) })); break
    case 'matrix': into.set(node.id, { kind: 'Matrix', label: 'Bewertungsmatrix' }); node.options.forEach((o) => into.set(o.id, { kind: 'Option', label: o.label })); break
    case 'bars': if (node.title) into.set(node.id, { kind: 'Diagramm', label: node.title }); node.items.forEach((i) => into.set(i.id, { kind: 'Datenpunkt', label: i.label })); break
    case 'diagram': into.set(node.id, { kind: 'Diagramm', label: 'Systemlandkarte' }); node.nodes.forEach((n) => into.set(n.id, { kind: 'Komponente', label: n.label })); break
    case 'timeline': node.items.forEach((i) => into.set(i.id, { kind: 'Phase', label: i.label })); break
    case 'board': node.cards.forEach((c) => into.set(c.id, { kind: 'Aufgabe', label: c.title })); break
    case 'records': {
      const kind = { finding: 'Befund', decision: 'Entscheidung', question: 'Offene Frage', risk: 'Risiko', option: 'Option' }[node.variant]
      node.items.forEach((i) => into.set(i.id, { kind, label: i.title }))
      break
    }
    case 'sources': node.items.forEach((s) => into.set(s.id, { kind: 'Quelle', label: s.title })); break
    case 'assumptions': into.set(node.id, { kind: 'Annahmen', label: 'Annahmen' }); node.items.forEach((a) => into.set(a.id, { kind: 'Annahme', label: a.label })); break
    case 'artifact': into.set(node.id, { kind: 'Artefakt', label: node.title }); break
    default: break
  }
  return into
}
