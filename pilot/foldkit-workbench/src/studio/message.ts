import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

export const ExplicitAction = Schema.Literals(['ask-why', 'compare', 'investigate', 'inspect-source', 'edit-assumption', 'move-card', 'artifact-event'])
export type ExplicitAction = typeof ExplicitAction.Type

export const Message = defineMessageUnion({
  // navigation
  SelectedConversation: { id: Schema.String },
  StartedConversation: {},
  ToggledRail: {},
  SelectedNarrowView: { view: Schema.Literals(['chat', 'board']) },
  OpenedRecentPane: { conversationId: Schema.String, paneId: Schema.String },
  ResetStudio: {},
  DismissedNotice: {},

  // conversation
  ChangedDraft: { value: Schema.String },
  SubmittedDraft: {},
  PressedComposerKey: { key: Schema.String, shift: Schema.Boolean },
  ClickedStarter: { prompt: Schema.String },
  ClickedRef: { objectId: Schema.String },
  InspectedPacket: { messageId: Schema.String },
  ClosedPacket: {},
  TickedStream: {},

  // workspace → conversation
  ToggledObject: { paneId: Schema.String, objectId: Schema.String },
  RemovedContext: { objectId: Schema.String },
  ClearedSelection: {},
  ClickedAction: { action: ExplicitAction },
  ClickedPaneAction: { paneId: Schema.String, prompt: Schema.String },
  ChangedAssumption: { paneId: Schema.String, id: Schema.String, value: Schema.Number },
  ResetAssumption: { id: Schema.String },
  StartedCardDrag: { cardId: Schema.String },
  DroppedCard: { paneId: Schema.String, lane: Schema.String },
  MovedCard: { paneId: Schema.String, cardId: Schema.String, lane: Schema.String },
  DiscardedArtifactEvent: {},

  // panes
  FocusedPane: { paneId: Schema.String },
  ToggledPin: { paneId: Schema.String },
  ClosedPane: { paneId: Schema.String },
  RestoredRevision: { paneId: Schema.String },
  ToggledLog: {},
  ToggledSplit: {},
  PromotedBlock: { messageId: Schema.String, block: Schema.Number },
  SentArtifactState: {},

  // layout
  StartedResize: {},
  MovedResize: { width: Schema.Number },
  EndedResize: {},
  NudgedBoard: { delta: Schema.Number },

  // artifact bridge (untrusted)
  ReceivedArtifactMessage: { artifactId: Schema.String, paneId: Schema.String, raw: Schema.Unknown },
  RejectedArtifactSender: { detail: Schema.String },

  // persistence
  Saved: {},
  FailedSave: { message: Schema.String },
})
export type Message = typeof Message.Type
