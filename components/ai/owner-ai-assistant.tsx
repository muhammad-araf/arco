'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  X, 
  ArrowUp, 
  Loader2, 
  CheckCircle2, 
  Boxes, 
  Users2, 
  Wallet, 
  Maximize2, 
  Brain,
  ChevronDown,
  ChevronRight,
  Bot
} from 'lucide-react'
import { MarkdownContent } from './markdown-content'

interface ActionReceipt {
  action: string
  details: string
  success: boolean
  data?: any
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  status?: string
  actions?: ActionReceipt[]
}

function ThinkingBlock({ thinking, status }: { thinking?: string; status?: string }) {
  const [open, setOpen] = React.useState(false)

  if (!thinking && !status) return null

  return (
    <div className="rounded border border-border/80 bg-muted/40 overflow-hidden text-xs my-1.5 shadow-2xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-left hover:bg-muted/70 text-muted-foreground hover:text-foreground cursor-pointer text-[11px]"
      >
        <div className="flex items-center gap-1.5 font-medium">
          <Brain className="h-3 w-3 text-amber-500 shrink-0" />
          <span>{status ? status : 'Thought Process'}</span>
          {status && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />}
        </div>
        {thinking && (
          <div className="flex items-center gap-0.5 text-[10px]">
            <span>{open ? 'Hide' : 'Steps'}</span>
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </div>
        )}
      </button>

      {open && thinking && (
        <div className="px-3 py-2 border-t border-border/60 font-mono text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap bg-background/50 max-h-40 overflow-y-auto select-text">
          {thinking}
        </div>
      )}
    </div>
  )
}

const QUICK_PROMPTS = [
  { icon: Wallet, label: 'Daybook', prompt: 'Show today cash in hand and daybook summary' },
  { icon: Users2, label: 'Parties', prompt: 'Top party balances: kis se kitna lena he aur kis ko kitna dena he?' },
  { icon: Boxes, label: 'Stock', prompt: 'Check stock levels in all godowns and low stock alerts' }
]

