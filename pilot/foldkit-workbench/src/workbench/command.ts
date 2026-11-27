/**
 * Every effectful boundary, as a named Command.
 *
 * Commands are the only place that talks to the provider or to local storage.
 * They produce Messages and never touch the Model. The provider implementation
 * is chosen here, so the fixture route and the optional runtime route are the
 * same code path everywhere else.
 */

import { Command } from 'foldkit'
import { Effect, Schema } from 'effect'

import { Probe, QuestionId } from '../generation/proposal.js'
import { ProgramProvider, providerLayerFor, type RuntimeConfig } from '../generation/provider.js'
import { TurnRequest } from '../generation/turn.js'
import { Message } from './message.js'
import { ChatMessage, ChatReply } from './chat.js'

export const RunChat = Command.define('RunChat', {
  args: { messages: Schema.Array(ChatMessage) },
  messages: [Message.ReceivedChat, Message.FailedChat],
  execute: ({ messages }) => Effect.tryPromise(async () => {
    const response = await fetch('/api/unibas/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(messages),
    })
    if (!response.ok) throw new Error('Chat unavailable')
    return Schema.decodeUnknownSync(ChatReply)(await response.json())
  }).pipe(Effect.match({
    onSuccess: (result) => Message.ReceivedChat({ result }),
    onFailure: () => Message.FailedChat(),
  })),
})

const ProviderArgs = {
  providerMode: Schema.Literals(['fixture', 'runtime']),
  runtimeBaseUrl: Schema.optional(Schema.String),
}

const runtimeOf = (baseUrl: string | undefined): RuntimeConfig | undefined =>
  baseUrl === undefined ? undefined : { baseUrl }

/** Ask the provider for frame proposals. Its reply is untrusted JSON. */
export const AskFrame = Command.define('AskFrame', {
  args: {
    question: QuestionId,
    projectId: Schema.String,
    baseRevision: Schema.Number,
    probe: Probe,
    at: Schema.String,
    ...ProviderArgs,
  },
  messages: [Message.ReceivedProposals, Message.FailedRequest],
  execute: (args) => {
    const program = Effect.gen(function* () {
      const provider = yield* ProgramProvider
      return yield* provider.propose({
        question: args.question,
        projectId: args.projectId,
        baseRevision: args.baseRevision,
        probe: args.probe,
      })
    })

    return program.pipe(
      Effect.provide(providerLayerFor(args.providerMode, runtimeOf(args.runtimeBaseUrl))),
      Effect.map((raw) =>
        Message.ReceivedProposals({ question: args.question, raw, at: args.at }),
      ),
      Effect.catchTag('ProviderError', (cause) =>
        Effect.succeed(
          Message.FailedRequest({ question: args.question, message: cause.message, at: args.at }),
        ),
      ),
    )
  },
})

/** Run the next model turn against the request the host composed. */
export const RunTurn = Command.define('RunTurn', {
  args: {
    turnId: Schema.String,
    at: Schema.String,
    request: TurnRequest,
    ...ProviderArgs,
  },
  messages: [Message.ReceivedTurn, Message.FailedTurn],
  execute: (args) => {
    const program = Effect.gen(function* () {
      const provider = yield* ProgramProvider
      return yield* provider.reply(args.request)
    })

    return program.pipe(
      Effect.provide(providerLayerFor(args.providerMode, runtimeOf(args.runtimeBaseUrl))),
      Effect.map((answer) =>
        Message.ReceivedTurn({
          turn: {
            id: args.turnId,
            at: args.at,
            questionId: args.request.questionId,
            request: args.request,
            reply: answer.reply,
            recordIds: answer.recordIds,
            boardIncluded: args.request.boardSnapshot !== undefined,
            source: answer.source,
          },
        }),
      ),
      Effect.catchTag('ProviderError', (cause) =>
        Effect.succeed(Message.FailedTurn({ turnId: args.turnId, message: cause.message, at: args.at })),
      ),
    )
  },
})

/** Write the fixture state to local storage. The payload is already encoded. */
export const SaveFixture = Command.define('SaveFixture', {
  args: { key: Schema.String, payload: Schema.String },
  messages: [Message.SavedFixture, Message.FailedPersist],
  execute: (args) =>
    Effect.tryPromise({
      try: async () => {
        const storage = globalThis.localStorage
        if (storage === undefined) throw new Error('this environment has no local storage')
        storage.setItem(args.key, args.payload)
      },
      catch: (cause) => new Error(String(cause)),
    }).pipe(
      Effect.match({
        onFailure: (cause) => Message.FailedPersist({ message: cause.message }),
        onSuccess: () => Message.SavedFixture(),
      }),
    ),
})
