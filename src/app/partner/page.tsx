import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePartner } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { ClipboardList, Users } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Partner-portal home.
 *
 * Phase 1 surface: confirm-you're-in landing with two anchored
 * shortcuts (Activities · Officers) and a couple of "what you've
 * been doing for us" stats — activities this month + total
 * officers on your roster. Anything heavier (rates, finance,
 * recording new activities) lands in Phase 2.
 */
export default async function PartnerHomePage() {
  const me = await requirePartner();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [activitiesThisMonth, officerCount, partner] = await Promise.all([
    // Jobs we sent them (handledByPartnerId) that completed this month.
    prisma.job.count({
      where: {
        handledByPartnerId: me.partnerId,
        completedAt: { gte: monthStart },
        status: { not: "CANCELLED" },
      },
    }),
    prisma.partnerOfficer.count({
      where: { partnerId: me.partnerId, active: true },
    }),
    prisma.partner.findUnique({
      where: { id: me.partnerId },
      select: { name: true, role: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Welcome, ${partner?.name ?? "Partner"}`}
        subtitle="Manage your officer roster and review the activities you've handled for us."
      />

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="kpi p-4">
          <div className="kpi-label">Activities this month</div>
          <div className="kpi-value">
            {activitiesThisMonth.toLocaleString("en-GB")}
          </div>
          <div className="kpi-hint">Jobs we sent you that you've closed</div>
        </div>
        <div className="kpi p-4">
          <div className="kpi-label">Officers on your roster</div>
          <div className="kpi-value">
            {officerCount.toLocaleString("en-GB")}
          </div>
          <div className="kpi-hint">Active officers in your records</div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Link
          href="/partner/activities"
          className="card-hover p-5 flex items-start gap-3"
        >
          <ClipboardList size={22} className="text-brand-blue-dark mt-0.5" />
          <div>
            <h2 className="font-semibold text-brand-navy">Activities</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Every job we sent you. Filter by date, type, site.
            </p>
          </div>
        </Link>
        <Link
          href="/partner/officers"
          className="card-hover p-5 flex items-start gap-3"
        >
          <Users size={22} className="text-brand-blue-dark mt-0.5" />
          <div>
            <h2 className="font-semibold text-brand-navy">Officers</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Manage your private officer roster. Stays inside your
              portal.
            </p>
          </div>
        </Link>
      </div>

      <div className="card-subtle p-4">
        <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
          Coming next
        </h3>
        <ul className="text-sm text-slate-700 space-y-1 list-disc list-inside">
          <li>
            Record your own jobs and shifts with rates (what you charge us
            + what you pay your officer).
          </li>
          <li>
            Finance tab — your invoiced total + the split per officer.
          </li>
          <li>
            Optional login access for your officers so they can complete
            activities on their phone.
          </li>
        </ul>
      </div>
    </div>
  );
}
