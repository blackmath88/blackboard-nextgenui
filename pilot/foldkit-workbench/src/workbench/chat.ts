import { Schema } from 'effect'

export const ChatMessage = Schema.Struct({
  role: Schema.Literals(['user', 'assistant']),
  text: Schema.String,
})

export const ChatWorkspace = Schema.Struct({
  title: Schema.String,
  sections: Schema.Array(Schema.Struct({
    title: Schema.String,
    items: Schema.Array(Schema.String),
  })),
})

export const ChatReply = Schema.Struct({
  reply: Schema.String,
  workspace: Schema.NullOr(ChatWorkspace),
})
