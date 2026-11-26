/**
 * The provider boundary.
 *
 * `ProgramProvider` is an Effect service with two operations. `propose` returns
 * untrusted JSON exactly as a model would return it — the application decodes
 * and validates it, the provider never does. `reply` answers a turn request the
 * host composed.
 *
 * The fixture implementation is deterministic and offline. The runtime
 * implementation exists so the route is real code rather than a promise, but it
 * only ever talks to a loopback URL that the developer passed at boot; there is
 * no credential in this repository and no default endpoint.
 */

import { Context, Data, Effect, Layer } from 'effect'

import type { ProbeKind } from './fixtureProposals.js'
import { probedProposals } from './fixtureProposals.js'
import type { QuestionId } from './proposal.js'
import type { TurnRequest } from './turn.js'

export class ProviderError extends Data.TaggedError('ProviderError')<{
  message: string
}> {}

export type FrameRequest = Readonly<{
  question: QuestionId
  projectId: string
  baseRevision: number
  probe: ProbeKind
}>

export type TurnReply = Readonly<{
  reply: string
  recordIds: ReadonlyArray<string>
  source: 'fixture' | 'runtime'
}>

export interface ProgramProvider {
  readonly propose: (
    request: FrameRequest,
  ) => Effect.Effect<ReadonlyArray<unknown>, ProviderError>
  readonly reply: (request: TurnRequest) => Effect.Effect<TurnReply, ProviderError>
}

export const ProgramProvider = Context.Service<ProgramProvider>('blackboard/ProgramProvider')

// ---------------------------------------------------------------------------
// Deterministic answer to a turn request
// ---------------------------------------------------------------------------

/**
 * Reads only what the request carries. With sharing off there is no snapshot,
 * so there is nothing to name and the reply says so instead of guessing.
 */
export const answerTurnRequest = (request: TurnRequest): TurnReply => {
  const snapshot = request.boardSnapshot
  if (snapshot === undefined) {
    return {
      reply:
        'Board sharing is off, so this request carried no board snapshot. I have nothing to read: not one record, status or revision. Turn sharing on and ask again, and the request will carry the accepted board.',
      recordIds: [],
      source: 'fixture',
    }
  }

  const blocked = snapshot.records.filter((record) => record.status === 'Blocked')
  const done = snapshot.records.filter((record) => record.kind === 'task' && record.status === 'Done')
  const unsupported = snapshot.records.filter(
    (record) => record.kind === 'decision' && record.sourceIds.length === 0,
  )
  const named = [...blocked, ...done, ...unsupported].map((record) => record.id)

  if (request.questionId === 'q_decisions_without_evidence') {
    const list = unsupported.map((record) => `“${record.title}” (revision ${record.revision})`)
    return {
      reply:
        `Board snapshot at revision ${snapshot.revision}: ${
          list.length === 0 ? 'no open decision is missing a source' : `${list.length} decisions carry no source excerpt — ${list.join('; ')}`
        }.` +
        (snapshot.omittedRecordIds.length === 0
          ? ''
          : ` ${snapshot.omittedRecordIds.length} record(s) were outside the snapshot cap and are not counted here.`),
      recordIds: named,
      source: 'fixture',
    }
  }

  const list = blocked.map((record) => `“${record.title}” — ${record.status}, revision ${record.revision}`)
  const doneLine =
    done.length === 0
      ? ''
      : ` Recently closed: ${done.map((record) => `“${record.title}” (${record.status}, revision ${record.revision})`).join(', ')}.`

  return {
    reply:
      `Board snapshot at revision ${snapshot.revision}: ${
        list.length === 0 ? 'nothing is blocked' : `${list.length} record(s) are waiting — ${list.join('; ')}`
      }.${doneLine}` +
      (snapshot.shortenedRecordIds.length === 0
        ? ''
        : ` ${snapshot.shortenedRecordIds.length} title(s) were shortened to fit the snapshot budget.`),
    recordIds: named,
    source: 'fixture',
  }
}

// ---------------------------------------------------------------------------
// Fixture provider (default, offline, deterministic)
// ---------------------------------------------------------------------------

export const FixtureProgramProvider = {
  propose: (request: FrameRequest) =>
    Effect.succeed(probedProposals(request.question, request.baseRevision, request.probe)),
  reply: (request: TurnRequest) => Effect.succeed(answerTurnRequest(request)),
} satisfies ProgramProvider

export const fixtureProviderLayer = Layer.succeed(ProgramProvider, FixtureProgramProvider)

// ---------------------------------------------------------------------------
// Runtime provider (optional; loopback URL supplied at boot, never a credential)
// ---------------------------------------------------------------------------

export type RuntimeConfig = Readonly<{ baseUrl: string }>

const runtimeDecodeNote =
  'The application decodes and validates whatever comes back; the provider never trusts it.'

export const runtimeProgramProvider = (config: RuntimeConfig): ProgramProvider => ({
  propose: (request) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${config.baseUrl}/frame`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            question: request.question,
            projectId: request.projectId,
            baseRevision: request.baseRevision,
          }),
        })
        if (!response.ok) {
          throw new Error(`runtime route answered ${response.status}`)
        }
        const body: unknown = await response.json()
        return body instanceof Array ? body : [body]
      },
      catch: (cause) =>
        new ProviderError({
          message: `Runtime route ${config.baseUrl} did not answer (${String(cause)}). ${runtimeDecodeNote}`,
        }),
    }),
  reply: (request) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(`${config.baseUrl}/turn`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        })
        if (!response.ok) throw new Error(`runtime route answered ${response.status}`)
        const body = (await response.json()) as { reply?: string; recordIds?: ReadonlyArray<string> }
        return {
          reply: typeof body.reply === 'string' ? body.reply : '',
          recordIds: Array.isArray(body.recordIds) ? body.recordIds : [],
          source: 'runtime' as const,
        }
      },
      catch: (cause) =>
        new ProviderError({
          message: `Runtime route ${config.baseUrl} did not answer (${String(cause)}).`,
        }),
    }),
})

export const runtimeProviderLayer = (config: RuntimeConfig) =>
  Layer.succeed(ProgramProvider, runtimeProgramProvider(config))

/** Chosen at boot: runtime only when a loopback URL was passed, otherwise fixture. */
export const providerLayerFor = (mode: 'fixture' | 'runtime', runtime: RuntimeConfig | undefined) =>
  mode === 'runtime' && runtime !== undefined
    ? runtimeProviderLayer(runtime)
    : fixtureProviderLayer
