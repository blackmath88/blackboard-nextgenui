/**
 * Compiling a declarative frame plus the user's arrangement into something that
 * can be drawn.
 *
 * Every label, status word, waiting-on line and excerpt is looked up here from
 * the accepted project records. A reference the project no longer resolves
 * renders as an explicit unresolved placeholder instead of being dropped or
 * invented — that is what makes a saved arrangement safe to reopen later.
 */

import {
  type Decision,
  type Dependency,
  type Project,
  type Task,
  UnassignedGroupId,
  dependencyLabel,
  partyLabel,
  recordStatusLine,
  recordTitle,
  recordWaitingOn,
  sourceExcerpt,
  sourceTitle,
  unassignedGroupLabel,
  waitingOnParty,
} from '../project/records.js'
import { type Proposal, defaultArrangement } from './model.js'
import type { Arrangement, Selection } from './model.js'

export type ResolvedSource = Readonly<{ id: string; title: string; excerpt: string }>

export type ResolvedRecord = Readonly<{
  id: string
  kind: 'task' | 'decision'
  title: string
  statusLine: string
  detail: string
  followUp: string
  revision: number
  updatedAt: string
  sources: ReadonlyArray<ResolvedSource>
  pinned: boolean
}>

export type ResolvedGroup = Readonly<{
  id: string
  label: string
  kind: 'party' | 'record' | 'unassigned'
  /** The edge in the records that justifies this grouping, when there is one. */
  via: string | undefined
  records: ReadonlyArray<ResolvedRecord>
  /** IDs the proposal named that this project does not have. */
  unresolved: ReadonlyArray<string>
}>

export type ResolvedPane = Readonly<{
  id: string
  role: 'workSurface' | 'inspector'
  component: 'groupedList' | 'dependencyView' | 'evidenceInspector'
  focused: boolean
  groups: ReadonlyArray<ResolvedGroup>
  /** Actions this frame asked for, marked against what the host actually wires. */
  actions: ReadonlyArray<{ id: string; offered: boolean }>
}>

/** Actions the host wires. A proposal cannot add to this list. */
export const supportedHostActions: ReadonlyArray<string> = [
  'record.select',
  'record.openEvidence',
  'record.pin',
  'task.markDone',
  'task.markActive',
]

const anyRecord = (project: Project, id: string): Task | Decision | undefined =>
  project.tasks.find((task) => task.id === id) ??
  project.decisions.find((decision) => decision.id === id)

const edgeFor = (
  project: Project,
  groupId: string,
  memberIds: ReadonlyArray<string>,
): Dependency | undefined =>
  project.dependencies.find(
    (edge) =>
      (edge.fromId === groupId && memberIds.includes(edge.toId)) ||
      (edge.toId === groupId && memberIds.includes(edge.fromId)),
  )

const resolveRecord = (
  project: Project,
  id: string,
  pins: ReadonlyArray<string>,
): ResolvedRecord | undefined => {
  const record = anyRecord(project, id)
  if (record === undefined) return undefined

  const sources =
    record.kind === 'task'
      ? record.sourceIds.map((sourceId) => ({
          id: sourceId,
          title: sourceTitle(project, sourceId),
          excerpt: sourceExcerpt(project, sourceId),
        }))
      : record.sourceIds.map((sourceId) => ({
          id: sourceId,
          title: sourceTitle(project, sourceId),
          excerpt: sourceExcerpt(project, sourceId),
        }))

  const party = record.kind === 'task' ? waitingOnParty(project, record.id) : undefined
  const inbound = project.dependencies.filter((edge) => edge.toId === record.id)

  return {
    id: record.id,
    kind: record.kind,
    title: recordTitle(project, record.id),
    statusLine: recordStatusLine(project, record),
    detail:
      record.kind === 'task'
        ? record.waitNote ?? (record.waitingOnId === undefined
            ? recordWaitingOn(project, record.id)
            : `Parked on ${recordTitle(project, record.waitingOnId)}.`)
        : record.sourceIds.length === 0
          ? 'No source excerpt is attached to this decision.'
          : `${record.sourceIds.length} excerpt(s) attached.`,
    followUp:
      party !== undefined
        ? `Chase ${party.label} on ${party.channel}.`
        : inbound.length === 0
          ? 'No inbound dependency recorded.'
          : dependencyLabel(project, inbound[0]!),
    revision: record.revision,
    updatedAt: record.updatedAt,
    sources,
    pinned: pins.includes(record.id),
  }
}

