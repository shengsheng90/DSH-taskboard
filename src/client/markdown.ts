export type MarkdownInline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'strong'; readonly children: readonly MarkdownInline[] }
  | { readonly type: 'em'; readonly children: readonly MarkdownInline[] }
  | { readonly type: 'del'; readonly children: readonly MarkdownInline[] }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly MarkdownInline[] }
  | { readonly type: 'image'; readonly src: string; readonly alt: string }

export type MarkdownBlock =
  | { readonly type: 'paragraph'; readonly children: readonly MarkdownInline[] }
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4; readonly children: readonly MarkdownInline[] }
  | { readonly type: 'code'; readonly language: string; readonly value: string }
  | { readonly type: 'blockquote'; readonly children: readonly MarkdownBlock[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly (readonly MarkdownInline[])[] }
  | { readonly type: 'hr' }

export type MarkdownEditAction = 'heading' | 'bold' | 'italic' | 'quote' | 'code' | 'link' | 'ul' | 'ol'

export interface MarkdownEditResult {
  readonly value: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

const ATTACHMENT_SRC = /^\/api\/attachments\/[A-Za-z0-9-]+\/content(?:[?#].*)?$/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}\.)[ \t]+(.*)$/
const HEADING = /^(#{1,4})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const FENCE = /^(`{3,}|~{3,})(.*)$/
const HR = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/

/** Allow http(s), mailto, and Taskboard attachment content URLs; drop javascript/data/relative traps. */
export function sanitizeMarkdownUrl(raw: string): string | undefined {
  const url = raw.trim()
  if (url === '') return undefined
  if (ATTACHMENT_SRC.test(url)) return url
  if (/[\s<>"']/.test(url)) return undefined
  if (/^(javascript|data|vbscript):/i.test(url)) return undefined
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url
  return undefined
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[1] ?? '```'
      const language = (fence[2] ?? '').trim()
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').startsWith(marker)) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language, value: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const marks = heading[1] ?? '#'
      const level = Math.min(marks.length, 4) as 1 | 2 | 3 | 4
      blocks.push({ type: 'heading', level, children: parseInline(heading[2] ?? '') })
      index += 1
      continue
    }
    if (HR.test(line) && LIST_ITEM.exec(line) === null) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }
    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = []
      while (index < lines.length && /^ {0,3}>/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^ {0,3}> ?/, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', children: parseMarkdown(quoted.join('\n')) })
      continue
    }
    if (LIST_ITEM.test(line)) {
      const parsed = readList(lines, index)
      blocks.push(parsed.block)
      index = parsed.nextIndex
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (next.trim() === '' || isBlockStart(next)) break
      paragraph.push(next)
      index += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) })
  }
  return blocks
}

export function applyMarkdownEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownEditAction,
): MarkdownEditResult {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd, value.length))
  const end = Math.max(0, Math.min(Math.max(selectionStart, selectionEnd), value.length))
  if (action === 'bold') return wrapSelection(value, start, end, '**', '**', 'bold')
  if (action === 'italic') return wrapSelection(value, start, end, '*', '*', 'italic')
  if (action === 'code') return wrapCode(value, start, end)
  if (action === 'link') return wrapLink(value, start, end)
  if (action === 'heading') return prefixLines(value, start, end, line => `## ${line.replace(/^#{1,6}[ \t]+/, '')}`)
  if (action === 'quote') return toggleLinePrefix(value, start, end, '> ')
  if (action === 'ul') return toggleLinePrefix(value, start, end, '- ')
  return numberLines(value, start, end)
}

function isBlockStart(line: string): boolean {
  return HEADING.test(line)
    || FENCE.test(line)
    || (HR.test(line) && LIST_ITEM.exec(line) === null)
    || /^ {0,3}>/.test(line)
    || LIST_ITEM.test(line)
}

