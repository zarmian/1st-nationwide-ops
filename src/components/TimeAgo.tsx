"use client";

import { useEffect, useState } from "react";
import { formatTimeAgo, formatDateTime } from "@/lib/dates";

/**
 * Auto-updating "5m ago" pill. Re-renders every minute so dispatch /
 * /m/today don't show stale relative times while the page sits open.
 * Tooltip shows the absolute timestamp on hover.
 */
export function TimeAgo({
  date,
  className,
}: {
  date: Date | string | null | undefined;
  className?: string;
}) {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <span
      className={className}
      title={formatDateTime(date)}
      suppressHydrationWarning
    >
      {formatTimeAgo(date, now)}
    </span>
  );
}
