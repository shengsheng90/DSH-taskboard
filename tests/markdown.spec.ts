import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMarkdownEdit, parseMarkdown, sanitizeMarkdownUrl } from '../src/client/markdown.js'

test('markdown parser renders headings, lists, emphasis, links, images, and code', () => {
  const blocks = parseMarkdown([
    '## 问题',
    '任务详情需要 **Markdown** 和 *斜体*。',
    '',
    '- 第一项 `code`',
    '- 第二项',
    '',
    '1. 有序',
    '',
    '> 引用 **加粗**',
    '',
    '```ts',
    'const ok = true',
    '```',
    '',
    '见 [文档](https://example.com) 与 ![图](/api/attachments/ad8688e1-a734-4c1f-a7fe-f18f7217cbdf/content)',
    '',
    '---',
  ].join('\n'))
  assert.equal(blocks[0]?.type, 'heading')
  assert.equal(blocks[0]?.type === 'heading' ? blocks[0].level : 0, 2)
  assert.equal(blocks[1]?.type, 'paragraph')
  assert.deepEqual(blocks[1]?.type === 'paragraph' ? blocks[1].children.map(node => node.type) : [], ['text', 'strong', 'text', 'em', 'text'])
  assert.equal(blocks[2]?.type, 'list')
  assert.equal(blocks[2]?.type === 'list' ? blocks[2].ordered : true, false)
  assert.equal(blocks[2]?.type === 'list' ? blocks[2].items.length : 0, 2)
  assert.equal(blocks[3]?.type, 'list')
  assert.equal(blocks[3]?.type === 'list' ? blocks[3].ordered : false, true)
  assert.equal(blocks[4]?.type, 'blockquote')
  assert.equal(blocks[5]?.type, 'code')
  assert.equal(blocks[5]?.type === 'code' ? blocks[5].language : '', 'ts')
  assert.equal(blocks[5]?.type === 'code' ? blocks[5].value : '', 'const ok = true')
  assert.equal(blocks[6]?.type, 'paragraph')
  const inlines = blocks[6]?.type === 'paragraph' ? blocks[6].children : []
  assert.equal(inlines.some(node => node.type === 'link' && node.href === 'https://example.com'), true)
  assert.equal(inlines.some(node => node.type === 'image' && node.src.endsWith('/content')), true)
  assert.equal(blocks[7]?.type, 'hr')
})

test('markdown projection keeps raw HTML inert and drops unsafe urls', () => {
  const blocks = parseMarkdown('请看 <script>alert(1)</script> 和 [x](javascript:alert(1)) ![y](data:text/html,z) [ok](https://safe.example)')
  assert.equal(blocks[0]?.type, 'paragraph')
  const children = blocks[0]?.type === 'paragraph' ? blocks[0].children : []
  assert.equal(children.some(node => node.type === 'text' && node.value.includes('<script>alert(1)</script>')), true)
  assert.equal(children.some(node => node.type === 'link'), true)
  assert.equal(children.some(node => node.type === 'image'), false)
  assert.equal(children.some(node => node.type === 'link' && node.href === 'https://safe.example'), true)
  assert.equal(children.some(node => node.type === 'text' && node.value.includes('javascript:alert(1)')), true)
  assert.equal(sanitizeMarkdownUrl('javascript:alert(1)'), undefined)
  assert.equal(sanitizeMarkdownUrl('data:text/html,x'), undefined)
  assert.equal(sanitizeMarkdownUrl('/etc/passwd'), undefined)
  assert.equal(sanitizeMarkdownUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(
    sanitizeMarkdownUrl('/api/attachments/ad8688e1-a734-4c1f-a7fe-f18f7217cbdf/content'),
    '/api/attachments/ad8688e1-a734-4c1f-a7fe-f18f7217cbdf/content',
  )
})

test('markdown editor actions wrap the current selection and prefix lines', () => {
  assert.deepEqual(applyMarkdownEdit('hello', 0, 5, 'bold'), {
    value: '**hello**', selectionStart: 2, selectionEnd: 7,
  })
  assert.deepEqual(applyMarkdownEdit('hello', 0, 5, 'italic'), {
    value: '*hello*', selectionStart: 1, selectionEnd: 6,
  })
  assert.deepEqual(applyMarkdownEdit('hello', 0, 5, 'code'), {
    value: '`hello`', selectionStart: 1, selectionEnd: 6,
  })
  assert.deepEqual(applyMarkdownEdit('one\ntwo', 0, 7, 'code'), {
    value: '```\none\ntwo\n```', selectionStart: 4, selectionEnd: 11,
  })
  assert.deepEqual(applyMarkdownEdit('hello', 0, 5, 'link'), {
    value: '[hello](url)', selectionStart: 8, selectionEnd: 11,
  })
  assert.deepEqual(applyMarkdownEdit('title', 0, 5, 'heading'), {
    value: '## title', selectionStart: 0, selectionEnd: 8,
  })
  assert.deepEqual(applyMarkdownEdit('line', 0, 4, 'quote'), {
    value: '> line', selectionStart: 0, selectionEnd: 6,
  })
  assert.deepEqual(applyMarkdownEdit('a\nb', 0, 3, 'ul'), {
    value: '- a\n- b', selectionStart: 0, selectionEnd: 7,
  })
  assert.deepEqual(applyMarkdownEdit('a\nb', 0, 3, 'ol'), {
    value: '1. a\n2. b', selectionStart: 0, selectionEnd: 9,
  })
  assert.deepEqual(applyMarkdownEdit('- a\n- b', 0, 7, 'ul'), {
    value: 'a\nb', selectionStart: 0, selectionEnd: 3,
  })
})
