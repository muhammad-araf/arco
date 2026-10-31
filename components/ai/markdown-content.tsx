'use client'

import React from 'react'

interface MarkdownContentProps {
  content: string
  className?: string
}

// Only these href shapes may become clickable links. Anything else
// (javascript:, data:, vbscript:, mailto:, protocol-relative, …) is
// rendered as plain text so a model-emitted URL can never become an
// executable link. React's own escaping still covers the label text.
function safeHref(url: string): string | null {
  const href = url.trim()
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (href.startsWith('#')) return href
  return null
}

export function InlineMarkdown({ text }: { text: string }) {
  if (!text) return null

  const regex = /(\*\*[^*]+?\*\*|`[^`]+?`|\*[^*]+?\*|\[[^\]]+?\]\([^)]+?\))/g
  const parts = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'text',
        val: text.slice(lastIndex, match.index)
      })
    }

    const m = match[0]
    if (m.startsWith('**') && m.endsWith('**')) {
      parts.push({ type: 'bold', val: m.slice(2, -2) })
    } else if (m.startsWith('`') && m.endsWith('`')) {
      parts.push({ type: 'code', val: m.slice(1, -1) })
    } else if (m.startsWith('*') && m.endsWith('*')) {
      parts.push({ type: 'italic', val: m.slice(1, -1) })
    } else if (m.startsWith('[') && m.includes('](') && m.endsWith(')')) {
      const splitIdx = m.indexOf('](')
      const label = m.slice(1, splitIdx)
      const url = safeHref(m.slice(splitIdx + 2, -1))
      parts.push({ type: 'link', val: label, url })
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', val: text.slice(lastIndex) })
  }

  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'bold') {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {p.val}
            </strong>
          )
        }
        if (p.type === 'code') {
          return (
            <code
              key={i}
              className="px-1.5 py-0.5 rounded bg-muted border border-border text-emerald-600 dark:text-emerald-400 font-mono text-[11px]"
            >
              {p.val}
            </code>
          )
        }
        if (p.type === 'italic') {
          return (
            <em key={i} className="italic text-foreground/90">
              {p.val}
            </em>
          )
        }
        if (p.type === 'link') {
          if (!p.url) {
            // Unsafe scheme: show the label as plain text, never as a link.
            return <span key={i}>{p.val}</span>
          }
          return (
            <a
              key={i}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium"
            >
              {p.val}
            </a>
          )
        }
        return <span key={i}>{p.val}</span>
      })}
    </>
  )
}

function renderTable(tableLines: string[], key: string | number) {
  if (tableLines.length < 2) return null

  const parseRow = (line: string) => {
    return line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim())
  }

  // The second line is a separator row (|---|---|) in a well-formed table.
  // If it is not (model omitted it), it is a data row — dropping it via a
  // blind slice(2) would silently lose figures, so only skip it when it
  // really is a separator.
  const isSeparatorRow = (line: string) =>
    parseRow(line).length > 0 &&
    parseRow(line).every(cell => /^:?-+:?$/.test(cell))
  const headerCells = parseRow(tableLines[0])
  const dataLines =
    tableLines.length > 1 && isSeparatorRow(tableLines[1])
      ? tableLines.slice(2)
      : tableLines.slice(1)

  return (
    <div key={key} className="my-3 overflow-x-auto rounded-md border border-border shadow-2xs">
      <table className="w-full text-xs text-left border-collapse">
        <thead className="bg-muted/70 text-foreground font-semibold border-b border-border">
          <tr>
            {headerCells.map((cell, idx) => (
              <th key={idx} className="px-3 py-2 text-left whitespace-nowrap">
                <InlineMarkdown text={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60 bg-card">
          {dataLines.map((rowLine, rIdx) => {
            const cells = parseRow(rowLine)
            return (
              <tr key={rIdx} className="hover:bg-muted/30 transition-colors">
                {cells.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3 py-2 text-foreground/90 leading-relaxed">
                    <InlineMarkdown text={cell} />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  if (!content) return null

  const lines = content.split('\n')
  const elements: React.ReactNode[] = []

  let inTable = false
  let tableBuffer: string[] = []

  let inList = false
  let listKind: 'ul' | 'ol' = 'ul'
  let listBuffer: string[] = []

  let inCodeBlock = false
  let codeBuffer: string[] = []

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      // A lone pipe line is not a table: render it as a paragraph instead
      // of dropping it (renderTable returns null for < 2 lines).
      if (tableBuffer.length < 2) {
        for (const line of tableBuffer) {
          elements.push(
            <p key={`tblp-${elements.length}`} className="my-1.5 text-xs leading-relaxed text-foreground/90">
              <InlineMarkdown text={line} />
            </p>
          )
        }
      } else {
        elements.push(renderTable(tableBuffer, `tbl-${elements.length}`))
      }
      tableBuffer = []
      inTable = false
    }
  }

  const flushList = () => {
    if (listBuffer.length > 0) {
      const Tag = listKind === 'ol' ? 'ol' : 'ul'
      const listClass =
        listKind === 'ol'
          ? 'my-2 space-y-1.5 list-decimal list-inside text-xs leading-relaxed text-foreground/90'
          : 'my-2 space-y-1.5 list-disc list-inside text-xs leading-relaxed text-foreground/90'
      elements.push(
        <Tag key={`${listKind}-${elements.length}`} className={listClass}>
          {listBuffer.map((item, idx) => (
            <li key={idx} className="pl-1">
              <InlineMarkdown text={item} />
            </li>
          ))}
        </Tag>
      )
      listBuffer = []
      inList = false
    }
  }

  const flushCodeBlock = () => {
    if (codeBuffer.length > 0) {
      elements.push(
        <pre key={`code-${elements.length}`} className="my-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-3">
          <code className="font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre">
            {codeBuffer.join('\n')}
          </code>
        </pre>
      )
    }
    codeBuffer = []
    inCodeBlock = false
  }

  // ATX heading classes, h1 largest … h6 smallest, all plain flat styling.
  // The h1/h2/h3 class strings are unchanged from before this fix.
  const headingClass: Record<number, string> = {
    1: 'text-lg font-bold text-foreground mt-4 mb-2',
    2: 'text-base font-bold text-foreground mt-4 mb-2 flex items-center gap-2 border-b border-border/60 pb-1',
    3: 'text-sm font-bold text-foreground mt-3 mb-1.5 flex items-center gap-1.5',
    4: 'text-xs font-bold text-foreground mt-3 mb-1.5 flex items-center gap-1.5',
    5: 'text-xs font-semibold text-foreground mt-2.5 mb-1 flex items-center gap-1.5',
    6: 'text-xs font-semibold text-foreground/80 mt-2 mb-1',
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    // Fenced code blocks (``` … ```, optional language tag). While inside
    // one, every line is literal content — no table/list/heading parsing —
    // so the fence markers themselves never print.
    if (inCodeBlock) {
      if (trimmed.startsWith('```')) {
        flushCodeBlock()
      } else {
        codeBuffer.push(rawLine)
      }
      continue
    }
    if (trimmed.startsWith('```')) {
      flushTable()
      flushList()
      inCodeBlock = true
      codeBuffer = []
      continue
    }

    // Table detection: a row starts with '|' and has at least one more
    // pipe (trailing pipe not required — the model sometimes omits it).
    if (trimmed.startsWith('|') && trimmed.slice(1).includes('|')) {
      flushList()
      inTable = true
      tableBuffer.push(trimmed)
      continue
    } else if (inTable) {
      flushTable()
    }

    // List detection: unordered (-, *, +) and ordered ("1." / "1)") items.
    // A kind switch (bullets → numbers or vice versa) flushes first so
    // each run keeps its own list element.
    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/)
    const olMatch = trimmed.match(/^\d+[.)]\s+(.*)$/)
    if (ulMatch || olMatch) {
      const kind = ulMatch ? 'ul' : 'ol'
      if (inList && listKind !== kind) flushList()
      inList = true
      listKind = kind
      listBuffer.push((ulMatch?.[1] ?? olMatch?.[1] ?? '').trim())
      continue
    } else if (inList) {
      flushList()
    }

    // Headings: ATX levels 1–6 — 1–6 '#' chars followed by a space.
    // The old code only handled '# ', '## ', '### ' in that order, and
    // '#### ' matched none of them (startsWith('### ') needs a space as
    // the 4th character), so it fell through to a paragraph and printed
    // the raw '#### ' markers. A closing run of hashes (## Title ##)
    // is stripped, per ATX rules; a bare '####' line has no text to show.
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const headingText = headingMatch[2].replace(/\s+#+\s*$/, '').trim()
      if (headingText !== '') {
        const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        elements.push(
          <Tag key={i} className={headingClass[level]}>
            <InlineMarkdown text={headingText} />
          </Tag>
        )
      }
      continue
    }
    if (/^#{1,6}$/.test(trimmed)) {
      continue
    }

    // Horizontal Rule: ---, ***, or ___ (3+ chars). The old regex
    // /^---{3,}$/ actually required 5+ dashes (the {3,} applied to the
    // third dash only), so a standard '---' printed literally.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(<hr key={i} className="my-3 border-border/60" />)
      continue
    }

    // Empty lines
    if (trimmed === '') {
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="my-1.5 text-xs leading-relaxed text-foreground/90">
        <InlineMarkdown text={rawLine} />
      </p>
    )
  }

  flushTable()
  flushList()
  flushCodeBlock()

  return <div className={`space-y-1 text-xs select-text ${className}`}>{elements}</div>
}
