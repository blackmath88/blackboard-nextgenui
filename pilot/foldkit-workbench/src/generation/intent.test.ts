import { expect, it } from 'vitest'
import { buildIntentPrompt, expandIntent } from '../../intent.js'
import { fixtureProject } from '../project/fixture.js'
import { reviewResponse } from './validate.js'

it.each(['q_blocking_groups', 'q_decisions_without_evidence'] as const)(
  'expands complete fixture intent and rejects missing or repeated records for %s',
  (question) => {
    const project = fixtureProject()
    const rows = buildIntentPrompt(project, question).split('\n').slice(3)
    expect(rows).toHaveLength(question === 'q_blocking_groups' ? 6 : 4)
    const grouped = new Map<string, string[]>()
    for (const row of rows) {
      const [id, group] = row.split('\t') as [string, string]
      grouped.set(group, [...(grouped.get(group) ?? []), id])
    }
    const groups = [...grouped].map(([id, recordIds]) => ({ id, recordIds }))
    const frame = expandIntent({ groups }, project, question)
    expect(reviewResponse(frame, {
      context: { project, foreignRecordIds: {} }, question, baseRevision: project.revision,
    })._tag).toBe('Success')
    expect(() => expandIntent({ groups: [] }, project, question)).toThrow()
    expect(() => expandIntent({ groups: [...groups, groups[0]] }, project, question)).toThrow()
  },
)
