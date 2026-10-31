import { Skel } from '@/components/erp-ui'

export default function ChatLoading() {
  return (
    <div className="h-[calc(100vh-6rem)] flex flex-col rounded-md border border-border bg-card overflow-hidden animate-pulse">
      <div className="h-14 border-b border-border p-4 flex items-center justify-between">
        <Skel className="h-5 w-40 bg-muted rounded" />
        <Skel className="h-8 w-24 bg-muted rounded" />
      </div>
      <div className="flex-1 p-6 space-y-4">
        <Skel className="h-12 w-3/4 bg-muted rounded-md" />
        <Skel className="h-24 w-full bg-muted rounded-md" />
        <Skel className="h-16 w-2/3 bg-muted rounded-md" />
      </div>
      <div className="h-16 border-t border-border p-3">
        <Skel className="h-10 w-full bg-muted rounded-md" />
      </div>
    </div>
  )
}
