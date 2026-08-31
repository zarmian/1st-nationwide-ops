"use client";

import { useState } from "react";
import { Drawer } from "vaul";
import { getMyCalloutBriefing } from "../_actions";
import type { SiteBriefing } from "@/lib/siteBriefing";

const KEY_STATUS_LABEL: Record<string, string> = {
  WITH_US: "with us",
  WITH_OFFICER: "with officer",
  WITH_CUSTOMER: "with customer",
  LOST: "LOST",
};

/**
 * Bottom-sheet briefing for an assigned callout: site basics, access notes,
 * codes (revealed on tap), and the keys held for the site. Loaded lazily when
 * the sheet opens so decrypted codes never sit in the page's initial HTML.
 * Uses Vaul for a drag-to-dismiss, spring-animated sheet.
 */
export function CalloutBriefing({
  siteId,
  siteName,
  notes,
}: {
  siteId: string;
  siteName: string;
  notes?: string | null;
}) {
  const [briefing, setBriefing] = useState<SiteBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCodes, setShowCodes] = useState(false);

  async function onOpenChange(open: boolean) {
    if (!open) {
      setShowCodes(false);
      return;
    }
    if (briefing || loading) return;
    setLoading(true);
    setError(null);
    const res = await getMyCalloutBriefing(siteId).catch(
      () => ({ ok: false as const, error: "Couldn't load the briefing." }),
    );
    if (res.ok) setBriefing(res.briefing);
    else setError(res.error);
    setLoading(false);
  }

  return (
    <Drawer.Root onOpenChange={onOpenChange}>
      <Drawer.Trigger className="btn-secondary text-sm">
        Site &amp; access
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-brand-navy/40" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col
                     rounded-t-2xl bg-white shadow-lg outline-none"
        >
          <div
            aria-hidden
            className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-slate-300"
          />
          <div className="overflow-y-auto overscroll-contain px-5 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <Drawer.Title className="text-lg font-semibold text-brand-navy text-balance">
              {siteName}
            </Drawer.Title>
            <Drawer.Description className="sr-only">
              Site and access briefing for {siteName}
            </Drawer.Description>

            {loading && (
              <div className="mt-4 space-y-2">
                <div className="skeleton h-4 w-2/3" />
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-20 w-full" />
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            {briefing && (
              <div className="mt-3 space-y-4">
                <Meta briefing={briefing} />
                {notes && (
                  <Section title="Callout notes">
                    <p className="whitespace-pre-line text-sm text-slate-700">
                      {notes}
                    </p>
                  </Section>
                )}
                <Access
                  access={briefing.access}
                  showCodes={showCodes}
                  onReveal={() => setShowCodes(true)}
                />
                <Keys keys={briefing.keys} keySetNote={briefing.keySetNote} />
              </div>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Meta({ briefing }: { briefing: SiteBriefing }) {
  const b = briefing;
  const line2 = [b.region, b.account].filter(Boolean).join(" · ");
  const mapsQuery = encodeURIComponent(
    [b.address, b.postcode].filter(Boolean).join(", "),
  );
  return (
    <div className="space-y-1.5">
      {(b.code || line2) && (
        <p className="text-xs text-slate-500">
          {[b.code, line2].filter(Boolean).join(" · ")}
        </p>
      )}
      {(b.address || b.postcode) && (
        <p className="text-sm text-slate-700">
          {[b.address, b.postcode].filter(Boolean).join(" · ")}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {(b.address || b.postcode) && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-sm"
          >
            Directions
          </a>
        )}
        {b.what3words && (
          <a
            href={`https://what3words.com/${encodeURIComponent(b.what3words)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost text-sm font-mono"
          >
            {`///${b.what3words}`}
          </a>
        )}
      </div>
    </div>
  );
}

function Access({
  access,
  showCodes,
  onReveal,
}: {
  access: SiteBriefing["access"];
  showCodes: boolean;
  onReveal: () => void;
}) {
  const a = access;
  const nothing =
    !a.entrySteps && !a.hazards && !a.lockboxId && !a.hasCodes;
  if (nothing) {
    return (
      <Section title="Access">
        <p className="text-sm text-slate-500">No access notes on file.</p>
      </Section>
    );
  }
  return (
    <Section title="Access">
      <div className="space-y-2.5">
        {a.hazards && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="font-medium">⚠ Hazards: </span>
            <span className="whitespace-pre-line">{a.hazards}</span>
          </div>
        )}
        {a.entrySteps && (
          <p className="whitespace-pre-line text-sm text-slate-700">
            {a.entrySteps}
          </p>
        )}
        {a.lockboxId && (
          <p className="text-sm text-slate-700">
            <span className="text-slate-500">Lockbox: </span>
            <span className="font-mono">{a.lockboxId}</span>
          </p>
        )}
        {a.hasCodes && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            {a.codesUnavailable && !a.alarmCode && !a.padlockCode ? (
              <p className="text-sm text-slate-500">
                Codes are on file but can’t be shown here (encryption key not
                set). Check the site page.
              </p>
            ) : !showCodes ? (
              <button
                type="button"
                onClick={onReveal}
                className="btn-secondary text-sm w-full"
              >
                Reveal alarm / padlock codes
              </button>
            ) : (
              <div className="space-y-1.5 text-sm">
                {a.alarmCode && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Alarm</span>
                    <span className="font-mono text-brand-navy select-all">
                      {a.alarmCode}
                    </span>
                  </div>
                )}
                {a.padlockCode && (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Padlock</span>
                    <span className="font-mono text-brand-navy select-all">
                      {a.padlockCode}
                    </span>
                  </div>
                )}
                {a.codesUnavailable && (
                  <p className="text-xs text-slate-500">
                    Some codes couldn’t be decrypted.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}

function Keys({
  keys,
  keySetNote,
}: {
  keys: SiteBriefing["keys"];
  keySetNote: string | null;
}) {
  if (keys.length === 0) {
    return (
      <Section title="Keys">
        <p className="text-sm text-slate-500">No keys on file for this site.</p>
      </Section>
    );
  }
  const withUs = keys.filter((k) => k.status === "WITH_US").length;
  return (
    <Section title={`Keys (${withUs} with us)`}>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {keys.map((k, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <span className="min-w-0 text-slate-700">
              {k.internalNo ? (
                <span className="font-mono text-slate-500">#{k.internalNo} </span>
              ) : null}
              {k.label}
              {k.setLabel ? (
                <span className="text-slate-400"> · {k.setLabel}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-slate-500">
              {k.holder ?? KEY_STATUS_LABEL[k.status] ?? k.status.toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
      {keySetNote && (
        <p className="mt-1.5 text-xs text-slate-500 whitespace-pre-line">
          {keySetNote}
        </p>
      )}
    </Section>
  );
}
