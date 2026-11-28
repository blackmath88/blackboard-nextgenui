/**
 * Project records for the isolated Foldkit workbench experiment (issue #13).
 *
 * Everything the workbench renders is resolved from these records: titles,
 * status wording, waitlist labels, source excerpts, dependency edges and the
 * audit trail. A generated proposal only carries record IDs, so no label,
 * status word or excerpt in the UI can originate from model text.
 *
 * The project is fictional. All names, IDs, tickets and excerpts are synthetic.
 */

import { Result, Schema } from 'effect'

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** The one project this prototype owns. Anything else is a cross-project reference. */
export const ProjectId = 'prj_northwind_m365'

/** The host constant a proposal may use for records with no waitlist recorded. */
export const UnassignedGroupId = 'unassigned'
export const unassignedGroupLabel = 'No waitlist recorded'

const NonEmptyString = Schema.NonEmptyString

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TaskStatus = Schema.Literals(['ready', 'active', 'blocked', 'done'])
export type TaskStatus = typeof TaskStatus.Type

/** Status wording lives here, in host code, next to the record. */
export const taskStatusLabel = (status: TaskStatus): string =>
  status === 'ready'
    ? 'Ready'
    : status === 'active'
      ? 'In progress'
      : status === 'blocked'
        ? 'Blocked'
        : 'Done'

export const Task = Schema.Struct({
  id: NonEmptyString,
  projectId: Schema.Literal(ProjectId),
  kind: Schema.Literal('task'),
  title: Schema.String,
  status: TaskStatus,
  /** What this task is parked on: a waitlist party, a task or a decision. */
  waitingOnId: Schema.optional(Schema.String),
  /** Why the task waits, in the programme's own words, stored with the record. */
  waitNote: Schema.optional(Schema.String),
  owner: Schema.String,
  sourceIds: Schema.Array(Schema.String),
  /** Per-record revision; a stale write is refused. */
  revision: Schema.Number,
  updatedAt: Schema.String,
})
export type Task = typeof Task.Type

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export const DecisionStatus = Schema.Literals(['open', 'accepted', 'rejected', 'deferred'])
export type DecisionStatus = typeof DecisionStatus.Type

export const decisionStatusLabel = (status: DecisionStatus): string =>
  status === 'open'
    ? 'Open'
    : status === 'accepted'
      ? 'Accepted'
      : status === 'rejected'
        ? 'Rejected'
        : 'Deferred'

export const Decision = Schema.Struct({
  id: NonEmptyString,
  projectId: Schema.Literal(ProjectId),
  kind: Schema.Literal('decision'),
  title: Schema.String,
  status: DecisionStatus,
  /** An empty array means "no evidence on file" and is rendered as such. */
  sourceIds: Schema.Array(Schema.String),
  owner: Schema.String,
  revision: Schema.Number,
  updatedAt: Schema.String,
})
export type Decision = typeof Decision.Type

// ---------------------------------------------------------------------------
// Sources and excerpts
// ---------------------------------------------------------------------------

export const SourceKind = Schema.Literals(['meeting', 'email', 'chat', 'ticket', 'doc'])
export type SourceKind = typeof SourceKind.Type

export const sourceKindLabel = (kind: SourceKind): string =>
  kind === 'meeting'
    ? 'Meeting note'
    : kind === 'email'
      ? 'Mail'
      : kind === 'chat'
        ? 'Chat'
        : kind === 'ticket'
          ? 'Ticket'
          : 'Document'

export const Source = Schema.Struct({
  id: NonEmptyString,
  projectId: Schema.Literal(ProjectId),
  kind: Schema.Literal('source'),
  sourceKind: SourceKind,
  title: Schema.String,
  /** Verbatim excerpt; rendered from this field only. */
  excerpt: Schema.String,
  attribution: Schema.String,
  /** Local record locator. Nothing here is ever fetched. */
  locator: Schema.String,
  revision: Schema.Number,
  updatedAt: Schema.String,
})
export type Source = typeof Source.Type

// ---------------------------------------------------------------------------
// Waitlist parties ("what we are waiting on")
// ---------------------------------------------------------------------------

export const Party = Schema.Struct({
  id: NonEmptyString,
  projectId: Schema.Literal(ProjectId),
  kind: Schema.Literal('party'),
  label: Schema.String,
  channel: Schema.String,
  revision: Schema.Number,
  updatedAt: Schema.String,
})
export type Party = typeof Party.Type

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export const DependencyKind = Schema.Literals(['blockedBy', 'requires', 'informs'])
export type DependencyKind = typeof DependencyKind.Type

