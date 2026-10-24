"use client";

import * as React from "react";
import { Calendar } from "lucide-react";

/**
 * Today's date, rendered on the client only.
 *
 * The dashboard layout is a server component and must not call
 * new Date() during render: with cacheComponents enabled that makes
 * the layout un-prerenderable (the date would freeze at build time
 * or force the whole layout dynamic). This tiny client component
 * formats the date in an effect, so server output stays
 * deterministic and the badge fills in after hydration — no
 * hydration mismatch, same markup and classes as before.
 */
export function TodayBadge() {
  const [todayFormatted, setTodayFormatted] = React.useState<string | null>(null);

  React.useEffect(() => {
    setTodayFormatted(
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date()),
    );
  }, []);

  return (
    <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
      <Calendar className="h-3.5 w-3.5" />
      <span>{todayFormatted ?? ""}</span>
    </div>
  );
}
