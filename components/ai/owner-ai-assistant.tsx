'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot } from 'lucide-react'

// Plain entry-point pill to the single chat interface at /chat.
// No drawer, no conversation state, no API calls: clicking the pill
// navigates to the full /chat page, which is the only chat UI.
// Hidden on /chat itself (and /chat/*), and kept at bottom-40 on
// other pages so it never covers bottom-anchored controls
// (footers, pagination, submit rows).
export function OwnerAIAssistant() {
  const pathname = usePathname()
  const isChatPage = pathname === '/chat' || pathname.startsWith('/chat/')
  if (isChatPage) return null

  return (
    <div className="fixed bottom-40 right-5 z-40">
      <Link
        href="/chat"
        prefetch={false}
        aria-label="Open AI chat"
        title="Open AI chat"
        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-colors duration-200 border border-emerald-400/30 font-semibold text-xs"
      >
        <span className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Bot className="h-3 w-3 text-white" />
        </span>
        <span>ARCO AI</span>
      </Link>
    </div>
  )
}
