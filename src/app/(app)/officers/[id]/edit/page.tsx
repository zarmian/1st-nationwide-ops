import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { OfficerForm } from "../../_components/OfficerForm";
import { updateOfficer } from "../../_actions";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function EditOfficerPage({
  params,
}: {
  params: { id: string };
}) {
  const [officer, regions, recentVisits, keysHeld, recentSubs] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: params.id },
        include: { region: { select: { name: true } } },
      }),
      prisma.region.findMany({ orderBy: { name: "asc" } }),
      prisma.patrolVisit.findMany({
        where: { officerId: params.id },
        orderBy: { scheduledAt: "desc" },
        take: 8,
        include: { site: { select: { name: true, code: true } } },
      }),
      prisma.key.findMany({
        where: { currentHolderUserId: params.id, status: "WITH_OFFICER" },
        select: {
          id: true,
          label: true,
          internalNo: true,
          site: { select: { name: true } },
        },
      }),
      prisma.formSubmission.findMany({
        where: { submittedByUserId: params.id },
        orderBy: { submittedAt: "desc" },
        take: 6,
        select: {
          id: true,
          form: true,
          submittedAt: true,
          site: { select: { name: true } },
          // Show the SCHEDULED date of the underlying activity, not when the
          // paperwork was submitted.
          job: { select: { scheduledFor: true } },
          patrolVisit: { select: { scheduledAt: true } },
          shift: { select: { scheduledStartsAt: true } },
        },
      }),
    ]);

  if (!officer) notFound();
  const action = updateOfficer.bind(null, officer.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={officer.name}
        backHref="/officers"
        backLabel="Officers"
        subtitle={
          <>
            {officer.email}
            {officer.region ? ` · ${officer.region.name}` : ""}
            {officer.onDuty && officer.active && (
              <span className="chip-mint text-[10px] ml-2">On duty</span>
            )}
            {!officer.active && (
              <span className="chip-slate text-[10px] ml-2">Inactive</span>
            )}
          </>
        }
        actions={
          <Link
            href={`/activities?officerId=${officer.id}`}
            className="btn-secondary text-sm"
          >
            View activities →
          </Link>
        }
      />

      <div className="grid lg:grid-cols-[1fr_320px] gap-5">
        <OfficerForm
          action={action}
          submitLabel="Save changes"
          isCreate={false}
          regions={regions}
          initial={{
            id: officer.id,
            name: officer.name,
            email: officer.email,
            phone: officer.phone,
            whatsappNumber: officer.whatsappNumber,
            siaNumber: officer.siaNumber,
            regionId: officer.regionId,
            role: officer.role,
            active: officer.active,
          }}
        />

        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Keys held ({keysHeld.length})
            </h3>
            {keysHeld.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No keys assigned.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {keysHeld.map((k) => (
                  <li key={k.id}>
                    <Link
                      href={`/keys/${k.id}`}
                      className="text-brand-navy hover:text-brand-blue-dark"
                    >
                      {k.internalNo ? `${k.internalNo} · ` : ""}
                      {k.label}
                    </Link>
                    {k.site && (
                      <div className="text-xs text-slate-500">{k.site.name}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Recent visits
            </h3>
            {recentVisits.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No visits yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recentVisits.map((v) => (
                  <li key={v.id}>
                    <div className="text-brand-navy">
                      {v.site.name}
                      {v.site.code ? (
                        <span className="text-xs text-slate-500 ml-1">
                          {v.site.code}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmt(v.scheduledAt)} · {v.status.toLowerCase()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Recent submissions
            </h3>
            {recentSubs.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No submissions yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recentSubs.map((s) => (
                  <li key={s.id}>
                    <div className="text-brand-navy">
                      {s.form.replace(/_/g, " ").toLowerCase()}
                    </div>
                    <div className="text-xs text-slate-500">
                      {s.site?.name ?? "—"} ·{" "}
                      {fmt(
                        s.job?.scheduledFor ??
                          s.patrolVisit?.scheduledAt ??
                          s.shift?.scheduledStartsAt ??
                          s.submittedAt,
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Account
            </h3>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between">
                <dt className="text-slate-500">Last seen</dt>
                <dd className="text-slate-700">{fmt(officer.lastSeenAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Created</dt>
                <dd className="text-slate-700">{fmt(officer.createdAt)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
