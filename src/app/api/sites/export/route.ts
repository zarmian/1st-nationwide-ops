import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildSiteWhereAnd, siteOrderBy } from "@/lib/siteFilters";

const ACTIVE_ONBOARDING_STAGES = [
  "PROPOSED",
  "SURVEY",
  "KEY_COLLECTION",
] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const p = new URL(req.url).searchParams;
  const where = {
    AND: buildSiteWhereAnd({
      q: p.get("q") || undefined,
      region: p.get("region") || undefined,
      service: p.get("service") || undefined,
      type: p.get("type") || undefined,
      partner: p.get("partner") || undefined,
      customer: p.get("customer") || undefined,
      status: p.get("status") || undefined,
    }),
  };

  const sites = await prisma.site.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      partner: { select: { name: true } },
      region: { select: { name: true } },
      onboardingPipelines: {
        where: { stage: { in: ACTIVE_ONBOARDING_STAGES as any } },
        select: { stage: true },
        take: 1,
      },
    },
    orderBy: siteOrderBy(p.get("sort") || undefined),
  });

  const header = [
    "code",
    "name",
    "address",
    "postcode",
    "city",
    "type",
    "region",
    "customer",
    "partner",
    "services",
    "risk_level",
    "onboarding_stage",
    "notes",
  ];

  const rows = sites.map((s) =>
    [
      s.code ?? "",
      s.name,
      s.addressLine,
      s.postcodeFormatted,
      s.city ?? "",
      s.type,
      s.region?.name ?? "",
      s.customer?.name ?? "",
      s.partner?.name ?? "",
      s.services.join("|"),
      s.riskLevel,
      s.onboardingPipelines[0]?.stage ?? "",
      s.notes ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );

  const body = [header.join(","), ...rows].join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sites-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
