import { expect, it } from 'vitest'
import { workspaceReport } from './workspace-report.js'

it('exports a local diagram and accepted state without executing model markup', () => {
  const html = workspaceReport({
    title: 'Plan <script>',
    sections: [{ title: 'Research & tests', items: ['<img src="example">'] }],
  }, [{ id: '1', title: 'Book the room', done: true, source: 'Chat transcript stays local' }])
  expect(html).toContain('class="topic">Plan &lt;script&gt;')
  expect(html).toContain('Research &amp; tests')
  expect(html).toContain('&lt;img src=&quot;example&quot;&gt;')
  expect(html).toContain('<strong>Done</strong> Book the room')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('Chat transcript stays local')
})
