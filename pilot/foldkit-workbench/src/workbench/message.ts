/**
 * The Message union.
 *
 * Every user intent and every asynchronous result is a named, schema-defined
 * message. Nothing here can mutate the Model; messages only describe what
 * happened.
 */

import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { Probe, QuestionId } from '../generation/proposal.js'
import { ProviderMode, Turn } from './model.js'

export const Direction = Schema.Literals(['up', 'down', 'front', 'back'])
export type Direction = typeof Direction.Type

export const Message = defineMessageUnion({
  // ---- asking a question
  ClickedAsk: { question: QuestionId },
  ChangedChatDraft: { value: Schema.String },
  SubmittedChat: {},
  /** Untrusted provider output, exactly as it arrived. */
  ReceivedProposals: {
    question: QuestionId,
    raw: Schema.Array(Schema.Unknown),
    at: Schema.String,
  },
  FailedRequest: { question: QuestionId, message: Schema.String, at: Schema.String },

  // ---- preview and apply
  ClickedInspectProposal: { index: Schema.Number },
  ClickedApplyProposal: {},
  ClickedDismissPreview: {},

  // ---- arrangements the user owns
  ChangedViewName: { value: Schema.String },
  ClickedSaveView: {},
  ClickedOpenSavedView: { name: Schema.String },
  ClickedDropSavedView: { name: Schema.String },

  // ---- arranging
  ClickedMovePane: { paneId: Schema.String, direction: Direction },
  ClickedMoveGroup: { paneId: Schema.String, groupId: Schema.String, direction: Direction },
  ClickedMoveRecord: {
    paneId: Schema.String,
    groupId: Schema.String,
    recordId: Schema.String,
    direction: Direction,
  },
  ClickedFocusPane: { paneId: Schema.String },
  ClickedUndoArrangement: {},

  // ---- working with records
  ClickedSelectRecord: { recordId: Schema.String },
  ClickedOpenSource: { recordId: Schema.String, sourceId: Schema.String },
  ClickedTogglePin: { recordId: Schema.String },
  /** An ordinary host action: the status changes on the record, not in a view. */
  ClickedMarkTaskDone: { taskId: Schema.String },

  // ---- the next model turn
  ClickedRunTurn: {},
  ReceivedTurn: { turn: Turn },
  FailedTurn: { turnId: Schema.String, message: Schema.String, at: Schema.String },
  ClickedToggleSharing: {},

  // ---- settings, persistence, recovery
  ChangedProviderMode: { mode: ProviderMode },
  ChangedProbe: { probe: Probe },
  SavedFixture: {},
  FailedPersist: { message: Schema.String },
  ClickedReset: {},
  ClickedDismissNotices: {},
})

export type Message = typeof Message.Type
export type { Probe, QuestionId }
