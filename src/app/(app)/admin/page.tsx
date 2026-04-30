import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminHubPage() {
  const [customers, partners, regions, pending] = await Promise.all([
    prisma.customer.count({ where: { active: true } }),
    prisma.partner.count({ where: { active: true } }),
    prisma.region.count(),
    prisma.reportReview.count({ where: { status: "PENDING" } }),
  ]);

  const cards = [
    {
      href: "/admin/reports",
      title: "Review queue",
      blurb: "Officer submissions waiting for sign-off before they go to the customer.",
      stat: pending,
      statLabel: "pending",
    },
    {
      href: "/admin/customers",
      title: "Customers",
      blurb: "Direct customers (Shurgard, Aegis, Orbis) and their contacts.",
      stat: customers,
      statLabel: "active",
    },
    {
      href: "/admin/partners",
      title: "Partners",
      blurb: "Companies we sub work to or that sub work to us (Nexus, Keyholding Co).",
      stat: partners,
      statLabel: "active",
    },
    {
      href: "/admin/regions",
      title: "Regions",
      blurb: "Operating regions for sites and officers (London, Outside London).",
      stat: regions,
      statLabel: "regions",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Admin</h1>
        <p className="text-sm text-slate-500">
          Manage the lookup data behind sites and jobs.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="card p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold text-brand-navy">{c.title}</h2>
              <div className="text-right">
                <div className="text-2xl font-semibold text-brand-navy tabular-nums">
                  {c.stat.toLocaleString("en-GB")}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  {c.statLabel}
                </div>
              </div>
            </div>
            <p className="text-sm text-slate-500 mt-2">{c.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
