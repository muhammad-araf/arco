import { createClient } from '@/lib/supabase/server'
import { getCurrentActor } from '@/app/actions/auth'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { ChatClient } from './chat-client'
import ChatLoading from './loading'

export const metadata = {
  title: 'AI Command Assistant - ARCO ERP',
  description: 'Autonomous AI assistant for ARCO Agro & Industrial ERP database operations and finance'
}

export default async function ChatPage() {
  const supabase = await createClient()
  const actor = await getCurrentActor(supabase).catch(() => null)

  if (!actor) {
    redirect('/login')
  }

  return (
    <Suspense fallback={<ChatLoading />}>
      <ChatClient actor={{
        userId: actor.userId,
        email: actor.email,
        role: actor.role,
        displayName: actor.displayName || 'Operator'
      }} />
    </Suspense>
  )
}
