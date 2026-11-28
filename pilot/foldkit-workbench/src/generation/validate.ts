/**
 * The structured-output boundary.
 *
 * Both questions go through this one gate. Step one is a schema decode of
 * whatever the provider returned. Step two proves the *references*: every group
 * ID, record ID and action ID must exist in the project the user is looking at,
 * the proposal must answer the question that was asked, and it must have been
 * computed against the revision the board is on now.
 *
 * Anything that fails here never reaches the renderer, so it cannot surface a
 * label, an excerpt or an action that this project does not own.
 */

import { Result, Schema } from 'effect'

import { type Project, UnassignedGroupId, findRecord } from '../project/records.js'
import {
  AllowedActionIds,
  FrameProposal,
  type QuestionId,
  type ProposalRejection,
  rejectionHeadline,
} from './proposal.js'

export type Proposal = typeof FrameProposal.Type

export type ValidationContext = Readonly<{
  project: Project
  /** IDs known to belong to another project, mapped to their owner. */
  foreignRecordIds: Readonly<Record<string, string>>
}>

export type ReviewRequest = Readonly<{
  responses: ReadonlyArray<unknown>
  context: ValidationContext
  question: QuestionId
  baseRevision: number
}>

export type RefusedResponse = Readonly<{
  label: string
  rejection: ProposalRejection
}>

const reject = (
  kind: ProposalRejection['kind'],
  detail: string,
  reference?: string,
): ProposalRejection =>
  reference === undefined ? { kind, detail } : { kind, detail, reference }

/** A broken reference is either owned elsewhere or does not exist at all. */
const referenceRejection = (
  what: string,
  id: string,
  context: ValidationContext,
): ProposalRejection => {
  const owner = context.foreignRecordIds[id]
  return owner === undefined
    ? reject('unknownRecord', `${what} “${id}” is not a record of ${context.project.name}.`, id)
    : reject('crossProjectReference', `${what} “${id}” belongs to ${owner}, not to this project.`, id)
}

const firstBrokenReference = (
  proposal: Proposal,
  context: ValidationContext,
): ProposalRejection | undefined => {
  for (const pane of proposal.panes) {
    for (const group of pane.groups) {
      if (group.id !== UnassignedGroupId && findRecord(context.project, group.id) === undefined) {
        const owner = context.foreignRecordIds[group.id]
        return owner === undefined
          ? reject(
              'unknownGroup',
              `Group “${group.id}” is neither a waitlist nor a record of this project.`,
              group.id,
            )
          : reject('crossProjectReference', `Group “${group.id}” belongs to ${owner}.`, group.id)
      }

      const broken = group.recordIds.find((recordId) => findRecord(context.project, recordId) === undefined)
      if (broken !== undefined) return referenceRejection('Record', broken, context)
    }

    const focus = pane.focusRecordId
    if (focus !== undefined && findRecord(context.project, focus) === undefined) {
      return referenceRejection('Focused record', focus, context)
    }
  }
  return undefined
}

/**
 * Order is deliberate: wrong project, then the question it answers, then broken
 * references, then an action the host will not run, then staleness. A proposal
 * that is both unsafe and stale reports the unsafe part.
 */
export const validateProposal = (
  proposal: Proposal,
  args: Readonly<{ context: ValidationContext; question: QuestionId; baseRevision: number }>,
): Result.Result<Proposal, ProposalRejection> => {
  const { context, question, baseRevision } = args

  if (proposal.projectId !== context.project.id) {
    return Result.fail(
      reject(
        'wrongProject',
        `It is scoped to “${proposal.projectId}”; this workbench shows “${context.project.id}”.`,
        proposal.projectId,
      ),
    )
  }

  if (proposal.questionId !== question) {
    return Result.fail(
      reject(
        'unknownRecord',
        `It answers “${proposal.questionId}”, not the question that was asked.`,
        proposal.questionId,
      ),
    )
  }

  if (proposal.panes.length === 0) {
    return Result.fail(reject('malformedOutput', 'It contains no panes to render.'))
  }

  const broken = firstBrokenReference(proposal, context)
  if (broken !== undefined) return Result.fail(broken)

  const unsupported = proposal.actions.find((actionId) => !AllowedActionIds.includes(actionId as never))
  if (unsupported !== undefined) {
    return Result.fail(
      reject(
        'unsupportedAction',
        `It asks for “${unsupported}”. The host only wires ${AllowedActionIds.join(', ')}, and that list is not extendable from a reply.`,
        unsupported,
      ),
    )
  }

  if (proposal.baseRevision !== baseRevision) {
    return Result.fail(
      reject(
        'staleProposal',
        `It was drawn against revision ${proposal.baseRevision}; the board is at revision ${baseRevision}.`,
      ),
    )
  }

  return Result.succeed(proposal)
}

/** Decode, then validate. Never throws, never trusts. */
export const reviewResponse = (
  raw: unknown,
  args: Readonly<{ context: ValidationContext; question: QuestionId; baseRevision: number }>,
): Result.Result<Proposal, ProposalRejection> => {
  const decoded = Schema.decodeUnknownResult(FrameProposal)(raw)
  if (decoded._tag === 'Failure') {
    return Result.fail(
      reject('malformedOutput', `It does not match the frame contract: ${decoded.failure.message}`),
    )
  }
  return validateProposal(decoded.success, args)
}

/**
 * Review a whole provider reply. The accepted proposals are the only ones the
 * preview can offer; the refused ones are reported with the reason.
 */
export const reviewProposals = (
  request: ReviewRequest,
): Readonly<{ accepted: ReadonlyArray<Proposal>; refused: ReadonlyArray<RefusedResponse> }> => {
  const accepted: Proposal[] = []
  const refused: RefusedResponse[] = []

  request.responses.forEach((raw, index) => {
    const outcome = reviewResponse(raw, {
      context: request.context,
      question: request.question,
      baseRevision: request.baseRevision,
    })
    const label = `Proposal ${index + 1}`

    if (outcome._tag === 'Success') {
      accepted.push(outcome.success)
      return
    }
    refused.push({ label, rejection: { ...outcome.failure, detail: `${rejectionHeadline(outcome.failure)}. ${outcome.failure.detail}` } })
  })

  return { accepted, refused }
}
