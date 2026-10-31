import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownContent } from '@/components/ai/markdown-content'

function render(content: string): string {
  return renderToStaticMarkup(React.createElement(MarkdownContent, { content }))
}

describe('MarkdownContent heading rendering', () => {
  it('renders #### as an h4 without raw markers (screenshot case)', () => {
    const html = render('#### 💡 Recommended Next Actions\n- **Follow up** on receivables')
    expect(html).toContain('<h4')
    expect(html).toContain('💡 Recommended Next Actions')
    expect(html).not.toContain('####')
    expect(html).toContain('<strong')
    expect(html).toContain('Follow up')
  })

  it('renders all ATX levels 1-6 and keeps h1/h2/h3 tags', () => {
    const html = render('# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six')
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(html).toContain(`<h${level}`)
    }
    expect(html).not.toMatch(/#{1,6} /)
  })

  it('renders the screenshot shape end to end', () => {
    const content = [
      '### 💰 Daybook & Cash Flow Summary',
      '',
      '| Metric | Amount |',
      '|---|---|',
      '| Total Inflow | Rs 1,234,500 |',
      '| Net Flow | Rs 45,600 |',
      '',
      '#### 💡 Recommended Next Actions',
      '- **Follow up** on Rs 45,600 outstanding',
      '- Review cash in hand',
    ].join('\n')
    const html = render(content)
    expect(html).toContain('<h3')
    expect(html).toContain('<table')
    expect(html).toContain('<h4')
    expect(html).toContain('Rs 1,234,500')
    expect(html).toContain('Rs 45,600')
    expect(html).not.toContain('####')
  })
})

describe('MarkdownContent other block markers', () => {
  it('renders a standard --- horizontal rule instead of printing it', () => {
    const html = render('Above\n---\nBelow')
    expect(html).toContain('<hr')
    expect(html).not.toContain('---')
  })

  it('renders ordered lists as <ol> instead of plain paragraphs', () => {
    const html = render('1. First step\n2. Second step')
    expect(html).toContain('<ol')
    expect(html).toContain('First step')
  })

  it('renders fenced code blocks without leaking fence markers', () => {
    const html = render('Before\n```\nSELECT 1\n```\nAfter')
    expect(html).toContain('<pre')
    expect(html).toContain('SELECT 1')
    expect(html).not.toContain('```')
  })

  it('keeps table data rows when the separator row is omitted', () => {
    const html = render('| Item | Qty |\n| Wheat | 100 |')
    expect(html).toContain('<table')
    expect(html).toContain('Wheat')
    expect(html).toContain('100')
  })

  it('never alters figures: amounts render verbatim', () => {
    const html = render('Net Flow: Rs 1,234,500.75 and 0.5% yield')
    expect(html).toContain('Rs 1,234,500.75')
    expect(html).toContain('0.5%')
  })
})

describe('MarkdownContent link safety', () => {
  it('renders http/https links as anchors', () => {
    const html = render('[Docs](https://example.com/report)')
    expect(html).toContain('<a href="https://example.com/report"')
  })

  it('does not render javascript: URLs as clickable links', () => {
    const html = render('[Click me](javascript:alert(1))')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<a')
    expect(html).toContain('Click me')
  })
})
