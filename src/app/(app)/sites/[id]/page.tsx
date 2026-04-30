import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { SiteHeader } from "./_components/SiteHeader";
import { Tabs, type TabKey } from "./_components/Tabs";
import { ActivityFeed } from "./_components/ActivityFeed";
import { loadActivity } from "./_lib/activity";

export const dynamic = "force-dynamic";

const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_SHORT: Record<string, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

export default async function SiteDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  const tab = (searchParams.tab ?? "overview") as TabKey;

  const site = await prisma.site.findUnique({
    where: { id: params.id },
    include: {
      customer: { include: { contacts: true } },
      partner: true,
      region: true,
      keys: { orderBy: [{ status: "asc" }, { internalNo: "asc" }] },
      keySets: {
        where: { active: true },
        orderBy: { internalNo: "asc" },
        include: {
          keys: {
            where: { status: { not: "RETIRED" } },
            orderBy: { label: "asc" },
          },
        },
      },
      patrolSchedules: { where: { active: true } },
      lockUnlockSchedules: { where: { active: true } },
      accessInstruction: true,
    },
  });

  if (!site) notFound();

  const activeKeys = site.keys.filter((k) => k.status !== "RETIRED");

  const [activityCounts] = await Promise.all([
    Promise.all([
      prisma.alarmEvent.count({ where: { siteId: site.id } }),
      prisma.patrolVisit.count({ where: { siteId: site.id } }),
      prisma.formSubmission.count({ where: { siteId: site.id } }),
    ]).then(([a, p, s]) => a + p + s),
  ]);

  const totalSetKeys = site.keySets.reduce(
    (sum, s) => sum + s.keys.length,
    0,
  );
  const counts = {
    keys: totalSetKeys + activeKeys.length,
    activity: activityCounts,
  };

  const chips = buildSummaryChips(site, activeKeys);

  return (
    <div className="space-y-6">
      <SiteHeader
        site={{
          id: site.id,
          code: site.code,
          name: site.name,
          addressLine: site.addressLine,
          postcodeFormatted: site.postcodeFormatted,
          city: site.city,
          region: site.region ? { name: site.region.name } : null,
        }}
        chips={chips}
      />

      <Tabs siteId={site.id} active={tab} counts={counts} />

      {tab === "overview" && <OverviewTab site={site} />}
      {tab === "schedule" && <ScheduleTab site={site} />}
      {tab === "keys" && <KeysTab keys={site.keys} />}
      {tab === "activity" && <ActivityTab siteId={site.id} />}
      {tab === "documents" && <DocumentsTab />}
      {tab === "settings" && <SettingsTab siteId={site.id} active={site.active} />}
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────

async function OverviewTab({ site }: { site: SiteWithRelations }) {
  const { events, total } = await loadActivity(site.id, { take: 5 });

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-6">
      <div className="space-y-6 min-w-0">
        <section>
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-xs uppercase tracking-wider text-slate-500">
              Recent activity
            </h2>
            <span className="text-xs text-slate-400">
              Source of truth — every patrol, alarm, lock, unlock
            </span>
          </div>
          <ActivityFeed events={events} />
          {total > events.length && (
            <Link
              href={`/sites/${site.id}?tab=activity`}
              className="inline-block mt-3 text-sm text-brand-mint-dark hover:underline"
            >
              See all {total} events →
            </Link>
          )}
        </section>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-slate-500 mb-3">
            Schedule
          </h2>
          <ScheduleSummary site={site} compact />
        </section>
      </div>

      <Sidebar site={site} />
    </div>
  );
}

function Sidebar({ site }: { site: SiteWithRelations }) {
  const activeKeys = site.keys.filter((k) => k.status !== "RETIRED");
  const program = site.customer?.contractStart
    ? `Direct contract · since ${monthYear(site.customer.contractStart)}`
    : site.customer
      ? "Direct contract"
      : site.partner
        ? `Operated for ${site.partner.name}`
        : null;

  return (
    <aside className="space-y-5 lg:border-l lg:border-slate-200 lg:pl-6">
      {(site.customer || site.partner) && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
            {site.customer ? "Customer" : "Partner"}
          </h3>
          <div className="font-semibold text-brand-navy">
            {site.customer?.name ?? site.partner?.name}
          </div>
          {program && <div className="text-sm text-slate-500">{program}</div>}
        </div>
      )}

      {site.customer && <ContactsBlock customer={site.customer} />}

      <div>
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
          Keys held
        </h3>
        <KeySetSummary
          keySets={site.keySets}
          orphanKeys={activeKeys.filter((k) => !k.keySetId)}
        />
      </div>

      {site.notes && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
            Site notes
          </h3>
          <div className="card p-3 text-sm text-slate-700 whitespace-pre-wrap">
            {site.notes}
          </div>
        </div>
      )}
    </aside>
  );
}

