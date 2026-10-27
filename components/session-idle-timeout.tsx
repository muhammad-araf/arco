"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import { signOutAction } from "@/app/actions/auth"

/**
 * Signs the operator out after `minutes` of inactivity.
 *
 * - minutes <= 0 disables the timer entirely (the setting value 0
 *   means "never time out").
 * - Any mouse, keyboard, touch or scroll activity resets the clock.
 * - Sign-out goes through the same server action as a manual sign-out,
 *   then falls back to a client sign-out + redirect to /login so a
 *   failed server round trip cannot leave a stale session on screen.
 * - Rendered only by the dashboard layout; it renders nothing itself.
 */
export function SessionIdleTimeout({ minutes }: { minutes: number }) {
  React.useEffect(() => {
    const mins = minutes
    if (!mins || mins <= 0 || !Number.isFinite(mins)) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let signedOut = false

    const signOut = async () => {
      if (signedOut) return
      signedOut = true
      try {
        await signOutAction()
      } catch {
        // Fall through to the client sign-out below.
      }
      try {
        const supabase = createClient()
        await supabase.auth.signOut()
      } catch {
        // Redirect regardless; the layout guard rejects stale sessions.
      }
      window.location.href = "/login"
    }

    const reset = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(signOut, mins * 60 * 1000)
    }

    const events = ["mousedown", "keydown", "touchstart", "scroll", "mousemove"]
    for (const ev of events) {
      window.addEventListener(ev, reset, { passive: true })
    }
    reset()
    return () => {
      if (timer) clearTimeout(timer)
      for (const ev of events) {
        window.removeEventListener(ev, reset)
      }
    }
  }, [minutes])

  return null
}
