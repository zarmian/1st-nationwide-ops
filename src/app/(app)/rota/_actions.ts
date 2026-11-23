"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff, requireUser } from "@/lib/authz";
import {
  ROTA_PATROLS,
  ROTA_SHIFTS,
  addDays,
  dateKey,
  dateValue,
  dayLabel,
  rotaSlot,
  shiftsOverlap,
  slotName,
  type RotaPatrolCode,
  type RotaShiftCode,
} from "@/lib/rota";

/**
 * Rota + availability server actions.
 *
 * Officer-side: `setMyAvailability` toggles a single (date, half) row
 * on OfficerAvailability for the signed-in user.
 *
 * Dispatcher-side: `assignToRota` puts an officer on a mobile patrol shift
 * (North Mobile 24 hours, South Mobile day or night), `unassignFromRota`
 * takes them off. Both check requireStaff so officers can't reach into the
 * rota table directly.
 *
 * Date inputs are parsed as ISO "YYYY-MM-DD" strings (UK calendar
 * date). They land in a Postgres DATE column so no timezone math is
 * needed once the string is parsed.
 */

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date");
// Officers mark availability by half: Day or Night.
const Shift = z.enum(["DAY", "NIGHT"]);

export async function setMyAvailability(input: {
  date: string;
  shift: "DAY" | "NIGHT";
  available: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireUser();
  // Officers, dispatchers, and admins can all mark their own
  // availability. Office staff don't usually but no harm in allowing.
  const parsed = z
    .object({
      date: DateString,
      shift: Shift,
      available: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  // "YYYY-MM-DD" → midnight UTC, which a DATE column reads as that UK day.
  const date = dateValue(parsed.data.date);
  if (parsed.data.available) {
    await prisma.officerAvailability.upsert({
      where: {
        officerId_date_shift: {
          officerId: me.id,
          date,
          shift: parsed.data.shift,
        },
      },
      create: {
        officerId: me.id,
        date,
        shift: parsed.data.shift,
      },
      update: {},
    });
  } else {
    await prisma.officerAvailability
      .delete({
        where: {
          officerId_date_shift: {
            officerId: me.id,
            date,
            shift: parsed.data.shift,
          },
        },
      })
      .catch(() => {
        // Not present = already unavailable. Treat as success.
      });
  }
  revalidatePath("/m/rota");
  revalidatePath("/rota");
  return { ok: true };
}

export async function assignToRota(input: {
  date: string;
  patrol: RotaPatrolCode;
  shift: RotaShiftCode;
  officerId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  const parsed = z
    .object({
      date: DateString,
      patrol: z.enum(ROTA_PATROLS),
      shift: z.enum(ROTA_SHIFTS),
      officerId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { date, patrol, shift, officerId } = parsed.data;
  if (!rotaSlot(patrol, shift)) {
    return { ok: false, error: "That patrol doesn't have that shift." };
  }

  const officer = await prisma.user.findFirst({
    where: { id: officerId, active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
    select: { name: true },
  });
  if (!officer) return { ok: false, error: "Officer not found." };

  // One officer can't be on two shifts at once: the North 24-hour shift
  // overlaps both South shifts that day. Shifts that only touch (one ends at
  // 09:00 as the next starts) are fine. Shifts start and end within a day of
  // their date, so neighbouring days are enough to check.
  const nearby = await prisma.rotaAssignment.findMany({
    where: {
      officerId,
      patrol: { not: null },
      date: { gte: dateValue(addDays(date, -1)), lte: dateValue(addDays(date, 1)) },
    },
    select: { date: true, shift: true, patrol: true },
  });
  const clash = nearby.find((a) => {
    const other = { date: dateKey(a.date), shift: a.shift as RotaShiftCode };
    const same = other.date === date && other.shift === shift && a.patrol === patrol;
    return !same && shiftsOverlap({ date, shift }, other);
  });
  if (clash) {
    const clashDay = dateKey(clash.date);
    const when = clashDay === date ? "that day" : `on ${dayLabel(clashDay)}`;
    return {
      ok: false,
      error: `${officer.name} is already on ${slotName(
        clash.patrol as RotaPatrolCode,
        clash.shift as RotaShiftCode,
      )} ${when}.`,
    };
  }

  try {
    await prisma.rotaAssignment.create({
      data: {
        date: dateValue(date),
        shift,
        patrol,
        officerId,
        createdByUserId: me.id,
      },
    });
  } catch (err: any) {
    // Unique violation = already on this patrol shift. Treat as
    // idempotent — the assignment exists, the caller's intent is
    // satisfied.
    if (err?.code !== "P2002") throw err;
  }
  revalidatePath("/rota");
  revalidatePath("/m/rota");
  return { ok: true };
}

export async function unassignFromRota(input: {
  assignmentId: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const parsed = z
    .object({ assignmentId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  await prisma.rotaAssignment
    .delete({ where: { id: parsed.data.assignmentId } })
    .catch(() => {
      // Already gone — treat as success.
    });
  revalidatePath("/rota");
  revalidatePath("/m/rota");
  return { ok: true };
}