// ── Schedule ─────────────────────────────────────────────────────────────

function ScheduleTab({ site }: { site: SiteWithRelations }) {
  return (
    <div className="space-y-6 max-w-3xl">
      <ScheduleSummary site={site} compact={false} />
    </div>
  );
}

function ScheduleSummary({
  site,
  compact,
}: {
  site: SiteWithRelations;
  compact: boolean;
}) {
  const patrol = site.patrolSchedules.filter((s) => s.kind === "PATROL");
  const vpi = site.patrolSchedules.filter((s) => s.kind === "VPI");
  const lu = site.lockUnlockSchedules[0];

  const rows: { label: string; value: string }[] = [];
  if (patrol.length) {
    rows.push({ label: "Patrol", value: describePatrolSchedule(patrol) });
  }
  if (vpi.length) {
    rows.push({ label: "VPI", value: describePatrolSchedule(vpi) });
  }
  if (lu) {
    if (lu.unlockTime) {
      rows.push({
        label: "Unlock",
        value: `${formatDayList(lu.days)} · ${lu.unlockTime}`,
      });
    }
    if (lu.lockdownTime) {
      rows.push({
        label: "Lockdown",
        value: `${formatDayList(lu.days)} · ${lu.lockdownTime}`,
      });
    }
  }
  if (site.services.includes("ALARM_RESPONSE")) {
    rows.push({ label: "Alarm response", value: "24/7 · keyholder" });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
        No schedule configured. Add it on the{" "}
        <Link
          href={`/sites/${site.id}/edit`}
          className="text-brand-mint-dark hover:underline"
        >
          edit page
        </Link>
        .
      </div>
    );
  }

  return (
    <div className={compact ? "card overflow-hidden" : "card overflow-hidden"}>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.label}>
              <th
                scope="row"
                className="text-left px-4 py-2.5 font-medium text-slate-600 w-40 align-top"
              >
                {r.label}
              </th>
              <td className="px-4 py-2.5 text-slate-800">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Keys ─────────────────────────────────────────────────────────────────

