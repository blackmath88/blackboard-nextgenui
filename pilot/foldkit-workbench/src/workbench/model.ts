/**
 * The workbench Model: accepted project records, the applied and previewed
 * frames, the user's arrangement, saved view definitions, selection, pins,
 * sharing, turn history and notices. It is the single source of truth and the
 * only thing that is persisted.
 *
 * The Model never holds a record's label, status word or excerpt; those are
 * resolved from `project` at view time.
 */

import { Schema } from 'effect'

import { Project } from '../project/records.js'
import {
  FrameProposal,
  Probe,
  QuestionId,
  type QuestionId as Question,
  ProposalRejection,
} from '../generation/proposal.js'
import { TurnRequest } from '../generation/turn.js'

export type { Question }
export type Proposal = typeof FrameProposal.Type

// ---------------------------------------------------------------------------
// Selection, arrangement, saved views
// ---------------------------------------------------------------------------

/** What the user is looking at. Survives preview, apply, rearrange and reload. */
export const Selection = Schema.Struct({
  recordId: Schema.optional(Schema.String),
  /** A source link, held separately so it survives a change of view. */
  sourceId: Schema.optional(Schema.String),
})
export type Selection = typeof Selection.Type

/** The user's arrangement of the applied frame. Pure presentation state. */
export const RecordOrder = Schema.Struct({
  paneId: Schema.String,
  recordIds: Schema.Array(Schema.String),
})
export type RecordOrder = typeof RecordOrder.Type

export const Arrangement = Schema.Struct({
  /** Pane IDs in display order; the first pane is the primary work surface. */
  paneOrder: Schema.Array(Schema.String),
  /** Group IDs in display order within a pane. */
  groupOrder: Schema.Array(
    Schema.Struct({ paneId: Schema.String, groupIds: Schema.Array(Schema.String) }),
  ),
  /** Record order inside a pane. Absent pane means "keep the proposal's order". */
  recordOrder: Schema.Array(RecordOrder),
  focusPaneId: Schema.String,
})
export type Arrangement = typeof Arrangement.Type

/** An applied frame plus the user's arrangement, saved under a name. */
export const SavedView = Schema.Struct({
  name: Schema.String,
  questionId: QuestionId,
  proposalId: Schema.String,
  /** The frame definition this view resolves against. */
  proposal: FrameProposal,
  arrangement: Arrangement,
  selection: Selection,
  savedAt: Schema.String,
})
export type SavedView = typeof SavedView.Type

// ---------------------------------------------------------------------------
// Preview and turns
// ---------------------------------------------------------------------------

export const RefusedProposal = Schema.Struct({
  label: Schema.String,
  rejection: ProposalRejection,
})
export type RefusedProposal = typeof RefusedProposal.Type

/** The proposals the provider just returned, already reviewed by the host. */
export const Preview = Schema.Struct({
  questionId: QuestionId,
  accepted: Schema.Array(FrameProposal),
  refused: Schema.Array(RefusedProposal),
  /** Which accepted proposal the preview surface is showing. */
  selectedIndex: Schema.Number,
  at: Schema.String,
})
export type Preview = typeof Preview.Type

export const Turn = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  questionId: QuestionId,
  /** The exact request the host composed, kept so it can be read back. */
  request: TurnRequest,
  reply: Schema.String,
  /** Records the reply names, so each one links back to its own record. */
  recordIds: Schema.Array(Schema.String),
  boardIncluded: Schema.Boolean,
  source: Schema.Literals(['fixture', 'runtime']),
})
export type Turn = typeof Turn.Type

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

export const Notice = Schema.Struct({
  at: Schema.String,
  tone: Schema.Literals(['info', 'warning', 'error']),
  text: Schema.String,
})
export type Notice = typeof Notice.Type

export const ProviderMode = Schema.Literals(['fixture', 'runtime'])
export type ProviderMode = typeof ProviderMode.Type

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export const Model = Schema.Struct({
  /** Accepted project records: the only place record content lives. */
  project: Project,

  question: QuestionId,
  /** The frame being rendered. Absent means the plain board view. */
  applied: Schema.optional(FrameProposal),
  arrangement: Schema.optional(Arrangement),
  /** Undo stack for arrangement changes; applying a frame is not undone this way. */
  arrangementHistory: Schema.Array(Arrangement),

  savedViews: Schema.Array(SavedView),
  /** Draft text of the name input, so the view stays a pure function. */
  viewNameDraft: Schema.String,
  preview: Schema.optional(Preview),

  selection: Selection,
  pins: Schema.Array(Schema.String),
  sharing: Schema.Boolean,
  turns: Schema.Array(Turn),
  notices: Schema.Array(Notice),

  providerMode: ProviderMode,
  /** Whether a runtime route was supplied at boot. Never carries a credential. */
  runtimeRouteConfigured: Schema.Boolean,
  probe: Probe,

  requesting: Schema.Boolean,
  /** Set when a persist Command failed; the Model keeps rendering. */
  persistenceFailed: Schema.Boolean,
})
export type Model = typeof Model.Type

export const defaultArrangement = (proposal: Proposal): Arrangement => ({
  paneOrder: proposal.panes.map((pane) => pane.id),
  groupOrder: proposal.panes.map((pane) => ({
    paneId: pane.id,
    groupIds: pane.groups.map((group) => group.id),
  })),
  recordOrder: [],
  focusPaneId: proposal.panes[0]?.id ?? '',
})

export const initialModel = (project: Project): Model => ({
  project,
  question: 'q_blocking_groups',
  arrangementHistory: [],
  savedViews: [],
  viewNameDraft: '',
  selection: {},
  pins: [],
  sharing: true,
  turns: [],
  notices: [],
  providerMode: 'fixture',
  runtimeRouteConfigured: false,
  probe: 'none',
  requesting: false,
  persistenceFailed: false,
})
