"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Sun, Moon } from "lucide-react"

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <button
        type="button"
        className={`h-9 w-9 rounded-lg flex items-center justify-center border border-border/60 bg-muted/30 text-muted-foreground ${className}`}
        disabled
      >
        <Sun className="h-4 w-4" />
      </button>
    )
  }

  const isDark = resolvedTheme === "dark"

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`h-9 w-9 rounded-lg flex items-center justify-center border border-border/60 bg-card hover:bg-muted/70 text-foreground transition-all duration-200 cursor-pointer shadow-xs ${className}`}
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      aria-label="Toggle theme"
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-amber-400 rotate-0 scale-100 transition-transform" />
      ) : (
        <Moon className="h-4 w-4 text-emerald-600 rotate-0 scale-100 transition-transform" />
      )}
    </button>
  )
}
