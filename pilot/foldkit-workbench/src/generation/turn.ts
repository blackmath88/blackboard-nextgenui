/**
 * The bounded board snapshot that goes into the next model turn.
 *
 * Only accepted records are included, the snapshot is capped per kind and in
 * total characters, and both the omitted and shortened counts are reported so
 * the payload can be read honestly. With sharing off, no snapshot is built at
 * all — the request simply has no board field.
 */

import { Schema } from 'effect'

import { type Decision, type Project, type Task, decisionStatusLabel, taskStatusLabel } from '../project/records.js'
import { QuestionId, questionPrompt } from './proposal.js'

export const MaxRecordsPerKind = 8
export const MaxSnapshotChars = 3_600

/** The host-owned wording of a question, exactly as it goes into the request. */
export const questionText = (question: QuestionId): string => questionPrompt(question)

export const SnapshotRecord = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(['task', 'decision']),
  title: Schema.String,
  status: Schema.String,
  revision: Schema.Number,
  updatedAt: Schema.String,
  waitingOnId: Schema.optional(Schema.String),
  sourceIds: Schema.Array(Schema.String),
})

export type SnapshotRecord = typeof SnapshotRecord.Type

export const BoardSnapshot = Schema.Struct({
  projectId: Schema.String,
  projectName: Schema.String,
  revision: Schema.Number,
  records: Schema.Array(SnapshotRecord),
  /** Records left out because of the caps, so the reader sees the gaps. */
  omittedRecordIds: Schema.Array(Schema.String),
  shortenedRecordIds: Schema.Array(Schema.String),
  charCount: Schema.Number,
})
export type BoardSnapshot = typeof BoardSnapshot.Type

const taskRow = (task: Task): SnapshotRecord => ({
  id: task.id,
  kind: 'task',
  title: task.title,
  status: taskStatusLabel(task.status),
  revision: task.revision,
  updatedAt: task.updatedAt,
  ...(task.waitingOnId === undefined ? {} : { waitingOnId: task.waitingOnId }),
  sourceIds: task.sourceIds,
})

const decisionRow = (decision: Decision): SnapshotRecord => ({
  id: decision.id,
  kind: 'decision',
  title: decision.title,
  status: decisionStatusLabel(decision.status),
  revision: decision.revision,
  updatedAt: decision.updatedAt,
  sourceIds: decision.sourceIds,
})

/** Most recently touched records first, so the caps drop the stale ones. */
const recentFirst = <T extends { updatedAt: string; revision: number }>(rows: ReadonlyArray<T>) =>
  [...rows].sort((left, right) =>
    left.updatedAt === right.updatedAt
      ? right.revision - left.revision
      : right.updatedAt.localeCompare(left.updatedAt),
  )

const fits = (record: SnapshotRecord): number => JSON.stringify(record).length

/**
 * Build the accepted-state snapshot. A record whose row would break the total
 * budget is included with `title` clipped and named in `shortenedRecordIds`;
 * records beyond the per-kind cap are named in `omittedRecordIds`.
 */
export const buildBoardSnapshot = (project: Project): BoardSnapshot => {
  const tasks = recentFirst(project.tasks)
  const decisions = recentFirst(project.decisions)

  const takenTasks = tasks.slice(0, MaxRecordsPerKind)
  const takenDecisions = decisions.slice(0, MaxRecordsPerKind)

  const omitted = [
    ...tasks.slice(MaxRecordsPerKind),
    ...decisions.slice(MaxRecordsPerKind),
  ].map((record) => record.id)

  const rows = [...takenTasks.map(taskRow), ...takenDecisions.map(decisionRow)]

  const records: SnapshotRecord[] = []
  const shortened: string[] = []
  let used = 0

  for (const row of rows) {
    const size = fits(row)
    if (used + size <= MaxSnapshotChars) {
      records.push(row)
      used += size
      continue
    }

    const room = MaxSnapshotChars - used
    if (room > 64) {
      let clipped = row
      while (fits(clipped) > room && clipped.title.length > 8) {
        clipped = { ...clipped, title: `${clipped.title.slice(0, clipped.title.length - 4)}…` }
      }
      records.push(clipped)
      shortened.push(row.id)
      used += fits(clipped)
    } else {
      omitted.push(row.id)
    }
  }

  return {
    projectId: project.id,
    projectName: project.name,
    revision: project.revision,
    records,
    omittedRecordIds: omitted,
    shortenedRecordIds: shortened,
    charCount: used,
  }
}

// ---------------------------------------------------------------------------
// The turn request that the host composes and the user can read
// ---------------------------------------------------------------------------

export const SelectionContext = Schema.Struct({
  recordId: Schema.String,
  sourceId: Schema.optional(Schema.String),
})
export type SelectionContext = typeof SelectionContext.Type

export const TurnRequest = Schema.Struct({
  kind: Schema.Literal('blackboard.turn.request'),
  question: Schema.String,
  questionId: QuestionId,
  fixtureMode: Schema.Literal(true),
  sharing: Schema.Struct({
    enabled: Schema.Boolean,
    notice: Schema.String,
  }),
  selection: Schema.optional(SelectionContext),
  /** Absent when sharing is off. Never an empty snapshot. */
  boardSnapshot: Schema.optional(BoardSnapshot),
})
export type TurnRequest = typeof TurnRequest.Type

export const sharingNoticeOn =
  'Board sharing is on: accepted records only, capped and listed in full below.'
export const sharingNoticeOff =
  'Board sharing is off: this request carries no board snapshot.'

export const buildTurnRequest = (args: Readonly<{
  project: Project
  question: string
  questionId: QuestionId
  sharing: boolean
  selection: SelectionContext | undefined
}>): TurnRequest => ({
  kind: 'blackboard.turn.request',
  question: args.question,
  questionId: args.questionId,
  fixtureMode: true,
  sharing: {
    enabled: args.sharing,
    notice: args.sharing ? sharingNoticeOn : sharingNoticeOff,
  },
  ...(args.selection === undefined ? {} : { selection: args.selection }),
  ...(args.sharing ? { boardSnapshot: buildBoardSnapshot(args.project) } : {}),
})

export const prettyTurnRequest = (request: TurnRequest): string =>
  JSON.stringify(request, null, 2)
