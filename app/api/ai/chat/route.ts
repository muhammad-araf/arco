import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentActor } from '@/app/actions/auth'
import { createAgentStream, ChatMessage } from '@/lib/ai/gemini-client'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const actor = await getCurrentActor(supabase).catch(() => null)

    if (!actor) {
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required to access ARCO AI Agent.' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const messages: ChatMessage[] = body.messages || []

    if (!messages.length) {
      return NextResponse.json(
        { error: 'Message history is required.' },
        { status: 400 }
      )
    }

    const stream = createAgentStream(messages, {
      userId: actor.userId,
      email: actor.email,
      role: actor.role,
      displayName: actor.displayName || undefined
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      }
    })
  } catch (error: any) {
    console.error('Unhandled error in /api/ai/chat:', error)
    return NextResponse.json(
      { error: error?.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
