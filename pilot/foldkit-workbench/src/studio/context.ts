/**
 * Context assembly: what the assistant is allowed to know about the workspace
 * for one turn. The packet is bounded, built only from this conversation's
 * state, and stored on the user turn so it can be read back ("Was die KI sieht").
 */

import type { Conversation, ContextRef, Interaction, Pane } from './model.js'
import { assumptionValues } from './model.js'
import { objectIndex, type Node } from './spec.js'

const MaxPacket = 6000

export type Found = { pane: Pane; node: Node; item: Record<string, unknown> | undefined }

/** Locate an object by id in the conversation's panes (newest pane first). */
export const findObject = (conversation: Conversation, objectId: string): Found | undefined => {
  for (const pane of conversation.panes) {
    const hit = findIn(pane.rep.root, objectId)
    if (hit) return { pane, ...hit }
  }
  return undefined
}

const findIn = (node: Node, id: string): { node: Node; item: Record<string, unknown> | undefined } | undefined => {
  switch (node.type) {
    case 'section': case 'grid':
      for (const child of node.children) {
        const hit = findIn(child, id)
        if (hit) return hit
      }
      return undefined
    case 'metric': case 'artifact': case 'diagram': case 'assumptions': case 'matrix': case 'bars':
      if (node.type === 'metric' || node.type === 'artifact') return node.id === id ? { node, item: node as unknown as Record<string, unknown> } : undefined
      if (node.id === id) return { node, item: { id: node.id, type: node.type } }
      break
    default: break
  }
  switch (node.type) {
    case 'table': { const row = node.rows.find((r) => r.id === id); return row ? { node, item: row } : undefined }
    case 'matrix': { const o = node.options.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    case 'bars': { const o = node.items.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    case 'diagram': { const o = node.nodes.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    case 'timeline': { const o = node.items.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    case 'board': { const o = node.cards.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    case 'records': { const o = node.items.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    case 'sources': { const o = node.items.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    case 'assumptions': { const o = node.items.find((r) => r.id === id); return o ? { node, item: o } : undefined }
    default: return undefined
  }
}

export const labelOf = (conversation: Conversation, objectId: string): { kind: string; label: string } | undefined => {
  for (const pane of conversation.panes) {
    const hit = objectIndex(pane.rep.root).get(objectId)
    if (hit) return hit
  }
  return undefined
}

export const refFor = (conversation: Conversation, objectId: string): ContextRef | undefined => {
  const found = findObject(conversation, objectId)
  const label = labelOf(conversation, objectId)
  return found && label ? { paneId: found.pane.rep.id, objectId, ...label } : undefined
}

const clip = (value: unknown, max = 280) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

export type Packet = ReturnType<typeof buildPacket>

/** The bounded state the next assistant turn receives. */
export const buildPacket = (conversation: Conversation, request: string, interaction: Interaction | null, selection: ReadonlyArray<ContextRef>) => {
  const values = assumptionValues(conversation)
  const focus = conversation.panes.find((p) => p.rep.id === conversation.focusPaneId)
  const packet = {
    request: clip(request, 600),
    interaction: interaction && {
      type: interaction.type,
      pane: interaction.paneId,
      paneRevision: interaction.paneRevision,
      payload: interaction.payload,
    },
    selection: selection.map((ref) => {
      const found = findObject(conversation, ref.objectId)
      return { id: ref.objectId, kind: ref.kind, label: ref.label, pane: ref.paneId, data: found?.item ? clip(found.item, 360) : null }
    }),
    humanEdits: Object.entries(conversation.assumptions).map(([id, edit]) => ({
      id, label: labelOf(conversation, id)?.label ?? id, proposed: edit.proposed, value: edit.value,
    })),
    movedCards: Object.entries(conversation.cards).map(([id, lane]) => ({ id, title: labelOf(conversation, id)?.label ?? id, lane })),
    values,
    workspace: conversation.panes.map((p) => ({ id: p.rep.id, title: p.rep.title, revision: p.revision, pinned: p.pinned })),
    focus: focus ? { id: focus.rep.id, revision: focus.revision } : null,
    recent: conversation.messages.slice(-6).map((m) => ({ role: m.role, text: clip(m.markdown, 280) })),
  }
  // Keep the packet bounded: drop the oldest conversation lines first.
  while (JSON.stringify(packet).length > MaxPacket && packet.recent.length > 0) packet.recent.shift()
  return packet
}
