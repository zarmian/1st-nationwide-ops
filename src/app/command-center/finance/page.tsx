import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Icon, AreaChart, fmtGBP, fmtInt } from "../_ui";

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
      <div className="val money">{value}</div>
      <span className={`delta ${subTone}`}>{sub}</span>
    </div>
  );
}

const num = (v: unknown): number => Number(v ?? 0);

function serviceLabelForJobType(t: string): string {
  switch (t) {
    case "ALARM_RESPONSE":
      return "Alarm response";
    case "PATROL":
      return "Patrol";
    case "LOCK":
    case "UNLOCK":
      return "Lock-up / Unlock";
    case "VPI":
      return "VPI";
    case "KEY_COLLECTION":
    case "KEY_DROPOFF":
      return "Keyholding";
    case "STATIC_GUARDING_SHIFT":
      return "Static guarding";
    case "DOG_HANDLER_SHIFT":
      return "Dog handler";
    default:
      return "Ad-hoc";
  }
}

export default async function FinanceLivePage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") redirect("/command-center");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Previous period of the same elapsed length, ending the instant before the month began.
  const periodMs = now.getTime() - monthStart.getTime();
  const prevTo = new Date(monthStart.getTime() - 1);
  const prevFrom = new Date(prevTo.getTime() - periodMs);

  async function billedSum(from: Date, to: Date): Promise<number> {
    const [v, j] = await prisma.$transaction([
      prisma.patrolVisit.aggregate({
        _sum: { billedAmount: true },
        where: { status: "COMPLETED", departedAt: { gte: from, lte: to } },
      }),
      prisma.job.aggregate({
        _sum: { billedAmount: true },
        where: { completedAt: { gte: from, lte: to }, status: { not: "CANCELLED" } },
      }),
    ]);
    return num(v._sum.billedAmount) + num(j._sum.billedAmount);
  }

  // 14-day daily billed series (raw SQL — cheap group vs round-tripping rows).
  const sparkEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const sparkStart = new Date(sparkEnd);
  sparkStart.setDate(sparkEnd.getDate() - 13);
  sparkStart.setHours(0, 0, 0, 0);

  const [earnedToday, earnedMonth, earnedPrev, rangeVisits, rangeJobs, ratedSites, sitesMissingRates, zeroBilled, dailyRows] =
    await Promise.all([
      billedSum(startToday, now),
      billedSum(monthStart, now),
      billedSum(prevFrom, prevTo),
      prisma.patrolVisit.findMany({
        where: { status: "COMPLETED", departedAt: { gte: monthStart, lte: now } },
        select: {
          billedAmount: true,
          paidAmount: true,
          officer: { select: { id: true, name: true } },
          patrolSchedule: { select: { kind: true } },
          site: {
            select: {
              customerId: true,
              customer: { select: { name: true } },
              partnerId: true,
              partner: { select: { name: true } },
            },
          },
        },
      }),
      prisma.job.findMany({
        where: { completedAt: { gte: monthStart, lte: now }, status: { not: "CANCELLED" } },
        select: {
          billedAmount: true,
          paidAmount: true,
          type: true,
          customerId: true,
          customer: { select: { name: true } },
          partnerId: true,
          partner: { select: { name: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      prisma.site.findMany({
        where: { active: true, rates: { some: { service: "ANNUAL_SUBSCRIPTION" } } },
        select: { name: true, rates: { where: { service: "ANNUAL_SUBSCRIPTION" }, select: { amount: true } } },
      }),
      prisma.site.count({ where: { active: true, rates: { none: {} } } }),
      prisma.job.count({
        where: { completedAt: { gte: monthStart, lte: now }, status: { not: "CANCELLED" }, OR: [{ billedAmount: null }, { billedAmount: 0 }] },
      }),
      prisma.$queryRaw<{ day: Date; total: number }[]>`
        SELECT day, COALESCE(SUM(amount), 0)::float8 AS total
        FROM (
          SELECT date_trunc('day', "departedAt") AS day, "billedAmount" AS amount
          FROM "PatrolVisit"
          WHERE "departedAt" BETWEEN ${sparkStart} AND ${sparkEnd}
            AND "status" = 'COMPLETED' AND "billedAmount" IS NOT NULL
          UNION ALL
          SELECT date_trunc('day', "completedAt") AS day, "billedAmount" AS amount
          FROM "Job"
          WHERE "completedAt" BETWEEN ${sparkStart} AND ${sparkEnd}
            AND "status" <> 'CANCELLED' AND "billedAmount" IS NOT NULL
        ) s
        GROUP BY day ORDER BY day ASC
      `,
    ]);

  // ---- P&L by account, officer cost, revenue-by-service (single pass) ----
  type Pnl = { key: string; label: string; kind: "customer" | "partner" | "none"; billed: number; paid: number; activities: number };
  const pnl = new Map<string, Pnl>();
  function bucket(customerId: string | null, customerName: string | null, partnerId: string | null, partnerName: string | null): Pnl {
    let key: string;
    let label: string;
    let kind: Pnl["kind"];
    if (customerId) {
      key = `c:${customerId}`;
      label = customerName ?? "Customer";
      kind = "customer";
    } else if (partnerId) {
      key = `p:${partnerId}`;
      label = partnerName ?? "Partner";
      kind = "partner";
    } else {
      key = "unassigned";
      label = "Unassigned";
      kind = "none";
    }
    let b = pnl.get(key);
    if (!b) {
      b = { key, label, kind, billed: 0, paid: 0, activities: 0 };
      pnl.set(key, b);
    }
    return b;
  }

  const officerCost = new Map<string, { name: string; paid: number; activities: number }>();
  function addOfficer(id: string | null | undefined, name: string | null | undefined, paid: number) {
    if (!id) return;
    const cur = officerCost.get(id) ?? { name: name ?? "Officer", paid: 0, activities: 0 };
    cur.paid += paid;
    cur.activities += 1;
    officerCost.set(id, cur);
  }

  const service = new Map<string, number>();
  const addService = (label: string, amt: number) => service.set(label, (service.get(label) ?? 0) + amt);

  let totalBilled = 0;
  let totalPaid = 0;
  let totalActivities = 0;

  for (const v of rangeVisits) {
    const billed = num(v.billedAmount);
    const paid = num(v.paidAmount);
    const b = bucket(v.site?.customerId ?? null, v.site?.customer?.name ?? null, v.site?.partnerId ?? null, v.site?.partner?.name ?? null);
    b.billed += billed;
    b.paid += paid;
    b.activities += 1;
    addOfficer(v.officer?.id, v.officer?.name, paid);
    addService(v.patrolSchedule?.kind === "VPI" ? "VPI" : "Patrol", billed);
    totalBilled += billed;
    totalPaid += paid;
    totalActivities += 1;
  }
  for (const j of rangeJobs) {
    const billed = num(j.billedAmount);
    const paid = num(j.paidAmount);
    const b = bucket(j.customerId, j.customer?.name ?? null, j.partnerId, j.partner?.name ?? null);
    b.billed += billed;
    b.paid += paid;
    b.activities += 1;
    addOfficer(j.assignedTo?.id, j.assignedTo?.name, paid);
    addService(serviceLabelForJobType(j.type), billed);
    totalBilled += billed;
    totalPaid += paid;
    totalActivities += 1;
  }

  const pnlRows = Array.from(pnl.values()).sort((a, b) => b.billed - a.billed);
  const officerRows = Array.from(officerCost.values()).sort((a, b) => b.paid - a.paid).slice(0, 6);
  const serviceRows = Array.from(service.entries())
    .map(([label, amt]) => ({ label, amt }))
    .filter((s) => s.amt > 0)
    .sort((a, b) => b.amt - a.amt)
    .slice(0, 6);
  const serviceMax = Math.max(1, ...serviceRows.map((s) => s.amt));

  const arr = ratedSites.reduce((sum, s) => sum + num(s.rates[0]?.amount), 0);
  const topSites = ratedSites
    .map((s) => ({ name: s.name, annual: num(s.rates[0]?.amount) }))
    .filter((s) => s.annual > 0)
    .sort((a, b) => b.annual - a.annual)
    .slice(0, 6);

  const profit = totalBilled - totalPaid;
  const margin = totalBilled > 0 ? Math.round((profit / totalBilled) * 100) : 0;
  const monthLabel = monthStart.toLocaleDateString("en-GB", { month: "long" });
  const delta = earnedPrev > 0 ? Math.round(((earnedMonth - earnedPrev) / earnedPrev) * 100) : null;

  // Densify daily series to 14 points.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const dailyMap = new Map<string, number>();
  for (const r of dailyRows) dailyMap.set(dayKey(new Date(r.day)), num(r.total));
  const daily: number[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(sparkStart);
    d.setDate(sparkStart.getDate() + i);
    daily.push(dailyMap.get(dayKey(d)) ?? 0);
  }
  const daily14Total = daily.reduce((a, b) => a + b, 0);

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Finance</h1>
          <p>Billing, margin and officer cost across customers and partners.</p>
        </div>
        <div className="toolbar">
          <a className="chip active" href="/finance">
            <Icon name="download" size={14} /> Full finance
          </a>
        </div>
      </div>

      <div className="section-h">
        <span>{monthLabel} · to date</span>
        <span className="line" />
        <span className="meta">vs previous period</span>
      </div>
      <div className="kpis">
        <Kpi
          icon="dollar"
          tone="g"
          label={`Earned · ${monthLabel}`}
          value={fmtGBP(earnedMonth)}
          sub={delta === null ? "this month" : `${delta >= 0 ? "+" : ""}${delta}% vs last`}
          subTone={delta === null ? "flat" : delta >= 0 ? "up" : "down"}
        />
        <Kpi icon="clock" label="Earned today" value={fmtGBP(earnedToday)} sub="billed so far" />
        <Kpi icon="chartUp" tone="v" label="Annual recurring" value={fmtGBP(arr)} sub={`${fmtInt(ratedSites.length)} sites`} />
        <Kpi icon="bars" tone="g" label={`Profit · ${monthLabel}`} value={fmtGBP(profit)} sub={`${margin}% margin`} subTone={profit >= 0 ? "up" : "down"} />
        <Kpi icon="users" tone="s" label="Officer cost" value={fmtGBP(totalPaid)} sub={`${fmtInt(totalActivities)} activities`} />
        <Kpi
          icon="alert"
          tone="a"
          label="Sites missing rates"
          value={fmtInt(sitesMissingRates)}
          sub={sitesMissingRates > 0 ? "won't bill until set" : "all rated"}
          subTone={sitesMissingRates > 0 ? "warn" : "flat"}
        />
      </div>

      <div className="section-h">
        <span>Profit &amp; loss</span>
        <span className="line" />
        <span className="meta">by account · {monthLabel}</span>
      </div>
      <div className="grid-main">
        <div className="card">
          <div className="head">
            <h3>By account</h3>
            <span className="meta">customers &amp; partners</span>
          </div>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="r">Activities</th>
                  <th className="r">Billed</th>
                  <th className="r">Cost</th>
                  <th className="r">Profit</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {pnlRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      No completed, billed activities this month yet.
                    </td>
                  </tr>
                ) : (
                  pnlRows.map((r) => {
                    const p = r.billed - r.paid;
                    const m = r.billed > 0 ? Math.round((p / r.billed) * 100) : 0;
                    return (
                      <tr key={r.key}>
                        <td>
                          <span className="src">
                            {r.kind === "customer" ? (
                              <span className="tag direct">Customer</span>
                            ) : r.kind === "partner" ? (
                              <span className="tag app">Partner</span>
                            ) : null}{" "}
                            {r.label}
                          </span>
                        </td>
                        <td className="r mono">{fmtInt(r.activities)}</td>
                        <td className="money">{fmtGBP(r.billed)}</td>
                        <td className="money" style={{ color: "var(--muted)" }}>
                          {fmtGBP(r.paid)}
                        </td>
                        <td className={`money ${p >= 0 ? "pos" : "neg"}`}>{fmtGBP(p)}</td>
                        <td style={{ minWidth: 120 }}>
                          <div className="track">
                            <span className={`seg ${m >= 35 ? "green" : "amber"}`} style={{ width: `${Math.max(0, Math.min(100, m))}%` }} />
                          </div>
                          <div className="sub mono" style={{ marginTop: 4 }}>
                            {m}%
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {pnlRows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td>Total · {fmtInt(pnlRows.length)} accounts</td>
                    <td className="r mono">{fmtInt(totalActivities)}</td>
                    <td className="money">{fmtGBP(totalBilled)}</td>
                    <td className="money" style={{ color: "var(--muted)" }}>
                      {fmtGBP(totalPaid)}
                    </td>
                    <td className={`money ${profit >= 0 ? "pos" : "neg"}`}>{fmtGBP(profit)}</td>
                    <td className="mono">{margin}%</td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="head">
              <h3>
                <Icon name="chartUp" size={16} /> Billed · last 14 days
              </h3>
              <span className="meta">{fmtGBP(daily14Total)}</span>
            </div>
            <AreaChart values={daily} id="billed" color="#22C55E" ariaLabel="Daily amount billed over the last 14 days" />
            <div className="chart-x">
              <span>-14d</span>
              <span>-10d</span>
              <span>-6d</span>
              <span>today</span>
            </div>
          </div>

          <div className="card">
            <div className="head">
              <h3>Revenue by service</h3>
              <span className="meta">{monthLabel}</span>
            </div>
            {serviceRows.length === 0 ? (
              <div className="empty">No billed revenue this month yet.</div>
            ) : (
              <div className="pad cov">
                {serviceRows.map((s) => (
                  <div className="cov-row" key={s.label}>
                    <div className="lab">
                      <span className="n">{s.label}</span>
                      <span className="v">{fmtGBP(s.amt)}</span>
                    </div>
                    <div className="track">
                      <span className="seg rep" style={{ width: `${(s.amt / serviceMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="section-h">
        <span>People &amp; sites</span>
        <span className="line" />
      </div>
      <div className="grid-3">
        <div className="card">
          <div className="head">
            <h3>Officer cost · {monthLabel}</h3>
            <span className="meta">top by pay</span>
          </div>
          {officerRows.length === 0 ? (
            <div className="empty">No officer pay recorded yet.</div>
          ) : (
            officerRows.map((o) => (
              <div className="ofc" key={o.name}>
                <div className="who">
                  <div className="t">{o.name}</div>
                  <div className="s">{fmtInt(o.activities)} activities</div>
                </div>
                <span className="money">{fmtGBP(o.paid)}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="head">
            <h3>Top sites by annual value</h3>
            <span className="meta">recurring</span>
          </div>
          {topSites.length === 0 ? (
            <div className="empty">No annual subscriptions set.</div>
          ) : (
            topSites.map((s) => (
              <div className="kline" key={s.name}>
                <span className="ksite">{s.name}</span>
                <span className="badge b-blue">{fmtGBP(s.annual)}/yr</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="head">
            <h3>Billing health</h3>
            <span className="meta">needs attention</span>
          </div>
          <div className="qitem">
            <span className={`badge ${sitesMissingRates > 0 ? "b-amber" : "b-green"}`} style={{ padding: 5 }}>
              <Icon name={sitesMissingRates > 0 ? "alert" : "check"} size={15} />
            </span>
            <div className="who">
              <div className="t">{fmtInt(sitesMissingRates)} sites missing rates</div>
              <div className="s">Activities here won&apos;t be billed</div>
            </div>
            <span className={`badge ${sitesMissingRates > 0 ? "b-amber" : "b-green"}`}>{sitesMissingRates > 0 ? "Set rates" : "OK"}</span>
          </div>
          <div className="qitem">
            <span className={`badge ${zeroBilled > 0 ? "b-red" : "b-green"}`} style={{ padding: 5 }}>
              <Icon name={zeroBilled > 0 ? "alert" : "check"} size={15} />
            </span>
            <div className="who">
              <div className="t">{fmtInt(zeroBilled)} activities billed at £0</div>
              <div className="s">Completed this month with no amount</div>
            </div>
            <span className={`badge ${zeroBilled > 0 ? "b-red" : "b-green"}`}>{zeroBilled > 0 ? "Review" : "OK"}</span>
          </div>
          <div className="qitem">
            <span className="badge b-violet" style={{ padding: 5 }}>
              <Icon name="download" size={15} />
            </span>
            <div className="who">
              <div className="t">Full finance workspace</div>
              <div className="s">Date ranges, payroll &amp; recalc</div>
            </div>
            <a className="badge b-violet" href="/finance">
              Open
            </a>
          </div>
        </div>
      </div>

      <footer>
        <div className="legend">
          <div className="col">
            <h4>Billed − Cost = Profit</h4>
            <p>Billed is what we charge the account; cost is what we paid the officer. Figures snapshot on completion, so scheduled-but-undone work never inflates today's earnings.</p>
          </div>
          <div className="col">
            <h4>Customers and partners together</h4>
            <p>Partner accounts appear alongside direct customers — partner-app jobs still carry an officer cost we track for pay.</p>
          </div>
          <div className="col">
            <h4>Live</h4>
            <p>Every figure comes straight from completed jobs and patrol visits in the operations database, refreshed automatically.</p>
          </div>
        </div>
        <p style={{ marginTop: 14, textAlign: "center" }}>Live data · currency GBP · admin only.</p>
      </footer>
    </main>
  );
}
