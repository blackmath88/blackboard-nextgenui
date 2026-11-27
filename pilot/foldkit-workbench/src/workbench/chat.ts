import { Schema } from 'effect'

export const ChatMessage = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
})

export const WorkspaceLayout = Schema.Literals(['summary', 'map', 'kanban'])

export const ChatWorkspace = Schema.Struct({
  title: Schema.String,
  layout: Schema.optional(WorkspaceLayout),
  source: Schema.optional(Schema.String),
  sections: Schema.Array(Schema.Struct({
    title: Schema.String,
    items: Schema.Array(Schema.String),
    kind: Schema.optional(Schema.Literals(['list', 'checklist'])),
  })),
})

export const checklistKey = (section: typeof ChatWorkspace.Type.sections[number], index: number) =>
  JSON.stringify([section.title, section.items[index], section.items.slice(0, index).filter(item => item === section.items[index]).length])

export const findChecklistItem = (workspace: typeof ChatWorkspace.Type | null, key: string): string | undefined => {
  for (const section of workspace?.sections ?? []) {
    if (section.kind !== 'checklist') continue
    const index = section.items.findIndex((_, index) => checklistKey(section, index) === key)
    if (index >= 0) return section.items[index]
  }
  return undefined
}

export const WorkspaceMarker = '\n<workspace>\n'

export const WorkspaceTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  source: Schema.String,
  done: Schema.Boolean,
})

export function taskContext(tasks: ReadonlyArray<typeof WorkspaceTask.Type>): string {
  const snapshot = []
  for (const { title, done } of tasks.slice(-12).reverse()) {
    const entry = { title, done }
    if (JSON.stringify([entry, ...snapshot]).length > 2400) break
    snapshot.unshift(entry)
  }
  return JSON.stringify(snapshot)
}

export const ChatReply = Schema.Struct({
  reply: Schema.String,
  workspace: Schema.NullOr(ChatWorkspace),
})