function KeysTab({
  keys,
}: {
  keys: SiteWithRelations["keys"];
}) {
  if (keys.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
        No keys recorded for this site.
      </div>
    );
  }
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
              Internal #
            </th>
            <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
              Label
            </th>
            <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
              Type
            </th>
            <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
              Status
            </th>
            <th className="text-left px-4 py-2.5 font-medium uppercase tracking-wider text-xs">
              Notes
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {keys.map((k) => (
            <tr key={k.id}>
              <td className="px-4 py-2.5 font-medium text-brand-navy">
                {k.internalNo ?? "—"}
              </td>
              <td className="px-4 py-2.5">{k.label}</td>
              <td className="px-4 py-2.5 text-slate-600">
                {k.type.charAt(0) + k.type.slice(1).toLowerCase()}
              </td>
              <td className="px-4 py-2.5">
                <KeyStatusChip status={k.status} />
              </td>
              <td className="px-4 py-2.5 text-slate-500">{k.notes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KeyStatusChip({ status }: { status: string }) {
  const tone =
    status === "WITH_US"
      ? "chip-mint"
      : status === "LOST"
        ? "chip-red"
        : status === "RETIRED"
          ? "chip-slate"
          : "chip-amber";
  const label = status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase());
  return <span className={tone}>{label}</span>;
}

// ── Contacts + KeySets sidebar ───────────────────────────────────────────

function ContactsBlock({
  customer,
}: {
  customer: SiteWithRelations["customer"];
}) {
  if (!customer) return null;
  const contacts = customer.contacts ?? [];
  // Surface the legacy single-contact fields if they're set and there are
  // no proper CustomerContact rows yet.
  const hasLegacy =
    contacts.length === 0 &&
    (customer.contactName || customer.contactEmail || customer.contactPhone);
  if (contacts.length === 0 && !hasLegacy) return null;

  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-1.5">
        Contacts
      </h3>
      <ul className="space-y-2 text-sm">
        {contacts.map((c) => (
          <li key={c.id}>
            <div className="font-medium text-slate-800">{c.name}</div>
            <div className="text-xs text-slate-500">
              {[c.role, c.phone, c.email, c.ref ? `ref ${c.ref}` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </li>
        ))}
        {hasLegacy && (
          <li>
            {customer.contactName && (
              <div className="font-medium text-slate-800">
                {customer.contactName}
              </div>
            )}
            <div className="text-xs text-slate-500">
              {[customer.contactPhone, customer.contactEmail]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}

function KeySetSummary({
  keySets,
  orphanKeys,
}: {
  keySets: SiteWithRelations["keySets"];
  orphanKeys: SiteWithRelations["keys"];
}) {
  const items: { id: string; ref: string; line: string; tone: string }[] = [];

  for (const set of keySets) {
    const counts = countByType(set.keys);
    const line = formatKeyCounts(counts);
    const tone = pickKeyTone(set.keys);
    items.push({
      id: set.id,
      ref: set.internalNo ?? set.label,
      line: line || set.label,
      tone,
    });
  }

  if (orphanKeys.length > 0) {
    const counts = countByType(orphanKeys);
    items.push({
      id: "orphans",
      ref: "Site keys",
      line: formatKeyCounts(counts) || "—",
      tone: pickKeyTone(orphanKeys),
    });
  }

  if (items.length === 0) {
    return <p className="text-sm text-slate-500 italic">None on file.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {items.slice(0, 4).map((it) => (
        <li
          key={it.id}
          className="card p-3 flex items-center justify-between gap-2"
        >
          <div className="min-w-0">
            <div className="font-semibold text-brand-navy">{it.ref}</div>
            <div className="text-xs text-slate-500 truncate">{it.line}</div>
          </div>
          <span className={it.tone}>
            {it.tone === "chip-mint" ? "With us" : "Mixed"}
          </span>
        </li>
      ))}
      {items.length > 4 && (
        <li className="text-xs text-slate-500 px-1">
          + {items.length - 4} more
        </li>
      )}
    </ul>
  );
}

function countByType(
  keys: { type: string; status: string }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) {
    if (k.status === "RETIRED") continue;
    out[k.type] = (out[k.type] ?? 0) + 1;
  }
  return out;
}

function formatKeyCounts(counts: Record<string, number>): string {
  const parts: string[] = [];
  for (const [type, n] of Object.entries(counts)) {
    if (!n) continue;
    const label = type === "FOB" ? "fob" : type === "PADLOCK" ? "padlock" : type === "CODE" ? "code" : "key";
    parts.push(`${n} ${label}${n === 1 ? "" : "s"}`);
  }
  return parts.join(" + ");
}

function pickKeyTone(keys: { status: string }[]): string {
  const all = keys.filter((k) => k.status !== "RETIRED");
  if (all.length === 0) return "chip-slate";
  if (all.every((k) => k.status === "WITH_US")) return "chip-mint";
  return "chip-amber";
}

// ── Activity ─────────────────────────────────────────────────────────────

async function ActivityTab({ siteId }: { siteId: string }) {
  const { events, total } = await loadActivity(siteId, { take: 50 });
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        {total} event{total === 1 ? "" : "s"} on file. Showing the most recent{" "}
        {events.length}.
      </p>
      <ActivityFeed events={events} />
    </div>
  );
}

// ── Documents ────────────────────────────────────────────────────────────

function DocumentsTab() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
      Documents aren't wired up yet. Risk assessments, contracts, and site
      photos will live here.
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────

function SettingsTab({ siteId, active }: { siteId: string; active: boolean }) {
  return (
    <div className="card p-5 space-y-3 max-w-xl">
      <div>
        <h3 className="font-semibold text-brand-navy">Edit site details</h3>
        <p className="text-sm text-slate-500">
          All site fields, services, schedules, keys, and access info live on
          the edit page.
        </p>
      </div>
      <Link href={`/sites/${siteId}/edit`} className="btn-primary inline-flex">
        Open edit page
      </Link>
      {!active && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          This site is marked inactive. It won't appear on the main sites list.
        </p>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────

type SiteWithRelations = NonNullable<
  Awaited<ReturnType<typeof loadSite>>
>;

// (Type helper, never actually called — must mirror the page's findUnique include.)
async function loadSite(id: string) {
  return prisma.site.findUnique({
    where: { id },
    include: {
      customer: { include: { contacts: true } },
      partner: true,
      region: true,
      keys: true,
      keySets: { include: { keys: true } },
      patrolSchedules: true,
      lockUnlockSchedules: true,
      accessInstruction: true,
    },
  });
}

function buildSummaryChips(
  site: SiteWithRelations,
  activeKeys: SiteWithRelations["keys"],
): { key: string; label: string; tone: "mint" | "slate" }[] {
  const chips: { key: string; label: string; tone: "mint" | "slate" }[] = [];
  const services = new Set(site.services);
  const patrol = site.patrolSchedules.filter((s) => s.kind === "PATROL");
  const lu = site.lockUnlockSchedules[0];

  if (services.has("ALARM_RESPONSE")) {
    chips.push({ key: "alarm", label: "Alarm response", tone: "mint" });
  }
  if (services.has("PATROL") && patrol.length) {
    chips.push({
      key: "patrol",
      label: `Patrol · ${shortPatrol(patrol)}`,
      tone: "mint",
    });
  } else if (services.has("PATROL")) {
    chips.push({ key: "patrol", label: "Mobile patrol", tone: "mint" });
  }
  if (
    (services.has("LOCKUP") || services.has("UNLOCK")) &&
    lu &&
    (lu.lockdownTime || lu.unlockTime)
  ) {
    const parts = [];
    if (lu.lockdownTime) parts.push(`Lock ${lu.lockdownTime}`);
    if (lu.unlockTime) parts.push(`Unlock ${lu.unlockTime}`);
    chips.push({
      key: "lu",
      label: `${parts.join(" / ")} · ${formatDayList(lu.days)}`,
      tone: "mint",
    });
  }
  if (services.has("KEYHOLDING")) {
    const withUs = activeKeys.filter((k) => k.status === "WITH_US");
    const ref =
      withUs[0]?.internalNo ?? activeKeys[0]?.internalNo ?? null;
    chips.push({
      key: "keys",
      label:
        withUs.length > 0
          ? `Keys with us${ref ? ` · ${ref}` : ""}`
          : `Keyholder${ref ? ` · ${ref}` : ""}`,
      tone: "slate",
    });
  }

  return chips;
}

function describePatrolSchedule(
  schedules: SiteWithRelations["patrolSchedules"],
): string {
  if (schedules.length === 0) return "—";
  // Group by frequency for compact display.
  const byFreq = new Map<string, string[]>();
  for (const s of schedules) {
    const list = byFreq.get(s.frequency) ?? [];
    list.push(s.dayOfWeek);
    byFreq.set(s.frequency, list);
  }
  const parts: string[] = [];
  for (const [freq, days] of byFreq) {
    parts.push(`${formatDayList(days)} — ${freq.toLowerCase()}`);
  }
  return parts.join(" · ");
}

function shortPatrol(schedules: SiteWithRelations["patrolSchedules"]): string {
  if (schedules.length === 1) {
    return `${DAY_SHORT[schedules[0].dayOfWeek]} ${schedules[0].frequency.toLowerCase()}`;
  }
  return `${schedules.length}× per cycle`;
}

function formatDayList(days: string[]): string {
  if (!days.length) return "—";
  const indices = days
    .map((d) => DAY_ORDER.indexOf(d as (typeof DAY_ORDER)[number]))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);

  if (indices.length === 7) return "Daily";
  // Mon-Fri (weekdays)
  if (
    indices.length === 5 &&
    indices.every((i, idx) => i === idx)
  ) {
    return "Mon–Fri";
  }
  // Mon-Sat
  if (
    indices.length === 6 &&
    indices.every((i, idx) => i === idx)
  ) {
    return "Mon–Sat";
  }
  // Consecutive run
  const isConsecutive = indices.every(
    (v, i, arr) => i === 0 || v === arr[i - 1] + 1,
  );
  if (isConsecutive && indices.length > 1) {
    return `${DAY_SHORT[DAY_ORDER[indices[0]]]}–${DAY_SHORT[DAY_ORDER[indices[indices.length - 1]]]}`;
  }
  return indices.map((i) => DAY_SHORT[DAY_ORDER[i]]).join(", ");
}

function monthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
