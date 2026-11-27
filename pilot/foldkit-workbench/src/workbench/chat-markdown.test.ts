import { expect, it } from 'vitest'
import { chatMarkdown } from './chat-markdown.js'

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
