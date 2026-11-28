/**
 * Studio state: conversations, their workspace panes and everything the human
 * owns about them (selection, pins, edited assumptions, moved cards, layout).
 *
 * The Model is the only thing persisted. Representations are kept exactly as
 * the (validated) turn proposed them; human edits live beside them keyed by
 * stable object ids, so a regenerated representation never erases them.
 */

import { Schema } from 'effect'
import { Representation } from './spec.js'

export const ContextRef = Schema.Struct({
  paneId: Schema.String,
  objectId: Schema.String,
  kind: Schema.String,
  label: Schema.String,
})
export type ContextRef = typeof ContextRef.Type

export const InteractionType = Schema.Literals([
  'select', 'ask-why', 'compare', 'investigate', 'inspect-source', 'edit-assumption', 'move-card',
  'pin', 'unpin', 'artifact-event', 'reset-assumption', 'close-pane',
])
export type InteractionType = typeof InteractionType.Type

/** A typed record of something the human did in the workspace. */
export const Interaction = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  type: InteractionType,
  paneId: Schema.String,
  paneRevision: Schema.Number,
  objectIds: Schema.Array(Schema.String),
  payload: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean])),
  /** Whether this interaction asked the assistant for a turn. Selection never does. */
  explicit: Schema.Boolean,
})
export type Interaction = typeof Interaction.Type

export const ChatEntry = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(['user', 'assistant']),
  markdown: Schema.String,
  at: Schema.String,
  context: Schema.Array(ContextRef),
  /** The bounded context packet the host composed for this turn (user turns). */
  packet: Schema.optional(Schema.String),
  /** Pane ids this assistant turn created or evolved. */
  touched: Schema.Array(Schema.String),
  /** The workspace patch failed validation; the previous view was kept. */
  refused: Schema.optional(Schema.String),
})
export type ChatEntry = typeof ChatEntry.Type

export const Pane = Schema.Struct({
  rep: Representation,
  revision: Schema.Number,
  /** The assistant turn that last produced this pane. */
  turnId: Schema.String,
  pinned: Schema.Boolean,
  /** Pane revisions this one replaced, newest first (bounded). */
  history: Schema.Array(Representation),
})
export type Pane = typeof Pane.Type

export const HumanValue = Schema.Struct({
  value: Schema.Number,
  at: Schema.String,
  /** The value the representation proposed before the human edit. */
  proposed: Schema.Number,
})

export const Scenario = Schema.Literals(['architecture', 'budget', 'research', 'open'])
export type Scenario = typeof Scenario.Type

export const Conversation = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  project: Schema.String,
  scenario: Scenario,
  updatedAt: Schema.String,
  messages: Schema.Array(ChatEntry),
  panes: Schema.Array(Pane),
  focusPaneId: Schema.NullOr(Schema.String),
  selection: Schema.Array(ContextRef),
  assumptions: Schema.Record(Schema.String, HumanValue),
  cards: Schema.Record(Schema.String, Schema.String),
  interactions: Schema.Array(Interaction),
  draft: Schema.String,
  /** Artifact events received but not yet discussed. */
  pendingArtifact: Schema.NullOr(Interaction),
})
export type Conversation = typeof Conversation.Type

export const Streaming = Schema.Struct({
  conversationId: Schema.String,
  entry: ChatEntry,
  shown: Schema.Number,
  patch: Schema.NullOr(Schema.Unknown),
  scenario: Scenario,
  title: Schema.optional(Schema.String),
})
export type Streaming = typeof Streaming.Type

export const BridgeEntry = Schema.Struct({
  at: Schema.String,
  artifactId: Schema.String,
  accepted: Schema.Boolean,
  detail: Schema.String,
})
export type BridgeEntry = typeof BridgeEntry.Type

export const Model = Schema.Struct({
  conversations: Schema.Array(Conversation),
  activeId: Schema.String,
  boardWidth: Schema.Number,
  railOpen: Schema.Boolean,
  narrowView: Schema.Literals(['chat', 'board']),
  inspectPacket: Schema.NullOr(Schema.String),
  streaming: Schema.NullOr(Streaming),
  sequence: Schema.Number,
  notice: Schema.NullOr(Schema.String),
  saveFailed: Schema.Boolean,
  resizing: Schema.Boolean,
  dragCard: Schema.NullOr(Schema.String),
  showLog: Schema.Boolean,
  /** Artifact bridge decisions, newest first. Not persisted. */
  bridgeLog: Schema.Array(BridgeEntry),
})
export type Model = typeof Model.Type

export const Persisted = Schema.Struct({
  version: Schema.Literal(1),
  conversations: Schema.Array(Conversation),
  activeId: Schema.String,
  boardWidth: Schema.Number,
})

export const StudioStorageKey = 'blackboard.studio.v1'

export const emptyConversation = (id: string, at: string, title = 'Neues Gespräch'): Conversation => ({
  id,
  title,
  project: 'Blackboard Labor',
  scenario: 'open',
  updatedAt: at,
  messages: [],
  panes: [],
  focusPaneId: null,
  selection: [],
  assumptions: {},
  cards: {},
  interactions: [],
  draft: '',
  pendingArtifact: null,
})

export const initialModel = (at: string): Model => ({
  conversations: [emptyConversation('c-1', at)],
  activeId: 'c-1',
  boardWidth: 560,
  railOpen: true,
  narrowView: 'chat',
  inspectPacket: null,
  streaming: null,
  sequence: 1,
  notice: null,
  saveFailed: false,
  resizing: false,
  dragCard: null,
  showLog: false,
  bridgeLog: [],
})

export const active = (model: Model): Conversation =>
  model.conversations.find((c) => c.id === model.activeId) ?? model.conversations[0]!

/** Current value of an assumption: the human edit wins over the proposal. */
export const assumptionValues = (conversation: Conversation): Record<string, number> => {
  const values: Record<string, number> = {}
  const visit = (node: typeof Representation.Type.root): void => {
    if (node.type === 'section' || node.type === 'grid') node.children.forEach(visit)
    else if (node.type === 'assumptions') node.items.forEach((item) => { values[item.id] = item.value })
  }
  conversation.panes.forEach((pane) => visit(pane.rep.root))
  for (const [id, edit] of Object.entries(conversation.assumptions)) values[id] = edit.value
  return values
}
