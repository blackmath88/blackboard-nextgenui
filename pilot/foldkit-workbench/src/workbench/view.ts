/**
 * The workbench view.
 *
 * It is a plain function of the Model, and it resolves every visible word from
 * the accepted records. Where a frame names something the project no longer
 * has, the view says "unresolved" instead of hiding the gap or inventing text.
 */

import type { Document, HtmlBuilder } from 'foldkit/html'
import { Option } from 'effect'
import { checklistKey } from './chat.js'
import { chatMarkdown } from './chat-markdown.js'
import { FollowChat } from './chat-scroll.js'

import {
  type Probe,
  type QuestionId,
  paneComponentLabel,
  questionPrompt,
  reasonCopy,
} from '../generation/proposal.js'
import { probeDescription, probeKinds, probeLabel } from '../generation/fixtureProposals.js'
import { type TurnRequest, buildTurnRequest, prettyTurnRequest } from '../generation/turn.js'
import { findRecord } from '../project/records.js'
import type { Model, Proposal } from './model.js'
import { Message } from './message.js'
import { unresolvedReferences } from './persistence.js'
import {
  type ResolvedGroup,
  type ResolvedPane,
  type ResolvedRecord,
  resolveFrame,
  resolveInspector,
} from './resolve.js'

export type ViewDeps = Readonly<{
  /** Render the Model as it was received on reload, for the restore notice. */
  restoreNote: string | undefined
}>

const probeTitles: Readonly<Record<Probe, string>> = Object.fromEntries(
  probeKinds.map((kind) => [kind, probeDescription(kind)]),
) as Readonly<Record<Probe, string>>

const questions: ReadonlyArray<{ id: QuestionId; short: string }> = [
  { id: 'q_blocking_groups', short: 'What is blocking rollout readiness, grouped by what we are waiting on?' },
  { id: 'q_decisions_without_evidence', short: 'Which decisions lack evidence?' },
]

