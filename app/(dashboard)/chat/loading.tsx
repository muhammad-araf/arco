import { Skel } from '@/components/erp-ui'

/* Mirrors the new chat layout (chat-client.tsx): a list column topped
   by a full-width New Chat button + RECENT CHATS label, then rows (no
   actor footer), and a main column with no top header — just a
   centered message column, an input bar, and a disclaimer line. On
   mobile the list column is hidden, leaving the single chat panel,
   exactly as the client hides it while a panel is shown. Flat
   animate-pulse blocks only — no gradients, no fake progress. */
export default function ChatLoading() {
  return (
    <div
      className="h-[calc(100vh-6.5rem)] flex rounded-md border border-border bg-card shadow-xs overflow-hidden animate-pulse"
      aria-label="Loading chat"
      aria-busy="true"
    >
      {/* List column (desktop only) */}
      <div className="hidden md:flex w-72 border-r border-border bg-muted/20 flex-col shrink-0">
        <div className="p-3 border-b border-border space-y-2.5">
          <Skel className="h-9 w-full bg-muted rounded" />
          <Skel className="h-3 w-28 bg-muted rounded" />
        </div>
        <div className="flex-1 p-2 space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skel key={i} className="h-9 w-full bg-muted rounded" />
          ))}
        </div>
      </div>

      {/* Chat panel column */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {/* Mobile Back row shape (mobile only, as on the real page) */}
        <div className="md:hidden border-b border-border px-3 py-2 bg-card">
          <Skel className="h-6 w-16 bg-muted rounded" />
        </div>

        {/* Centered message column */}
        <div className="flex-1 p-4 sm:p-6">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <div className="flex gap-3">
              <Skel className="h-7 w-7 shrink-0 bg-muted rounded" />
              <div className="min-w-0 max-w-[78%] flex-1 space-y-2">
                <Skel className="h-20 w-full bg-muted rounded-md" />
                <Skel className="h-3 w-3/4 bg-muted rounded" />
              </div>
            </div>
            <div className="flex justify-end">
              <Skel className="h-12 w-2/3 sm:w-1/2 bg-muted rounded-md" />
            </div>
            <div className="flex gap-3">
              <Skel className="h-7 w-7 shrink-0 bg-muted rounded" />
              <div className="min-w-0 max-w-[78%] flex-1 space-y-2">
                <Skel className="h-16 w-full bg-muted rounded-md" />
                <Skel className="h-3 w-1/2 bg-muted rounded" />
              </div>
            </div>
          </div>
        </div>

        {/* Input bar + disclaimer line */}
        <div className="p-3 sm:p-4 border-t border-border bg-card">
          <Skel className="h-10 w-full bg-muted rounded-md" />
          <div className="flex justify-center mt-1.5">
            <Skel className="h-2.5 w-80 max-w-full bg-muted rounded" />
          </div>
        </div>
      </div>
    </div>
  )
}
