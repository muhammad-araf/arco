import { Skel } from '@/components/erp-ui'

/* Mirrors the new single-column chat layout (chat-client.tsx): no
   list column anymore — the conversation list lives in the global
   sidebar. Just a centered message column, an input bar, and a
   disclaimer line, single-panel on mobile as well as desktop. Flat
   animate-pulse blocks only — no gradients, no fake progress. */
export default function ChatLoading() {
  return (
    <div
      className="h-[calc(100vh-6.5rem)] flex flex-col rounded-md border border-border bg-card shadow-xs overflow-hidden animate-pulse"
      aria-label="Loading chat"
      aria-busy="true"
    >
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
  )
}