export function OwnerAIAssistant() {
  const [open, setOpen] = React.useState(false)
  // On /chat the full page IS the assistant (its own input bar, send
  // button and hint text sit at the panel bottom), so the floating
  // pill has no job there and any fixed bottom-right position would
  // eventually collide with it — the /chat textarea auto-grows to
  // 160px, pushing the input zone to ~230px above the viewport
  // bottom, so no fixed offset can clear it in all states. Hiding
  // the pill on /chat only (it stays on every other page) is what
  // guarantees the pill never covers the chat input, send button
  // or hint text. The drawer itself is untouched: if it was already
  // open when navigating to /chat it stays open until closed, as
  // on any other navigation, since this layout does not remount.
  const pathname = usePathname()
  const isChatPage = pathname === '/chat' || pathname.startsWith('/chat/')
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const messagesEndRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  const handleSubmit = async (overridePrompt?: string) => {
    const promptToSend = (overridePrompt || input).trim()
    if (!promptToSend || loading) return

    setInput('')
    const userMsg: Message = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: promptToSend
    }

    const placeholderId = `asst-${Date.now()}`
    const placeholderMsg: Message = {
      id: placeholderId,
      role: 'assistant',
      content: '',
      status: 'Querying database...'
    }

    const newMessages = [...messages, userMsg]
    setMessages([...newMessages, placeholderMsg])
    setLoading(true)

    try {
      const historyPayload = newMessages.map(m => ({
        role: m.role,
        content: m.content
      }))

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historyPayload })
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error ${res.status}`)
      }

      if (!res.body) throw new Error('No stream available')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulatedText = ''
      let accumulatedThinking = ''
      let actionsAccumulated: ActionReceipt[] = []
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data: ')) continue

          try {
            const event = JSON.parse(trimmed.slice(6))

            if (event.type === 'delta') {
              accumulatedText += event.text
              setMessages(prev =>
                prev.map(m =>
                  m.id === placeholderId
                    ? { ...m, content: accumulatedText, status: undefined }
                    : m
                )
              )
            } else if (event.type === 'status') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === placeholderId ? { ...m, status: event.message } : m
                )
              )
            } else if (event.type === 'thinking') {
              accumulatedThinking += (accumulatedThinking ? '\n' : '') + event.text
              setMessages(prev =>
                prev.map(m =>
                  m.id === placeholderId ? { ...m, thinking: accumulatedThinking } : m
                )
              )
            } else if (event.type === 'action') {
              actionsAccumulated.push(event.action)
              setMessages(prev =>
                prev.map(m =>
                  m.id === placeholderId
                    ? { ...m, actions: [...actionsAccumulated] }
                    : m
                )
              )
            } else if (event.type === 'error') {
              accumulatedText += `\n\n⚠️ **Error**: ${event.error}`
              setMessages(prev =>
                prev.map(m =>
                  m.id === placeholderId
                    ? { ...m, content: accumulatedText, status: undefined }
                    : m
                )
              )
            }
          } catch (e) {}
        }
      }

      setMessages(prev =>
        prev.map(m =>
          m.id === placeholderId
            ? {
                ...m,
                content: accumulatedText || 'Operation completed.',
                thinking: accumulatedThinking || undefined,
                actions: actionsAccumulated.length > 0 ? actionsAccumulated : undefined
              }
            : m
        )
      )
    } catch (err: any) {
      setMessages(prev =>
        prev.map(m =>
          m.id === placeholderId
            ? {
                ...m,
                content: `⚠️ **Request Failed**: ${err?.message || 'Error communicating with AI assistant.'}`,
                status: undefined
              }
            : m
        )
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating Pill Trigger — NOT bottom-5: at bottom-5 (20px) the
          pill sat squarely inside the bottom-anchored control band of
          every page (the /chat input bar + hint, pagination, footers
          and submit rows all live within ~110px of the viewport
          bottom once scrolled to the end, after the main padding).
          bottom-40 (160px) lifts it clear of that whole band with
          ~50px to spare, while keeping it a visible entry point on
          non-chat pages. It still overlays scrollable rows mid-page
          at some scroll positions — unavoidable for any fixed FAB —
          but those rows scroll out from under it, unlike fixed
          bottom controls which cannot. z-40 unchanged: below the
          mobile sidebar drawer (z-50) and modals (z-[100]), above
          the sticky header (z-30), which it never meets
          geometrically (header top, pill lower-right). */}
      {!isChatPage && (
      <div className="fixed bottom-40 right-5 z-40">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-colors duration-200 cursor-pointer border border-emerald-400/30 font-semibold text-xs"
          title="Open AI Command Assistant"
        >
          <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Bot className="h-3 w-3 text-white" />
          </div>
          <span>ARCO AI</span>
          <span className="hidden sm:inline text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">
            Live DB
          </span>
        </button>
      </div>
      )}

      {/* Slide-over Drawer Backdrop & Panel */}
      {open && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          <div 
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={() => setOpen(false)}
          />

          <div className="relative w-full max-w-md bg-card border-l border-border h-full flex flex-col shadow-md z-10 animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="h-14 border-b border-border px-4 flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-600/30 flex items-center justify-center">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-foreground">ARCO AI Assistant</h3>
                  <p className="text-[10px] text-muted-foreground">Connected to Supabase Database</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <Link
                  href="/chat"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Expand to Full Chat Page"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Quick Chips */}
            <div className="px-3 py-2 border-b border-border bg-muted/10 flex items-center gap-1.5 overflow-x-auto">
              {QUICK_PROMPTS.map((qp, idx) => {
                const Icon = qp.icon
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSubmit(qp.prompt)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-card hover:bg-muted border border-border text-[11px] font-medium text-foreground shrink-0 cursor-pointer transition-colors"
                  >
                    <Icon className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span>{qp.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-4">
                  <Bot className="h-8 w-8 text-muted-foreground/60 mb-2" />
                  <p className="text-xs font-semibold text-foreground">
                    Ask anything about ARCO
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
                    Get instant financial numbers, inventory balances, employee attendance, or record new vouchers.
                  </p>
                </div>
              ) : (
                messages.map(m => {
                  const isUser = m.role === 'user'
                  return (
                    <div
                      key={m.id}
                      className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      {!isUser && (
                        <div className="h-6 w-6 rounded bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-600/30 flex items-center justify-center shrink-0 mt-0.5">
                          <Bot className="h-3 w-3" />
                        </div>
                      )}

                      <div className="max-w-[85%] space-y-1">
                        <div
                          className={`rounded p-3 text-xs ${
                            isUser
                              ? 'bg-emerald-600 text-white ml-auto'
                              : 'bg-card border border-border text-foreground shadow-2xs'
                          }`}
                        >
                          {!isUser && (
                            <ThinkingBlock thinking={m.thinking} status={m.status} />
                          )}

                          {!isUser && m.actions && m.actions.length > 0 && (
                            <div className="my-1.5 space-y-1">
                              {m.actions.map((act, aIdx) => (
                                <div
                                  key={aIdx}
                                  className="flex items-start gap-1.5 p-1.5 rounded bg-muted/60 border border-border/70 text-[10px]"
                                >
                                  <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <span className="font-semibold text-foreground">{act.action}</span>
                                    <p className="text-muted-foreground mt-0.5">{act.details}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {isUser ? (
                            <p className="whitespace-pre-wrap select-text">{m.content}</p>
                          ) : (
                            <MarkdownContent content={m.content} />
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}

              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                  <span>Processing...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Footer */}
            <div className="p-3 border-t border-border bg-card">
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSubmit()
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask ARCO AI (English or Roman Urdu)..."
                  disabled={loading}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="h-8 w-8 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 cursor-pointer transition-colors shadow-xs"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