const orderedBy = (
  wanted: ReadonlyArray<string>,
  actual: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const kept = wanted.filter((id) => actual.includes(id))
  const added = actual.filter((id) => !wanted.includes(id))
  return [...kept, ...added]
}

const resolveGroup = (
  project: Project,
  groupId: string,
  memberIds: ReadonlyArray<string>,
  pins: ReadonlyArray<string>,
): ResolvedGroup => {
  const party = project.parties.find((each) => each.id === groupId)
  const kind: ResolvedGroup['kind'] =
    groupId === UnassignedGroupId ? 'unassigned' : party === undefined ? 'record' : 'party'

  const records: ResolvedRecord[] = []
  const unresolved: string[] = []
  for (const id of memberIds) {
    const resolved = resolveRecord(project, id, pins)
    if (resolved === undefined) unresolved.push(id)
    else records.push(resolved)
  }

  const edge = edgeFor(project, groupId, memberIds)

  return {
    id: groupId,
    label:
      kind === 'unassigned'
        ? unassignedGroupLabel
        : kind === 'party'
          ? partyLabel(project, groupId)
          : recordTitle(project, groupId),
    kind,
    via: edge === undefined ? undefined : dependencyLabel(project, edge),
    records,
    unresolved,
  }
}

/**
 * Compile the applied frame into panes, groups and records in the user's order.
 * References that no longer resolve stay visible as unresolved.
 */
export const resolveFrame = (args: Readonly<{
  project: Project
  applied: Proposal
  arrangement: Arrangement
  pins: ReadonlyArray<string>
}>): Readonly<{ panes: ReadonlyArray<ResolvedPane>; unresolved: ReadonlyArray<string> }> => {
  const { project, applied, arrangement, pins } = args
  const paneOrder = orderedBy(arrangement.paneOrder, applied.panes.map((pane) => pane.id))
  const unresolved: string[] = []

  const panes = paneOrder.flatMap((paneId) => {
    const pane = applied.panes.find((candidate) => candidate.id === paneId)
    if (pane === undefined) return []

    const wantedGroups = arrangement.groupOrder.find((entry) => entry.paneId === paneId)?.groupIds ?? []
    const groupOrder = orderedBy(wantedGroups, pane.groups.map((group) => group.id))
    const recordOrder = arrangement.recordOrder.find((entry) => entry.paneId === paneId)?.recordIds ?? []

    const groups = groupOrder.flatMap((groupId) => {
      const group = pane.groups.find((candidate) => candidate.id === groupId)
      if (group === undefined) return []
      const memberIds = recordOrder.length === 0 ? group.recordIds : orderedBy(recordOrder, group.recordIds)
      const resolved = resolveGroup(project, groupId, memberIds, pins)
      unresolved.push(...resolved.unresolved)
      return [resolved]
    })

    return [
      {
        id: pane.id,
        role: pane.role,
        component: pane.component,
        focused: arrangement.focusPaneId === pane.id,
        groups,
        actions: applied.actions.map((action) => ({
          id: action,
          offered: supportedHostActions.includes(action),
        })),
      },
    ]
  })

  return { panes, unresolved: [...new Set(unresolved)] }
}

export type ResolvedInspector = Readonly<{
  record: ResolvedRecord | undefined
  /** The chosen record, with the open decision's context beside it. */
  openSourceId: string | undefined
  /** Set when the stored selection points at a record the project no longer has. */
  danglingRecordId: string | undefined
}>

export const resolveInspector = (args: Readonly<{
  project: Project
  selection: Selection
  pins: ReadonlyArray<string>
}>): ResolvedInspector => {
  const recordId = args.selection.recordId
  if (recordId === undefined) {
    return { record: undefined, openSourceId: undefined, danglingRecordId: undefined }
  }

  const record = resolveRecord(args.project, recordId, args.pins)
  const sourceId = args.selection.sourceId
  const sourceKnown =
    record !== undefined && sourceId !== undefined && record.sources.some((each) => each.id === sourceId)

  return {
    record,
    openSourceId: sourceKnown ? sourceId : undefined,
    danglingRecordId: record === undefined ? recordId : undefined,
  }
}

export const arrangementFor = (proposal: Proposal): Arrangement => defaultArrangement(proposal)

/** Plain wording for a record kind, used in chips. */
export const kindChip = (record: ResolvedRecord | Decision | Task): string =>
  record.kind === 'task' ? 'Task' : 'Decision'
