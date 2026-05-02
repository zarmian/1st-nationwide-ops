import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
  const role = (session?.user as any)?.role;
  if (role !== "ADMIN" && role !== "DISPATCHER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") || undefined;
  const region = url.searchParams.get("region") || undefined;
  const service = url.searchParams.get("service") || undefined;
  const type = url.searchParams.get("type") || undefined;

  const where = {
    AND: [
      q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { addressLine: { contains: q, mode: "insensitive" as const } },
              {
                postcode: {
                  contains: q.replace(/\s+/g, ""),
                  mode: "insensitive" as const,
                },
              },
              { code: { contains: q, mode: "insensitive" as const } },
              {
                customer: {
                  name: { contains: q, mode: "insensitive" as const },
                },
              },
            ],
          }
        : {},
      region
        ? { region: { name: { equals: region, mode: "insensitive" as const } } }
        : {},
      service ? { services: { has: service as any } } : {},
      type ? { type: type as any } : {},
      { active: true },
    ],
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
    orderBy: [{ code: "asc" }, { name: "asc" }],
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
