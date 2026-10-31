'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowUp,
  Loader2,
  CheckCircle2,
  Database,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Bot
} from 'lucide-react'
import { 
  getChatSessions,
  getChatSession, 
  saveChatSession, 
  createNewSession
} from '@/lib/ai/chat-storage'
import { MarkdownContent } from '@/components/ai/markdown-content'

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
  timestamp: string
  thinking?: string
  status?: string
  actions?: ActionReceipt[]
}

function ThinkingBlock({ thinking, status }: { thinking?: string; status?: string }) {
  const [open, setOpen] = React.useState(false)

  if (!thinking && !status) return null

  return (
    <div className="rounded-md border border-border/80 bg-muted/40 overflow-hidden text-xs my-2 max-w-xl shadow-2xs transition-all">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
      >
        <span className="font-medium">Thought Process</span>
        {thinking && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <span>{open ? 'Hide' : 'Show steps'}</span>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </div>
        )}
      </button>

      {open && thinking && (
        <div className="px-3 py-2 border-t border-border/60 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap bg-background max-h-48 overflow-y-auto select-text">
          {thinking}
        </div>
      )}
    </div>
  )
}

export function ChatClient({ actor }: { actor: { userId: string; email: string | null; role: string; displayName: string } }) {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session')

  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(sessionId)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [copiedId, setCopiedId] = React.useState<string | null>(null)

  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  // Guards the first-session auto-select below so it runs on initial
  // mount only. Without this, navigating back to bare /chat (sidebar
  // New Chat, or deleting the last session) would bounce the user
  // back into the first session instead of staying an empty new chat.
  const initialMountRef = React.useRef(false)

  // Load the ?session= session, or — on initial mount only — the first
  // session when there is no ?session= param. The conversation list
  // itself lives in the global sidebar now, so this page is a single
  // column and no longer keeps its own session list.
  React.useEffect(() => {
    if (sessionId) {
      initialMountRef.current = true
      const active = getChatSession(sessionId)
      if (active) {
        setMessages(active.messages as Message[])
        setActiveSessionId(active.id)
      }
      return
    }

    if (!initialMountRef.current) {
      initialMountRef.current = true
      const list = getChatSessions()
      if (list.length > 0) {
        const first = list[0]
        setActiveSessionId(first.id)
        setMessages(first.messages as Message[])
      }
      return
    }

    // Later navigation to bare /chat: stay an empty new chat.
    setActiveSessionId(null)
    setMessages([])
    setInput('')
  }, [sessionId])

  // Auto scroll
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Auto-grow textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
    }
  }

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleSubmit = async (overridePrompt?: string) => {
    const promptToSend = (overridePrompt || input).trim()
    if (!promptToSend || loading) return

    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    const userMessage: Message = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: promptToSend,
      timestamp: timeStr
    }

    const assistantPlaceholderId = `asst-${Date.now()}`
    const placeholderAssistant: Message = {
      id: assistantPlaceholderId,
      role: 'assistant',
      content: '',
      timestamp: timeStr,
      status: 'Analyzing business request...'
    }

    const newMessages = [...messages, userMessage]
    setMessages([...newMessages, placeholderAssistant])
    setLoading(true)

    // Ensure session exists
    let currSessionId = activeSessionId
    if (!currSessionId) {
      const created = createNewSession(promptToSend)
      currSessionId = created.id
      setActiveSessionId(currSessionId)
      saveChatSession(created)
      window.history.replaceState(null, '', `/chat?session=${currSessionId}`)
    }

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

      if (!res.body) {
        throw new Error('No readable response body stream received.')
      }

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
                  m.id === assistantPlaceholderId
                    ? { ...m, content: accumulatedText, status: undefined }
                    : m
                )
              )
            } else if (event.type === 'status') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantPlaceholderId
                    ? { ...m, status: event.message }
                    : m
                )
              )
            } else if (event.type === 'thinking') {
              accumulatedThinking += (accumulatedThinking ? '\n' : '') + event.text
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantPlaceholderId
                    ? { ...m, thinking: accumulatedThinking }
                    : m
                )
              )
            } else if (event.type === 'action') {
              actionsAccumulated.push(event.action)
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantPlaceholderId
                    ? { ...m, actions: [...actionsAccumulated] }
                    : m
                )
              )
            } else if (event.type === 'error') {
              accumulatedText += `\n\n⚠️ **Error**: ${event.error}`
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantPlaceholderId
                    ? { ...m, content: accumulatedText, status: undefined }
                    : m
                )
              )
            }
          } catch (e) {
            // Ignore parse errors on split packets
          }
        }
      }

      // Finalize and save to storage
      const finalAssistant: Message = {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: accumulatedText || 'Operation completed.',
        timestamp: timeStr,
        thinking: accumulatedThinking || undefined,
        actions: actionsAccumulated.length > 0 ? actionsAccumulated : undefined
      }

      const completedConversation = [...newMessages, finalAssistant]
      setMessages(completedConversation)

      const existingSession = getChatSession(currSessionId)
      if (existingSession) {
        saveChatSession({
          ...existingSession,
          messages: completedConversation,
          updatedAt: new Date().toISOString()
        })
      }
    } catch (err: any) {
      console.error('Chat error:', err)
      const errorMsg: Message = {
        id: assistantPlaceholderId,
        role: 'assistant',
        content: `⚠️ **Request Failed**: ${err?.message || 'Could not communicate with AI agent.'}`,
        timestamp: timeStr
      }
      setMessages([...newMessages, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    // Single column: the conversation list lives in the global sidebar
    // now, so this page is always just the centered message column,
    // the input bar, and the disclaimer line — on mobile as well as
    // desktop (the list is reached via the sidebar drawer).
    <div className="h-[calc(100vh-6.5rem)] flex flex-col rounded-md border border-border bg-card shadow-xs overflow-hidden">
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Messages Stream — centered max-width column. */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center py-8">
              <div className="h-12 w-12 rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-600/25 flex items-center justify-center mb-3">
                <Bot className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                How can I assist your operations today?
              </h3>
            </div>
          ) : (
            messages.map(m => {
              const isUser = m.role === 'user'

              return (
                <div
                  key={m.id}
                  className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="h-7 w-7 rounded bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-600/30 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5" />
                    </div>
                  )}

                  <div className={`min-w-0 max-w-[85%] sm:max-w-[78%] space-y-1.5`}>
                    <div
                      className={`min-w-0 break-words rounded-md p-3.5 text-xs ${
                        isUser
                          ? 'bg-emerald-600 text-white ml-auto shadow-xs'
                          : 'bg-card border border-border shadow-2xs text-foreground'
                      }`}
                    >
                      {/* Thought process block */}
                      {!isUser && (
                        <ThinkingBlock thinking={m.thinking} status={m.status} />
                      )}

                      {/* Action receipts */}
                      {!isUser && m.actions && m.actions.length > 0 && (
                        <div className="my-2 space-y-1.5">
                          {m.actions.map((act, aIdx) => (
                            <div
                              key={aIdx}
                              className="flex items-start gap-2 p-2 rounded bg-muted/60 border border-border/70 text-[11px]"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <span className="font-semibold text-foreground uppercase tracking-wide break-words">
                                  {act.action}
                                </span>
                                <p className="text-muted-foreground mt-0.5 break-words">{act.details}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Content */}
                      {isUser ? (
                        <p className="whitespace-pre-wrap break-words leading-relaxed select-text font-normal">
                          {m.content}
                        </p>
                      ) : (
                        <MarkdownContent content={m.content} />
                      )}
                    </div>

                    {/* Metadata & Copy action */}
                    <div className={`flex flex-wrap items-center gap-2 px-1 text-[10px] text-muted-foreground ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <span>{m.timestamp}</span>
                      {!isUser && m.content && (
                        <button
                          type="button"
                          onClick={() => handleCopy(m.id, m.content)}
                          className="hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
                        >
                          {copiedId === m.id ? (
                            <>
                              <Check className="h-2.5 w-2.5 text-emerald-500" />
                              <span className="text-emerald-500">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-2.5 w-2.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {isUser && (
                    <div className="h-7 w-7 rounded bg-secondary text-secondary-foreground border border-border flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold">
                      {actor.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {loading && (
            <div className="flex gap-2 items-center text-xs text-muted-foreground pt-1 pl-10">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              <span>Processing live database operations...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Bar */}
        <div className="p-3 sm:p-4 border-t border-border bg-card">
          <div className="relative flex items-end rounded-md border border-border bg-background focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 transition-all p-1.5">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything"
              rows={1}
              disabled={loading}
              className="w-full min-w-0 resize-none border-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none p-2 min-h-[38px] max-h-[160px] leading-relaxed"
            />
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!input.trim() || loading}
              className="h-8 w-8 rounded bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-xs ml-1"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center mt-1.5">
            ARCO AI acts live on your database. Check details before critical changes.
          </p>
        </div>
      </div>
    </div>
  )
}
