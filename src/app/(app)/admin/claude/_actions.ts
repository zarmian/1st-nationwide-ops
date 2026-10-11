"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { fail, okVoid, type ActionResult } from "@/lib/actionResult";
import { revokeGrant } from "@/lib/mcp/oauth";

/** Disconnect one Claude connection: revokes it and every token under it. */
export async function disconnectClaude(grantId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  const grant = await prisma.mcpGrant.findUnique({
    where: { id: grantId },
    select: { id: true },
  });
  if (!grant) return fail("That connection no longer exists.");
  await revokeGrant(prisma, grantId, me.id);
  revalidatePath("/admin/claude");
  return okVoid();
}

/** Let office (dispatcher) accounts connect Claude, or stop them. */
export async function setOfficeStaffClaude(allow: boolean): Promise<ActionResult> {
  const me = await requireAdmin();
  await prisma.mcpSettings.upsert({
    where: { id: 1 },
    create: { id: 1, allowDispatchers: allow, updatedByUserId: me.id },
    update: { allowDispatchers: allow, updatedByUserId: me.id },
  });
  if (!allow) {
    // Switching it off disconnects office staff straight away.
    const grants = await prisma.mcpGrant.findMany({
      where: { revokedAt: null, user: { role: "DISPATCHER" } },
      select: { id: true },
    });
    for (const g of grants) await revokeGrant(prisma, g.id, me.id);
  }
  revalidatePath("/admin/claude");
  return okVoid();
}
