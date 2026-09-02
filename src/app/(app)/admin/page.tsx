import {
  Inbox,
  Building2,
  Handshake,
  Map,
  FileText,
  LayoutTemplate,
  Upload,
  MapPinned,
  PoundSterling,
  Bell,
  SlidersHorizontal,
  EyeOff,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { HubGrid, type HubCard } from "@/components/HubGrid";

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
    hiddenCustomers,
    hiddenPartners,
  ] = await prisma.$transaction([
    prisma.customer.count({ where: { active: true } }),
    prisma.partner.count({ where: { active: true } }),
    prisma.region.count(),
    prisma.reportReview.count({ where: { status: "PENDING" } }),
    prisma.formTemplate.count({ where: { active: true } }),
    prisma.formBlueprint.count({ where: { active: true } }),
    prisma.notification.count({ where: { status: "PENDING" } }),
    prisma.jobTypeOption.count({ where: { active: true } }),
    prisma.customer.count({ where: { hidden: true } }),
    prisma.partner.count({ where: { hidden: true } }),
  ]);

  const cards: HubCard[] = [
    {
      href: "/admin/reports",
      title: "Review queue",
      blurb: "Officer submissions waiting for sign-off before they go to the customer.",
      stat: pending,
      statLabel: "pending",
      icon: Inbox,
      tone: "amber",
    },
    {
      href: "/admin/customers",
      title: "Customers",
      blurb: "Direct customers (Shurgard, Aegis, Orbis) and their contacts.",
      stat: customers,
      statLabel: "active",
      icon: Building2,
      tone: "blue",
    },
    {
      href: "/admin/partners",
      title: "Partners",
      blurb: "Companies we sub work to or that sub work to us (Nexus, Keyholding Co).",
      stat: partners,
      statLabel: "active",
      icon: Handshake,
      tone: "indigo",
    },
    {
      href: "/admin/regions",
      title: "Regions",
      blurb: "Operating regions for sites and officers (London, Outside London).",
      stat: regions,
      statLabel: "regions",
      icon: Map,
      tone: "emerald",
    },
    {
      href: "/admin/forms",
      title: "Form templates",
      blurb: "What officers fill in for each kind of job. Per-customer, per-partner, or per-site.",
      stat: templates,
      statLabel: "active",
      icon: FileText,
      tone: "blue",
    },
    {
      href: "/admin/blueprints",
      title: "Form blueprints",
      blurb: "Reusable starting points — pick when creating a new template instead of building from scratch.",
      stat: blueprints,
      statLabel: "active",
      icon: LayoutTemplate,
      tone: "indigo",
    },
    {
      href: "/admin/imports/nexus",
      title: "Nexus import",
      blurb: "Upload the latest Nexus CSV. Reset site data first if you want a clean slate.",
      stat: 0,
      statLabel: "tool",
      icon: Upload,
      tone: "blue",
      tool: true,
    },
    {
      href: "/admin/imports/sites",
      title: "Sites import",
      blurb: "Upload a site list (Shurgard, Aegis, Orbis, or a custom CSV). Matches by code or name + postcode, then geocodes.",
      stat: 0,
      statLabel: "tool",
      icon: MapPinned,
      tone: "emerald",
      tool: true,
    },
    {
      href: "/admin/officer-rates",
      title: "Officer pay rates",
      blurb: "Monthly retainer + per-service rates. Company defaults with per-officer overrides.",
      stat: 0,
      statLabel: "rates",
      icon: PoundSterling,
      tone: "amber",
      tool: true,
    },
    {
      href: "/admin/notifications",
      title: "Notifications",
      blurb: "WhatsApp queue — visit, alarm, and key-handover events sent to staff.",
      stat: notifyPending,
      statLabel: "pending",
      icon: Bell,
      tone: "rose",
    },
    {
      href: "/admin/options",
      title: "Picker options",
      blurb: "Labels and order of the job-type / source dropdowns. Rename, hide, reorder, or add alias labels.",
      stat: pickerOptions,
      statLabel: "job types",
      icon: SlidersHorizontal,
      tone: "indigo",
    },
    {
      href: "/admin/hidden",
      title: "Hidden accounts",
      blurb: "Customers/partners you've hidden from admin browse views. Un-hide them here. Dispatch, finance and the client portal are unaffected.",
      stat: hiddenCustomers + hiddenPartners,
      statLabel: "hidden",
      icon: EyeOff,
      tone: "rose",
    },
  ];

  return (
    <div className="section">
      <PageHeader
        title="Admin"
        subtitle="Manage the lookup data behind sites and jobs."
      />

      <HubGrid cards={cards} />
    </div>
  );
}
