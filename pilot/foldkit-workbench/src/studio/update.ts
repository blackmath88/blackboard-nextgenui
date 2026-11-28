/**
 * The studio's single pure update.
 *
 * Rules:
 * 1. Selection establishes context and never starts a turn.
 * 2. Only an explicit action or a submitted message starts a turn. Each turn
 *    carries a bounded context packet built from this conversation alone.
 * 3. A turn's workspace patch is untrusted: it is decoded with the catalogue
 *    schema and refused as a whole when invalid; the previous view stays.
 * 4. Human-owned values (assumptions, card lanes, pins, selection) are kept
 *    beside representations, keyed by stable ids, so a regenerated
 *    representation cannot erase them. A pinned pane is never overwritten.
 * 5. Artifact messages arrive here already sender-bound and are reviewed
 *    against the artifact's own allowed events before they become context.
 */

import { Command } from 'foldkit'
import { Effect, Schema } from 'effect'
import type { Return } from 'foldkit/update'

import { postArtifactState, reviewArtifactMessage } from './artifact.js'
import { promoteBlock } from './derive.js'
import { buildPacket, findObject, refFor } from './context.js'
import { respond } from './director.js'
import { Message, type ExplicitAction } from './message.js'
import {
  type ChatEntry, type ContextRef, type Conversation, type Interaction, type Model, type Pane,
  Persisted, StudioStorageKey, active, assumptionValues, emptyConversation, initialModel,
} from './model.js'
import { decodePatch, type Representation } from './spec.js'

type Result = Return<Model, Message>

export type StudioDeps = Readonly<{ now: () => string }>

export const SaveStudio = Command.define('SaveStudio', {
  args: { payload: Schema.String },
  messages: [Message.Saved, Message.FailedSave],
  execute: ({ payload }) => Effect.try({
    try: () => {
      globalThis.localStorage?.setItem(StudioStorageKey, payload)
      return Message.Saved()
    },
    catch: (cause) => String(cause),
  }).pipe(Effect.catch((cause) => Effect.succeed(Message.FailedSave({ message: String(cause) })))),
})

export const SendArtifactState = Command.define('SendArtifactState', {
  args: { artifactId: Schema.String, state: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number, Schema.Boolean])) },
  messages: [Message.SentArtifactState],
  execute: ({ artifactId, state }) => Effect.sync(() => {
    try { postArtifactState(artifactId, state) } catch { /* the frame may be gone */ }
    return Message.SentArtifactState()
  }),
})

export const encodeStudio = (model: Model): string =>
  JSON.stringify({ version: 1, conversations: model.conversations, activeId: model.activeId, boardWidth: model.boardWidth })

export const restoreStudio = (raw: string | null, at: string): { model: Model; restored: boolean; ignored: boolean } => {
  const fresh = initialModel(at)
  if (!raw) return { model: fresh, restored: false, ignored: false }
  try {
    const decoded = Schema.decodeUnknownResult(Persisted)(JSON.parse(raw))
    if (decoded._tag === 'Failure' || decoded.success.conversations.length === 0) return { model: fresh, restored: false, ignored: true }
    const { conversations, activeId, boardWidth } = decoded.success
    const sequence = conversations.reduce((n, c) => n + c.messages.length + c.interactions.length + 1, 1)
    return {
      model: { ...fresh, conversations, activeId: conversations.some((c) => c.id === activeId) ? activeId : conversations[0]!.id, boardWidth, sequence: sequence + 100 },
      restored: true,
      ignored: false,
    }
  } catch {
    return { model: fresh, restored: false, ignored: true }
  }
}

const MaxInteractions = 120
const MaxHistory = 5
const StreamStep = 14

const updateActive = (model: Model, change: (c: Conversation) => Conversation): Model => ({
  ...model,
  conversations: model.conversations.map((c) => (c.id === model.activeId ? change(c) : c)),
})

const paneRevision = (c: Conversation, paneId: string) => c.panes.find((p) => p.rep.id === paneId)?.revision ?? 0

