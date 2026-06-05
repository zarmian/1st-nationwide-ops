"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "1nw-install-dismissed";

/**
 * Hint to install the PWA. Shown only when:
 *   - The page isn't already running as a standalone PWA.
 *   - The user hasn't dismissed it this session.
 *
 * Android / Chrome: clicking "Install" fires the deferred prompt.
 * iOS Safari: no JS install API exists; we show short visual instructions.
 */
export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(true);
  const [platform, setPlatform] = useState<"android" | "ios" | "other">("other");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(DISMISSED_KEY) === "1") return;

    // Already installed?
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;

    const ua = window.navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
    const isAndroid = /Android/.test(ua);
    setPlatform(isIos ? "ios" : isAndroid ? "android" : "other");

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // On iOS the event doesn't fire; surface manual instructions instead.
    if (isIos) setHidden(false);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
    };
  }, []);

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      /* ignore — Safari private mode */
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  }

  return (
    <div className="card border-brand-blue/40 bg-brand-blue-light/30 p-3 flex items-start gap-3">
      <div className="flex-1 text-sm">
        <div className="font-medium text-brand-navy">Install as an app</div>
        {platform === "ios" ? (
          <p className="text-slate-600 mt-0.5">
            Tap{" "}
            <span className="inline-block px-1.5 py-0.5 bg-white border border-slate-200 rounded text-xs">
              Share
            </span>{" "}
            then{" "}
            <span className="inline-block px-1.5 py-0.5 bg-white border border-slate-200 rounded text-xs">
              Add to Home Screen
            </span>{" "}
            to install. Opens like a real app, no browser bar.
          </p>
        ) : (
          <p className="text-slate-600 mt-0.5">
            Install to your home screen for instant launch and a tidier
            interface (no browser bar).
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {platform === "android" && deferred && (
          <button
            type="button"
            onClick={install}
            className="btn-primary text-sm"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="btn-ghost text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