export const dependencyKindLabel = (kind: DependencyKind): string =>
  kind === 'blockedBy' ? 'blocked by' : kind === 'requires' ? 'requires' : 'informs'

export const Dependency = Schema.Struct({
  id: NonEmptyString,
  projectId: Schema.Literal(ProjectId),
  kind: Schema.Literal('dependency'),
  fromId: Schema.String,
  toId: Schema.String,
  dependencyKind: DependencyKind,
  revision: Schema.Number,
  updatedAt: Schema.String,
})
export type Dependency = typeof Dependency.Type

// ---------------------------------------------------------------------------
// Audit trail (host-owned facts, never model text)
// ---------------------------------------------------------------------------

export const AuditKind = Schema.Literals([
  'accepted',
  'created',
  'edited',
  'moved',
  'frame_proposed',
  'frame_applied',
  'frame_rejected',
  'view_saved',
  'view_opened',
  'task_status_changed',
  'arrangement_changed',
  'undo',
  'turn_sent',
])
export type AuditKind = typeof AuditKind.Type

export const AuditEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  actor: Schema.Literals(['user', 'host', 'fixture_model']),
  auditKind: AuditKind,
  recordId: Schema.optional(Schema.String),
  detail: Schema.String,
})
export type AuditEntry = typeof AuditEntry.Type

// ---------------------------------------------------------------------------
// The project itself
// ---------------------------------------------------------------------------

export const Project = Schema.Struct({
  id: Schema.Literal(ProjectId),
  name: Schema.String,
  revision: Schema.Number,
  tasks: Schema.Array(Task),
  decisions: Schema.Array(Decision),
  sources: Schema.Array(Source),
  parties: Schema.Array(Party),
  dependencies: Schema.Array(Dependency),
  audit: Schema.Array(AuditEntry),
})
export type Project = typeof Project.Type

// ---------------------------------------------------------------------------
// Lookups used by the renderer and the validator
// ---------------------------------------------------------------------------

export type AnyRecord = Task | Decision | Source | Party | Dependency

export const allRecords = (project: Project): ReadonlyArray<AnyRecord> => [
  ...project.tasks,
  ...project.decisions,
  ...project.sources,
  ...project.parties,
  ...project.dependencies,
]

export const findRecord = (project: Project, id: string): AnyRecord | undefined =>
  project.tasks.find((record) => record.id === id) ??
  project.decisions.find((record) => record.id === id) ??
  project.sources.find((record) => record.id === id) ??
  project.parties.find((record) => record.id === id) ??
  project.dependencies.find((record) => record.id === id)

export const recordKindLabel = (record: AnyRecord): string =>
  record.kind === 'task'
    ? 'Task'
    : record.kind === 'decision'
      ? 'Decision'
      : record.kind === 'source'
        ? 'Source'
        : record.kind === 'party'
          ? 'Waitlist'
          : 'Dependency'

/** Title of any record, with an explicit fallback for a dangling reference. */
export const recordTitle = (project: Project, id: string): string => {
  const record = findRecord(project, id)
  if (record === undefined) return `record ${id} is no longer in this project`
  if (record.kind === 'party') return record.label
  if (record.kind === 'dependency') return `${dependencyKindLabel(record.dependencyKind)} edge ${record.id}`
  return record.title
}

/** Status line for a record, always resolved from the record itself. */
export const recordStatusLine = (project: Project, record: AnyRecord): string => {
  if (record.kind === 'task') {
    const waiting = record.waitingOnId === undefined
      ? ''
      : ` · waiting on ${recordTitle(project, record.waitingOnId)}`
    return `${taskStatusLabel(record.status)}${waiting}`
  }
  if (record.kind === 'decision') {
    return `${decisionStatusLabel(record.status)} · ${
      record.sourceIds.length === 0 ? 'no evidence on file' : `${record.sourceIds.length} source(s)`
    }`
  }
  if (record.kind === 'source') {
    return `${sourceKindLabel(record.sourceKind)} · ${record.attribution}`
  }
  if (record.kind === 'party') {
    return `waitlist · ${record.channel}`
  }
  return `dependency · ${dependencyKindLabel(record.dependencyKind)}`
}

/** Sources attached to a record, resolved from the project, never from a proposal. */
export const sourcesFor = (
  project: Project,
  record: AnyRecord,
): ReadonlyArray<Source> => {
  const ids =
    record.kind === 'task' || record.kind === 'decision' ? record.sourceIds : []
  return ids.flatMap((id) => project.sources.filter((source) => source.id === id))
}

