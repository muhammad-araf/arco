'use client'

import React from 'react'

interface MarkdownContentProps {
  content: string
  className?: string
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
      const url = m.slice(splitIdx + 2, -1)
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

  const headerCells = parseRow(tableLines[0])
  const dataLines = tableLines.slice(2)

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
  let listBuffer: string[] = []

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      elements.push(renderTable(tableBuffer, `tbl-${elements.length}`))
      tableBuffer = []
      inTable = false
    }
  }

  const flushList = () => {
    if (listBuffer.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-2 space-y-1.5 list-disc list-inside text-xs leading-relaxed text-foreground/90">
          {listBuffer.map((item, idx) => (
            <li key={idx} className="pl-1">
              <InlineMarkdown text={item} />
            </li>
          ))}
        </ul>
      )
      listBuffer = []
      inList = false
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    // Table detection
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushList()
      inTable = true
      tableBuffer.push(trimmed)
      continue
    } else if (inTable) {
      flushTable()
    }

    // List detection
    if (/^[-*]\s+/.test(trimmed)) {
      inList = true
      listBuffer.push(trimmed.replace(/^[-*]\s+/, ''))
      continue
    } else if (inList) {
      flushList()
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3 key={i} className="text-sm font-bold text-foreground mt-3 mb-1.5 flex items-center gap-1.5">
          <InlineMarkdown text={trimmed.replace('### ', '')} />
        </h3>
      )
      continue
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2 key={i} className="text-base font-bold text-foreground mt-4 mb-2 flex items-center gap-2 border-b border-border/60 pb-1">
          <InlineMarkdown text={trimmed.replace('## ', '')} />
        </h2>
      )
      continue
    }
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1 key={i} className="text-lg font-bold text-foreground mt-4 mb-2">
          <InlineMarkdown text={trimmed.replace('# ', '')} />
        </h1>
      )
      continue
    }

    // Horizontal Rule
    if (/^---{3,}$/.test(trimmed)) {
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

  return <div className={`space-y-1 text-xs select-text ${className}`}>{elements}</div>
}
