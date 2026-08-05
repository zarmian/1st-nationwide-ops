import type { ReactNode } from "react";
import { prisma } from "@/lib/db";
import { ukDayPlus, ukWallClockToUtc } from "@/lib/dates";
import { getLiveBoard, getOnDuty, TYPE_LABEL, jobStatusView } from "./_data";
import { Icon, Badge, BoardTable, AreaChart, fmtInt, initialsOf } from "./_ui";

export const dynamic = "force-dynamic";

function Kpi({
  icon,
  tone,
  label,
  value,
  sub,
  subTone = "flat",
}: {
  icon: string;
  tone?: string;
  label: string;
  value: ReactNode;
  sub: ReactNode;
  subTone?: "flat" | "up" | "down" | "warn";
}) {
  return (
    <div className="kpi">
      <div className="top">
        {label}
        <span className={`ic ${tone ?? ""}`}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="val">{value}</div>
      <span className={`delta ${subTone}`}>{sub}</span>
    </div>
  );
}

export default async function CommandCenterPage() {
  const now = new Date();
  const t0 = ukDayPlus(now, 0);
  const startToday = ukWallClockToUtc(t0.year, t0.month, t0.day, 0, 0, 0);
  const since24 = new Date(now.getTime() - 24 * 3600 * 1000);

  const [
    openJobs,
    inProgressJobs,
    alarmsToday,
    onDutyCount,
    activeOfficers,
    awaitingReview,
    keysOut,
    activeSites,
    board,
    alarms24,
    reviewJobs,
    todaysJobs,
    onDuty,
    keysOutList,
  ] = await Promise.all([
    prisma.job.count({ where: { status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS"] } } }),
    prisma.job.count({ where: { status: "IN_PROGRESS" } }),
    prisma.alarmEvent.count({ where: { receivedAt: { gte: startToday } } }),
    prisma.user.count({ where: { active: true, onDuty: true, role: { in: ["OFFICER", "DISPATCHER"] } } }),
    prisma.user.count({ where: { active: true, role: "OFFICER" } }),
    prisma.job.count({ where: { status: { in: ["SUBMITTED", "REVIEW_PENDING"] } } }),
    prisma.key.count({ where: { status: { in: ["WITH_OFFICER", "WITH_CUSTOMER"] } } }),
    prisma.site.count({ where: { active: true } }),
    getLiveBoard(8),
    prisma.alarmEvent.findMany({ where: { receivedAt: { gte: since24 } }, select: { receivedAt: true } }),
    prisma.job.findMany({
      where: { status: { in: ["SUBMITTED", "REVIEW_PENDING"] } },
      select: {
        id: true,
        type: true,
        typeLabel: true,
        status: true,
        reportedViaPartnerApp: true,
        site: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
      orderBy: { updatedAt: "asc" },
      take: 6,
    }),
    prisma.job.findMany({
      where: { createdAt: { gte: startToday } },
      select: {
        reportedViaPartnerApp: true,
        customer: { select: { name: true } },
        partner: { select: { name: true } },
        handledByPartner: { select: { name: true } },
      },
    }),
    getOnDuty(),
    prisma.key.findMany({
      where: { status: { in: ["WITH_OFFICER", "WITH_CUSTOMER"] } },
      select: {
        id: true,
        label: true,
        internalNo: true,
        status: true,
        site: { select: { name: true } },
        currentHolder: { select: { name: true } },
        movements: { orderBy: { occurredAt: "desc" }, take: 1, select: { occurredAt: true } },
      },
      orderBy: { updatedAt: "asc" },
      take: 6,
    }),
  ]);

  // Alarm activity — 12 two-hour buckets across the last 24h (oldest → now).
  const buckets = new Array(12).fill(0) as number[];
  for (const a of alarms24) {
    const hoursAgo = (now.getTime() - a.receivedAt.getTime()) / 3600000;
    let idx = Math.floor((24 - hoursAgo) / 2);
    if (idx < 0) idx = 0;
    if (idx > 11) idx = 11;
    buckets[idx] += 1;
  }

  // Jobs by client today (solid bar = produces our report, hatched = partner app).
  const ownerMap = new Map<string, { count: number; app: boolean }>();
  for (const j of todaysJobs) {
    let name: string;
    let app: boolean;
    if (j.reportedViaPartnerApp) {
      name = j.partner?.name ?? j.handledByPartner?.name ?? "Partner app";
      app = true;
    } else if (j.handledByPartner) {
      name = j.handledByPartner.name;
      app = false;
    } else if (j.customer) {
      name = j.customer.name;
      app = false;
    } else if (j.partner) {
      name = j.partner.name;
      app = true;
    } else {
      name = "Unassigned";
      app = false;
    }
    const cur = ownerMap.get(name) ?? { count: 0, app };
    cur.count += 1;
    ownerMap.set(name, cur);
  }
  const ownerRows = Array.from(ownerMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const ownerMax = Math.max(1, ...ownerRows.map((o) => o.count));

  const alarmTotal = alarms24.length;

  return (
    <main>
      <div className="section-h">
        <span>At a glance</span>
        <span className="line" />
        <span className="meta">Live · all regions</span>
      </div>
      <div className="kpis">
        <Kpi icon="box" label="Open jobs" value={fmtInt(openJobs)} sub={`${fmtInt(inProgressJobs)} in progress`} />
        <Kpi icon="bell" label="Alarm responses" value={fmtInt(alarmsToday)} sub="since 00:00 today" />
        <Kpi
          icon="users"
          tone="g"
          label="Officers on duty"
          value={
            <>
              {fmtInt(onDutyCount)}
              <span className="sub"> / {fmtInt(activeOfficers)}</span>
            </>
          }
          sub="active officers"
        />
        <Kpi
          icon="fileText"
          tone="a"
          label="Awaiting review"
          value={fmtInt(awaitingReview)}
          sub={awaitingReview > 0 ? "need sign-off" : "all clear"}
          subTone={awaitingReview > 0 ? "warn" : "flat"}
        />
        <Kpi icon="key" label="Keys out" value={fmtInt(keysOut)} sub="held off-site" />
        <Kpi icon="shield" tone="s" label="Active sites" value={fmtInt(activeSites)} sub="under cover" />
      </div>

      <div className="section-h">
        <span>Live operations</span>
        <span className="line" />
      </div>
      <div className="grid-main">
        <div className="card">
          <div className="head">
            <h3>
              <Icon name="grid" size={16} /> Dispatch board
            </h3>
            <span className="meta">
              <a href="/command-center/dispatch" style={{ color: "var(--blue-light)" }}>
                open full board →
              </a>
            </span>
          </div>
          <BoardTable rows={board} />
        </div>

        <div className="stack">
          <div className="card">
            <div className="head">
              <h3>
                <Icon name="chartUp" size={16} /> Alarm activity
              </h3>
              <span className="meta">last 24h · {fmtInt(alarmTotal)} total</span>
            </div>
            <AreaChart values={buckets} id="alarms" ariaLabel="Alarm events over the last 24 hours" />
            <div className="chart-x">
              <span>-24h</span>
              <span>-18h</span>
              <span>-12h</span>
              <span>-6h</span>
              <span>now</span>
            </div>
          </div>

          <div className="card">
            <div className="head">
              <h3>
                <Icon name="fileText" size={16} /> Review queue
              </h3>
              <span className="meta">{fmtInt(awaitingReview)} pending</span>
            </div>
            {reviewJobs.length === 0 ? (
              <div className="empty">Nothing awaiting review.</div>
            ) : (
              reviewJobs.map((j) => {
                const sv = jobStatusView(j.status, j.reportedViaPartnerApp);
                return (
                  <div className="qitem" key={j.id}>
                    <Badge tone="amber">
                      <Icon name="clock" size={13} />
                    </Badge>
                    <div className="who">
                      <div className="t">
                        {j.site?.name ?? "—"} — {j.typeLabel ?? TYPE_LABEL[j.type] ?? j.type}
                      </div>
                      <div className="s">{j.assignedTo?.name ?? "Unassigned"}</div>
                    </div>
                    <Badge tone={sv.tone}>{sv.label}</Badge>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="section-h">
        <span>Coverage &amp; resources</span>
        <span className="line" />
      </div>
      <div className="grid-3">
        <div className="card">
          <div className="head">
            <h3>Jobs by client · today</h3>
            <span className="meta">{fmtInt(todaysJobs.length)} total</span>
          </div>
          {ownerRows.length === 0 ? (
            <div className="empty">No jobs logged today yet.</div>
          ) : (
            <>
              <div className="pad cov">
                {ownerRows.map((o) => (
                  <div className="cov-row" key={o.name}>
                    <div className="lab">
                      <span className="n">
                        {o.name}{" "}
                        <em style={{ fontStyle: "normal", color: "var(--dim)" }}>· {o.app ? "partner app" : "direct"}</em>
                      </span>
                      <span className="v">{o.count}</span>
                    </div>
                    <div className="track">
                      <span className={`seg ${o.app ? "norep" : "rep"}`} style={{ width: `${(o.count / ownerMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="chart-legend" style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12, marginTop: 2 }}>
                <span>
                  <i style={{ background: "linear-gradient(90deg,#3B82F6,#60A5FA)" }} />
                  Produces client report
                </span>
                <span>
                  <i style={{ background: "repeating-linear-gradient(45deg,#475569,#475569 3px,#3b475e 3px,#3b475e 6px)" }} />
                  Logged in partner app
                </span>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="head">
            <h3>Officers on duty</h3>
            <span className="meta">{fmtInt(onDutyCount)} active</span>
          </div>
          {onDuty.length === 0 ? (
            <div className="empty">No officers on duty.</div>
          ) : (
            onDuty.slice(0, 8).map((o) => (
              <div className="ofc" key={o.id}>
                <div className="av">
                  {initialsOf(o.name)}
                  <span className={`st ${o.freshness === "fresh" ? "on" : o.freshness === "stale" ? "idle" : "off"}`} />
                </div>
                <div className="who">
                  <div className="t">{o.name}</div>
                  <div className="s">
                    {o.roleLabel}
                    {o.freshness === "old" ? " · GPS stale" : ""}
                  </div>
                </div>
                <span className="ping">{o.lastSeen}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="head">
            <h3>Key register</h3>
            <span className="meta">{fmtInt(keysOut)} out</span>
          </div>
          {keysOutList.length === 0 ? (
            <div className="empty">All keys are with us.</div>
          ) : (
            keysOutList.map((k) => {
              const last = k.movements[0]?.occurredAt ?? null;
              const daysOut = last ? Math.floor((now.getTime() - last.getTime()) / 86400000) : null;
              const overdue = daysOut !== null && daysOut > 7;
              const outLabel = daysOut === null ? "out" : daysOut === 0 ? "today" : `${daysOut}d`;
              return (
                <div className={`kline ${overdue ? "over" : ""}`} key={k.id}>
                  {overdue ? (
                    <Badge tone="red">
                      <Icon name="alert" size={13} />
                    </Badge>
                  ) : null}
                  <span className="kid">{k.internalNo ?? k.label}</span>
                  <span className="ksite">
                    {k.site?.name ?? "—"}
                    {k.currentHolder ? ` · ${k.currentHolder.name}` : ""}
                  </span>
                  <span className={`badge ${overdue ? "b-red" : "b-slate"}`}>{overdue ? `out ${outLabel}` : `out · ${outLabel}`}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <footer>
        <div className="legend">
          <div className="col">
            <h4>Direct customer</h4>
            <p>
              Shurgard, Aegis, Orbis. Our officer attends, our admin reviews, we send the daily email/PDF.{" "}
              <span style={{ color: "var(--blue-light)" }}>Produces a client report.</span>
            </p>
          </div>
          <div className="col">
            <h4>Partner app</h4>
            <p>
              Nexus &amp; Keyholding Co jobs. Our officer fills in <em>their</em> app — we keep an internal stub for pay only.{" "}
              <span style={{ color: "var(--slate)" }}>No client report.</span>
            </p>
          </div>
          <div className="col">
            <h4>Subcontracted</h4>
            <p>
              Out-of-London Shurgard sites subbed to Nexus. Their officer attends; we ingest their report.{" "}
              <span style={{ color: "var(--amber)" }}>Awaiting partner report.</span>
            </p>
          </div>
        </div>
        <p style={{ marginTop: 14, textAlign: "center" }}>
          Live data from the operations database · refreshes automatically every 30 seconds.
        </p>
      </footer>
    </main>
  );
}
