/**
 * Local persistence of the fixture state.
 *
 * One key, one JSON document, versioned. It holds the accepted records, the
 * applied frame, the arrangement, the saved views, selection, pins, sharing and
 * the turn history — everything needed to reopen the workbench and resolve the
 * saved arrangement against records that may have moved on since it was saved.
 *
 * A broken or foreign document is ignored rather than trusted: the workbench
 * then starts from the fixture and says so.
 */

import { Option, Schema } from 'effect'

import { Arrangement, Model, Notice, type Proposal, SavedView, Selection, Turn, initialModel } from './model.js'
import { FrameProposal, QuestionId } from '../generation/proposal.js'
import { Project } from '../project/records.js'

export const StorageKey = 'blackboard.foldkit-workbench.v1'
export const PersistedVersion = 1

import { ChatMessage, ChatWorkspace, WorkspaceTask } from './chat.js'

export const PersistedState = Schema.Struct({
  version: Schema.Literal(PersistedVersion),
  project: Project,
  question: QuestionId,
  applied: Schema.optional(FrameProposal),
  arrangement: Schema.optional(Arrangement),
  arrangementHistory: Schema.Array(Arrangement),
  savedViews: Schema.Array(SavedView),
  chatHistory: Schema.optional(Schema.Array(Schema.String)),
  conversation: Schema.optional(Schema.Array(ChatMessage)),
  conversationWorkspace: Schema.optional(Schema.NullOr(ChatWorkspace)),
  proposedWorkspace: Schema.optional(Schema.NullOr(ChatWorkspace)),
  previousWorkspace: Schema.optional(Schema.NullOr(ChatWorkspace)),
  workspaceTasks: Schema.optional(Schema.Array(WorkspaceTask)),
  checkedChatItems: Schema.optional(Schema.Array(Schema.String)),
  selection: Selection,
  pins: Schema.Array(Schema.String),
  sharing: Schema.Boolean,
  turns: Schema.Array(Turn),
  notices: Schema.Array(Notice),
})
export type PersistedState = typeof PersistedState.Type

export const PersistedJson = Schema.fromJsonString(Schema.toCodecJson(PersistedState))

/** Everything the experiment keeps. Presentation-only flags stay out. */
export const persistedOf = (model: Model): PersistedState => ({
  version: PersistedVersion,
  project: model.project,
  question: model.question,
  ...(model.applied === undefined ? {} : { applied: model.applied }),
  ...(model.arrangement === undefined ? {} : { arrangement: model.arrangement }),
  arrangementHistory: model.arrangementHistory,
  savedViews: model.savedViews,
  chatHistory: model.chatHistory,
  conversation: model.conversation,
  conversationWorkspace: model.conversationWorkspace,
  proposedWorkspace: model.proposedWorkspace,
  ...(model.previousWorkspace === undefined ? {} : { previousWorkspace: model.previousWorkspace }),
  workspaceTasks: model.workspaceTasks,
  checkedChatItems: model.checkedChatItems,
  selection: model.selection,
  pins: model.pins,
  sharing: model.sharing,
  turns: model.turns,
  notices: model.notices,
})

export const encodePersisted = (model: Model): string =>
  Schema.encodeSync(PersistedJson)(persistedOf(model))

export type RestoreResult = Readonly<
  | { _tag: 'Restored'; state: PersistedState }
  | { _tag: 'Empty' }
  | { _tag: 'Ignored'; reason: string }
>

export const decodePersisted = (raw: string): RestoreResult => {
  const decoded = Schema.decodeUnknownResult(PersistedJson)(raw)
  if (decoded._tag === 'Failure') {
    return {
      _tag: 'Ignored',
      reason: `Stored state did not match the stored shape, so it was ignored: ${decoded.failure.message}`,
    }
  }
  return { _tag: 'Restored', state: decoded.success }
}

export const restoreFrom = (raw: Option.Option<string>): RestoreResult =>
  Option.match(raw, {
    onNone: () => ({ _tag: 'Empty' }),
    onSome: decodePersisted,
  })

/**
 * Rebuild the live Model from a stored document. Presentation-only flags are
 * never restored: the provider stays the fixture, no request is in flight, and
 * a runtime route can only come from boot.
 */
export const modelOf = (
  state: PersistedState,
  extras: Readonly<{ runtimeRouteConfigured: boolean }>,
): Model => ({
  ...initialModel(state.project),
  question: state.question,
  ...(state.applied === undefined ? {} : { applied: state.applied }),
  ...(state.arrangement === undefined ? {} : { arrangement: state.arrangement }),
  arrangementHistory: state.arrangementHistory,
  savedViews: state.savedViews,
  chatHistory: state.chatHistory ?? [],
  conversation: state.conversation ?? [],
  conversationWorkspace: state.conversationWorkspace ?? null,
  proposedWorkspace: state.proposedWorkspace ?? null,
  ...(state.previousWorkspace === undefined ? {} : { previousWorkspace: state.previousWorkspace }),
  workspaceTasks: state.workspaceTasks ?? [],
  checkedChatItems: state.checkedChatItems ?? [],
  selection: state.selection,
  pins: state.pins,
  sharing: state.sharing,
  turns: state.turns,
  notices: state.notices,
  runtimeRouteConfigured: extras.runtimeRouteConfigured,
})

/**
 * Records referenced by a saved arrangement that the current project no longer
 * has. The renderer shows these as unresolved instead of hiding them.
 */
export const unresolvedReferences = (args: Readonly<{
  project: Project
  applied: Proposal | undefined
}>): ReadonlyArray<string> => {
  if (args.applied === undefined) return []
  const ids = args.applied.panes.flatMap((pane) => [
    ...pane.groups.flatMap((group) => [group.id, ...group.recordIds]),
    ...(pane.focusRecordId === undefined ? [] : [pane.focusRecordId]),
  ])
  const known = new Set<string>([
    ...args.project.tasks.map((task) => task.id),
    ...args.project.decisions.map((decision) => decision.id),
    ...args.project.sources.map((source) => source.id),
    ...args.project.parties.map((party) => party.id),
    ...args.project.dependencies.map((dependency) => dependency.id),
    'unassigned',
  ])
  return [...new Set(ids)].filter((id) => !known.has(id))
}
