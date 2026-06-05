"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animated number tween for KPI values. Starts at 0 on mount and tweens
 * to `value` over `duration` ms with ease-out cubic. Honours
 * prefers-reduced-motion: that's set globally to 0.01ms but we also
 * short-circuit here so the static value renders on first paint for SSR
 * matching.
 *
 * Pass a `format` fn to render currency / locale strings without
 * stripping the tween's fractional precision.
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
  const startedRef = useRef(false);

  useEffect(() => {
    // SSR-rendered text starts at `value`; on hydrate we reset to 0
    // exactly once and tween up. Re-renders with a new value tween from
    // the previous display, not from 0 again.
    if (!startedRef.current) {
      startedRef.current = true;
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (reduce) {
        setDisplay(value);
        return;
      }
      setDisplay(0);
    }

    const from = display;
    const to = value;
    if (from === to) return;
    const start = performance.now();

    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // We intentionally only re-tween when `value` changes, not when the
    // display state itself changes — that would cause an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span className={`tabular-nums ${className}`}>
      {format ? format(display) : Math.round(display).toLocaleString("en-GB")}
    </span>
  );
}
