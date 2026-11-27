/**
 * The single pure update.
 *
 * The rules it enforces, stated once:
 *
 * 1. A provider reply can only name panes, components, groups and IDs. Labels,
 *    statuses and excerpts stay behind the record boundary, so a reply cannot
 *    turn a Done task into a Blocked one.
 * 2. An invalid reply is refused before it can reach the applied frame, so the
 *    last usable view and the accepted records survive untouched.
 * 3. Selection is stored as IDs, which is why it survives preview, apply,
 *    rearranging, saving and reloading.
 * 4. Arranging is the user's own state: reversible, kept apart from the
 *    proposal's grouping, never written back into a proposal.
 * 5. Every accepted change asks a Command to persist. A failed Command adds a
 *    notice and keeps the Model.
 */

import type { Command as CommandOf } from 'foldkit/command'
import type { Return as UpdateReturn } from 'foldkit/update'

import { RECORDS_IN_ANOTHER_PROJECT as foreignRecordOwners } from '../project/fixture.js'
import type { Project } from '../project/records.js'
import { auditFor, findRecord, markTaskDone } from '../project/records.js'
import { reviewProposals } from '../generation/validate.js'
import { type TurnRequest, buildTurnRequest, questionText } from '../generation/turn.js'
import { AskFrame, RunTurn, SaveFixture } from './command.js'
import { findChecklistItem, taskContext } from './chat.js'
import { type Arrangement, type Model, type Proposal, type SavedView, defaultArrangement } from './model.js'
import { Message } from './message.js'
import { StorageKey } from './persistence.js'

const MaxHistory = 25
const MaxTurns = 8
const MaxNotices = 4
const MaxSavedViews = 12
const MaxAudit = 40

/**
 * The outside world, injected once at start-up so the transition stays a plain
 * function that a test can call directly.
 */
export type WorkbenchDeps = Readonly<{
  /** Encode the fixture state for the save Command. */
  encode: (model: Model) => string
  /** The untouched fixture board, for the reset control. */
  freshProject: () => Project
  /** A loopback runtime route supplied at boot, or nothing. */
  runtimeRoute: string | undefined
  /** Timestamp source, so a test can be deterministic. */
  now: () => string
}>

type Result = UpdateReturn<Model, Message>

/** Field-level copy. The Model is immutable; this keeps the handlers short. */
const patch = <M extends object>(model: M, changes: { readonly [K in keyof M]?: M[K] | undefined }): M => ({
  ...model,
  ...changes,
})

const say = (model: Model, tone: 'info' | 'warning' | 'error', text: string, at: string): Model => ({
  ...model,
  notices: [{ at, tone, text }, ...model.notices].slice(0, MaxNotices),
})

const audited = (model: Model, entry: Parameters<typeof auditFor>[0]): Model => ({
  ...model,
  project: {
    ...model.project,
    audit: [...model.project.audit, auditFor(entry)].slice(-MaxAudit),
  },
})

