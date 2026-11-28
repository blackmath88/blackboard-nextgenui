import { expect, it } from 'vitest'
import { chatMarkdown, recoverIdeaMap } from './chat-markdown.js'

it('recovers an explicit idea map from a model reply with a list', () => {
  const reply = '- **Logistics:** Book a room\n- **Ideas:** Swap by theme'
  expect(recoverIdeaMap('Give me an idea map', reply)?.sections).toEqual([
    { title: 'Logistics', items: ['Book a room'] },
    { title: 'Ideas', items: ['Swap by theme'] },
  ])
  expect(recoverIdeaMap('Give me two tips', reply)).toBeNull()
})

it('renders headings, numbered lists and an unfinished code fence during streaming', () => {
  expect(chatMarkdown('# Plan\n\n1. First\n2. Second\n\n```ts\nconst x')).toEqual([
    { kind: 'heading', text: 'Plan' },
    { kind: 'ordered', items: ['First', 'Second'] },
    { kind: 'code', text: 'const x\n' },
  ])
})

it('leaves HTML as text for the Foldkit renderer', () => {
  expect(chatMarkdown('<button>Example</button>')).toEqual([
    { kind: 'paragraph', text: '<button>Example</button>' },
  ])
})
