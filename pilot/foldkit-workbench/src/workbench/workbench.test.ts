/**
 * The required loop, end to end, against the fixture provider.
 *
 * Everything asserted here is deterministic: the fixture replies are fixed, the
 * clock is fixed, and every visible label is resolved from the records.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { fixtureProject } from '../project/fixture.js'
import { Message } from './message.js'
import { initialModel } from './model.js'
import { encodePersisted, decodePersisted, modelOf } from './persistence.js'
import { resolveFrame, resolveInspector } from './resolve.js'
import { session } from './harness.js'
import { checklistKey } from './chat.js'

it('keeps an accepted edit across a reframe and reload', async () => {
  const board = session()
  const section = { title: 'Prepare', kind: 'checklist' as const, items: ['Book a room'] }
  await board.send(Message.ReceivedChat({ result: { reply: 'Try this.', workspace: { title: 'Plan', sections: [section] } } }))
  await board.send(Message.AppliedChatWorkspace())
  const id = checklistKey(section, 0)
  await board.send(Message.AcceptedWorkspaceTask({ id, title: 'Book a room' }))
  await board.send(Message.RenamedWorkspaceTask({ id, title: 'Book the library' }))
  await board.send(Message.ToggledChatItem({ key: id }))
  await board.send(Message.ChangedWorkspaceLayout({ layout: 'kanban' }))
  expect(board.model().conversationWorkspace?.layout).toBe('kanban')
  expect(board.model().workspaceTasks[0]?.done).toBe(true)
  await board.send(Message.ReceivedChat({ result: { reply: 'Another view.', workspace: { title: 'Summary', sections: [] } } }))
  await board.send(Message.AppliedChatWorkspace())
  const restored = decodePersisted(encodePersisted(board.model()))
  expect(restored._tag === 'Restored' && restored.state.workspaceTasks).toMatchObject([
    { id, title: 'Book the library', done: true },
  ])
})

it('starts with an empty workspace and preserves it across ordinary replies', async () => {
  const board = session()
  expect(board.model().conversation).toEqual([])
  expect(board.model().conversationWorkspace).toBeNull()
  const workspace = { title: 'Book swap', sections: [{ title: 'Before the event', items: ['Book a room'] }] }
  await board.send(Message.ReceivedChat({ result: { reply: 'Here is a plan.', workspace } }))
  expect(board.model().conversationWorkspace).toBeNull()
  await board.send(Message.AppliedChatWorkspace())
  await board.send(Message.ReceivedChat({ result: { reply: 'You’re welcome.', workspace: null } }))
  expect(board.model().conversationWorkspace).toMatchObject(workspace)
  expect(board.model().conversation.at(-1)).toEqual({ role: 'assistant', text: 'You’re welcome.' })
})

it('routes a typed chat message to the workspace and persists the conversation', async () => {
  const board = session()
  const value = 'Which decisions lack evidence?'
  await board.send(Message.ChangedChatDraft({ value }))
  await board.send(Message.SubmittedChat())
  expect(board.model().chatDraft).toBe('')
  expect(board.model().preview?.accepted[0]?.questionId).toBe('q_decisions_without_evidence')
  const restored = decodePersisted(encodePersisted(board.model()))
  expect(restored._tag === 'Restored' && restored.state.chatHistory).toEqual([value])
})

const firstPaneGroupIds = (model: ReturnType<typeof initialModel>) => {
  const resolved = resolveFrame({
    project: model.project,
    applied: model.applied!,
    arrangement: model.arrangement!,
    pins: model.pins,
  })
  return resolved.panes[0]!.groups.map((group) => group.id)
}

describe('question 1 — what is blocking, grouped by what we wait on', () => {
  it('previews two proposals, applies one, and resolves every label from records', async () => {
    const board = session()

    await board.send(Message.ClickedAsk({ question: 'q_blocking_groups' }))
    const previewed = board.model()

    expect(previewed.requesting).toBe(false)
    expect(previewed.preview?.accepted.map((each) => each.proposalId)).toEqual([
      'fx.q1.grouped',
      'fx.q1.chain',
    ])
    expect(previewed.preview?.refused).toEqual([])
    // A preview never changes the board.
    expect(previewed.applied).toBeUndefined()

    await board.send(Message.ClickedApplyProposal())
    const applied = board.model()

    expect(applied.applied?.proposalId).toBe('fx.q1.grouped')
    expect(applied.arrangement?.paneOrder).toEqual(['surface.blockers', 'inspector.evidence'])
    expect(applied.preview).toBeUndefined()

    const resolved = resolveFrame({
      project: applied.project,
      applied: applied.applied!,
      arrangement: applied.arrangement!,
      pins: applied.pins,
    })

    const surface = resolved.panes[0]!
    expect(surface.component).toBe('groupedList')
    expect(surface.groups.map((group) => group.label)).toEqual([
      'Security review (SEC-441)',
      'Finance (licence export)',
      'Vendor (lockdown window)',
      'Steering group (wave 2 scope)',
      'Known Folder Move stays on the pilot group only',
    ])

    const first = surface.groups[0]!.records[0]!
    expect(first.title).toBe('Finish tenant baseline policy scan')
    expect(first.statusLine).toBe('Blocked · waiting on Security review (SEC-441)')
    expect(first.sources[0]!.title).toBe('SEC-441 · Baseline policy scan findings')
  })

  it('lets the user rearrange, and undo only the arrangement', async () => {
    const board = session()
    await board.send(Message.ClickedAsk({ question: 'q_blocking_groups' }))
    await board.send(Message.ClickedApplyProposal())

    const before = firstPaneGroupIds(board.model())

    await board.send(Message.ClickedMoveGroup({
      paneId: 'surface.blockers',
      groupId: 'party_finance',
      direction: 'front',
    }))
    const moved = board.model()
    expect(firstPaneGroupIds(moved)).toEqual([
      'party_finance',
      ...before.filter((id) => id !== 'party_finance'),
    ])
    expect(moved.arrangementHistory).toHaveLength(1)

    await board.send(Message.ClickedMoveRecord({
      paneId: 'surface.blockers',
      groupId: before[1] === 'party_security_review' ? 'party_security_review' : before[0]!,
      recordId: 'task_mailbox_pilot',
      direction: 'up',
    }))
    expect(board.model().arrangementHistory).toHaveLength(2)

    await board.send(Message.ClickedUndoArrangement())
    expect(firstPaneGroupIds(board.model())).toEqual([
      'party_finance',
      ...before.filter((id) => id !== 'party_finance'),
    ])

    await board.send(Message.ClickedUndoArrangement())
    expect(firstPaneGroupIds(board.model())).toEqual(before)
    expect(board.model().arrangementHistory).toHaveLength(0)

    // Undo walks arrangement steps only; the applied frame is untouched.
    expect(board.model().applied?.proposalId).toBe('fx.q1.grouped')
  })

  it('keeps the selected record and its source link across view changes', async () => {
    const board = session()
    await board.send(Message.ClickedAsk({ question: 'q_blocking_groups' }))
    await board.send(Message.ClickedApplyProposal())

    await board.send(Message.ClickedSelectRecord({ recordId: 'task_tenant_baseline' }))
    await board.send(Message.ClickedOpenSource({
      recordId: 'task_tenant_baseline',
      sourceId: 'src_standup_0311',
    }))

    const selected = resolveInspector({
      project: board.model().project,
      selection: board.model().selection,
      pins: board.model().pins,
    })
    expect(selected.record?.title).toBe('Finish tenant baseline policy scan')
    expect(selected.openSourceId).toBe('src_standup_0311')

    // Ask again, switch to the other answer, and apply it.
    await board.send(Message.ClickedAsk({ question: 'q_blocking_groups' }))
    await board.send(Message.ClickedInspectProposal({ index: 1 }))
    await board.send(Message.ClickedApplyProposal())
    expect(board.model().applied?.proposalId).toBe('fx.q1.chain')

    const after = resolveInspector({
      project: board.model().project,
      selection: board.model().selection,
      pins: board.model().pins,
    })
    expect(after.record?.id).toBe('task_tenant_baseline')
    expect(after.openSourceId).toBe('src_standup_0311')
  })
})

describe('question 2 — which decisions lack evidence', () => {
  it('previews two proposals built on the same contract and shows the gap', async () => {
    const board = session()

    await board.send(Message.ClickedAsk({ question: 'q_decisions_without_evidence' }))
    const previewed = board.model()

    expect(previewed.preview?.accepted.map((each) => each.proposalId)).toEqual([
      'fx.q2.gap',
      'fx.q2.risk',
    ])

    await board.send(Message.ClickedApplyProposal())
    const applied = board.model()

    const resolved = resolveFrame({
      project: applied.project,
      applied: applied.applied!,
      arrangement: applied.arrangement!,
      pins: applied.pins,
    })

    const unassigned = resolved.panes[0]!.groups.find((group) => group.id === 'unassigned')
    expect(unassigned?.label).toBe('No waitlist recorded')
    expect(unassigned?.records.map((record) => record.id)).toEqual([
      'dec_resource_accounts',
      'dec_room_rename',
    ])
    expect(unassigned?.records[0]!.detail).toBe('No source excerpt is attached to this decision.')
  })

  it('answers a follow-up turn from the shared board, and from nothing when sharing is off', async () => {
    const board = session()
    await board.send(Message.ClickedAsk({ question: 'q_decisions_without_evidence' }))
    await board.send(Message.ClickedApplyProposal())

    await board.send(Message.ClickedRunTurn())
    const shared = board.model()
    expect(shared.turns).toHaveLength(1)
    expect(shared.turns[0]!.boardIncluded).toBe(true)
    expect(shared.turns[0]!.request.boardSnapshot).toBeDefined()
    expect(shared.turns[0]!.reply).toContain('no source excerpt')

    await board.send(Message.ClickedToggleSharing())
    await board.send(Message.ClickedRunTurn())
    const withheld = board.model().turns[0]!

    expect(withheld.boardIncluded).toBe(false)
    expect('boardSnapshot' in withheld.request).toBe(false)
    expect(withheld.reply).toContain('carried no board snapshot')
    expect(withheld.recordIds).toEqual([])
  })

  it('caps the snapshot and reports what the caps touched', async () => {
    const board = session()
    await board.send(Message.ClickedRunTurn())
    const snapshot = board.model().turns[0]!.request.boardSnapshot!

    const tasks = snapshot.records.filter((record) => record.kind === 'task')
    const decisions = snapshot.records.filter((record) => record.kind === 'decision')
    expect(tasks.length).toBeLessThanOrEqual(8)
    expect(decisions.length).toBeLessThanOrEqual(8)
    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(3_600)
    expect(snapshot.omittedRecordIds.length + snapshot.records.length).toBe(
      fixtureProject().tasks.length + fixtureProject().decisions.length,
    )
  })
})

describe('records, saved views and the ordinary host action', () => {
  let board: ReturnType<typeof session>

  beforeEach(async () => {
    board = session()
    await board.send(Message.ClickedAsk({ question: 'q_blocking_groups' }))
    await board.send(Message.ClickedApplyProposal())
    await board.send(Message.ClickedSelectRecord({ recordId: 'task_mailbox_pilot' }))
  })

  it('marks a task done through the record, not the view', async () => {
    const revisionBefore = board.model().project.revision

    await board.send(Message.ClickedMarkTaskDone({ taskId: 'task_mailbox_pilot' }))
    const after = board.model()

    const task = after.project.tasks.find((each) => each.id === 'task_mailbox_pilot')!
    expect(task.status).toBe('done')
    expect(task.revision).toBe(3)
    expect(after.project.revision).toBe(revisionBefore + 1)
    expect(after.project.audit.at(-1)?.auditKind).toBe('task_status_changed')

    // The open frame re-resolves: the same proposal now says Done.
    const resolved = resolveFrame({
      project: after.project,
      applied: after.applied!,
      arrangement: after.arrangement!,
      pins: after.pins,
    })
    const shown = resolved.panes
      .flatMap((pane) => pane.groups.flatMap((group) => group.records))
      .find((record) => record.id === 'task_mailbox_pilot')
    expect(shown?.statusLine).toMatch(/^Done/)
  })

  it('saves an arrangement by name and reopens it against the updated records', async () => {
    await board.send(Message.ChangedViewName({ value: '  blockers by waitlist  ' }))
    await board.send(Message.ClickedSaveView())

    expect(board.model().savedViews.map((view) => view.name)).toEqual(['blockers by waitlist'])
    expect(board.model().viewNameDraft).toBe('')

    // The board moves on underneath the saved arrangement.
    await board.send(Message.ClickedMarkTaskDone({ taskId: 'task_mailbox_pilot' }))

    await board.send(Message.ClickedOpenSavedView({ name: 'blockers by waitlist' }))
    const reopened = board.model()

    expect(reopened.applied?.proposalId).toBe('fx.q1.grouped')
    expect(reopened.selection.recordId).toBe('task_mailbox_pilot')

    const resolved = resolveFrame({
      project: reopened.project,
      applied: reopened.applied!,
      arrangement: reopened.arrangement!,
      pins: reopened.pins,
    })
    const shown = resolved.panes
      .flatMap((pane) => pane.groups.flatMap((group) => group.records))
      .find((record) => record.id === 'task_mailbox_pilot')
    expect(shown?.statusLine).toMatch(/^Done/)
  })

  it('refuses to save a view with an empty name', async () => {
    await board.send(Message.ChangedViewName({ value: '   ' }))
    await board.send(Message.ClickedSaveView())
    expect(board.model().savedViews).toEqual([])
    expect(board.model().notices[0]?.text).toContain('Give the view a name')
  })

  it('survives a reload, resolving the saved arrangement against current records', async () => {
    await board.send(Message.ChangedViewName({ value: 'resume' }))
    await board.send(Message.ClickedSaveView())
    await board.send(Message.ClickedMarkTaskDone({ taskId: 'task_mailbox_pilot' }))
    await board.send(Message.ClickedTogglePin({ recordId: 'dec_security_gate' }))

    const stored = encodePersisted(board.model())
    const restored = decodePersisted(stored)
    expect(restored._tag).toBe('Restored')
    if (restored._tag !== 'Restored') return

    const reloaded = modelOf(restored.state, { runtimeRouteConfigured: false })

    expect(reloaded.savedViews.map((view) => view.name)).toEqual(['resume'])
    expect(reloaded.selection).toEqual({ recordId: 'task_mailbox_pilot' })
    expect(reloaded.pins).toEqual(['dec_security_gate'])
    expect(reloaded.project.revision).toBe(board.model().project.revision)
    expect(reloaded.providerMode).toBe('fixture')

    // Reopening the saved arrangement after reload resolves the new status.
    const resolved = resolveFrame({
      project: reloaded.project,
      applied: reloaded.applied!,
      arrangement: reloaded.arrangement!,
      pins: reloaded.pins,
    })
    const shown = resolved.panes
      .flatMap((pane) => pane.groups.flatMap((group) => group.records))
      .find((record) => record.id === 'task_mailbox_pilot')
    expect(shown?.statusLine).toMatch(/^Done/)
  })

  it('persists after a record change so a reload lands in the same place', async () => {
    await board.send(Message.ClickedMarkTaskDone({ taskId: 'task_mailbox_pilot' }))

    const raw = globalThis.localStorage.getItem('blackboard.foldkit-workbench.v1')
    expect(raw).toBeTruthy()
    const restored = decodePersisted(raw!)
    expect(restored._tag).toBe('Restored')
    if (restored._tag !== 'Restored') return
    expect(restored.state.project.tasks.find((task) => task.id === 'task_mailbox_pilot')?.status).toBe(
      'done',
    )
  })
})
