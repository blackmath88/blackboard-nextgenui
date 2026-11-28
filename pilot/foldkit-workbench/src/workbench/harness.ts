/**
 * Test helpers: drive the workbench exactly as the runtime does — a Message in,
 * a new Model and Commands out, Commands executed, their Messages fed back.
 */

import { Effect } from 'effect'

import { fixtureProject } from '../project/fixture.js'
import { type Model, initialModel } from './model.js'
import { encodePersisted } from './persistence.js'
import { type Message } from './message.js'
import { type WorkbenchDeps, makeUpdate } from './update.js'

export const stamp = '2026-03-20T10:00:00.000Z'

export const deps: WorkbenchDeps = {
  encode: encodePersisted,
  freshProject: fixtureProject,
  runtimeRoute: undefined,
  now: () => stamp,
}

type CommandLike = Readonly<{ name: string; args?: Record<string, unknown>; effect: Effect.Effect<Message> }>

const commandsOf = (result: Readonly<{ commands?: unknown }>): ReadonlyArray<CommandLike> =>
  (result.commands as ReadonlyArray<CommandLike> | undefined) ?? []

export const commandNamed = (result: { commands?: unknown }, name: string): CommandLike | undefined =>
  commandsOf(result).find((command) => command.name === name)

export type Session = Readonly<{
  model: () => Model
  /** Pure step: no Commands run. */
  step: (message: Message) => { model: Model; commands: ReadonlyArray<CommandLike> }
  /** Full step: run every Command, feed every reply back, until quiet. */
  send: (message: Message) => Promise<Model>
}>

export const session = (start?: Model): Session => {
  const update = makeUpdate(deps)
  let model = start ?? initialModel(fixtureProject())

  const step = (message: Message) => {
    const result = update(model, message)
    model = result.model
    return { model: result.model, commands: commandsOf(result) }
  }

  const send = async (message: Message): Promise<Model> => {
    const pending: CommandLike[] = [...step(message).commands]

    while (pending.length > 0) {
      const command = pending.shift()!
      const reply = await Effect.runPromise(command.effect)
      pending.push(...step(reply).commands)
    }

    return model
  }

  return { model: () => model, step, send }
}
