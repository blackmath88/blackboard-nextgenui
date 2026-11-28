import { Effect, Queue, Schema, Stream } from 'effect'
import { Subscription } from 'foldkit'
import { Message } from './message.js'
import type { Model } from './model.js'

/** Turn a DOM event source into a Stream of Messages, removing the listener on teardown. */
const fromEvents = <E extends Event>(target: EventTarget, names: ReadonlyArray<string>, toMessage: (event: E) => Message | null): Stream.Stream<Message> =>
  Stream.callback<Message>((queue) => Effect.acquireRelease(
    Effect.sync(() => {
      const handler = (event: Event) => {
        const message = toMessage(event as E)
        if (message) Queue.offerUnsafe(queue, message)
      }
      names.forEach((name) => target.addEventListener(name, handler))
      return handler
    }),
    (handler) => Effect.sync(() => names.forEach((name) => target.removeEventListener(name, handler))),
  ))

async function* ticks(): AsyncGenerator<Message> {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 22))
    yield Message.TickedStream()
  }
}

/**
 * The artifact bridge listener. The only trust anchor is `event.source`: it must
 * be the contentWindow of an iframe the host rendered for a known artifact.
 */
export const artifactSender = (event: MessageEvent, doc: Document = document): Message | null => {
  const frames = Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe[data-artifact-id]'))
  const frame = frames.find((f) => f.contentWindow !== null && f.contentWindow === event.source)
  if (!frame) {
    // Ignore our own window and extension noise; record anything else.
    if (event.source === window || event.source === null) return null
    return Message.RejectedArtifactSender({ detail: 'Nachricht von unbekanntem Absender verworfen' })
  }
  return Message.ReceivedArtifactMessage({
    artifactId: frame.dataset['artifactId'] ?? '',
    paneId: frame.dataset['paneId'] ?? '',
    raw: event.data,
  })
}

export const studioSubscriptions = Subscription.make<Model, Message>()((entry) => ({
  stream: entry({ streaming: Schema.Boolean }, {
    modelToDependencies: (model) => ({ streaming: model.streaming !== null }),
    dependenciesToStream: ({ streaming }) => (streaming ? Stream.fromAsyncIterable(ticks(), () => null).pipe(Stream.catch(() => Stream.empty)) : Stream.empty),
  }),
  resize: entry({ resizing: Schema.Boolean }, {
    modelToDependencies: (model) => ({ resizing: model.resizing }),
    dependenciesToStream: ({ resizing }) => !resizing
      ? Stream.empty
      : fromEvents<PointerEvent>(window, ['pointermove', 'pointerup', 'pointercancel'], (event) =>
          event.type === 'pointermove'
            ? Message.MovedResize({ width: window.innerWidth - event.clientX })
            : Message.EndedResize()),
  }),
  bridge: entry({ on: Schema.Boolean }, {
    modelToDependencies: () => ({ on: true }),
    dependenciesToStream: () => fromEvents<MessageEvent>(window, ['message'], (event) => artifactSender(event)),
  }),
}))
