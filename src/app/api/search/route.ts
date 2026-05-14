import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";

/**
 * GET /api/search?q=foo
 *
 * Cross-entity quick-search for the command palette. Returns up to a
 * handful of hits per entity type. Role-aware: officers only see
 * themselves + their sites; admins / dispatchers see everything.
 *
 * Stays intentionally narrow on what we query — three text searches at
 * most. Keeps the latency under ~150ms even on a cold function.
 */

const MAX_PER_KIND = 5;

export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ sites: [], officers: [], jobs: [], shifts: [] });
  }

  const isStaff = me.role === "ADMIN" || me.role === "DISPATCHER";

  // Sites — most useful single hit. Officers get the same list (their
  // assigned visits / jobs link to sites already).
  const sites = await prisma.site.findMany({
    where: {
      active: true,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { postcode: { contains: q.replace(/\s/g, ""), mode: "insensitive" } },
        { partnerReference: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: MAX_PER_KIND,
    select: {
      id: true,
      name: true,
      code: true,
      postcodeFormatted: true,
      customer: { select: { name: true } },
      partner: { select: { name: true } },
    },
  });

  // Officers — staff only; officers don't need to find each other in this app.
  const officers = isStaff
    ? await prisma.user.findMany({
        where: {
          active: true,
          role: { in: ["OFFICER", "DISPATCHER"] },
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { siaNumber: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { name: "asc" },
        take: MAX_PER_KIND,
        select: { id: true, name: true, email: true, role: true },
      })
    : [];

  // Live jobs / open shifts — staff only.
  const jobs = isStaff
    ? await prisma.job.findMany({
        where: {
          status: {
            in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "REVIEW_PENDING"],
          },
          OR: [
            { site: { name: { contains: q, mode: "insensitive" } } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
            { partner: { name: { contains: q, mode: "insensitive" } } },
            { notes: { contains: q, mode: "insensitive" } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: MAX_PER_KIND,
        select: {
          id: true,
          type: true,
          status: true,
          site: { select: { name: true } },
          customer: { select: { name: true } },
          partner: { select: { name: true } },
        },
      })
    : [];

  const shifts = isStaff
    ? await prisma.shift.findMany({
        where: {
          status: { in: ["PENDING", "IN_PROGRESS"] },
          site: { name: { contains: q, mode: "insensitive" } },
        },
        orderBy: { scheduledStartsAt: "asc" },
        take: MAX_PER_KIND,
        select: {
          id: true,
          type: true,
          status: true,
          site: { select: { name: true } },
          officer: { select: { name: true } },
        },
      })
    : [];

  return NextResponse.json({ sites, officers, jobs, shifts });
}
