import { Schema } from 'effect'
import type { QuestionId, FrameProposal } from './src/generation/proposal.js'
import type { Project } from './src/project/records.js'

const Intent = Schema.Struct({
  groups: Schema.Array(Schema.Struct({ id: Schema.String, recordIds: Schema.Array(Schema.String) })),
})

const eligible = (project: Project, question: QuestionId) =>
  question === 'q_blocking_groups'
    ? project.tasks.filter((task) => task.status === 'blocked')
        .map((task) => [task.id, task.waitingOnId ?? 'unassigned'] as const)
    : project.decisions.filter((decision) => decision.sourceIds.length === 0)
        .map((decision) => [decision.id, 'unassigned'] as const)

export function buildIntentPrompt(project: Project, question: QuestionId): string {
  return [
    'Return only JSON {"groups":[{"id":"group","recordIds":["record"]}]}.',
    'Each row is an eligible record ID and its required group ID, separated by a tab.',
    'Include every record once. You may choose the order of groups and records.',
    ...eligible(project, question).map((row) => row.join('\t')),
  ].join('\n')
}

export function expandIntent(raw: unknown, project: Project, question: QuestionId): FrameProposal {
  const { groups } = Schema.decodeUnknownSync(Intent)(raw)
  const remaining = new Map(eligible(project, question))
  const seenGroups = new Set<string>()
  for (const { id, recordIds } of groups) {
    if (seenGroups.has(id) || recordIds.length === 0) throw new Error('Invalid intent group')
    seenGroups.add(id)
    for (const record of recordIds) {
      if (remaining.get(record) !== id) throw new Error('Unexpected intent record')
      remaining.delete(record)
    }
  }
  if (remaining.size) throw new Error('Missing intent records')
  return {
    kind: 'blackboard.frame.proposal', schemaVersion: 1, proposalId: 'live.intent',
    projectId: project.id, baseRevision: project.revision, questionId: question,
    foreground: 'workSurface', reason: question === 'q_blocking_groups' ? 'waitingOnGrouping' : 'evidenceGap',
    panes: [
      { id: 'surface.intent', role: 'workSurface', component: 'groupedList', groups },
      { id: 'inspector.evidence', role: 'inspector', component: 'evidenceInspector', groups: [] },
    ],
    actions: [],
  }
}
