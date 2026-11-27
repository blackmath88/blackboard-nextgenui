import { expect, it } from 'vitest'
import { splitWorkspaceDelta, WorkspaceMarker } from './chat.js'

it('immediately emits short text, retaining only a possible marker prefix', () => {
  expect(splitWorkspaceDelta('', 'Hi')).toEqual({ text: 'Hi', pending: '', workspace: false })
  expect(splitWorkspaceDelta('', 'Hi\n<work')).toEqual({ text: 'Hi', pending: '\n<work', workspace: false })
  expect(splitWorkspaceDelta('\n<work', ' in progress').text).toBe('\n<work in progress')
})

it('keeps workspace JSON out of chat for every separator split point', () => {
  for (let index = 0; index < WorkspaceMarker.length; index++) {
    const first = splitWorkspaceDelta('', 'Answer' + WorkspaceMarker.slice(0, index))
    const last = splitWorkspaceDelta(first.pending, WorkspaceMarker.slice(index) + '{"title":"Plan"}')
    expect(first.text + last.text).toBe('Answer')
    expect(last.workspace).toBe(true)
    expect(last.pending).toBe('{"title":"Plan"}')
  }
})
