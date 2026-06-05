"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "success" | "error";

export type Toast = {
  id: string;
  message: string;
  tone: ToastTone;
  /** ms before auto-dismiss. Pass 0 to keep until manual dismiss. */
  duration?: number;
  /** Optional action — usually an "Undo" button. */
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
};

type ShowOpts = Omit<Toast, "id">;

type ToastContextValue = {
  show: (opts: ShowOpts) => string;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

/**
 * Top-level provider that renders a stacking toast region in the corner of
 * the viewport and exposes a `useToast()` hook. Mount once near the root
 * of the (app) tree.
 *
 * Each toast supports an optional `action` — used for "Undo" affordances
 * on destructive operations. The action runs in the caller's context;
 * the toast dismisses itself afterward.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeouts = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const t = timeouts.current.get(id);
    if (t) {
      clearTimeout(t);
      timeouts.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (opts: ShowOpts): string => {
      const id = `toast-${++nextId}`;
      const duration = opts.duration ?? (opts.action ? 8000 : 4000);
      setToasts((list) => [...list, { ...opts, id }]);
      if (duration > 0) {
        const t = setTimeout(() => dismiss(id), duration);
        timeouts.current.set(id, t);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timeouts.current.forEach(clearTimeout);
      timeouts.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <ToastRegion toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}

function ToastRegion({
  toasts,
  dismiss,
}: {
  toasts: Toast[];
  dismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)]"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  dismiss,
}: {
  toast: Toast;
  dismiss: (id: string) => void;
}) {
  const tone =
    toast.tone === "success"
      ? "border-brand-blue/40 bg-brand-blue-light/50"
      : toast.tone === "error"
        ? "border-red-200 bg-red-50"
        : "border-slate-200 bg-white";
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className={`card shadow-lg p-3 flex items-start gap-3 ${tone}`}
    >
      <div className="flex-1 text-sm text-slate-800">{toast.message}</div>
      {toast.action && (
        <button
          type="button"
          onClick={async () => {
            try {
              await toast.action!.onClick();
            } finally {
              dismiss(toast.id);
            }
          }}
          className="text-sm font-medium text-brand-blue-dark hover:underline"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss"
        className="text-slate-400 hover:text-slate-700 px-1"
      >
        ×
      </button>
    </div>
  );
}
