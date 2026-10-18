"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { fail, ok, okVoid, type ActionResult } from "@/lib/actionResult";
import { recipientsFrom, runDailyCheck } from "@/lib/dailyCheck";

const Settings = z.object({
  enabled: z.boolean(),
  recipients: z.string().trim().max(500),
});

/** Whether the morning check is emailed, and to whom. */
export async function saveDailyCheckSettings(input: {
  enabled: boolean;
  recipients: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const parsed = Settings.safeParse(input);
  if (!parsed.success) return fail("Those settings don't look right.");
  const { enabled, recipients } = parsed.data;
  const typed = recipients.split(/[,;\s]+/).filter(Boolean);
  if (typed.length && recipientsFrom(recipients).length !== typed.length) {
    return fail("One of the email addresses doesn't look right.");
  }
  await prisma.dailyCheckSettings.upsert({
    where: { id: 1 },
    create: { id: 1, enabled, recipients: recipients || null },
    update: { enabled, recipients: recipients || null },
  });
  revalidatePath("/admin/daily-check");
  return okVoid();
}

/** Run the check now (no email; the morning run's span isn't moved). */
export async function runDailyCheckNow(): Promise<ActionResult<{ id: string; total: number }>> {
  await requireAdmin();
  try {
    const res = await runDailyCheck({ trigger: "manual", email: false });
    revalidatePath("/admin/daily-check");
    return ok({ id: res.id, total: res.counts.total });
  } catch (e: any) {
    console.error("Daily check (run now) failed:", e?.code ?? e?.name ?? "error");
    return fail("The check didn't finish — try again in a minute.");
  }
}