const record = (model: Model, c: Conversation, at: string, i: Omit<Interaction, 'id' | 'at' | 'paneRevision'>): [Conversation, Interaction, number] => {
  const interaction: Interaction = { ...i, id: `i-${model.sequence}`, at, paneRevision: paneRevision(c, i.paneId) }
  return [{ ...c, interactions: [...c.interactions, interaction].slice(-MaxInteractions), updatedAt: at }, interaction, model.sequence + 1]
}

/** Interactions of a type that happened after the last explicit action of the same family. */
export const undiscussed = (c: Conversation, type: 'edit-assumption' | 'move-card' | 'artifact-event'): Interaction[] => {
  let lastExplicit = -1
  c.interactions.forEach((i, index) => { if (i.type === type && i.explicit) lastExplicit = index })
  return c.interactions.filter((i, index) => index > lastExplicit && i.type === type && !i.explicit)
}

const userText = (action: ExplicitAction, selection: ReadonlyArray<ContextRef>, c: Conversation): string => {
  const names = selection.map((s) => `„${s.label}“`)
  const join = (list: string[]) => list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} und ${list.at(-1)}`
  switch (action) {
    case 'ask-why': return `Warum ${names[0] ?? 'das'}?`
    case 'compare': return `Vergleiche ${join(names)}.`
    case 'investigate': return `Untersuche ${names[0] ?? 'die Auswahl'}.`
    case 'inspect-source': return `Wie relevant ist ${names[0] ?? 'diese Quelle'}?`
    case 'edit-assumption': {
      const ids = [...new Set(undiscussed(c, 'edit-assumption').flatMap((i) => i.objectIds))]
      const labels = ids.map((id) => refFor(c, id)?.label ?? id)
      return `Was bedeuten meine Änderungen an ${join(labels.map((l) => `„${l}“`)) || 'den Annahmen'}?`
    }
    case 'move-card': return `Ich habe ${undiscussed(c, 'move-card').length === 1 ? 'eine Aufgabe' : 'Aufgaben'} verschoben. Bitte bewerte den Plan neu.`
    case 'artifact-event': return 'Ich habe im Simulator ein Szenario gewählt. Was heisst das für uns?'
  }
}

/** Start an assistant turn: compose the packet, run the director, review its patch. */
const beginTurn = (model: Model, text: string, interaction: Interaction | null, at: string): Model => {
  if (model.streaming) return model
  const c = active(model)
  const selection = interaction?.type === 'edit-assumption' || interaction?.type === 'move-card' || interaction?.type === 'artifact-event'
    ? []
    : c.selection
  const packet = buildPacket(c, text, interaction, selection)
  const userEntry: ChatEntry = {
    id: `m-${model.sequence}`, role: 'user', markdown: text, at,
    context: [...selection], packet: JSON.stringify(packet, null, 2), touched: [],
  }
  const withUser: Conversation = { ...c, messages: [...c.messages, userEntry], selection: [], draft: '', updatedAt: at }
  const turn = respond(withUser, packet)
  let patch: Representation[] | null = null
  let focus: string | undefined
  let refused: string | undefined
  if (turn.patch !== null && turn.patch !== undefined) {
    const decoded = decodePatch(turn.patch)
    if (decoded._tag === 'Success') {
      patch = [...decoded.success.upsert]
      focus = decoded.success.focus
    } else {
      refused = 'Die vorgeschlagene Darstellung war ungültig und wurde nicht übernommen. Die bisherige Arbeitsfläche bleibt erhalten.'
    }
  }
  const assistant: ChatEntry = {
    id: `m-${model.sequence + 1}`, role: 'assistant', markdown: turn.markdown, at, context: [],
    touched: patch?.map((r) => r.id) ?? [], ...(refused ? { refused } : {}), ...(turn.origin ? { origin: turn.origin } : {}),
  }
  return {
    ...updateActive(model, () => withUser),
    sequence: model.sequence + 2,
    narrowView: 'chat',
    streaming: {
      conversationId: c.id, entry: assistant, shown: 0,
      patch: patch ? { upsert: patch, focus } : null,
      scenario: turn.scenario ?? c.scenario,
      ...(turn.title ? { title: turn.title } : {}),
    },
  }
}

/** Merge validated representations into the conversation, preserving pins and history. */
export const applyPatch = (c: Conversation, upsert: ReadonlyArray<Representation>, focus: string | undefined, turnId: string): Conversation => {
  let panes = [...c.panes]
  let focusPaneId = focus ?? c.focusPaneId
  for (const rep of upsert) {
    const index = panes.findIndex((p) => p.rep.id === rep.id)
    const existing = panes[index]
    if (existing === undefined) {
      panes.push({ rep, revision: 1, turnId, pinned: false, history: [] })
    } else if (existing.pinned) {
      // A pinned pane is frozen. The new version opens beside it.
      const id = `${rep.id}.v${existing.revision + 1}`
      const sibling = panes.findIndex((p) => p.rep.id === id)
      const pane: Pane = { rep: { ...rep, id }, revision: existing.revision + 1, turnId, pinned: false, history: [] }
      if (sibling >= 0) panes[sibling] = pane
      else panes.splice(index + 1, 0, pane)
      if (focusPaneId === rep.id) focusPaneId = id
    } else {
      panes[index] = {
        ...existing, rep, revision: existing.revision + 1, turnId,
        history: [existing.rep, ...existing.history].slice(0, MaxHistory),
      }
    }
  }
  return { ...c, panes, focusPaneId: focusPaneId ?? panes[0]?.rep.id ?? null }
}

const finishStream = (model: Model, at: string): Model => {
  const s = model.streaming
  if (!s) return model
  const patch = s.patch as { upsert: Representation[]; focus?: string } | null
  return {
    ...model,
    streaming: null,
    conversations: model.conversations.map((c) => {
      if (c.id !== s.conversationId) return c
      const next = patch ? applyPatch(c, patch.upsert, patch.focus, s.entry.id) : c
      return {
        ...next,
        scenario: s.scenario,
        ...(s.title && c.title === 'Neues Gespräch' ? { title: s.title } : {}),
        messages: [...next.messages, { ...s.entry, at }],
        updatedAt: at,
      }
    }),
  }
}

export const makeStudioUpdate = (deps: StudioDeps) => (model: Model, message: Message): Result => {
  const at = deps.now()
  const save = (next: Model): Result => ({ model: next, commands: [SaveStudio({ payload: encodeStudio(next) })] })
  const c = active(model)

  return Message.match(message, {
    // ------------------------------------------------------------ navigation
    SelectedConversation: ({ id }) => model.conversations.some((x) => x.id === id) && !model.streaming
      ? save({ ...model, activeId: id, inspectPacket: null, ...(model.split ? { split: false, boardWidth: model.widthBeforeSplit ?? model.boardWidth, widthBeforeSplit: null } : {}) })
      : { model },
    StartedConversation: () => {
      if (model.streaming) return { model }
      const empty = model.conversations.find((x) => x.messages.length === 0)
      if (empty) return save({ ...model, activeId: empty.id, narrowView: 'chat' })
      const id = `c-${model.sequence}`
      return save({ ...model, conversations: [emptyConversation(id, at), ...model.conversations], activeId: id, sequence: model.sequence + 1, narrowView: 'chat' })
    },
    ToggledRail: () => ({ model: { ...model, railOpen: !model.railOpen } }),
    SelectedNarrowView: ({ view }) => ({ model: { ...model, narrowView: view } }),
    OpenedRecentPane: ({ conversationId, paneId }) => model.streaming ? { model } : save({
      ...model,
      activeId: conversationId,
      narrowView: 'board',
      conversations: model.conversations.map((x) => x.id === conversationId ? { ...x, focusPaneId: paneId } : x),
    }),
    ResetStudio: () => save({ ...initialModel(at), boardWidth: model.boardWidth }),
    DismissedNotice: () => ({ model: { ...model, notice: null } }),

    // ------------------------------------------------------------ conversation
    ChangedDraft: ({ value }) => ({ model: updateActive(model, (x) => ({ ...x, draft: value.slice(0, 2000) })) }),
    PressedComposerKey: ({ key, shift }) => {
      if (key !== 'Enter' || shift) return { model }
      const text = c.draft.trim()
      return text ? save(beginTurn(model, text, null, at)) : { model }
    },
    SubmittedDraft: () => {
      const text = c.draft.trim()
      return text ? save(beginTurn(model, text, null, at)) : { model }
    },
    ClickedStarter: ({ prompt }) => save(beginTurn(model, prompt, null, at)),
    ClickedRef: ({ objectId }) => {
      const ref = refFor(c, objectId)
      if (!ref) return { model: { ...model, notice: 'Dieses Element ist nicht mehr auf der Arbeitsfläche.' } }
      const already = c.selection.some((s) => s.objectId === objectId)
      return save({
        ...updateActive(model, (x) => ({ ...x, focusPaneId: ref.paneId, selection: already ? x.selection : [...x.selection, ref] })),
        narrowView: 'board',
      })
    },
    InspectedPacket: ({ messageId }) => ({ model: { ...model, inspectPacket: messageId } }),
    ClosedPacket: () => ({ model: { ...model, inspectPacket: null } }),
    TickedStream: () => {
      const s = model.streaming
      if (!s) return { model }
      const shown = s.shown + StreamStep
      return shown >= s.entry.markdown.length
        ? save(finishStream(model, at))
        : { model: { ...model, streaming: { ...s, shown } } }
    },

    // ------------------------------------------------------------ workspace → conversation
    ToggledObject: ({ paneId, objectId }) => {
      const selected = c.selection.some((s) => s.objectId === objectId)
      const ref = refFor(c, objectId)
      if (!ref) return { model }
      const [withLog, , sequence] = record(model, c, at, { type: 'select', paneId, objectIds: [objectId], payload: { selected: !selected }, explicit: false })
      const selection = selected ? c.selection.filter((s) => s.objectId !== objectId) : [...c.selection, { ...ref, paneId }].slice(-4)
      return save({ ...updateActive(model, () => ({ ...withLog, selection })), sequence })
    },
    RemovedContext: ({ objectId }) => save(updateActive(model, (x) => ({ ...x, selection: x.selection.filter((s) => s.objectId !== objectId) }))),
    ClearedSelection: () => save(updateActive(model, (x) => ({ ...x, selection: [] }))),
    ClickedAction: ({ action }) => {
      if (model.streaming) return { model }
      const family = action === 'edit-assumption' || action === 'move-card' || action === 'artifact-event'
      const pending = family ? undiscussed(c, action) : []
      const paneId = c.selection[0]?.paneId ?? pending.at(-1)?.paneId ?? c.focusPaneId ?? ''
      const payload = action === 'artifact-event'
        ? (c.pendingArtifact?.payload ?? {})
        : { count: family ? pending.length : c.selection.length }
      const objectIds = family ? [...new Set(pending.flatMap((i) => i.objectIds))] : c.selection.map((s) => s.objectId)
      const [withLog, interaction, sequence] = record(model, c, at, { type: action, paneId, objectIds, payload, explicit: true })
      const text = userText(action, c.selection, c)
      const next = updateActive({ ...model, sequence }, () => ({ ...withLog, ...(action === 'artifact-event' ? { pendingArtifact: null } : {}) }))
      return save(beginTurn(next, text, interaction, at))
    },
    ClickedPaneAction: ({ prompt }) => save(beginTurn(model, prompt, null, at)),
    ChangedAssumption: ({ paneId, id, value }) => {
      if (!Number.isFinite(value)) return { model }
      const found = findObject(c, id)
      const item = found?.item as { value?: number; min?: number; max?: number } | undefined
      if (!item || typeof item.value !== 'number') return { model }
      const clamped = Math.min(item.max ?? value, Math.max(item.min ?? value, value))
      const previous = c.assumptions[id]
      const proposed = previous?.proposed ?? item.value
      const [withLog, , sequence] = record(model, c, at, { type: 'edit-assumption', paneId, objectIds: [id], payload: { from: assumptionValues(c)[id] ?? proposed, to: clamped }, explicit: false })
      // Collapse a drag into one record: replace the last edit of the same id.
      const interactions = (() => {
        const list = withLog.interactions
        const last = list.at(-2)
        return last && last.type === 'edit-assumption' && !last.explicit && last.objectIds[0] === id
          ? [...list.slice(0, -2), { ...list.at(-1)!, payload: { from: last.payload['from'] ?? proposed, to: clamped } }]
          : list
      })()
      const assumptions = { ...withLog.assumptions }
      if (clamped === proposed) delete assumptions[id]
      else assumptions[id] = { value: clamped, at, proposed }
      return save({ ...updateActive(model, () => ({ ...withLog, interactions, assumptions })), sequence })
    },
    ResetAssumption: ({ id }) => {
      const edit = c.assumptions[id]
      if (!edit) return { model }
      const [withLog, , sequence] = record(model, c, at, { type: 'reset-assumption', paneId: findObject(c, id)?.pane.rep.id ?? '', objectIds: [id], payload: { to: edit.proposed }, explicit: false })
      const assumptions = { ...withLog.assumptions }
      delete assumptions[id]
      return save({ ...updateActive(model, () => ({ ...withLog, assumptions })), sequence })
    },
    StartedCardDrag: ({ cardId }) => ({ model: { ...model, dragCard: cardId } }),
    DroppedCard: ({ paneId, lane }) => {
      const cardId = model.dragCard
      if (!cardId) return { model }
      return moveCard({ ...model, dragCard: null }, c, paneId, cardId, lane, at, save)
    },
    MovedCard: ({ paneId, cardId, lane }) => moveCard(model, c, paneId, cardId, lane, at, save),
    DiscardedArtifactEvent: () => save(updateActive(model, (x) => ({ ...x, pendingArtifact: null }))),

    // ------------------------------------------------------------ panes
    FocusedPane: ({ paneId }) => save(updateActive(model, (x) => ({ ...x, focusPaneId: paneId }))),
    ToggledPin: ({ paneId }) => {
      const pane = c.panes.find((p) => p.rep.id === paneId)
      if (!pane) return { model }
      const [withLog, , sequence] = record(model, c, at, { type: pane.pinned ? 'unpin' : 'pin', paneId, objectIds: [], payload: {}, explicit: false })
      return save({ ...updateActive(model, () => ({ ...withLog, panes: withLog.panes.map((p) => p.rep.id === paneId ? { ...p, pinned: !p.pinned } : p) })), sequence })
    },
    ClosedPane: ({ paneId }) => {
      const pane = c.panes.find((p) => p.rep.id === paneId)
      if (!pane || pane.pinned) return { model }
      const [withLog, , sequence] = record(model, c, at, { type: 'close-pane', paneId, objectIds: [], payload: {}, explicit: false })
      const panes = withLog.panes.filter((p) => p.rep.id !== paneId)
      const index = c.panes.findIndex((p) => p.rep.id === paneId)
      return save({
        ...updateActive(model, () => ({
          ...withLog, panes,
          selection: withLog.selection.filter((s) => s.paneId !== paneId),
          focusPaneId: withLog.focusPaneId === paneId ? (panes[Math.max(0, index - 1)]?.rep.id ?? null) : withLog.focusPaneId,
        })),
        sequence,
      })
    },
    RestoredRevision: ({ paneId }) => save(updateActive(model, (x) => ({
      ...x,
      panes: x.panes.map((p) => p.rep.id === paneId && p.history[0] && !p.pinned
        ? { ...p, rep: p.history[0], history: [p.rep, ...p.history.slice(1)], revision: p.revision + 1 }
        : p),
    }))),
    ToggledLog: () => ({ model: { ...model, showLog: !model.showLog } }),
    ToggledSplit: () => save(model.split
      ? { ...model, split: false, boardWidth: model.widthBeforeSplit ?? model.boardWidth, widthBeforeSplit: null }
      : { ...model, split: true, boardWidth: Math.max(model.boardWidth, 900), widthBeforeSplit: model.boardWidth }),
    DismissedRestore: () => ({ model: { ...model, restoreDismissed: true } }),
    SentArtifactState: () => ({ model }),
    PromotedBlock: ({ messageId, block }) => {
      const entry = c.messages.find((m) => m.id === messageId && m.role === 'assistant')
      const rep = entry ? promoteBlock(entry, block, entry.at) : undefined
      if (!rep) return { model }
      const [withLog, , sequence] = record(model, c, at, { type: 'promote', paneId: rep.id, objectIds: [], payload: { message: messageId, block }, explicit: false })
      const next = applyPatch(withLog, [rep], rep.id, messageId)
      return save({ ...updateActive({ ...model, narrowView: 'board' }, () => next), sequence })
    },

    // ------------------------------------------------------------ layout
    StartedResize: () => ({ model: { ...model, resizing: true } }),
    MovedResize: ({ width }) => ({ model: { ...model, boardWidth: clampWidth(width) } }),
    EndedResize: () => save({ ...model, resizing: false }),
    NudgedBoard: ({ delta }) => save({ ...model, boardWidth: clampWidth(model.boardWidth + delta) }),

    // ------------------------------------------------------------ artifact bridge
    ReceivedArtifactMessage: ({ artifactId, paneId, raw }) => {
      const pane = c.panes.find((p) => p.rep.id === paneId)
      const node = pane ? findObject(c, artifactId) : undefined
      const allowed = node?.node.type === 'artifact' ? node.node.allowedEvents : []
      const log = (accepted: boolean, detail: string) => [{ at, artifactId, accepted, detail }, ...model.bridgeLog].slice(0, 20)
      if (!node || node.node.type !== 'artifact') return { model: { ...model, bridgeLog: log(false, 'unbekanntes Artefakt') } }
      const verdict = reviewArtifactMessage(raw, allowed)
      if (verdict._tag === 'Rejected') return { model: { ...model, bridgeLog: log(false, verdict.reason) } }
      if (verdict._tag === 'Resized') return { model: { ...model, artifactHeights: { ...model.artifactHeights, [`${paneId}/${artifactId}`]: verdict.height } } }
      if (verdict._tag === 'Initialized') {
        // Continuity: hand the artifact the last state the human accepted from it.
        const last = [...c.interactions].reverse().find((i) => i.type === 'artifact-event' && i.objectIds[0] === artifactId && i.payload['event'] !== 'sandbox.probe')
        const state = last ? Object.fromEntries(Object.entries(last.payload).filter(([k]) => k !== 'event')) : null
        return {
          model: { ...model, bridgeLog: log(true, state ? 'initialisiert · letzter Zustand übergeben' : 'initialisiert') },
          ...(state ? { commands: [SendArtifactState({ artifactId, state })] } : {}),
        }
      }
      if (verdict.name === 'sandbox.probe') {
        const sealed = Object.values(verdict.payload).every((v) => v === true)
        return { model: { ...model, bridgeLog: log(true, sealed ? 'Isolationsprüfung: Speicher, DOM und Netzwerk gesperrt' : `Isolationsprüfung unvollständig: ${JSON.stringify(verdict.payload)}`) } }
      }
      const [withLog, interaction, sequence] = record(model, c, at, { type: 'artifact-event', paneId, objectIds: [artifactId], payload: { event: verdict.name, ...verdict.payload }, explicit: false })
      return save({
        ...updateActive({ ...model, bridgeLog: log(true, `${verdict.name} angenommen`) }, () => ({ ...withLog, pendingArtifact: interaction })),
        sequence,
      })
    },
    RejectedArtifactSender: ({ detail }) => ({ model: { ...model, bridgeLog: [{ at, artifactId: '—', accepted: false, detail }, ...model.bridgeLog].slice(0, 20) } }),

    // ------------------------------------------------------------ persistence
    Saved: () => (model.saveFailed ? { model: { ...model, saveFailed: false } } : { model }),
    FailedSave: () => ({ model: { ...model, saveFailed: true } }),
  })
}

const clampWidth = (width: number) => Math.round(Math.min(1100, Math.max(380, width)))

const moveCard = (model: Model, c: Conversation, paneId: string, cardId: string, lane: string, at: string, save: (m: Model) => Result): Result => {
  const found = findObject(c, cardId)
  if (!found || found.node.type !== 'board' || !found.node.lanes.some((l) => l.id === lane)) return { model }
  const proposed = (found.item as { lane: string }).lane
  const from = c.cards[cardId] ?? proposed
  if (from === lane) return { model }
  const [withLog, , sequence] = record(model, c, at, { type: 'move-card', paneId, objectIds: [cardId], payload: { from, to: lane }, explicit: false })
  const cards = { ...withLog.cards }
  if (lane === proposed) delete cards[cardId]
  else cards[cardId] = lane
  return save({ ...updateActive(model, () => ({ ...withLog, cards })), sequence })
}