function readList(lines: readonly string[], start: number): { block: Extract<MarkdownBlock, { type: 'list' }>; nextIndex: number } {
  const first = LIST_ITEM.exec(lines[start] ?? '')
  const ordered = /^\d{1,9}\.$/.test(first?.[2] ?? '')
  const items: string[][] = []
  let index = start
  let current: string[] | undefined
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      const peek = lines[index + 1] ?? ''
      if (current !== undefined && (LIST_ITEM.test(peek) || /^\s{2,}\S/.test(peek))) {
        index += 1
        continue
      }
      break
    }
    const item = LIST_ITEM.exec(line)
    if (item !== null && /^\d{1,9}\.$/.test(item[2] ?? '') === ordered) {
      current = [item[3] ?? '']
      items.push(current)
      index += 1
      continue
    }
    if (current !== undefined && /^\s{2,}/.test(line)) {
      current.push(line.trim())
      index += 1
      continue
    }
    break
  }
  return {
    block: { type: 'list', ordered, items: items.map(parts => parseInline(parts.join('\n'))) },
    nextIndex: index,
  }
}

export function parseInline(input: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let index = 0
  let textStart = 0
  const flush = (to: number): void => {
    if (to > textStart) nodes.push({ type: 'text', value: input.slice(textStart, to) })
  }
  while (index < input.length) {
    const ch = input[index] ?? ''
    if (ch === '\\' && index + 1 < input.length) {
      flush(index)
      nodes.push({ type: 'text', value: input[index + 1] ?? '' })
      index += 2
      textStart = index
      continue
    }
    if (ch === '`') {
      const closed = findClosing(input, index + 1, '`')
      if (closed !== undefined) {
        flush(index)
        nodes.push({ type: 'code', value: input.slice(index + 1, closed) })
        index = closed + 1
        textStart = index
        continue
      }
    }
    if (input.startsWith('![', index)) {
      const image = readLink(input, index, true)
      if (image !== undefined) {
        flush(index)
        nodes.push(image.node)
        index = image.end
        textStart = index
        continue
      }
    }
    if (ch === '[') {
      const link = readLink(input, index, false)
      if (link !== undefined) {
        flush(index)
        nodes.push(link.node)
        index = link.end
        textStart = index
        continue
      }
    }
    if (input.startsWith('**', index) || input.startsWith('__', index)) {
      const delim = input.slice(index, index + 2)
      const closed = findClosing(input, index + 2, delim)
      if (closed !== undefined && closed > index + 2) {
        flush(index)
        nodes.push({ type: 'strong', children: parseInline(input.slice(index + 2, closed)) })
        index = closed + 2
        textStart = index
        continue
      }
    }
    if (input.startsWith('~~', index)) {
      const closed = findClosing(input, index + 2, '~~')
      if (closed !== undefined && closed > index + 2) {
        flush(index)
        nodes.push({ type: 'del', children: parseInline(input.slice(index + 2, closed)) })
        index = closed + 2
        textStart = index
        continue
      }
    }
    if ((ch === '*' || ch === '_') && canOpenEmphasis(input, index, ch)) {
      const closed = findClosing(input, index + 1, ch)
      if (closed !== undefined && closed > index + 1 && (input[closed - 1] ?? '') !== ' ' && canCloseEmphasis(input, closed, ch)) {
        flush(index)
        nodes.push({ type: 'em', children: parseInline(input.slice(index + 1, closed)) })
        index = closed + 1
        textStart = index
        continue
      }
    }
    index += 1
  }
  flush(input.length)
  return nodes
}

function canOpenEmphasis(input: string, index: number, marker: string): boolean {
  const next = input[index + 1] ?? ''
  if (next === '' || next === ' ' || next === marker) return false
  if (marker !== '_') return true
  const prev = index === 0 ? ' ' : input[index - 1] ?? ' '
  return !/[A-Za-z0-9]/.test(prev)
}

function canCloseEmphasis(input: string, index: number, marker: string): boolean {
  if (marker !== '_') return true
  const next = input[index + 1] ?? ' '
  return !/[A-Za-z0-9]/.test(next)
}

