import Link from "next/link";
import type { ReactNode } from "react";
import type { UserRole } from "@prisma/client";
import type { SourceKind, BoardRow } from "./_data";
import { formatSched } from "./_data";

/* ---- icons (lucide-derived inner markup, stroked, currentColor) ---------- */
const PATHS: Record<string, string> = {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  grid: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  checkSquare: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  wallet: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  box: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v16"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 8-8M15 7l3 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  mapPin: '<path d="M20 10c0 6-8 11-8 11s-8-5-8-11a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  upRight: '<path d="M7 17 17 7M9 7h8v8"/>',
  downRight: '<path d="M7 7 17 17M9 17h8V9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chartUp: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  minus: '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  fileOff: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="m9 15 6-6"/>',
  dollar: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  bars: '<path d="M16 8v8M12 4v12M8 12v4M4 20h16"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? "" }}
    />
  );
}

export type Tone = "blue" | "green" | "amber" | "red" | "slate" | "violet";

export function Badge({ tone, icon, children }: { tone: Tone; icon?: string; children: ReactNode }) {
  return (
    <span className={`badge b-${tone}`}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: "HIGH" | "MEDIUM" | "LOW" }) {
  const cls = priority === "HIGH" ? "pri-high" : priority === "MEDIUM" ? "pri-med" : "pri-low";
  const label = priority === "HIGH" ? "High" : priority === "MEDIUM" ? "Medium" : "Low";
  return (
    <span>
      <span className={`dot-pri ${cls}`} /> {label}
    </span>
  );
}

export function SourceTag({ kind, owner }: { kind: SourceKind; owner: string }) {
  if (kind === "none") return <span className="src" style={{ color: "var(--dim)" }}>—</span>;
  const meta =
    kind === "direct"
      ? { cls: "direct", label: "Direct" }
      : kind === "subbed"
        ? { cls: "subbed", label: "Subbed" }
        : { cls: "app", label: "Partner app" };
  return (
    <span className="src">
      <span className={`tag ${meta.cls}`}>{meta.label}</span> {kind === "subbed" ? `→ ${owner}` : owner}
    </span>
  );
}

/* ---- job-type badge + shared live board table ---------------------------- */
function typeBadgeMeta(typeRaw: string): { tone: Tone; icon: string } {
  switch (typeRaw) {
    case "ALARM_RESPONSE":
      return { tone: "red", icon: "bell" };
    case "LOCK":
      return { tone: "blue", icon: "lock" };
    case "UNLOCK":
      return { tone: "blue", icon: "lock" };
    case "VPI":
      return { tone: "blue", icon: "checkSquare" };
    case "PATROL":
      return { tone: "blue", icon: "activity" };
    case "KEY_COLLECTION":
    case "KEY_DROPOFF":
      return { tone: "blue", icon: "key" };
    default:
      return { tone: "blue", icon: "box" };
  }
}

export function BoardTable({ rows, showPriority = false }: { rows: BoardRow[]; showPriority?: boolean }) {
  const cols = showPriority ? 7 : 6;
  return (
    <div className="tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Scheduled</th>
            <th>Site</th>
            <th>Job</th>
            <th>Source</th>
            <th>Responder</th>
            {showPriority ? <th>Priority</th> : null}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols} className="empty">
                No live activity right now.
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const tb = typeBadgeMeta(r.typeRaw);
              const sched = formatSched(r.scheduledFor);
              return (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="time">
                    {sched ? (
                      <>
                        <div className="mono">
                          {sched.day} · {sched.time}
                        </div>
                      </>
                    ) : (
                      <span className="sub">unscheduled</span>
                    )}
                  </td>
                  <td>
                    <div className="site">{r.siteName}</div>
                    <div className="sub">{r.siteSub}</div>
                  </td>
                  <td>
                    <Badge tone={tb.tone} icon={tb.icon}>
                      {r.typeLabel}
                    </Badge>
                  </td>
                  <td>
                    <SourceTag kind={r.sourceKind} owner={r.ownerName} />
                  </td>
                  <td>{r.responder}</td>
                  {showPriority ? (
                    <td>
                      <PriorityDot priority={r.priority} />
                    </td>
                  ) : null}
                  <td>
                    <Badge tone={r.status.tone} icon={r.status.icon}>
                      {r.status.label}
                    </Badge>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ---- area chart (inline SVG, server-rendered) ---------------------------- */
export function AreaChart({
  values,
  id,
  color = "#60A5FA",
  height = 150,
  ariaLabel,
}: {
  values: number[];
  id: string;
  color?: string;
  height?: number;
  ariaLabel?: string;
}) {
  const w = 320;
  const h = height;
  const padTop = 8;
  const padBottom = 6;
  const max = Math.max(1, ...values);
  const n = values.length;
  const step = n > 1 ? w / (n - 1) : w;
  const pts = values.map((v, i): [number, number] => [
    i * step,
    h - padBottom - (v / max) * (h - padTop - padBottom),
  ]);
  const line = pts.length
    ? pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(0)},${p[1].toFixed(1)}`).join(" ")
    : `M0,${h - padBottom} L${w},${h - padBottom}`;
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.38" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={h * 0.25} x2={w} y2={h * 0.25} stroke="#1A2740" strokeWidth="1" />
        <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} stroke="#1A2740" strokeWidth="1" />
        <line x1="0" y1={h * 0.75} x2={w} y2={h * 0.75} stroke="#1A2740" strokeWidth="1" />
        <path d={area} fill={`url(#grad-${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {last ? <circle cx={last[0]} cy={last[1]} r="4" fill="#0B1220" stroke={color} strokeWidth="2.4" /> : null}
      </svg>
    </div>
  );
}

/* ---- formatters ---------------------------------------------------------- */
export function fmtGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}
export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---- top bar (shared across the three pages) ----------------------------- */
export function TopBar({
  active,
  initials,
  role,
  now,
}: {
  active: string;
  initials: string;
  role: UserRole;
  now: Date;
}) {
  const isCC = active === "/command-center";
  const isDispatch = active.startsWith("/command-center/dispatch");
  const isFinance = active.startsWith("/command-center/finance");
  const time = now.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "long", year: "numeric" });
  return (
    <header className="bar">
      <div className="brand">
        <span className="mark" aria-hidden>
          <Icon name="shield" size={19} />
        </span>
        <span>
          1st Nationwide
          <small>Operations platform</small>
        </span>
      </div>
      <span className="preview-pill">Preview</span>
      <nav className="pagenav">
        <Link href="/command-center" className={isCC ? "active" : undefined}>
          <Icon name="grid" size={15} /> Command Center
        </Link>
        <Link href="/command-center/dispatch" className={isDispatch ? "active" : undefined}>
          <Icon name="checkSquare" size={15} /> Dispatch
        </Link>
        {role === "ADMIN" ? (
          <Link href="/command-center/finance" className={isFinance ? "active" : undefined}>
            <Icon name="wallet" size={15} /> Finance
          </Link>
        ) : null}
      </nav>
      <div className="spacer" />
      <span className="live">
        <span className="dot" aria-hidden /> Live
      </span>
      <div className="updated">
        <span className="t">{time}</span>
        <span className="d">Updated · {date}</span>
      </div>
      <div className="avatar" title="Signed in">{initials}</div>
    </header>
  );
}
