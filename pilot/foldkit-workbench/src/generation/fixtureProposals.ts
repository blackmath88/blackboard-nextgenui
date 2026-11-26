/**
 * Deterministic fixture proposals.
 *
 * These are the two declarative proposals the fixture provider returns for each
 * question. They only name panes, components, groups, record IDs and host
 * action IDs. They contain no titles, no status words and no excerpts, and they
 * are frozen so nothing can mutate them into carrying data they do not own.
 *
 * `probe` variants exist so the rejection path can be demonstrated in the
 * running app and in tests; each one is invalid in exactly one documented way.
 */

import { PROJECT_ID } from '../project/fixture.js'
import type { QuestionId } from './proposal.js'

const Unassigned = 'unassigned'

const base = (questionId: QuestionId, baseRevision: number) => ({
  kind: 'blackboard.frame.proposal' as const,
  schemaVersion: 1 as const,
  projectId: PROJECT_ID,
  questionId,
  baseRevision,
})

// ---------------------------------------------------------------------------
// Question 1 — "What's blocking rollout readiness, grouped by what we're waiting on?"
// ---------------------------------------------------------------------------

/** Proposal 1A: a grouped list in front, an evidence inspector beside it. */
export const proposalOneA = (baseRevision: number) =>
  Object.freeze({
    ...base('q_blocking_groups', baseRevision),
    proposalId: 'fx.q1.grouped',
    reason: 'waitingOnGrouping' as const,
    foreground: 'workSurface' as const,
    actions: ['record.select', 'record.openEvidence', 'task.markDone'],
    panes: [
      {
        id: 'surface.blockers',
        role: 'workSurface' as const,
        component: 'groupedList' as const,
        focusRecordId: 'task_tenant_baseline',
        groups: [
          { id: 'party_security_review', recordIds: ['task_tenant_baseline', 'task_mailbox_pilot'] },
          { id: 'party_finance', recordIds: ['task_license_reconcile'] },
          { id: 'party_vendor', recordIds: ['task_legacy_public_folders'] },
          { id: 'party_steering_group', recordIds: ['task_teams_wave_two'] },
          { id: 'dec_onedrive_kfm_scope', recordIds: ['task_known_folder_move'] },
        ],
      },
      {
        id: 'inspector.evidence',
        role: 'inspector' as const,
        component: 'evidenceInspector' as const,
        focusRecordId: 'task_tenant_baseline',
        groups: [],
      },
    ],
  })

/** Proposal 1B: the dependency chain in front, the grouped list moved to the side. */
export const proposalOneB = (baseRevision: number) =>
  Object.freeze({
    ...base('q_blocking_groups', baseRevision),
    proposalId: 'fx.q1.chain',
    reason: 'dependencyChain' as const,
    foreground: 'workSurface' as const,
    actions: ['record.select', 'record.openEvidence'],
    panes: [
      {
        id: 'surface.chain',
        role: 'workSurface' as const,
        component: 'dependencyView' as const,
        focusRecordId: 'task_mailbox_pilot',
        groups: [
          { id: 'task_tenant_baseline', recordIds: ['task_mailbox_pilot', 'task_tenant_baseline', 'dec_security_gate'] },
          { id: 'task_identity_sync', recordIds: ['task_teams_wave_two'] },
          { id: 'party_vendor', recordIds: ['task_legacy_public_folders'] },
          { id: 'dec_license_harvest', recordIds: ['task_license_reconcile'] },
        ],
      },
      {
        id: 'inspector.waitlists',
        role: 'inspector' as const,
        component: 'groupedList' as const,
        groups: [
          { id: 'party_security_review', recordIds: ['task_tenant_baseline'] },
          { id: 'party_finance', recordIds: ['task_license_reconcile'] },
          { id: 'party_vendor', recordIds: ['task_legacy_public_folders'] },
        ],
      },
    ],
  })

// ---------------------------------------------------------------------------
// Question 2 — "Which decisions lack evidence?"
// ---------------------------------------------------------------------------

/** Proposal 2A: the evidence gap itself in front, grouped by what each open decision gates. */
export const proposalTwoA = (baseRevision: number) =>
  Object.freeze({
    ...base('q_decisions_without_evidence', baseRevision),
    proposalId: 'fx.q2.gap',
    reason: 'evidenceGap' as const,
    foreground: 'workSurface' as const,
    actions: ['record.select', 'record.openEvidence', 'record.pin'],
    panes: [
      {
        id: 'surface.gap',
        role: 'workSurface' as const,
        component: 'groupedList' as const,
        focusRecordId: 'dec_license_harvest',
        groups: [
          { id: 'task_license_reconcile', recordIds: ['dec_license_harvest'] },
          { id: 'task_cutover_date', recordIds: ['dec_cutover_window'] },
          { id: Unassigned, recordIds: ['dec_resource_accounts', 'dec_room_rename'] },
        ],
      },
      {
        id: 'inspector.evidence',
        role: 'inspector' as const,
        component: 'evidenceInspector' as const,
        focusRecordId: 'dec_license_harvest',
        groups: [],
      },
    ],
  })