export const view = (model: Model, h: HtmlBuilder<Message>, deps: ViewDeps): Document => {
  const t = (value: string) => value
  const button = (label: string, message: Message, extra: Parameters<HtmlBuilder<Message>['button']>[0] = []) =>
    h.button([...extra, h.Type('button'), h.OnClick(message)], [label])

  const inspector = resolveInspector({ project: model.project, selection: model.selection, pins: model.pins })
  const frame =
    model.applied === undefined || model.arrangement === undefined
      ? undefined
      : resolveFrame({
          project: model.project,
          applied: model.applied,
          arrangement: model.arrangement,
          pins: model.pins,
        })

  // ---------------------------------------------------------------- chrome
  const header = h.header([h.Class('bar')], [
    h.div([], [
      h.h1([], ['Blackboard — runtime workbench']),
      h.p([h.Class('sub')], [
        model.project.name,
        ' · fixture project · revision ',
        t(String(model.project.revision)),
      ]),
    ]),
    h.div([h.Class('badges')], [
      h.span([h.Class('badge fixture')], ['FIXTURE MODE — no real tenant, no credentials']),
      h.span([h.Class('badge')], [`provider: ${model.providerMode}`]),
      h.span([h.Class('badge')], [`sharing: ${model.sharing ? 'on' : 'off'}`]),
      h.span([h.Class('badge')], [`revision ${model.project.revision}`]),
      ...(model.persistenceFailed
        ? [h.span([h.Class('badge bad')], ['local save FAILED — this tab will not reopen'])]
        : []),
      ...(model.requesting ? [h.span([h.Class('badge busy')], ['waiting on provider…'])] : []),
    ]),
  ])

  const restoreNote = model.providerMode === 'runtime' ? undefined : deps.restoreNote
  const notices =
    model.notices.length === 0 && restoreNote === undefined
      ? h.div([], [])
      : h.section([h.Class('notices'), h.Role('status')], [
          ...(restoreNote === undefined
            ? []
            : [h.div([h.Class('notice info')], [restoreNote])]),
          ...model.notices.map((notice) =>
            h.div([h.Class(`notice ${notice.tone}`)], [
              h.small([], [notice.at]),
              ' ',
              notice.text,
            ]),
          ),
          button('Dismiss', Message.ClickedDismissNotices(), [h.Class('ghost')]),
        ])

  // ---------------------------------------------------------------- controls
  const questionControls = h.section([h.Class('panel questions')], [
    h.h2([], ['Ask the runtime']),
    h.p([h.Class('hint')], ['Both questions go through the same structured-output contract and the same host-side validation.']),
    ...questions.map((question) =>
      h.div([h.Class('qrow')], [
        button(
          question.short,
          Message.ClickedAsk({ question: question.id }),
          [h.Class(model.question === question.id ? 'primary on' : 'primary')],
        ),
      ]),
    ),
    h.p([h.Class('hint')], ['Reply probe — inject a known defect into the fixture reply:']),
    h.div([h.Class('probes')], [
      ...probeKinds.map((kind) =>
        h.button(
          [h.Type('button'), h.Class(model.probe === kind ? 'probe on' : 'probe'), h.Title(probeTitles[kind]), h.OnClick(Message.ChangedProbe({ probe: kind }))],
          [probeLabel(kind)],
        ),
      ),
    ]),
  ])

  const settings = h.section([h.Class('panel settings')], [
    h.h2([], ['Host settings']),
    h.p([h.Class('hint')], [
      model.runtimeRouteConfigured
        ? 'UniBas generates views from the original synthetic fixture. Follow-up simulation runs locally.'
        : 'Views and follow-up simulation use the deterministic fixture provider.',
    ]),
    button(
      model.sharing ? 'Sharing: include accepted board records' : 'Sharing: off — send no board records',
      Message.ClickedToggleSharing(),
      [h.Class(model.sharing ? 'toggle on' : 'toggle')],
    ),
    h.p([h.Class('hint')], [
      'When sharing is off the request carries no ',
      h.code([], ['boardSnapshot']),
      ' field at all — never an empty one.',
    ]),
    h.div([h.Class('row')], [
      button('Run next turn', Message.ClickedRunTurn(), [h.Class('primary')]),
      button('Reset fixture', Message.ClickedReset(), [h.Class('ghost')]),
    ]),
  ])

  // ---------------------------------------------------------------- preview
  const previewPanel = (): ReturnType<HtmlBuilder<Message>['section']> => {
    const preview = model.preview
    if (preview === undefined) {
      return h.section([h.Class('panel preview empty')], [
        h.h2([], ['Preview']),
        h.p([h.Class('hint')], ['Nothing pending. Ask a question: the reply is decoded, validated against the records, and only then offered for apply.']),
      ])
    }

    const selected: Proposal | undefined = preview.accepted[preview.selectedIndex]

    return h.section([h.Class('panel preview')], [
      h.h2([], ['Preview — not applied yet']),
      h.p([h.Class('hint')], [`${preview.accepted.length} accepted, ${preview.refused.length} refused. Refused proposals are never offered for apply.`]),
      h.div([h.Class('row')], [
        ...preview.accepted.map((proposal, index) =>
          h.button(
            [h.Type('button'), h.Class(index === preview.selectedIndex ? 'chip on' : 'chip'), h.OnClick(Message.ClickedInspectProposal({ index }))],
            [proposal.proposalId],
          ),
        ),
      ]),
      ...(selected === undefined
        ? [h.p([h.Class('hint')], ['Nothing to inspect.'])]
        : [
            h.dl([h.Class('detail')], [
              h.dt([], ['Foregrounds']),
              h.dd([], [selected.foreground === 'workSurface' ? 'the work surface' : 'the evidence inspector']),
              h.dt([], ['Because']),
              h.dd([], [reasonCopy(selected.reason)]),
              h.dt([], ['Panes']),
              h.dd([], [selected.panes.map((pane) => `${pane.id} (${paneComponentLabel(pane.component)})`).join(' + ')]),
              h.dt([], ['Groups']),
              h.dd([], [selected.panes.map((pane) => `${pane.id}: ${pane.groups.length}`).join(' · ')]),
              h.dt([], ['Actions asked for']),
              h.dd([], [selected.actions.join(', ')]),
              h.dt([], ['Drawn against']),
              h.dd([], [`revision ${t(String(selected.baseRevision))} — board is at ${t(String(model.project.revision))}`]),
            ]),
            h.div([h.Class('row')], [
              button('Apply this arrangement', Message.ClickedApplyProposal(), [h.Class('primary')]),
              button('Keep current view', Message.ClickedDismissPreview(), [h.Class('ghost')]),
            ]),
          ]),
      ...(preview.refused.length === 0
        ? []
        : [
            h.details([h.Open(true)], [
              h.summary([], [`${t(String(preview.refused.length))} refused in this reply`]),
              h.ul([], [
                ...preview.refused.map((refused) =>
                  h.li([h.Class('refused')], [
                    h.strong([], [refused.label]),
                    ` — ${refused.rejection.kind}`,
                    h.div([h.Class('hint')], [refused.rejection.detail]),
                    ...(refused.rejection.reference === undefined
                      ? []
                      : [h.div([h.Class('hint')], [`reference: ${refused.rejection.reference}`])]),
                  ]),
                ),
              ]),
            ]),
          ]),
    ])
  }

  // ---------------------------------------------------------------- panes
  const recordRow = (record: ResolvedRecord, paneId: string, groupId: string) =>
    h.li([h.Key(record.id), h.Class(model.selection.recordId === record.id ? 'rec selected' : 'rec')], [
      h.div([h.Class('rec-head')], [
        h.button(
          [h.Type('button'), h.Class('rec-title'), h.OnClick(Message.ClickedSelectRecord({ recordId: record.id }))],
          [record.title],
        ),
        h.span([h.Class('chip tiny')], [record.kind === 'task' ? 'Task' : 'Decision']),
        ...(record.pinned ? [h.span([h.Class('chip tiny')], ['pinned'])] : []),
        h.small([h.Class('mono')], [record.id]),
      ]),
      h.p([h.Class('status')], [record.statusLine]),
      h.p([h.Class('hint')], [record.detail]),
      h.p([h.Class('hint')], [record.followUp]),
      h.div([h.Class('row tight')], [
        record.sources.length === 0
          ? h.span([h.Class('chip warn tiny')], ['no evidence attached'])
          : h.span([h.Class('chip tiny')], [`${t(String(record.sources.length))} excerpt(s)`]),
        ...(record.kind === 'task'
          ? [button('Mark done', Message.ClickedMarkTaskDone({ taskId: record.id }), [h.Class('small')])]
          : []),
        button(record.pinned ? 'Unpin' : 'Pin', Message.ClickedTogglePin({ recordId: record.id }), [h.Class('small ghost')]),
        button('↑', Message.ClickedMoveRecord({ paneId, groupId, recordId: record.id, direction: 'up' }), [h.Class('tinybtn')]),
        button('↓', Message.ClickedMoveRecord({ paneId, groupId, recordId: record.id, direction: 'down' }), [h.Class('tinybtn')]),
      ]),
      ...(record.sources.length === 0
        ? []
        : [
            h.ul([h.Class('sources')], [
              ...record.sources.map((source) =>
                h.li([h.Key(source.id)], [
                  h.button(
                    [h.Type('button'), h.Class('link'), h.OnClick(Message.ClickedOpenSource({ recordId: record.id, sourceId: source.id }))],
                    [source.title],
                  ),
                  ...(model.selection.recordId === record.id && model.selection.sourceId === source.id
                    ? [h.blockquote([], [source.excerpt])]
                    : []),
                ]),
              ),
            ]),
          ]),
    ])

  const groupBlock = (pane: ResolvedPane, group: ResolvedGroup) =>
    h.section([h.Key(group.id), h.Class('group')], [
      h.h4([], [
        group.label,
        h.span([h.Class('chip tiny')], [
          group.kind === 'party' ? 'waitlist party' : group.kind === 'unassigned' ? 'host constant' : 'record',
        ]),
      ]),
      ...(group.via === undefined ? [] : [h.p([h.Class('hint via')], [`edge in records: ${group.via}`])]),
      h.div([h.Class('row tight')], [
        button('↑', Message.ClickedMoveGroup({ paneId: pane.id, groupId: group.id, direction: 'up' }), [h.Class('tinybtn')]),
        button('↓', Message.ClickedMoveGroup({ paneId: pane.id, groupId: group.id, direction: 'down' }), [h.Class('tinybtn')]),
        button('top', Message.ClickedMoveGroup({ paneId: pane.id, groupId: group.id, direction: 'front' }), [h.Class('tinybtn')]),
      ]),
      ...(group.unresolved.length === 0
        ? []
        : [
            h.p([h.Class('unresolved')], [
              `unresolved in this project: ${group.unresolved.join(', ')} — kept visible, not invented`,
            ]),
          ]),
      h.ul([], [...group.records.map((record) => recordRow(record, pane.id, group.id))]),
    ])

  const paneBlock = (pane: ResolvedPane, index: number, total: number) =>
    h.section([h.Key(pane.id), h.Class(pane.focused ? 'pane focused' : 'pane')], [
      h.h3([], [
        `${t(String(index + 1))}. ${pane.id}`,
        h.span([h.Class('chip tiny')], [paneComponentLabel(pane.component)]),
        h.span([h.Class('chip tiny')], [pane.role === 'workSurface' ? 'work surface' : 'inspector']),
      ]),
      h.div([h.Class('row tight')], [
        button('focus', Message.ClickedFocusPane({ paneId: pane.id }), [h.Class('small ghost')]),
        button('↑ pane', Message.ClickedMovePane({ paneId: pane.id, direction: 'up' }), [h.Class('tinybtn')]),
        button('↓ pane', Message.ClickedMovePane({ paneId: pane.id, direction: 'down' }), [h.Class('tinybtn')]),
        ...(index === 0 ? [] : [button('first', Message.ClickedMovePane({ paneId: pane.id, direction: 'front' }), [h.Class('tinybtn')])]),
        ...(index === total - 1 ? [] : [button('last', Message.ClickedMovePane({ paneId: pane.id, direction: 'back' }), [h.Class('tinybtn')])]),
      ]),
      ...pane.groups.map((group) => groupBlock(pane, group)),
    ])

  const framePanel = (): ReturnType<HtmlBuilder<Message>['section']> => {
    if (model.applied === undefined || frame === undefined) {
      return h.section([h.Class('panel board')], [
        h.h2([], ['Plain board']),
        h.p([h.Class('hint')], ['No generated frame applied yet. The plain board is always available; record actions work here too.']),
        h.ul([], [
          ...model.project.tasks.map((task) =>
            h.li([h.Key(task.id)], [
              h.button([h.Type('button'), h.Class('link'), h.OnClick(Message.ClickedSelectRecord({ recordId: task.id }))], [task.title]),
              ' — ',
              task.status,
              button('Mark done', Message.ClickedMarkTaskDone({ taskId: task.id }), [h.Class('small')]),
            ]),
          ),
          ...model.project.decisions.map((decision) =>
            h.li([h.Key(decision.id)], [
              h.button([h.Type('button'), h.Class('link'), h.OnClick(Message.ClickedSelectRecord({ recordId: decision.id }))], [decision.title]),
              ' — ',
              decision.status,
            ]),
          ),
        ]),
      ])
    }

    const dangling = unresolvedReferences({ project: model.project, applied: model.applied })

    return h.section([h.Class('panel frame')], [
      h.h2([], [`Applied frame — ${t(model.applied.proposalId)}`]),
      h.p([h.Class('hint')], [
        'Arranging is your own state, kept apart from the proposal. Undo only walks the arrangement steps.',
      ]),
      h.div([h.Class('row')], [
        button('Undo arrangement', Message.ClickedUndoArrangement(), [h.Class('ghost')]),
        h.small([], [`${t(String(model.arrangementHistory.length))} step(s) undoable`]),
      ]),
      ...(dangling.length === 0
        ? []
        : [h.p([h.Class('unresolved')], [`this frame references IDs the project no longer has: ${dangling.join(', ')}`])]),
      ...frame.panes.map((pane, index) => paneBlock(pane, index, frame.panes.length)),
    ])
  }

  // ---------------------------------------------------------------- saved views
  const savedPanel = h.section([h.Class('panel saved')], [
    h.h2([], ['Saved arrangements']),
    h.div([h.Class('row')], [
      h.input([
        h.Type('text'),
        h.Placeholder('name this arrangement'),
        h.Value(model.viewNameDraft),
        h.OnInput((value) => Message.ChangedViewName({ value })),
        h.Class('name'),
      ]),
      button('Save view', Message.ClickedSaveView(), [h.Class('primary')]),
    ]),
    h.p([h.Class('hint')], ['A saved view stores the frame definition plus your arrangement and selection — not a picture of the board.']),
    model.savedViews.length === 0
      ? h.p([h.Class('hint')], ['Nothing saved yet.'])
      : h.ul([h.Class('savedlist')], [
          ...model.savedViews.map((saved) =>
            h.li([h.Key(saved.name)], [
              h.strong([], [saved.name]),
              h.small([], [` · ${saved.questionId} · ${saved.proposalId} · saved ${saved.savedAt}`]),
              h.div([h.Class('row tight')], [
                button('Open', Message.ClickedOpenSavedView({ name: saved.name }), [h.Class('small')]),
                button('Drop', Message.ClickedDropSavedView({ name: saved.name }), [h.Class('small ghost')]),
              ]),
            ]),
          ),
        ]),
  ])

  // ---------------------------------------------------------------- inspector
  const inspectorPanel = h.section([h.Class('panel inspector')], [
    h.h2([], ['Record inspector']),
    ...(inspector.danglingRecordId === undefined
      ? []
      : [h.p([h.Class('unresolved')], [`the stored selection points at ${inspector.danglingRecordId}, which this project no longer has`])]),
    ...(inspector.record === undefined
      ? [h.p([h.Class('hint')], ['No record selected. Selection is stored as an ID, so it survives preview, apply, rearranging and reload.'])]
      : [
          h.h3([], [inspector.record.title]),
          h.p([h.Class('hint mono')], [`${inspector.record.id} · ${t(String(inspector.record.revision))} · rev · updated ${inspector.record.updatedAt}`]),
          h.p([h.Class('status')], [inspector.record.statusLine]),
          h.p([], [inspector.record.detail]),
          h.p([h.Class('hint')], [inspector.record.followUp]),
          ...(inspector.record.kind === 'task'
            ? [button('Mark done', Message.ClickedMarkTaskDone({ taskId: inspector.record.id }), [h.Class('primary')])]
            : []),
          ...(inspector.record.sources.length === 0
            ? [h.p([h.Class('chip warn')], ['no evidence attached — this is what the second question is about'])]
            : [
                h.h4([], ['Evidence']),
                h.ul([h.Class('sources')], [
                  ...inspector.record.sources.map((source) =>
                    h.li([h.Key(source.id)], [
                      h.button(
                        [h.Type('button'), h.Class('link'), h.OnClick(Message.ClickedOpenSource({ recordId: inspector.record!.id, sourceId: source.id }))],
                        [source.title],
                      ),
                      ...(inspector.openSourceId === source.id
                        ? [h.blockquote([], [source.excerpt])]
                        : []),
                    ]),
                  ),
                ]),
              ]),
        ]),
    ...(model.pins.length === 0
      ? []
      : [
          h.h4([], ['Pinned']),
          h.ul([h.Class('pins')], [
            ...model.pins.map((pin) =>
              h.li([h.Key(pin)], [
                h.button([h.Type('button'), h.Class('link'), h.OnClick(Message.ClickedSelectRecord({ recordId: pin }))], [pin]),
                button('unpin', Message.ClickedTogglePin({ recordId: pin }), [h.Class('small ghost')]),
              ]),
            ),
          ]),
        ]),
  ])

  // ---------------------------------------------------------------- turns
  const turnsPanel = h.section([h.Class('panel turns')], [
    h.h2([], ['Requests and replies']),
    h.p([h.Class('hint')], ['The payload the host composed is inspectable. Model text never becomes a label, a status or an excerpt.']),
    model.turns.length === 0
      ? h.p([h.Class('hint')], ['No turn sent yet.'])
      : h.ul([h.Class('turns')], [
          ...model.turns.map((turn) =>
            h.li([h.Key(turn.id)], [
              h.div([h.Class('turn-head')], [
                h.strong([], [turn.id]),
                h.span([h.Class('chip tiny')], [turn.source]),
                h.span([h.Class('chip tiny')], [turn.boardIncluded ? 'board snapshot included' : 'no board snapshot']),
                h.small([], [turn.at]),
              ]),
              h.p([], [turn.reply]),
              ...(turn.recordIds.length === 0
                ? []
                : [
                    h.p([h.Class('hint')], ['names: ']),
                    h.ul([h.Class('refs')], [
                      ...turn.recordIds.map((id) =>
                        h.li([h.Key(id)], [
                          h.button([h.Type('button'), h.Class('link'), h.OnClick(Message.ClickedSelectRecord({ recordId: id }))], [id]),
                          ...(findRecord(model.project, id) === undefined ? [' — not in this project'] : []),
                        ]),
                      ),
                    ]),
                  ]),
              h.details([], [
                h.summary([], ['request payload']),
                h.pre([h.Class('payload')], [prettyTurnRequest(turn.request)]),
              ]),
            ]),
          ),
        ]),
  ])

  const currentRequest: TurnRequest =
    model.turns[0]?.request ??
    buildTurnRequest({
      project: model.project,
      question: questionPrompt(model.question),
      questionId: model.question,
      sharing: model.sharing,
      selection:
        model.selection.recordId === undefined
          ? undefined
          : {
              recordId: model.selection.recordId,
              ...(model.selection.sourceId === undefined ? {} : { sourceId: model.selection.sourceId }),
            },
    })

  const workspaceLayout = model.conversationWorkspace?.layout ?? 'summary'
  const inlineText = (text: string) => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map(part =>
    part.startsWith('**') && part.endsWith('**') ? h.strong([], [part.slice(2, -2)])
      : part.startsWith('`') && part.endsWith('`') && part.length > 1 ? h.code([], [part.slice(1, -1)])
        : part,
  )
  const renderAnswer = (text: string) => chatMarkdown(text).map(block => {
    switch (block.kind) {
      case 'heading': return h.h3([], inlineText(block.text))
      case 'code': return h.pre([], [h.code([], [block.text])])
      case 'ordered': return h.ol([], block.items.map(item => h.li([], inlineText(item))))
      case 'unordered': return h.ul([], block.items.map(item => h.li([], inlineText(item))))
      case 'paragraph': return h.p([], inlineText(block.text))
    }
  })
  const renderTask = (task: Model['workspaceTasks'][number]) => h.li([h.Key(task.id)], [
    h.label([], [h.input([h.Type('checkbox'), h.Checked(task.done),
      h.OnClick(Message.ToggledChatItem({ key: task.id }))]), ' ', task.title]),
    h.details([], [
      h.summary([], ['Edit or trace']),
      h.input([h.Class('name'), h.AriaLabel('Task title'), h.Value(task.title),
        h.OnChange(title => Message.RenamedWorkspaceTask({ id: task.id, title }))]),
      ...(task.sourceMessageId && model.conversation.some(message => message.id === task.sourceMessageId)
        ? [h.a([h.Href('#' + encodeURIComponent(task.sourceMessageId))], ['Jump to source message'])]
        : []),
      ...(task.source ? [h.blockquote([], [task.source])] : []),
    ]),
  ])

  if (model.providerMode === 'runtime') return {
    title: 'Blackboard',
    body: h.main([h.Class('wb blank-workbench show-' + model.mobilePane)], [
      h.nav([h.Class('mobile-panes'), h.AriaLabel('Choose pane')], [
        button('Chat', Message.SelectedMobilePane({ pane: 'chat' }), [h.AriaPressed(String(model.mobilePane === 'chat'))]),
        button(model.proposedWorkspace ? 'Workspace · New' : 'Workspace',
          Message.SelectedMobilePane({ pane: 'workspace' }), [h.AriaPressed(String(model.mobilePane === 'workspace'))]),
      ]),
      h.section([h.Class('col conversation live-chat'), h.AriaLabel('Chat')], [
        h.h2([], ['Conversation']),
        h.ol([h.Class('conversation-history'), h.OnMount(FollowChat())], [
          ...model.conversation.map(({ id, role, text }) =>
          h.li(id ? [h.Id(id), h.Key(id)] : [], [h.strong([], [role === 'user' ? 'You' : 'Blackboard']),
            ...(role === 'user' ? [h.p([], [text])] : renderAnswer(text))]),
          ),
          ...(model.partialReply ? [h.li([], [h.strong([], ['Blackboard']), ...renderAnswer(model.partialReply)])] : []),
        ]),
        ...(model.requesting ? [h.p([h.Class('chat-progress'), h.Role('status')], [
          model.partialReply ? 'Writing reply…' : 'Waiting for Qwen…',
        ])] : []),
        ...(model.chatStopped ? [h.p([h.Class('chat-progress'), h.Role('status')], ['Response stopped.'])] : []),
        ...(model.chatFailed ? [h.p([h.Role('status')], ['Qwen couldn’t complete the reply.'])] : []),
        ...(!model.requesting && model.conversation.at(-1)?.role === 'user'
          ? [h.div([], [button('Retry last message', Message.RetriedChat(), [h.Class('ghost')])])]
          : []),
        h.form([h.Class('chat-composer'), h.OnSubmit(Message.SubmittedChat())], [
          h.textarea([h.AriaLabel('Message'), h.Placeholder('Start a conversation…'), h.Rows(2), h.Maxlength(500),
            h.Value(model.chatDraft), h.OnInput((value) => Message.ChangedChatDraft({ value })),
            h.OnKeyDownPreventDefault((key, modifiers) =>
              key === 'Enter' && !modifiers.shiftKey && !modifiers.ctrlKey && !modifiers.altKey && !modifiers.metaKey
                ? Option.some(Message.SubmittedChat()) : Option.none(),
            )]),
          model.requesting ? button('Stop', Message.StoppedChat()) :
            h.button([h.Type('submit'), h.Class('primary'), h.Disabled(!model.chatDraft.trim())], ['Send']),
        ]),
        h.small([h.Class('hint')], ['Messages are sent to UniBas Qwen. Use synthetic or public information.']),
      ]),
      h.section([h.Class('col conversation live-workspace'), h.AriaLabel('Workspace')], [
        ...(model.notices.length ? [notices] : []),
        ...(model.proposedWorkspace ? [h.section([h.Class('workspace-proposal')], [
          h.h2([], ['Suggested workspace']),
          h.p([], [model.proposedWorkspace.title]),
          h.details([], [
            h.summary([], ['Preview contents']),
            ...model.proposedWorkspace.sections.map(section => h.section([], [
              h.h3([], [section.title]),
              h.ul([], section.items.map(item => h.li([], [item]))),
            ])),
          ]),
          h.div([h.Class('row')], [
            button('Apply view', Message.AppliedChatWorkspace(), [h.Class('primary')]),
            button('Decline', Message.DismissedChatWorkspace()),
          ]),
        ])] : []),
        ...(model.conversationWorkspace ? [h.div([h.Class('workspace-tools')], [
          ...(['summary', 'map', 'kanban'] as const).map(layout =>
            button(layout === 'map' ? 'Idea map' : layout === 'kanban' ? 'Kanban' : 'Summary',
              Message.ChangedWorkspaceLayout({ layout }), [h.AriaPressed(String(workspaceLayout === layout))])),
        ])] : []),
        ...(model.workspaceTasks.length || workspaceLayout === 'kanban' ? [h.section([], [
          h.h2([], ['Accepted tasks']),
          ...(model.workspaceTasks.length ? [button(model.sharing ? 'Task context on' : 'Task context off',
            Message.ClickedToggleSharing(), [h.Class('ghost small'), h.AriaPressed(String(model.sharing))])] : []),
          workspaceLayout === 'kanban' ? h.div([h.Class('workspace-kanban')], [false, true].map(done => {
            const tasks = model.workspaceTasks.filter(task => task.done === done)
            return h.section([], [
              h.h3([], [done ? 'Done' : 'Open', ' ', h.small([h.Class('hint')], [String(tasks.length)])]),
              tasks.length ? h.ul([h.Class('accepted-work')], tasks.map(renderTask)) : h.p([h.Class('hint')], [
                done ? 'Completed tasks appear here.' : 'Accept a task from the checklist below.',
              ]),
            ])
          })) : h.ul([h.Class('accepted-work')], model.workspaceTasks.map(renderTask)),
        ])] : []),
        ...(model.conversationWorkspace === null ? [] : [
        h.h2([h.Class(workspaceLayout === 'map' ? 'map-center' : '')], [model.conversationWorkspace.title]),
        ...(workspaceLayout === 'kanban' && model.conversationWorkspace.sections.some(section => section.items.length)
          ? [h.h3([], ['Suggestions'])] : []),
        h.div([h.Class(workspaceLayout === 'map' ? 'map-branches' : 'summary-sections')], model.conversationWorkspace.sections.flatMap((section) => {
          const rows = section.items.flatMap((item, index) => {
            const key = checklistKey(section, index)
            const accepted = model.workspaceTasks.find(task => task.id === key)
            if (workspaceLayout === 'kanban' && accepted) return []
            return [h.li([], section.kind !== 'checklist' ? [item] : [
              h.label([], [h.input([h.Type('checkbox'), h.Checked(accepted?.done ?? model.checkedChatItems.includes(key)),
                h.OnClick(Message.ToggledChatItem({ key }))]), ' ', accepted?.title ?? item]),
              ...(accepted ? [] : [button('Accept task', Message.AcceptedWorkspaceTask({ id: key, title: item }), [h.Class('small')])]),
            ])]
          })
          if (!rows.length) return []
          const title = workspaceLayout === 'kanban' && /^(open|done|to do|todo|in progress)$/i.test(section.title.trim())
            ? 'Suggested tasks' : section.title
          return [h.section([], [h.h3([], [title]), h.ul([], rows)])]
        })),
        ]),
        ...(model.previousWorkspace === undefined ? [] : [
          h.div([h.Class('workspace-tools')], [button('Undo view change', Message.UndidChatWorkspace())]),
        ]),
        ...(model.conversationWorkspace ? [
          h.div([h.Class('workspace-tools')], [button('Download HTML', Message.ClickedDownloadWorkspace(), [h.Class('ghost')])]),
        ] : []),
      ]),
    ]),
  }

  return {
    title: 'Blackboard · Conversation and workspace',
    body: h.div([h.Class('wb')], [
      header,
      notices,
      h.main([h.Class('chat-workspace')], [
        h.aside([h.Class('col project-nav')], [
          h.h2([], ['Projects']),
          h.p([], [model.project.name]),
          h.h2([], ['Chats']),
          h.p([], ['Rollout conversation']),
        ]),
        h.section([h.Class('col conversation')], [
          h.h2([], ['Conversation']),
          h.ol([h.Class('conversation-history'), h.AriaLive('polite')], [
            ...model.chatHistory.map((text) => h.li([], [text])),
          ]),
          h.form([h.Class('row'), h.OnSubmit(Message.SubmittedChat())], [
            h.input([
              h.Class('name'), h.AriaLabel('Message'), h.Placeholder('Ask about the rollout…'),
              h.Value(model.chatDraft), h.OnInput((value) => Message.ChangedChatDraft({ value })),
            ]),
            h.button([h.Type('submit'), h.Class('primary'), h.Disabled(model.requesting)], [
              model.requesting ? 'Working…' : 'Send',
            ]),
          ]),
          h.p([h.Class('hint')], ['Try “What’s blocking rollout?” or “Which decisions lack evidence?”']),
        ]),
        h.section([h.Class('col dynamic-workspace')], [
          h.h2([], ['Workspace']),
          previewPanel(), framePanel(), inspectorPanel, savedPanel,
          h.details([h.Class('panel')], [h.summary([], ['Workbench controls']), questionControls, settings, turnsPanel]),
        ]),
      ]),
      h.footer([h.Class('bar foot')], [
        h.h4([], ['Next request (preview)']),
        h.pre([h.Class('payload')], [prettyTurnRequest(currentRequest)]),
        h.small([h.Class('hint')], [
          'Synthetic fixture project. Nothing here touches a real Microsoft 365 tenant, and no credential is read, sent or stored.',
        ]),
      ]),
    ]),
  }
}

/** Bind the one-shot restore notice, so the view itself stays pure. */
export const viewWithRestoreNote = (restoreNote: string | undefined) => (model: Model, h: HtmlBuilder<Message>) =>
  view(model, h, { restoreNote })