/** Outgoing dependency edges of a record. */
export const dependenciesFrom = (
  project: Project,
  recordId: string,
): ReadonlyArray<Dependency> =>
  project.dependencies.filter((dependency) => dependency.fromId === recordId)

/** Incoming dependency edges of a record. */
export const dependenciesTo = (
  project: Project,
  recordId: string,
): ReadonlyArray<Dependency> =>
  project.dependencies.filter((dependency) => dependency.toId === recordId)

/** The record this task waits on, when that target still exists. */
export const waitingOnRecord = (project: Project, task: Task): AnyRecord | undefined =>
  task.waitingOnId === undefined ? undefined : findRecord(project, task.waitingOnId)

/** The waitlist a task is parked on, when the project still records one. */
export const waitingOnParty = (project: Project, recordId: string): Party | undefined => {
  const task = project.tasks.find((each) => each.id === recordId)
  if (task === undefined || task.waitingOnId === undefined) return undefined
  return project.parties.find((party) => party.id === task.waitingOnId)
}

/** A group heading, read off the party record. */
export const partyLabel = (project: Project, partyId: string): string => {
  const party = project.parties.find((each) => each.id === partyId)
  return party === undefined ? `waitlist ${partyId} is no longer in this project` : party.label
}

/** One line, in the programme's own words, about what is still open. */
export const recordWaitingOn = (project: Project, recordId: string): string => {
  const waiting = dependenciesTo(project, recordId)
  if (waiting.length === 0) return 'Nothing is waiting on it.'
  const names = waiting
    .map((dependency) => recordTitle(project, dependency.fromId))
    .slice(0, 3)
    .join(', ')
  return `${waiting.length} record(s) wait on it: ${names}.`
}

/** A dependency edge read as a sentence, from the record's own fields. */
export const dependencyLabel = (project: Project, dependency: Dependency): string =>
  `${recordTitle(project, dependency.fromId)} ${dependencyKindLabel(dependency.dependencyKind)} ${recordTitle(project, dependency.toId)}`

/** A stored excerpt, or an explicit statement that the ID holds nothing. */
export const sourceExcerpt = (project: Project, sourceId: string): string => {
  const source = project.sources.find((each) => each.id === sourceId)
  return source === undefined ? `No excerpt is stored under ${sourceId}.` : source.excerpt
}

export const sourceTitle = (project: Project, sourceId: string): string => {
  const source = project.sources.find((each) => each.id === sourceId)
  return source === undefined ? `source ${sourceId} is no longer in this project` : source.title
}

// ---------------------------------------------------------------------------
// The one ordinary record mutation the workbench performs
// ---------------------------------------------------------------------------

/**
 * Mark a task done through the record, not through a generated view. Bumps the
 * record revision and the project revision, appends an audit entry, and refuses
 * anything that is not a task in this project.
 */
export const markTaskDone = (
  project: Project,
  taskId: string,
  at: string,
): Result.Result<Project, string> => {
  const task = project.tasks.find((each) => each.id === taskId)
  if (task === undefined) {
    return Result.fail(`no task carries the ID ${taskId}`)
  }
  if (task.status === 'done') {
    return Result.fail(`${taskId} is already done`)
  }

  const closed: Task = {
    ...task,
    status: 'done',
    revision: task.revision + 1,
    updatedAt: at,
  }

  return Result.succeed({
    ...project,
    revision: project.revision + 1,
    tasks: project.tasks.map((each) => (each.id === taskId ? closed : each)),
    audit: [
      ...project.audit,
      auditFor({ actor: 'user', action: 'task_status_changed', recordId: taskId, reasonCode: 'user_marked_done', at }),
    ].slice(-MaxAuditEntries),
  })
}

// ---------------------------------------------------------------------------
// Audit helper (the trail is a host fact, never model text)
// ---------------------------------------------------------------------------

export const MaxAuditEntries = 40

export const auditFor = (entry: Readonly<{
  actor: AuditEntry['actor']
  action: AuditKind
  recordId: string
  reasonCode: string
  at: string
}>): AuditEntry => ({
  id: `aud_${entry.at}_${entry.action}_${entry.recordId}`,
  at: entry.at,
  actor: entry.actor,
  auditKind: entry.action,
  recordId: entry.recordId,
  detail: `${entry.actor} · ${entry.action} · ${entry.recordId} · ${entry.reasonCode}`,
})
