"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number tween for KPI values. On first mount it tweens 0 →
 * `value` over `duration`ms with cubic ease-out; on subsequent `value`
 * changes it tweens from whatever's on screen to the new target.
 *
 * Implementation note: an earlier version captured `display` in the
 * effect closure, which read the stale SSR-initial value (`= value`)
 * and short-circuited the tween — the KPI would flash 0 forever and the
 * page looked broken. We now keep the latest display in a ref so the
 * effect always reads the live value, and we tween from an explicit
 * `from` calculated up-front.
 *
 * Honours prefers-reduced-motion (snaps to value, no tween).
 */
export function CountUp({
  value,
  duration = 800,
  format,
  className = "",
}: {
  value: number;
  duration?: number;
  format?: (v: number) => string;
  className?: string;
}) {
  const [display, setDisplay] = useState<number>(value);
  const rafRef = useRef<number | null>(null);
  const hasMountedRef = useRef(false);
  const displayRef = useRef(value);
  // Mirror state → ref so the effect can read the latest display
  // without listing it as a dep (which would cause infinite re-runs).
  displayRef.current = display;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // First mount tweens 0 → value. Subsequent value changes tween from
    // the current display.
    const from = hasMountedRef.current ? displayRef.current : 0;
    hasMountedRef.current = true;

    if (reduce || from === value) {
      setDisplay(value);
      return;
    }

    // Snap display to the from-point so the next paint is the tween
    // start, not the previous value.
    setDisplay(from);
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (value - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return (
    <span className={`tabular-nums ${className}`}>
      {format ? format(display) : Math.round(display).toLocaleString("en-GB")}
    </span>
  );
}
