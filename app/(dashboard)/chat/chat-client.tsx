'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { 
  Sparkles, 
  ArrowUp, 
  Loader2, 
  CheckCircle2, 
  Database,
  Boxes,
  Users2,
  Wallet,
  ScrollText,
  Copy,
  Check,
  Plus,
  Trash2,
  Brain,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Bot
} from 'lucide-react'
import { 
  getChatSessions, 
  getChatSession, 
  saveChatSession, 
  deleteChatSession, 
  createNewSession, 
  type ChatSession 
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
        <div className="flex items-center gap-2 font-medium">
          <Brain className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span>{status ? status : 'Thought Process & Database Tools'}</span>
          {status && (
            <span className="flex h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping shrink-0" />
          )}
        </div>
        {thinking && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/80">
            <span>{open ? 'Hide' : 'Show steps'}</span>
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </div>
        )}
      </button>

      {open && thinking && (
        <div className="px-3 py-2 border-t border-border/60 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap bg-background/50 max-h-48 overflow-y-auto select-text">
          {thinking}
        </div>
      )}
    </div>
  )
}

const STARTER_PROMPTS = [
  {
    icon: Wallet,
    title: 'Daybook & Cash Flow',
    desc: 'Audit cash-in, expenses, and net daily cash',
    prompt: 'Show today cash in hand and daybook summary'
  },
  {
    icon: Users2,
    title: 'Party Balances',
    desc: 'Customer receivables & vendor payables',
    prompt: 'Top party balances: kis se kitna lena he aur kis ko kitna dena he?'
  },
  {
    icon: Boxes,
    title: 'Live Stock Levels',
    desc: 'Godown inventory & low-stock alerts',
    prompt: 'Check stock levels in all godowns and low stock alerts'
  },
  {
    icon: ScrollText,
    title: 'Machinery & Production',
    desc: 'Processing jobs, batch yields & billing',
    prompt: 'Summary of unbilled machinery jobs and recent production batches'
  }
]

