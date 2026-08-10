"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export type ConfirmOpts = {
  title: string;
  body?: React.ReactNode;
  /** Default: "Confirm". For destructive use "Delete" / "Cancel job" etc. */
  confirmLabel?: string;
  /** Default: "Cancel". */
  cancelLabel?: string;
  /** "default" (mint primary) or "danger" (red primary). */
  tone?: "default" | "danger";
};

type ConfirmContextValue = (opts: ConfirmOpts) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * Promise-based modal confirm. Replaces window.confirm() so destructive
 * actions render on-brand and run keyboard navigation (Esc to cancel,
 * Enter to confirm), not the OS dialog.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Cancel job?", tone: "danger" })) ...
 *
 * The provider must wrap the (app) tree (added in Providers.tsx). Each
 * call shows a single modal — concurrent calls queue.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  type PendingState = {
    opts: ConfirmOpts;
    resolve: (v: boolean) => void;
  } | null;
  const [pending, setPending] = useState<PendingState>(null);
  const queue = useRef<{ opts: ConfirmOpts; resolve: (v: boolean) => void }[]>(
    [],
  );

  const ask = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        if (pending) {
          queue.current.push({ opts, resolve });
        } else {
          setPending({ opts, resolve });
        }
      }),
    [pending],
  );

  const close = useCallback(
    (value: boolean) => {
      if (!pending) return;
      pending.resolve(value);
      const next = queue.current.shift();
      setPending(next ?? null);
    },
    [pending],
  );

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <ConfirmDialog opts={pending.opts} onClose={close} />
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx)
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  return ctx;
}

function ConfirmDialog({
  opts,
  onClose,
}: {
  opts: ConfirmOpts;
  onClose: (v: boolean) => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Remember what had focus so we can restore it when the dialog closes.
    const prevFocused = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose(false);
        return;
      }
      if (e.key === "Enter" && document.activeElement === confirmRef.current) {
        onClose(true);
        return;
      }
      // Trap Tab within the dialog so focus can't wander to the page behind.
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (!root) return;
        const items = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus to whatever triggered the dialog.
      prevFocused?.focus?.();
    };
  }, [onClose]);

  const isDanger = opts.tone === "danger";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4
                 bg-brand-navy/50 backdrop-blur-sm animate-pop-in overscroll-contain"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div
        ref={dialogRef}
        className="card shadow-lg w-full max-w-md p-5 space-y-3 animate-pop-in"
      >
        <h2 id="confirm-title" className="text-lg font-semibold text-brand-navy">
          {opts.title}
        </h2>
        {opts.body && (
          <div className="text-sm text-slate-600 leading-relaxed">
            {opts.body}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => onClose(false)}
            className="btn-ghost text-sm"
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onClose(true)}
            className={isDanger ? "btn-danger text-sm" : "btn-primary text-sm"}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