const moved = <T>(
  items: ReadonlyArray<T>,
  from: number,
  direction: 'up' | 'down' | 'front' | 'back',
): ReadonlyArray<T> => {
  if (from < 0 || from >= items.length) return items
  const to =
    direction === 'up'
      ? Math.max(0, from - 1)
      : direction === 'down'
        ? Math.min(items.length - 1, from + 1)
        : direction === 'front'
          ? 0
          : items.length - 1
  if (to === from) return items
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

const historyOf = (model: Model): ReadonlyArray<Arrangement> =>
  model.arrangement === undefined
    ? model.arrangementHistory
    : [...model.arrangementHistory, model.arrangement].slice(-MaxHistory)

const selectionForRequest = (
  model: Model,
): Readonly<{ recordId: string; sourceId?: string }> | undefined =>
  model.selection.recordId === undefined
    ? undefined
    : {
        recordId: model.selection.recordId,
        ...(model.selection.sourceId === undefined ? {} : { sourceId: model.selection.sourceId }),
      }

/** Plain words for a refusal, so the user can see what the guard caught. */
const refusalText = (refused: { rejection: { detail: string } } | undefined): string =>
  refused === undefined
    ? 'The reply contained nothing this host can render.'
    : refused.rejection.detail

export const makeUpdate =
  (deps: WorkbenchDeps) =>
  (model: Model, message: Message): Result => {
    const persist = (next: Model): ReadonlyArray<CommandOf<Message>> => [
      SaveFixture({ key: StorageKey, payload: deps.encode(next) }),
    ]

    return Message.match(message, {
      ChangedChatDraft: ({ value }) => ({ model: { ...model, chatDraft: value.slice(0, 500) } }),
      SubmittedChat: () => {
        const text = model.chatDraft.trim()
        if (!text || model.requesting) return { model }
        if (model.providerMode === 'runtime') {
          const conversation = [...model.conversation, { role: 'user' as const, text }].slice(-30)
          const chatContext = model.sharing ? taskContext(model.workspaceTasks) : ''
          const next = { ...model, conversation, chatContext, chatDraft: '', requesting: true, chatFailed: false, chatStopped: false, partialReply: '' }
          return { model: next, commands: persist(next) }
        }
        const next = { ...model, chatDraft: '', chatHistory: [...model.chatHistory, text].slice(-30) }
        const question = /evidence|sources?|unsupported/i.test(text)
          ? 'q_decisions_without_evidence'
          : /block|readiness|waiting|dependenc/i.test(text)
            ? 'q_blocking_groups'
            : undefined
        if (question === undefined) {
          const explained = say(next, 'info', 'Try asking what is blocking rollout or which decisions lack evidence.', deps.now())
          return { model: explained, commands: persist(explained) }
        }
        const result = makeUpdate(deps)(next, Message.ClickedAsk({ question }))
        return { ...result, commands: [...persist(next), ...(result.commands ?? [])] }
      },
      StreamedChat: ({ text }) => ({ model: { ...model, partialReply: model.partialReply + text } }),
      StoppedChat: () => {
        if (!model.requesting || model.providerMode !== 'runtime') return { model }
        const partial = model.partialReply.trim()
        const conversation = partial ? [...model.conversation, {
          role: 'assistant' as const, text: partial + '\n\n[Response stopped]',
        }].slice(-30) : model.conversation
        const next = { ...model, conversation, requesting: false, chatStopped: true, partialReply: '' }
        return { model: next, commands: persist(next) }
      },
      ReceivedChat: ({ result }) => {
        const next = {
          ...model,
          requesting: false,
          partialReply: '',
          conversation: [...model.conversation, { role: 'assistant' as const, text: result.reply }].slice(-30),
          proposedWorkspace: result.workspace ? {
            ...result.workspace,
            source: model.conversation.at(-1)?.text ?? '',
          } : model.proposedWorkspace,
        }
        return { model: next, commands: persist(next) }
      },
      FailedChat: () => ({ model: { ...model, requesting: false, chatFailed: true } }),
      AppliedChatWorkspace: () => {
        if (!model.proposedWorkspace) return { model }
        const next = { ...model, previousWorkspace: model.conversationWorkspace,
          conversationWorkspace: model.proposedWorkspace, proposedWorkspace: null }
        return { model: next, commands: persist(next) }
      },
      UndidChatWorkspace: () => {
        if (model.previousWorkspace === undefined) return { model }
        const { previousWorkspace, ...current } = model
        const next = { ...current, conversationWorkspace: previousWorkspace }
        return { model: next, commands: persist(next) }
      },
      DismissedChatWorkspace: () => {
        const next = { ...model, proposedWorkspace: null }
        return { model: next, commands: persist(next) }
      },
      ChangedWorkspaceLayout: ({ layout }) => {
        if (!model.conversationWorkspace) return { model }
        if (model.conversationWorkspace.layout === layout) return { model }
        const next = { ...model, previousWorkspace: model.conversationWorkspace,
          conversationWorkspace: { ...model.conversationWorkspace, layout } }
        return { model: next, commands: persist(next) }
      },
      AcceptedWorkspaceTask: ({ id, title }) => {
        if (findChecklistItem(model.conversationWorkspace, id) !== title) return { model }
        if (model.workspaceTasks.some(task => task.id === id)) return { model }
        const source = model.conversationWorkspace?.source ?? ''
        const next = { ...model, workspaceTasks: [...model.workspaceTasks, {
          id, title, source, done: model.checkedChatItems.includes(id),
        }] }
        return { model: next, commands: persist(next) }
      },
      RenamedWorkspaceTask: ({ id, title }) => {
        const trimmed = title.trim().slice(0, 240)
        if (!trimmed) return { model }
        const next = { ...model, workspaceTasks: model.workspaceTasks.map(task =>
          task.id === id ? { ...task, title: trimmed } : task,
        ) }
        return { model: next, commands: persist(next) }
      },
      ToggledChatItem: ({ key }) => {
        if (model.workspaceTasks.some(task => task.id === key)) {
          const next = { ...model, workspaceTasks: model.workspaceTasks.map(task =>
            task.id === key ? { ...task, done: !task.done } : task,
          ) }
          return { model: next, commands: persist(next) }
        }
        if (findChecklistItem(model.conversationWorkspace, key) === undefined) return { model }
        const checkedChatItems = model.checkedChatItems.includes(key)
          ? model.checkedChatItems.filter(item => item !== key)
          : [...model.checkedChatItems, key]
        const next = { ...model, checkedChatItems }
        return { model: next, commands: persist(next) }
      },
      // ------------------------------------------------------------ asking
      ClickedAsk: ({ question }) => ({
        model: { ...model, question, requesting: true },
        commands: [
          AskFrame({
            question,
            projectId: model.project.id,
            baseRevision: model.project.revision,
            probe: model.probe,
            at: deps.now(),
            providerMode: model.providerMode,
            ...(deps.runtimeRoute === undefined ? {} : { runtimeBaseUrl: deps.runtimeRoute }),
          }),
        ],
      }),

      ReceivedProposals: ({ question, raw, at }) => {
        if (question !== model.question) {
          return {
            model: say(
              { ...model, requesting: false },
              'warning',
              'A reply arrived for a question you have already moved on from, so it was dropped.',
              at,
            ),
          }
        }

        const review = reviewProposals({
          responses: raw,
          context: { project: model.project, foreignRecordIds: foreignRecordOwners },
          question,
          baseRevision: model.project.revision,
        })

        if (review.accepted.length === 0) {
          return {
            model: say(
              { ...model, requesting: false },
              'error',
              `Refused the reply — nothing was offered to apply, and the view on screen is unchanged. ${refusalText(review.refused[0])}`,
              at,
            ),
          }
        }

        const refusalNotes =
          review.refused.length === 0
            ? []
            : [
                {
                  at,
                  tone: 'warning' as const,
                  text: `${review.refused.length} of the reply's proposals were refused and are not offered: ${review.refused
                    .map((refused) => `${refused.label} — ${refusalText(refused)}`)
                    .join(' ')}`,
                },
              ]

        return {
          model: {
            ...model,
            requesting: false,
            preview: {
              questionId: question,
              accepted: review.accepted,
              refused: review.refused,
              selectedIndex: 0,
              at,
            },
            notices: [...refusalNotes, ...model.notices].slice(0, MaxNotices),
          },
        }
      },

      FailedRequest: ({ message: reason, at }) => ({
        model: say(
          { ...model, requesting: false },
          'error',
          `Could not reach the provider: ${reason}. The view on screen is unchanged.`,
          at,
        ),
      }),

      // ---------------------------------------------------- preview, apply
      ClickedInspectProposal: ({ index }) => {
        const preview = model.preview
        if (preview === undefined) return { model }
        return {
          model: patch(model, {
            preview: { ...preview, selectedIndex: Math.max(0, Math.min(preview.accepted.length - 1, index)) },
          }),
        }
      },

      ClickedDismissPreview: () => {
        const next = { ...model, preview: undefined }
        return { model: next, commands: persist(next) }
      },

      ClickedApplyProposal: () => {
        const proposal: Proposal | undefined = model.preview?.accepted[model.preview.selectedIndex]
        const at = deps.now()

        if (proposal === undefined) {
          return { model: say(model, 'warning', 'There is nothing in the preview to apply.', at) }
        }

        if (proposal.baseRevision !== model.project.revision) {
          return {
            model: say(
              model,
              'error',
              `That proposal was drawn against revision ${proposal.baseRevision} and the board is at revision ${model.project.revision}, so it was not applied. The current view and the accepted records are untouched.`,
              at,
            ),
          }
        }

        const next: Model = {
          ...audited(model, {
            actor: 'fixture_model',
            action: 'frame_applied',
            recordId: proposal.proposalId,
            reasonCode: proposal.reason,
            at,
          }),
          applied: proposal,
          arrangement: defaultArrangement(proposal),
          arrangementHistory: [],
          preview: undefined,
          // Selection is deliberately untouched: it survives the view change.
        }
        return { model: next, commands: persist(next) }
      },

      // --------------------------------------------- saved arrangements
      ClickedSaveView: () => {
        const trimmed = model.viewNameDraft.trim()
        const at = deps.now()

        if (model.applied === undefined || model.arrangement === undefined) {
          return {
            model: say(model, 'warning', 'Apply a proposal first — there is nothing arranged to save yet.', at),
          }
        }
        if (trimmed.length === 0) {
          return { model: say(model, 'warning', 'Give the view a name before saving it.', at) }
        }

        const existed = model.savedViews.some((view) => view.name === trimmed)
        const view: SavedView = {
          name: trimmed,
          questionId: model.question,
          proposalId: model.applied.proposalId,
          proposal: model.applied,
          arrangement: model.arrangement,
          selection: model.selection,
          savedAt: at,
        }

        const next: Model = {
          ...audited(model, {
            actor: 'user',
            action: 'view_saved',
            recordId: model.applied.proposalId,
            reasonCode: existed ? 'saved_view_overwritten' : 'saved_view_named',
            at,
          }),
          savedViews: [view, ...model.savedViews.filter((each) => each.name !== trimmed)].slice(0, MaxSavedViews),
          viewNameDraft: '',
        }
        return {
          model: say(
            next,
            'info',
            `${existed ? 'Updated' : 'Saved'} “${trimmed}”. Reopening it resolves against whatever the records say then, not against a picture of them.`,
            at,
          ),
          commands: persist(next),
        }
      },

      ClickedOpenSavedView: ({ name }) => {
        const view = model.savedViews.find((each) => each.name === name)
        const at = deps.now()

        if (view === undefined) {
          return { model: say(model, 'warning', `No saved view called “${name}”.`, at) }
        }
        if (view.proposal.projectId !== model.project.id) {
          return {
            model: say(model, 'error', `“${name}” was built for another project, so it stays closed here.`, at),
          }
        }
        if (view.questionId !== model.question) {
          return {
            model: say(
              model,
              'info',
              `“${name}” arranges a different question. Ask that question first, then open it.`,
              at,
            ),
          }
        }

        const next: Model = {
          ...audited(model, {
            actor: 'user',
            action: 'view_opened',
            recordId: view.proposalId,
            reasonCode: 'saved_view_reopened',
            at,
          }),
          applied: view.proposal,
          arrangement: view.arrangement,
          arrangementHistory: [],
          selection: view.selection,
          preview: undefined,
        }
        return { model: next, commands: persist(next) }
      },

      ClickedDropSavedView: ({ name }) => {
        const next = patch(model, {
          savedViews: model.savedViews.filter((view) => view.name !== name),
        })
        return { model: next, commands: persist(next) }
      },

      // -------------------------------------------------------- arranging
      ClickedMovePane: ({ paneId, direction }) => {
        const arrangement = model.arrangement
        if (arrangement === undefined) return { model }
        const next: Model = {
          ...model,
          arrangementHistory: historyOf(model),
          arrangement: {
            ...arrangement,
            paneOrder: moved(arrangement.paneOrder, arrangement.paneOrder.indexOf(paneId), direction),
          },
        }
        return { model: next, commands: persist(next) }
      },

      ClickedMoveGroup: ({ paneId, groupId, direction }) => {
        const arrangement = model.arrangement
        if (arrangement === undefined) return { model }
        const entry = arrangement.groupOrder.find((each) => each.paneId === paneId)
        if (entry === undefined) return { model }
        const next: Model = {
          ...model,
          arrangementHistory: historyOf(model),
          arrangement: {
            ...arrangement,
            groupOrder: arrangement.groupOrder.map((each) =>
              each.paneId === paneId
                ? { ...each, groupIds: moved(each.groupIds, each.groupIds.indexOf(groupId), direction) }
                : each,
            ),
          },
        }
        return { model: next, commands: persist(next) }
      },

      ClickedMoveRecord: ({ paneId, groupId, recordId, direction }) => {
        const arrangement = model.arrangement
        if (arrangement === undefined || model.applied === undefined) return { model }

        const group = model.applied.panes
          .find((pane) => pane.id === paneId)
          ?.groups.find((each) => each.id === groupId)
        if (group === undefined) return { model }

        const existing = arrangement.recordOrder.find((each) => each.paneId === paneId)
        const current = existing?.recordIds ?? group.recordIds
        const entry = { paneId, recordIds: moved(current, current.indexOf(recordId), direction) }

        const next: Model = {
          ...model,
          arrangementHistory: historyOf(model),
          arrangement: {
            ...arrangement,
            recordOrder:
              existing === undefined
                ? [...arrangement.recordOrder, entry]
                : arrangement.recordOrder.map((each) => (each.paneId === paneId ? entry : each)),
          },
        }
        return { model: next, commands: persist(next) }
      },

      ClickedFocusPane: ({ paneId }) => {
        const arrangement = model.arrangement
        if (arrangement === undefined) return { model }
        const next = patch(model, {
          arrangement: { ...arrangement, focusPaneId: paneId },
        })
        return { model: next, commands: persist(next) }
      },

      ClickedUndoArrangement: () => {
        const previous = model.arrangementHistory[model.arrangementHistory.length - 1]
        const at = deps.now()
        if (previous === undefined) {
          return { model: say(model, 'info', 'Nothing to undo — the arrangement has not moved.', at) }
        }
        const next: Model = {
          ...model,
          ...audited(model, {
            actor: 'user',
            action: 'undo',
            recordId: model.applied?.proposalId ?? 'arrangement',
            reasonCode: 'undid_arrangement_change',
            at,
          }),
          arrangement: previous,
          arrangementHistory: model.arrangementHistory.slice(0, -1),
        }
        return { model: next, commands: persist(next) }
      },

      // -------------------------------------------------- records and links
      ClickedSelectRecord: ({ recordId }) => {
        if (findRecord(model.project, recordId) === undefined) {
          return {
            model: say(
              model,
              'error',
              `“${recordId}” is not a record in this project, so nothing was selected.`,
              deps.now(),
            ),
          }
        }
        const next = { ...model, selection: { recordId } }
        return { model: next, commands: persist(next) }
      },

      ClickedOpenSource: ({ recordId, sourceId }) => {
        const record = findRecord(model.project, recordId)
        if (record === undefined) {
          return { model: say(model, 'error', `“${recordId}” is not a record in this project.`, deps.now()) }
        }
        const linked = record.kind === 'task' || record.kind === 'decision' ? record.sourceIds : []
        if (!linked.includes(sourceId)) {
          return {
            model: say(
              model,
              'error',
              `Excerpt “${sourceId}” is not linked to “${recordId}”, so that link was refused. The selection is unchanged.`,
              deps.now(),
            ),
          }
        }
        const next = { ...model, selection: { recordId, sourceId } }
        return { model: next, commands: persist(next) }
      },

      ClickedTogglePin: ({ recordId }) => {
        if (findRecord(model.project, recordId) === undefined) return { model }
        const pins = model.pins.includes(recordId)
          ? model.pins.filter((pin) => pin !== recordId)
          : [...model.pins, recordId]
        const next = patch(model, { pins })
        return { model: next, commands: persist(next) }
      },

      ClickedMarkTaskDone: ({ taskId }) => {
        const at = deps.now()
        const mutated = markTaskDone(model.project, taskId, at)

        if (mutated._tag === 'Failure') {
          return {
            model: say(model, 'error', `“${taskId}” is not a task in this project (${mutated.failure}). Nothing changed.`, at),
          }
        }

        const next: Model = { ...model, project: mutated.success }
        return {
          model: say(
            next,
            'info',
            `Marked done. The board is at revision ${next.project.revision}; the open frame resolves against the new status, not against the reply that drew it.`,
            at,
          ),
          commands: persist(next),
        }
      },

      // ------------------------------------------------------- next turn
      ClickedRunTurn: () => {
        const at = deps.now()
        const request: TurnRequest = buildTurnRequest({
          project: model.project,
          question: questionText(model.question),
          questionId: model.question,
          sharing: model.sharing,
          selection: selectionForRequest(model),
        })

        return {
          model: { ...model, requesting: true },
          commands: [
            RunTurn({
              turnId: `turn_${model.turns.length + 1}_rev${model.project.revision}`,
              at,
              request,
              providerMode: model.providerMode,
              ...(deps.runtimeRoute === undefined ? {} : { runtimeBaseUrl: deps.runtimeRoute }),
            }),
          ],
        }
      },

      ReceivedTurn: ({ turn }) => {
        const next: Model = {
          ...model,
          requesting: false,
          turns: [turn, ...model.turns].slice(0, MaxTurns),
        }
        return { model: next, commands: persist(next) }
      },

      FailedTurn: ({ message: reason, at }) => ({
        model: say({ ...model, requesting: false }, 'error', `The turn did not complete: ${reason}`, at),
      }),

      ClickedToggleSharing: () => {
        const sharing = !model.sharing
        const next = patch(model, { sharing })
        return {
          model: say(
            next,
            'info',
            sharing
              ? 'Board sharing is on. The next request carries the accepted records only, capped, with the omissions listed.'
              : 'Board sharing is off. The next request carries no board snapshot at all.',
            deps.now(),
          ),
          commands: persist(next),
        }
      },

      ChangedViewName: ({ value }) => ({ model: { ...model, viewNameDraft: value } }),

      // ------------------------------------------- settings and recovery
      ChangedProviderMode: ({ mode }) => {
        if (mode === 'runtime' && deps.runtimeRoute === undefined) {
          return {
            model: say(
              model,
              'warning',
              'No runtime route was supplied at boot, so this prototype stays on the fixture provider. Start it with ?runtimeRoute=http://127.0.0.1:<port> to point it at a local route.',
              deps.now(),
            ),
          }
        }
        return { model: { ...model, providerMode: mode } }
      },

      ChangedProbe: ({ probe }) => ({ model: patch(model, { probe }) }),

      SavedFixture: () => ({ model: { ...model, persistenceFailed: false } }),

      FailedPersist: ({ message: reason }) => ({
        model: say(
          { ...model, persistenceFailed: true },
          'error',
          `Local save failed: ${reason}. The workbench keeps working; this tab just will not reopen where you left it.`,
          deps.now(),
        ),
      }),

      ClickedDismissNotices: () => ({ model: { ...model, notices: [] } }),

      ClickedReset: () => {
        const next: Model = {
          ...model,
          project: deps.freshProject(),
          viewNameDraft: '',
          applied: undefined,
          arrangement: undefined,
          arrangementHistory: [],
          savedViews: [],
          preview: undefined,
          selection: {},
          pins: [],
          sharing: true,
          turns: [],
          notices: [{ at: deps.now(), tone: 'info', text: 'Fixture reset to the starting board.' }],
          requesting: false,
          probe: 'none',
        }
        return { model: next, commands: persist(next) }
      },
    })
  }
