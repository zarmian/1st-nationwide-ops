import { getLiveBoard, getBucketCounts, getOnDuty } from "../_data";
import { Icon, BoardTable, fmtInt, initialsOf } from "../_ui";

export const dynamic = "force-dynamic";

export default async function DispatchLivePage() {
  const now = new Date();
  const [board, counts, onDuty] = await Promise.all([getLiveBoard(14), getBucketCounts(now), getOnDuty()]);

  const tabs: { label: string; count: number; warn?: boolean; active?: boolean }[] = [
    { label: "Live", count: counts.live, active: true },
    { label: "Pending", count: counts.pending },
    { label: "In progress", count: counts.in_progress },
    { label: "Awaiting review", count: counts.review },
    { label: "Missed", count: counts.missed, warn: counts.missed > 0 },
    { label: "Completed", count: counts.completed },
    { label: "Cancelled", count: counts.cancelled },
  ];

  return (
    <main>
      <div className="page-title">
        <div>
          <h1>Dispatch</h1>
          <p>Live board — callouts, scheduled lock-ups, patrols and partner jobs in one place.</p>
        </div>
        <div className="toolbar">
          <a className="chip" href="/dispatch">
            <Icon name="mapPin" size={14} /> Open map view
          </a>
          <a className="chip active" href="/dispatch/new">
            <Icon name="plus" size={14} /> New job
          </a>
        </div>
      </div>

      <div className="section-h">
        <span>Live board</span>
        <span className="line" />
        <span className="meta">{fmtInt(counts.live)} active activities</span>
      </div>
      <div className="card">
        <div className="tabs">
          {tabs.map((t) => (
            <span key={t.label} className={`tab ${t.active ? "active" : ""} ${t.warn ? "warn" : ""}`}>
              {t.label} <span className="c">{fmtInt(t.count)}</span>
            </span>
          ))}
        </div>
        <BoardTable rows={board} showPriority />
      </div>

      <div className="section-h">
        <span>Field team</span>
        <span className="line" />
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="head">
            <h3>
              <Icon name="users" size={16} /> On duty
            </h3>
            <span className="meta">{fmtInt(onDuty.length)} officers</span>
          </div>
          {onDuty.length === 0 ? (
            <div className="empty">No officers on duty.</div>
          ) : (
            onDuty.map((o) => (
              <div className="ofc" key={o.id}>
                <div className="av">
                  {initialsOf(o.name)}
                  <span className={`st ${o.freshness === "fresh" ? "on" : o.freshness === "stale" ? "idle" : "off"}`} />
                </div>
                <div className="who">
                  <div className="t">{o.name}</div>
                  <div className="s">
                    {o.roleLabel}
                    {o.freshness === "fresh" ? " · GPS live" : o.freshness === "stale" ? " · GPS stale" : " · GPS old"}
                  </div>
                </div>
                <span className="ping">{o.lastSeen}</span>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="head">
            <h3>
              <Icon name="mapPin" size={16} /> Field view
            </h3>
            <span className="meta">live map</span>
          </div>
          <div className="empty" style={{ padding: "30px 20px", lineHeight: 1.6 }}>
            The full live map — officer GPS pins with freshness, owner-coloured site markers and
            assignment routes — lives on the existing dispatch screen.
            <div style={{ marginTop: 14 }}>
              <a className="chip active" href="/dispatch" style={{ display: "inline-flex" }}>
                <Icon name="mapPin" size={14} /> Open map view
              </a>
            </div>
          </div>
        </div>
      </div>

      <footer>
        <div className="legend">
          <div className="col">
            <h4>One board, every activity</h4>
            <p>Ad-hoc callouts, scheduled lock-ups/unlocks, recurring patrols &amp; VPIs, and partner jobs all merge here — ordered by priority, then time.</p>
          </div>
          <div className="col">
            <h4>Source tells you the flow</h4>
            <p>
              <span className="tag direct" style={{ fontSize: 10 }}>Direct</span> produces a client report ·{" "}
              <span className="tag app" style={{ fontSize: 10 }}>Partner app</span> is logged for pay only ·{" "}
              <span className="tag subbed" style={{ fontSize: 10 }}>Subbed</span> waits on the partner's report.
            </p>
          </div>
          <div className="col">
            <h4>Live</h4>
            <p>Counts and rows come straight from the operations database and refresh automatically every 30 seconds.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}