/** Proposal 2B: the decisions beside the work they hold up, no inspector pane. */
export const proposalTwoB = (baseRevision: number) =>
  Object.freeze({
    ...base('q_decisions_without_evidence', baseRevision),
    proposalId: 'fx.q2.risk',
    reason: 'decisionRisk' as const,
    foreground: 'inspector' as const,
    actions: ['record.select', 'record.pin'],
    panes: [
      {
        id: 'surface.gated',
        role: 'workSurface' as const,
        component: 'dependencyView' as const,
        focusRecordId: 'dec_resource_accounts',
        groups: [
          { id: 'dec_license_harvest', recordIds: ['task_license_reconcile'] },
          { id: 'dec_cutover_window', recordIds: ['task_cutover_date'] },
          { id: 'dec_onedrive_kfm_scope', recordIds: ['task_known_folder_move'] },
        ],
      },
      {
        id: 'inspector.suspects',
        role: 'inspector' as const,
        component: 'groupedList' as const,
        groups: [
          { id: Unassigned, recordIds: ['dec_resource_accounts', 'dec_room_rename', 'dec_license_harvest', 'dec_cutover_window'] },
        ],
      },
    ],
  })

export const fixtureProposals = (
  question: QuestionId,
  baseRevision: number,
): ReadonlyArray<unknown> =>
  question === 'q_blocking_groups'
    ? [proposalOneA(baseRevision), proposalOneB(baseRevision)]
    : [proposalTwoA(baseRevision), proposalTwoB(baseRevision)]

// ---------------------------------------------------------------------------
// Probe variants: one documented defect each
// ---------------------------------------------------------------------------

export type ProbeKind = 'none' | 'unknownId' | 'crossProject' | 'unsupportedAction' | 'stale' | 'malformed'

export const probeKinds: ReadonlyArray<ProbeKind> = [
  'none',
  'unknownId',
  'crossProject',
  'unsupportedAction',
  'stale',
  'malformed',
]

export const probeLabel = (probe: ProbeKind): string =>
  probe === 'none'
    ? 'as generated'
    : probe === 'unknownId'
      ? 'unknown record ID'
      : probe === 'crossProject'
        ? 'reference into another project'
        : probe === 'unsupportedAction'
          ? 'action the host does not offer'
          : probe === 'stale'
            ? 'built on an older revision'
            : 'not a proposal at all'

export const probeDescription = (probe: ProbeKind): string =>
  probe === 'none'
    ? 'The provider replies with the two proposals it really generated.'
    : probe === 'unknownId'
      ? 'One proposal names a task that is not in this project.'
      : probe === 'crossProject'
        ? 'One proposal names a record owned by another project.'
        : probe === 'unsupportedAction'
          ? 'One proposal asks for a delete action the host never wires up.'
        : probe === 'stale'
          ? 'One proposal claims an older board revision than the one in view.'
          : 'One reply is not a frame proposal at all.'

/** The two honest proposals, with the chosen defect injected into the second. */
export const probedProposals = (
  question: QuestionId,
  baseRevision: number,
  probe: ProbeKind,
): ReadonlyArray<unknown> => {
  const proposals = fixtureProposals(question, baseRevision)
  if (probe === 'none') return proposals

  if (probe === 'malformed') return [proposals[1], { proposalId: 'fx.probe.malformed', panes: 'not-a-list' }]

  // The probe rewrites the second proposal as untrusted JSON, so the host's
  // validator is what catches the defect — exactly as it would with a real model.
  const target: Record<string, unknown> = { ...(proposals[1] as Record<string, unknown>) }
  const panes = (target['panes'] as ReadonlyArray<Record<string, unknown>>).map((pane) => ({ ...pane }))
  const first = { ...panes[0]! }
  const groups = (first['groups'] as ReadonlyArray<Record<string, unknown>>).map((group) => ({ ...group }))
  const memberIds = (groups[0]!['recordIds'] as ReadonlyArray<string>) ?? []

  if (probe === 'unknownId') {
    groups[0] = { ...groups[0]!, ['recordIds']: ['task_does_not_exist', ...memberIds] }
  } else if (probe === 'crossProject') {
    groups[0] = { ...groups[0]!, ['recordIds']: ['task_pos_rollback', ...memberIds] }
  } else if (probe === 'stale') {
    target['baseRevision'] = baseRevision - 3
  } else if (probe === 'unsupportedAction') {
    target['actions'] = ['record.select', 'project.deleteEverything']
  }

  first['groups'] = groups
  panes[0] = first
  target['proposalId'] = `fx.probe.${probe}`
  target['panes'] = panes
  return [proposals[0], target]
}
