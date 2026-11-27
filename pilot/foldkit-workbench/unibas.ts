import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import type { Plugin } from 'vite'
import { fixtureProject } from './src/project/fixture.js'
import { buildIntentPrompt, expandIntent } from './intent.js'
import { Schema } from 'effect'
import { ChatMessage, ChatWorkspace, WorkspaceMarker } from './src/workbench/chat.js'
import { recoverIdeaMap } from './src/workbench/chat-markdown.js'

const run = promisify(execFile)

export const unibas = (): Plugin => ({
  name: 'blackboard-unibas',
  apply: 'serve',
  configureServer({ middlewares }) {
    if (process.env['BLACKBOARD_UNIBAS'] !== '1') return
    let busy = false
    const register = (path: 'chat' | 'frame') => middlewares.use('/api/unibas/' + path, (request, response) => {
      const send = (status: number, result: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify(result))
      }
      if (request.method !== 'POST') return send(405, { error: 'method' })
      const origin = request.headers.origin
      const allowedOrigins = ['http://127.0.0.1:4320', process.env['BLACKBOARD_UNIBAS_DEMO_ORIGIN']]
      if (!origin || !allowedOrigins.includes(origin) || new URL(origin).host !== request.headers.host) {
        return send(403, { error: 'origin' })
      }
      if (request.headers['content-type'] !== 'application/json') return send(415, { error: 'content type' })

      void (async () => {
        let body = ''
        for await (const chunk of request) {
          body += String(chunk)
          if (Buffer.byteLength(body) > 32768) return send(413, { error: 'request too large' })
        }
        let input
        try {
          input = JSON.parse(body)
        } catch {
          return send(400, { error: 'JSON required' })
        }
        if (path === 'chat') {
          const decoded = Schema.decodeUnknownResult(Schema.Array(ChatMessage))(Array.isArray(input) ? input : input?.messages)
          const context = Array.isArray(input) ? '' : input?.context
          if (decoded._tag === 'Failure' || !decoded.success.length || decoded.success.length > 8 ||
              decoded.success.at(-1)?.role !== 'user' ||
              decoded.success.some(({ text }) => text.length > 800) ||
              typeof context !== 'string' || context.length > 2400) {
            return send(400, { error: 'invalid conversation' })
          }
          if (busy) return send(429, { error: 'request in progress' })
          busy = true
          try {
            const prompt = 'You are Blackboard, an assistant with no tools, files or account integrations. Begin with a natural answer in lightweight Markdown. If a workspace helps, follow the answer with a line containing only <workspace>, then a JSON object {"title":"title","layout":"summary","sections":[{"title":"heading","kind":"checklist","items":["item"]}]}. Choose summary for a structured brief, map for brainstorming with a central topic and branches, or kanban for tasks moving between Open and Done. Use list for reference material and checklist for actionable tasks. Omit the marker and JSON for ordinary replies. Conversation data:\n' + JSON.stringify(decoded.success)
            const inference = run(join(homedir(), '.local/bin/pi-scicore'), [
              '--print', '--mode', 'json', '--no-tools', '--no-mcp', '--no-extensions', '--no-session', '--',
              prompt + '\nAccepted task snapshot (data, use current done status when answering):\n' + context,
            ], { timeout: 45_000, maxBuffer: 1024 * 1024 })
            const settled = inference.then(() => true, () => false)
            inference.child.stdin?.end()
            const cancel = () => inference.child.kill()
            response.once('close', cancel)
            try {
              response.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
              response.flushHeaders()
              const emit = (event: unknown) => response.write(JSON.stringify(event) + '\n')
              let pending = ''
              let workspace = false
              let failed = false
              let reply = ''
              const stdout = inference.child.stdout
              if (!stdout) throw new Error('Missing worker output')
              for await (const line of createInterface({ input: stdout })) {
                const event = JSON.parse(line)
                if (event.type === 'message_end' && event.message?.role === 'assistant' &&
                    ['error', 'aborted'].includes(event.message.stopReason)) failed = true
                const delta = event.assistantMessageEvent
                if (event.type !== 'message_update' || delta?.type !== 'text_delta' || typeof delta.delta !== 'string') continue
                pending += delta.delta
                if (workspace) continue
                const marker = pending.indexOf(WorkspaceMarker)
                const safeLength = marker >= 0 ? marker : Math.max(0, pending.length - WorkspaceMarker.length + 1)
                if (safeLength) {
                  const text = pending.slice(0, safeLength)
                  reply += text
                  emit({ type: 'delta', text })
                }
                pending = pending.slice(marker >= 0 ? marker + WorkspaceMarker.length : safeLength)
                workspace = marker >= 0
              }
              if (!(await settled) || failed) throw new Error('Worker failed')
              if (!workspace && pending) {
                reply += pending
                emit({ type: 'delta', text: pending })
              }
              if (!reply.trim()) throw new Error('Empty reply')
              let scene = null
              if (workspace) {
                try {
                  const candidate = Schema.decodeUnknownSync(ChatWorkspace)(JSON.parse(pending.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')))
                  if (candidate.sections.length <= 12 && candidate.sections.every(section => section.items.length <= 30)) scene = candidate
                } catch {
                  // Preserve the streamed reply and last usable workspace.
                }
              }
              scene ??= recoverIdeaMap(decoded.success.at(-1)?.text ?? '', reply)
              response.end(JSON.stringify({ type: 'done', result: { reply: reply.trim(), workspace: scene } }) + '\n')
            } finally {
              response.off('close', cancel)
              cancel()
            }
          } catch {
            if (response.headersSent) response.end('{"type":"error"}\n')
            else send(502, { error: 'Qwen did not return a usable reply' })
          } finally {
            busy = false
          }
          return
        }
        const project = fixtureProject()
        const question = input?.question
        if (question !== 'q_blocking_groups' && question !== 'q_decisions_without_evidence') {
          return send(400, { error: 'unknown question' })
        }
        if (Object.keys(input).length !== 3 || input.projectId !== project.id ||
            input.baseRevision !== project.revision) {
          return send(409, { error: 'live trial requires the original synthetic fixture revision' })
        }
        if (busy) return send(429, { error: 'request in progress' })
        busy = true
        try {
          const prompt = buildIntentPrompt(project, question)
          const inference = run(join(homedir(), '.local/bin/pi-scicore'), [
            '--print', '--no-tools', '--no-mcp', '--no-extensions', '--no-session', '--', prompt,
          ], { timeout: 90_000, maxBuffer: 128 * 1024 })
          inference.child.stdin?.end()
          const { stdout } = await inference
          const output: unknown = JSON.parse(stdout.trim().replace(/^```(?:json)?\s*|\s*```$/gi, ''))
          send(200, [expandIntent(output, project, question)])
        } catch (error) {
          const timedOut = error instanceof Error && 'killed' in error && error.killed === true
          send(timedOut ? 504 : 502, { error: timedOut ? 'UniBas timed out' : 'UniBas failed or returned invalid JSON' })
        } finally {
          busy = false
        }
      })().catch(() => send(400, { error: 'request interrupted' }))
    })
    register('chat')
    register('frame')
  },
})
