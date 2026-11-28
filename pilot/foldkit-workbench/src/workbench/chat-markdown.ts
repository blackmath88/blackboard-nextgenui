type Block =
  | { kind: 'heading' | 'paragraph' | 'code'; text: string }
  | { kind: 'ordered' | 'unordered'; items: string[] }

export function recoverIdeaMap(question: string, reply: string) {
  if (!/\b(mind map|idea map|brainstorm)\b/i.test(question)) return null
  const ideas = chatMarkdown(reply).flatMap(block =>
    block.kind === 'ordered' || block.kind === 'unordered' ? block.items : [],
  ).slice(0, 8)
  if (ideas.length < 2) return null
  return {
    title: 'Idea map',
    layout: 'map' as const,
    sections: ideas.map((idea, index) => {
      const [label, ...details] = idea.replaceAll('**', '').split(':')
      return {
        title: (details.length ? label : `Idea ${index + 1}`)?.slice(0, 120) ?? 'Idea',
        items: [(details.length ? details.join(':').trim() : idea.replaceAll('**', '')).slice(0, 500)],
      }
    }),
  }
}

export function chatMarkdown(text: string): Block[] {
  const blocks: Block[] = []
  let fenced = false
  for (const line of text.split(/\r?\n/)) {
    const previous = blocks.at(-1)
    if (/^\s*```/.test(line)) {
      if (!fenced) blocks.push({ kind: 'code', text: '' })
      fenced = !fenced
    } else if (fenced && previous?.kind === 'code') {
      previous.text += line + '\n'
    } else if (!line.trim()) {
      if (previous?.kind === 'paragraph') previous.text += '\n'
    } else {
      const heading = /^#{1,6}\s+(.+)/.exec(line)?.[1]
      const item = /^\s*([-*]|\d+[.)])\s+(.+)/.exec(line)
      if (heading) {
        blocks.push({ kind: 'heading', text: heading })
      } else if (item?.[1] && item[2]) {
        const kind = /^\d/.test(item[1]) ? 'ordered' : 'unordered'
        if (previous?.kind === kind) previous.items.push(item[2])
        else blocks.push({ kind, items: [item[2]] })
      } else if (previous?.kind === 'paragraph' && !previous.text.endsWith('\n')) {
        previous.text += '\n' + line
      } else {
        blocks.push({ kind: 'paragraph', text: line })
      }
    }
  }
  return blocks
}
