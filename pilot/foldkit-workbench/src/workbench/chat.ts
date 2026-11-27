import { Schema } from 'effect'

export const ChatMessage = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
})

export const ChatWorkspace = Schema.Struct({
  title: Schema.String,
  source: Schema.optional(Schema.String),
  sections: Schema.Array(Schema.Struct({
    title: Schema.String,
    items: Schema.Array(Schema.String),
    kind: Schema.optional(Schema.Literals(['list', 'checklist'])),
  })),
})

export const checklistKey = (section: typeof ChatWorkspace.Type.sections[number], index: number) =>
  JSON.stringify([section.title, section.items[index], section.items.slice(0, index).filter(item => item === section.items[index]).length])

export const WorkspaceMarker = '\n<workspace>\n'

export const WorkspaceTask = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  source: Schema.String,
  done: Schema.Boolean,
})

export const ChatReply = Schema.Struct({
  reply: Schema.String,
  workspace: Schema.NullOr(ChatWorkspace),
})
