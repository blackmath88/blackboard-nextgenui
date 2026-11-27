import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Plugin } from 'vite'
import { fixtureProject } from './src/project/fixture.js'
import { buildIntentPrompt, expandIntent } from './intent.js'
import { Schema } from 'effect'
import { ChatMessage, ChatReply } from './src/workbench/chat.js'

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
          if (Buffer.byteLength(body) > 8192) return send(413, { error: 'request too large' })
        }
        let input
        try {
          input = JSON.parse(body)
        } catch {
          return send(400, { error: 'JSON required' })
        }
        if (path === 'chat') {
          const decoded = Schema.decodeUnknownResult(Schema.Array(ChatMessage))(input)
          if (decoded._tag === 'Failure' || !decoded.success.length || decoded.success.length > 8 ||
              decoded.success.at(-1)?.role !== 'user' ||
              decoded.success.some(({ text }) => text.length > 800)) {
            return send(400, { error: 'invalid conversation' })
          }
          if (busy) return send(429, { error: 'request in progress' })
          busy = true
          try {
            const prompt = 'You are Blackboard, a conversation assistant with no tools, files or account integrations. Respond naturally. When a workspace helps the current task, return a concise structured outline. Return only JSON: {"reply":"answer","workspace":null} or {"reply":"answer","workspace":{"title":"title","sections":[{"title":"heading","items":["item"]}]}}. Use null for ordinary chat. Conversation data:\n' + JSON.stringify(decoded.success)
            const inference = run(join(homedir(), '.local/bin/pi-scicore'), [
              '--print', '--no-tools', '--no-mcp', '--no-extensions', '--no-session', '--', prompt,
            ], { timeout: 45_000, maxBuffer: 32 * 1024 })
            inference.child.stdin?.end()
            const { stdout } = await inference
            const reply = Schema.decodeUnknownSync(ChatReply)(JSON.parse(stdout.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '')))
            send(200, reply)
          } catch {
            send(502, { error: 'Qwen did not return a usable reply' })
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
