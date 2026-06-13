"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireStaff, requireUser } from "@/lib/authz";

/**
 * Rota + availability server actions.
 *
 * Officer-side: `setMyAvailability` toggles a single (date, shift) row
 * on OfficerAvailability for the signed-in user.
 *
 * Dispatcher-side: `assignToRota` creates a RotaAssignment row,
 * `unassignFromRota` removes one. Both check requireStaff so officers
 * can't reach into the rota table directly.
 *
 * Date inputs are parsed as ISO "YYYY-MM-DD" strings (UK calendar
 * date). They land in a Postgres DATE column so no timezone math is
 * needed once the string is parsed.
 */

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date");
const Shift = z.enum(["DAY", "NIGHT"]);

function parseDate(s: string): Date {
  // "YYYY-MM-DD" → midnight UTC. Postgres DATE columns drop the time
  // portion, so this lines up with the UK calendar date.
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

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
  const date = parseDate(parsed.data.date);
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
  shift: "DAY" | "NIGHT";
  regionId: number;
  officerId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const me = await requireStaff();
  const parsed = z
    .object({
      date: DateString,
      shift: Shift,
      regionId: z.coerce.number().int().positive(),
      officerId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const date = parseDate(parsed.data.date);
  try {
    await prisma.rotaAssignment.create({
      data: {
        date,
        shift: parsed.data.shift,
        regionId: parsed.data.regionId,
        officerId: parsed.data.officerId,
        createdByUserId: me.id,
      },
    });
  } catch (err: any) {
    // Unique violation = already assigned to this region+shift. Treat
    // as idempotent — the assignment exists, the caller's intent is
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
