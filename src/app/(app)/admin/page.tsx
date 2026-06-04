import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminHubPage() {
  // $transaction runs queries serially over a single connection — avoids the
  // Vercel + Supabase pgbouncer pool-exhaustion that bites Promise.all when
  // connection_limit on DATABASE_URL is low.
  const [
    customers,
    partners,
    regions,
    pending,
    templates,
    blueprints,
    notifyPending,
    pickerOptions,
  ] = await prisma.$transaction([
    prisma.customer.count({ where: { active: true } }),
    prisma.partner.count({ where: { active: true } }),
    prisma.region.count(),
    prisma.reportReview.count({ where: { status: "PENDING" } }),
    prisma.formTemplate.count({ where: { active: true } }),
    prisma.formBlueprint.count({ where: { active: true } }),
    prisma.notification.count({ where: { status: "PENDING" } }),
    prisma.jobTypeOption.count({ where: { active: true } }),
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
    {
      href: "/admin/forms",
      title: "Form templates",
      blurb: "What officers fill in for each kind of job. Per-customer, per-partner, or per-site.",
      stat: templates,
      statLabel: "active",
    },
    {
      href: "/admin/blueprints",
      title: "Form blueprints",
      blurb: "Reusable starting points — pick when creating a new template instead of building from scratch.",
      stat: blueprints,
      statLabel: "active",
    },
    {
      href: "/admin/imports/nexus",
      title: "Nexus import",
      blurb: "Upload the latest Nexus CSV. Reset site data first if you want a clean slate.",
      stat: 0,
      statLabel: "tool",
    },
    {
      href: "/admin/officer-rates",
      title: "Officer pay rates",
      blurb: "Monthly retainer + per-service rates. Company defaults with per-officer overrides.",
      stat: 0,
      statLabel: "rates",
    },
    {
      href: "/admin/notifications",
      title: "Notifications",
      blurb: "WhatsApp queue — visit, alarm, and key-handover events sent to staff.",
      stat: notifyPending,
      statLabel: "pending",
    },
    {
      href: "/admin/options",
      title: "Picker options",
      blurb: "Labels and order of the job-type / source dropdowns. Rename, hide, reorder, or add alias labels.",
      stat: pickerOptions,
      statLabel: "job types",
    },
  ];

  return (
    <div className="section">
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
            className="card-hover p-5"
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
