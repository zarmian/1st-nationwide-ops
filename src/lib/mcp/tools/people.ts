/**
 * Officers (same filters as /officers) and, for admins, the compliance
 * register (same scoring as /compliance via loadComplianceRegister).
 * Never selects password hashes, Telegram link codes or chat ids.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { roleLabel } from "@/lib/roleLabel";
import { loadComplianceRegister, statusFor } from "@/lib/compliance";
import { ukDate, ukIso, type ToolContext } from "./common";

export async function listOfficers(
  ctx: ToolContext,
  input: {
    name?: string;
    region?: string;
    status?: "active" | "on_duty" | "inactive" | "all";
    role?: "officer" | "office" | "all";
    limit: number;
  },
) {
  const roles =
    input.role === "office"
      ? (["DISPATCHER"] as const)
      : input.role === "all"
        ? (["OFFICER", "DISPATCHER"] as const)
        : (["OFFICER"] as const);
  const status = input.status ?? "active";
  const where: Prisma.UserWhereInput = {
    AND: [
      { role: { in: [...roles] } },
      ...(status === "active" ? [{ active: true }] : []),
      ...(status === "inactive" ? [{ active: false }] : []),
      ...(status === "on_duty" ? [{ active: true, onDuty: true }] : []),
      ...(input.name?.trim()
        ? [{ name: { contains: input.name.trim(), mode: "insensitive" as const } }]
        : []),
      ...(input.region?.trim()
        ? [{ region: { name: { contains: input.region.trim(), mode: "insensitive" as const } } }]
        : []),
    ],
  };
  const [count, people] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { name: "asc" },
      take: input.limit,
      select: {
        id: true,
        name: true,
        role: true,
        phone: true,
        active: true,
        onDuty: true,
        lastSeenAt: true,
        siaNumber: true,
        siaExpiry: true,
        region: { select: { name: true } },
      },
    }),
  ]);
  return {
    count,
    shown: people.length,
    officers: people.map((p) => ({
      id: p.id,
      name: p.name,
      role: roleLabel(p.role),
      region: p.region?.name ?? null,
      phone: p.phone,
      active: p.active,
      onDuty: p.onDuty,
      lastSeen: ukIso(p.lastSeenAt),
      siaLicence: {
        number: p.siaNumber,
        expires: ukDate(p.siaExpiry),
        status: statusFor(p.siaExpiry, ctx.now),
      },
    })),
  };
}

export async function getCompliance(
  ctx: ToolContext,
  input: { show?: "needs_attention" | "expired" | "expiring" | "missing" | "all"; name?: string },
) {
  const register = await loadComplianceRegister(ctx.now, 30);
  const show = input.show ?? "needs_attention";
  const name = input.name?.trim().toLowerCase();
  const officers = register.officers.filter((o) => {
    if (name && !o.name.toLowerCase().includes(name)) return false;
    if (show === "all") return true;
    if (show === "needs_attention") return o.worst !== "valid";
    return o.items.some((i) => i.status === show);
  });
  return {
    asOf: ukDate(ctx.now),
    warningWindowDays: 30,
    counts: register.counts,
    officers: officers.map((o) => ({
      name: o.name,
      role: roleLabel(o.role),
      siaNumber: o.siaNumber,
      overall: o.worst,
      items: o.items.map((i) => ({
        item: i.kind,
        date: ukDate(i.date),
        status: i.status,
        ...(i.note ? { note: i.note } : {}),
      })),
    })),
  };
}
