/**
 * A small, safe Markdown subset for chat and representation text: headings,
 * paragraphs, lists, block quotes, fenced code, GFM tables, **bold**, *italic*,
 * `code` and `[[object-id]]` workspace references. Never produces raw HTML.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em' | 'code'; text: string }
  | { kind: 'ref'; id: string }

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph' | 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; align: ('start' | 'end')[]; rows: string[][] }

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())

export const blocks = (source: string): Block[] => {
  const out: Block[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const prev = out.at(-1)
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!)
      out.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map((c) => (c.endsWith(':') ? 'end' as const : 'start' as const))
      const rows: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) rows.push(cells(lines[i++]!))
      i--
      out.push({ kind: 'table', head, align, rows })
      continue
    }
    if (!line.trim()) { out.push({ kind: 'paragraph', text: '' }); continue }
    const heading = /^(#{1,4})\s+(.+)/.exec(line)
    if (heading) { out.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]! }); continue }
    const quote = /^>\s?(.*)/.exec(line)
    if (quote) {
      if (prev?.kind === 'quote') prev.text += ' ' + quote[1]
      else out.push({ kind: 'quote', text: quote[1] ?? '' })
      continue
    }
    const item = /^\s*([-*]|\d+[.)])\s+(.+)/.exec(line)
    if (item) {
      const ordered = /^\d/.test(item[1]!)
      if (prev?.kind === 'list' && prev.ordered === ordered) prev.items.push(item[2]!)
      else out.push({ kind: 'list', ordered, items: [item[2]!] })
      continue
    }
    if (prev?.kind === 'paragraph' && prev.text) prev.text += ' ' + line.trim()
    else out.push({ kind: 'paragraph', text: line.trim() })
  }
  return out.filter((b) => !(b.kind === 'paragraph' && !b.text))
}

export const inlines = (text: string): Inline[] => {
  const out: Inline[] = []
  const pattern = /\[\[([a-z0-9][a-z0-9._-]*)\]\]|\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ kind: 'text', text: text.slice(last, match.index) })
    if (match[1]) out.push({ kind: 'ref', id: match[1] })
    else if (match[2]) {
      // Allow a reference inside bold: **[[id]]**
      const inner = /^\[\[([a-z0-9][a-z0-9._-]*)\]\]$/.exec(match[2])
      out.push(inner ? { kind: 'ref', id: inner[1]! } : { kind: 'strong', text: match[2] })
    } else if (match[3]) out.push({ kind: 'em', text: match[3] })
    else if (match[4]) out.push({ kind: 'code', text: match[4] })
    last = match.index + match[0].length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/** Cut streamed text so that a half-typed reference or marker never shows. */
export const streamSafe = (text: string): string => text.replace(/\[\[[^\]]*$/, '').replace(/\*\*[^*]*$/, (m) => m.slice(2))
