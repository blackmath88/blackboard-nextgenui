/**
 * The declarative output contract between a provider and the workbench.
 *
 * A proposal names panes, components, groups, record IDs and host action IDs.
 * It carries no prose, no labels, no status words and no excerpts: every string
 * the user reads is resolved from project records at render time.
 */

import { Schema } from 'effect'

/** The two questions this slice answers. */
export const QuestionId = Schema.Literals(['q_blocking_groups', 'q_decisions_without_evidence'])
export type QuestionId = typeof QuestionId.Type

/**
 * Deterministic probe injected into the fixture reply so the guard can be shown
 * in the running app: one documented defect at a time, never a real provider.
 */
export const Probe = Schema.Literals([
  'none',
  'unknownId',
  'crossProject',
  'unsupportedAction',
  'stale',
  'malformed',
])
export type Probe = typeof Probe.Type

export const questionPrompt = (question: QuestionId): string =>
  question === 'q_blocking_groups'
    ? "What's blocking rollout readiness, grouped by what we're waiting on?"
    : 'Which decisions lack evidence?'

/** Host-resolved copy for why a provider chose an arrangement. */
export const ReasonCode = Schema.Literals([
  'waitingOnGrouping',
  'dependencyChain',
  'evidenceGap',
  'decisionRisk',
])
export type ReasonCode = typeof ReasonCode.Type

export const reasonCopy = (reason: ReasonCode): string =>
  reason === 'waitingOnGrouping'
    ? 'Grouped by the waitlist each blocked record is parked on.'
    : reason === 'dependencyChain'
      ? 'Led with the dependency chain so the blockers read in order.'
      : reason === 'evidenceGap'
        ? 'Led with the decisions that have no source excerpt on file.'
        : 'Led with the decisions still gated by open work.'

/** Components the host can actually render. A proposal may not invent one. */
export const PaneComponent = Schema.Literals([
  'groupedList',
  'dependencyView',
  'evidenceInspector',
])
export type PaneComponent = typeof PaneComponent.Type

export const paneComponentLabel = (component: PaneComponent): string =>
  component === 'groupedList'
    ? 'Grouped list'
    : component === 'dependencyView'
      ? 'Dependency view'
      : 'Evidence inspector'

export const PaneRole = Schema.Literals(['workSurface', 'inspector'])
export type PaneRole = typeof PaneRole.Type

/** Host-owned action vocabulary. A proposal may only name IDs from this list. */
export const AllowedActionIds = [
  'task.markDone',
  'task.markActive',
  'record.select',
  'record.openEvidence',
  'record.pin',
] as const
export type AllowedActionId = (typeof AllowedActionIds)[number]

export const isAllowedActionId = (id: string): id is AllowedActionId =>
  (AllowedActionIds as ReadonlyArray<string>).includes(id)

export const ProposalGroup = Schema.Struct({
  /** A waitlist/decision/task record ID, or the host constant "unassigned". */
  id: Schema.String,
  recordIds: Schema.Array(Schema.String),
})
export type ProposalGroup = typeof ProposalGroup.Type

export const ProposalPane = Schema.Struct({
  id: Schema.String,
  role: PaneRole,
  component: PaneComponent,
  groups: Schema.Array(ProposalGroup),
  focusRecordId: Schema.optional(Schema.String),
})
export type ProposalPane = typeof ProposalPane.Type

export const FrameProposal = Schema.Struct({
  kind: Schema.Literal('blackboard.frame.proposal'),
  schemaVersion: Schema.Literal(1),
  proposalId: Schema.String,
  projectId: Schema.String,
  questionId: QuestionId,
  /** Project revision the proposal was computed against. */
  baseRevision: Schema.Number,
  foreground: Schema.Literals(['workSurface', 'inspector']),
  reason: ReasonCode,
  panes: Schema.Array(ProposalPane),
  actions: Schema.Array(Schema.String),
})
export type FrameProposal = typeof FrameProposal.Type

export const UntrustedProposals = Schema.Struct({
  proposals: Schema.Array(Schema.Unknown),
})
export type UntrustedProposals = typeof UntrustedProposals.Type

/** The host constant a proposal may use for records with no waitlist recorded. */
export { UnassignedGroupId, unassignedGroupLabel } from '../project/records.js'

// ---------------------------------------------------------------------------
// Rejections
// ---------------------------------------------------------------------------

export const RejectionKind = Schema.Literals([
  'malformedOutput',
  'wrongProject',
  'unknownRecord',
  'crossProjectReference',
  'unsupportedAction',
  'unknownGroup',
  'staleProposal',
])
export type RejectionKind = typeof RejectionKind.Type

export const ProposalRejection = Schema.Struct({
  kind: RejectionKind,
  detail: Schema.String,
  reference: Schema.optional(Schema.String),
})
export type ProposalRejection = typeof ProposalRejection.Type

export const rejectionHeadline = (rejection: ProposalRejection): string =>
  rejection.kind === 'malformedOutput'
    ? 'Model output was not a valid frame proposal'
    : rejection.kind === 'wrongProject'
      ? 'Proposal was for a different project'
      : rejection.kind === 'unknownRecord'
        ? 'Proposal named a record this project does not have'
        : rejection.kind === 'crossProjectReference'
          ? 'Proposal reached into another project'
          : rejection.kind === 'unsupportedAction'
            ? 'Proposal asked for an action the host does not offer'
            : rejection.kind === 'unknownGroup'
              ? 'Proposal grouped by something this project does not record'
              : 'Proposal was built against an older revision of the board'

/** Advice shown with every rejection: what stayed untouched. */
export const rejectionAdvice = (rejection: ProposalRejection): string =>
  rejection.kind === 'staleProposal'
    ? 'Ask again to group the current revision of the board.'
    : 'Ask again, or keep working in the view that is already open.'

/** What a rejection never touches. */
export const rejectionPreservedNotice =
  'Last usable view and accepted records are unchanged.' as const