export function ChatClient({ actor }: { actor: { userId: string; email: string | null; role: string; displayName: string } }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('session')

  const [sessions, setSessions] = React.useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(sessionId)
  const [messages, setMessages] = React.useState<Message[]>([])
  const [input, setInput] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const [showHistory, setShowHistory] = React.useState(true)

  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  // Load sessions on mount
  React.useEffect(() => {
    const list = getChatSessions()
    setSessions(list)

    if (sessionId) {
      const active = getChatSession(sessionId)
      if (active) {
        setMessages(active.messages as Message[])
        setActiveSessionId(active.id)
        return
      }
    }

    if (list.length > 0 && !sessionId) {
      const first = list[0]
      setActiveSessionId(first.id)
      setMessages(first.messages as Message[])
    }
  }, [sessionId])

  // Sync event listener for multi-tab
  React.useEffect(() => {
    const handleSync = () => {
      setSessions(getChatSessions())
    }
    window.addEventListener('arco-chats-changed', handleSync)
    return () => window.removeEventListener('arco-chats-changed', handleSync)
  }, [])

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

  const handleSelectSession = (id: string) => {
    const session = getChatSession(id)
    if (session) {
      setActiveSessionId(session.id)
      setMessages(session.messages as Message[])
      router.push(`/chat?session=${id}`)
    }
  }

  const handleNewChat = () => {
    setActiveSessionId(null)
    setMessages([])
    setInput('')
    router.push('/chat')
  }

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    deleteChatSession(id)
    const updated = getChatSessions()
    setSessions(updated)
    if (activeSessionId === id) {
      if (updated.length > 0) {
        handleSelectSession(updated[0].id)
      } else {
        handleNewChat()
      }
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
      setSessions(getChatSessions())
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
        setSessions(getChatSessions())
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
    <div className="h-[calc(100vh-6.5rem)] flex rounded-md border border-border bg-card shadow-xs overflow-hidden">
      {/* Session History Sidebar */}
      <div className={`w-72 border-r border-border bg-muted/20 flex flex-col shrink-0 transition-all duration-200 ${showHistory ? 'flex' : 'hidden md:flex'}`}>
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-bold text-foreground">Conversations</span>
          </div>
          <button
            type="button"
            onClick={handleNewChat}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map(s => {
            const isActive = s.id === activeSessionId
            return (
              <div
                key={s.id}
                onClick={() => handleSelectSession(s.id)}
                className={`group flex items-center justify-between px-2.5 py-2 rounded text-xs cursor-pointer transition-colors ${
                  isActive 
                    ? 'bg-emerald-600/10 text-emerald-800 dark:text-emerald-300 font-semibold border border-emerald-600/30' 
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{s.title || 'Untitled Session'}</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDeleteSession(e, s.id)}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-500 p-0.5 rounded transition-opacity"
                  title="Delete chat"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="p-2.5 border-t border-border bg-card/60 text-[11px] text-muted-foreground flex items-center justify-between">
          <span className="truncate">{actor.displayName} ({actor.role})</span>
          <span className="flex h-2 w-2 rounded-full bg-emerald-500" title="Online" />
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Top Header */}
        <div className="h-12 border-b border-border px-4 flex items-center justify-between bg-card/50">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className="md:hidden p-1.5 rounded hover:bg-muted text-muted-foreground"
            >
              <MessageSquare className="h-4 w-4" />
            </button>
            <div className="h-7 w-7 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold text-foreground truncate">
                ARCO AI Command Center
              </h2>
              <p className="text-[10px] text-muted-foreground truncate">
                Real-time database queries & operational finance assistance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium border border-border cursor-pointer transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Chat</span>
            </button>
          </div>
        </div>

        {/* Messages Stream */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto py-8">
              <div className="h-12 w-12 rounded-lg bg-emerald-600/10 text-emerald-600 dark:text-emerald-400 border border-emerald-600/25 flex items-center justify-center mb-3">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold text-foreground">
                How can I assist your operations today?
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-md">
                Ask anything about cash balances, daybook, inventory stock, customer receivables, machinery jobs, or record daily attendance.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-6 w-full text-left">
                {STARTER_PROMPTS.map((sp, idx) => {
                  const Icon = sp.icon
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSubmit(sp.prompt)}
                      className="p-3 rounded-md border border-border bg-card hover:bg-muted/40 hover:border-emerald-600/40 text-left transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 text-foreground font-semibold text-xs group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span>{sp.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                        {sp.desc}
                      </p>
                    </button>
                  )
                })}
              </div>
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
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                  )}

                  <div className={`max-w-[85%] sm:max-w-[78%] space-y-1.5`}>
                    <div
                      className={`rounded-md p-3.5 text-xs ${
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
                              <div className="min-w-0">
                                <span className="font-semibold text-foreground uppercase tracking-wide">
                                  {act.action}
                                </span>
                                <p className="text-muted-foreground mt-0.5">{act.details}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Content */}
                      {isUser ? (
                        <p className="whitespace-pre-wrap leading-relaxed select-text font-normal">
                          {m.content}
                        </p>
                      ) : (
                        <MarkdownContent content={m.content} />
                      )}
                    </div>

                    {/* Metadata & Copy action */}
                    <div className={`flex items-center gap-2 px-1 text-[10px] text-muted-foreground ${isUser ? 'justify-end' : 'justify-start'}`}>
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

        {/* Input Bar */}
        <div className="p-3 sm:p-4 border-t border-border bg-card">
          <div className="relative flex items-end rounded-md border border-border bg-background focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 transition-all p-1.5">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything: Daybook summary, party balances, check godown stock, record attendance..."
              rows={1}
              disabled={loading}
              className="w-full resize-none border-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none p-2 min-h-[38px] max-h-[160px] leading-relaxed"
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
            Press <kbd className="font-mono bg-muted px-1 py-0.5 rounded border border-border text-[9px]">Enter</kbd> to send, <kbd className="font-mono bg-muted px-1 py-0.5 rounded border border-border text-[9px]">Shift+Enter</kbd> for newline. AI actions execute live against your Supabase database.
          </p>
        </div>
      </div>
    </div>
  )
}