function findClosing(input: string, from: number, delim: string): number | undefined {
  let index = from
  while (index < input.length) {
    if (input[index] === '\\') {
      index += 2
      continue
    }
    if (input.startsWith(delim, index)) return index
    index += 1
  }
  return undefined
}

function readLink(
  input: string,
  start: number,
  image: boolean,
): { readonly node: MarkdownInline; readonly end: number } | undefined {
  const labelStart = image ? start + 2 : start + 1
  let depth = 1
  let index = labelStart
  while (index < input.length) {
    const ch = input[index] ?? ''
    if (ch === '\\') {
      index += 2
      continue
    }
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        if ((input[index + 1] ?? '') !== '(') return undefined
        const close = input.indexOf(')', index + 2)
        if (close === -1) return undefined
        const label = input.slice(labelStart, index)
        const href = sanitizeMarkdownUrl(input.slice(index + 2, close))
        const end = close + 1
        const fallback: MarkdownInline = { type: 'text', value: input.slice(start, end) }
        if (href === undefined) return { node: fallback, end }
        if (image) return { node: { type: 'image', src: href, alt: label }, end }
        return { node: { type: 'link', href, children: parseInline(label) }, end }
      }
    }
    index += 1
  }
  return undefined
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder: string,
): MarkdownEditResult {
  const selected = value.slice(start, end) || placeholder
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
  const selectionStart = start + before.length
  return { value: next, selectionStart, selectionEnd: selectionStart + selected.length }
}

function wrapCode(value: string, start: number, end: number): MarkdownEditResult {
  const selected = value.slice(start, end)
  if (selected.includes('\n')) {
    const body = selected.replace(/^\n/, '').replace(/\n$/, '')
    const inserted = `\`\`\`\n${body}\n\`\`\``
    const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`
    return { value: next, selectionStart: start + 4, selectionEnd: start + 4 + body.length }
  }
  return wrapSelection(value, start, end, '`', '`', 'code')
}

function wrapLink(value: string, start: number, end: number): MarkdownEditResult {
  const selected = value.slice(start, end)
  if (selected.length > 0) {
    const next = `${value.slice(0, start)}[${selected}](url)${value.slice(end)}`
    const urlStart = start + selected.length + 3
    return { value: next, selectionStart: urlStart, selectionEnd: urlStart + 3 }
  }
  const inserted = '[text](url)'
  const next = `${value.slice(0, start)}${inserted}${value.slice(end)}`
  return { value: next, selectionStart: start + 1, selectionEnd: start + 5 }
}

function lineRange(value: string, start: number, end: number): { readonly from: number; readonly to: number } {
  const from = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
  const newline = value.indexOf('\n', end)
  return { from, to: newline === -1 ? value.length : newline }
}

function replaceLines(
  value: string,
  start: number,
  end: number,
  rewrite: (lines: readonly string[]) => string[],
): MarkdownEditResult {
  const { from, to } = lineRange(value, start, end)
  const nextBlock = rewrite(value.slice(from, to).split('\n')).join('\n')
  const next = `${value.slice(0, from)}${nextBlock}${value.slice(to)}`
  return { value: next, selectionStart: from, selectionEnd: from + nextBlock.length }
}

function prefixLines(value: string, start: number, end: number, rewrite: (line: string) => string): MarkdownEditResult {
  return replaceLines(value, start, end, lines => lines.map(rewrite))
}

function toggleLinePrefix(value: string, start: number, end: number, prefix: string): MarkdownEditResult {
  return replaceLines(value, start, end, lines => {
    const allPrefixed = lines.every(line => line.startsWith(prefix))
    return lines.map(line => allPrefixed ? line.slice(prefix.length) : line.startsWith(prefix) ? line : `${prefix}${line}`)
  })
}

function numberLines(value: string, start: number, end: number): MarkdownEditResult {
  return replaceLines(value, start, end, lines => {
    const numbered = lines.every(line => /^\d+\. /.test(line))
    return numbered
      ? lines.map(line => line.replace(/^\d+\. /, ''))
      : lines.map((line, index) => `${index + 1}. ${line.replace(/^\d+\. /, '')}`)
  })
}
