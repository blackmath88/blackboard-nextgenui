import { Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { ChatMessage, ChatReply } from './chat.js'
import { Message } from './message.js'
import type { Model } from './model.js'

async function* events(messages: ReadonlyArray<typeof ChatMessage.Type>, context: string): AsyncGenerator<Message> {
  const response = await fetch('/api/unibas/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, context }),
  })
  if (!response.ok || !response.body) throw new Error('Chat unavailable')
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ''
  try {
    while (true) {
      const read = await reader.read()
      if (read.done) throw new Error('Incomplete reply')
      const lines = (pending + read.value).split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        const event = JSON.parse(line)
        if (event.type === 'delta' && typeof event.text === 'string') {
          yield Message.StreamedChat({ text: event.text })
        } else if (event.type === 'done') {
          yield Message.ReceivedChat({ result: Schema.decodeUnknownSync(ChatReply)(event.result) })
          return
        } else if (event.type === 'error') throw new Error('Provider failed')
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export const chatSubscriptions = Subscription.make<Model, Message>()(entry => ({
  chat: entry({ messages: Schema.Array(ChatMessage), context: Schema.String }, {
    modelToDependencies: model => ({
      messages: model.providerMode === 'runtime' && model.requesting
        ? model.conversation.slice(-8).map(item => ({ ...item, text: item.text.slice(0, 800) }))
        : [],
      context: model.requesting ? model.chatContext : '',
    }),
    dependenciesToStream: ({ messages, context }) => messages.length === 0
      ? Stream.empty
      : Stream.fromAsyncIterable(events(messages, context), () => null).pipe(
          Stream.catch(() => Stream.succeed(Message.FailedChat())),
        ),
  }),
}))
