"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { parseUkDateTimeLocal } from "@/lib/dates";

const OUTCOMES = [
  "FALSE_ALARM",
  "GENUINE",
  "RESOLVED",
  "ESCALATED_TO_POLICE",
  "OTHER",
] as const;
type Outcome = (typeof OUTCOMES)[number];

/**
 * Record an alarm's close-out: outcome + close time + notes. Writes the
 * AlarmEvent.outcome/closedAt/notes columns (previously only ever seeded), which
 * also lights up the response-time reporting. Staff (admin/dispatcher).
 */
export async function closeAlarmAction(
  alarmId: string,
  input: { outcome: string; notes?: string | null; closedAt?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();

  if (!OUTCOMES.includes(input.outcome as Outcome)) {
    return { ok: false, error: "Choose an outcome." };
  }
  const closedAt = input.closedAt
    ? parseUkDateTimeLocal(input.closedAt)
    : new Date();
  if (input.closedAt && !closedAt) {
    return { ok: false, error: "Enter a valid close time." };
  }

  const existing = await prisma.alarmEvent.findUnique({
    where: { id: alarmId },
    select: { receivedAt: true },
  });
  if (!existing) return { ok: false, error: "Alarm not found." };
  if (closedAt && closedAt < existing.receivedAt) {
    return { ok: false, error: "Close time can't be before the alarm was received." };
  }

  try {
    await prisma.alarmEvent.update({
      where: { id: alarmId },
      data: {
        outcome: input.outcome as Outcome,
        closedAt: closedAt ?? new Date(),
        notes: input.notes?.trim() || null,
      },
    });
  } catch (e) {
    console.error("closeAlarm failed", e);
    return { ok: false, error: "Couldn't save the close-out. Please retry." };
  }

  revalidatePath(`/alarms/${alarmId}`);
  revalidatePath("/alarms");
  return { ok: true };
}

/** Re-open a closed alarm (clears outcome + close time; keeps notes). */
export async function reopenAlarmAction(
  alarmId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  try {
    await prisma.alarmEvent.update({
      where: { id: alarmId },
      data: { outcome: null, closedAt: null },
    });
  } catch (e) {
    console.error("reopenAlarm failed", e);
    return { ok: false, error: "Couldn't re-open. Please retry." };
  }
  revalidatePath(`/alarms/${alarmId}`);
  revalidatePath("/alarms");
  return { ok: true };
}
