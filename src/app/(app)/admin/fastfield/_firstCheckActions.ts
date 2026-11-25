"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/authz";
import { fail, okVoid, type ActionResult } from "@/lib/actionResult";
import { leaveFirstCheck, putBackFirstCheck } from "@/lib/fastfieldFirstCheck";

// Admin → FastField → "Checked by the robot on 24 Nov": put a report back on
// the shift it was on, or leave it. See lib/fastfieldFirstCheck.ts.

const Id = z.string().uuid();

function refresh(reportId: string, shiftIds: string[]) {
  revalidatePath("/admin/fastfield");
  revalidatePath(`/admin/fastfield/${reportId}`);
  for (const id of shiftIds) revalidatePath(`/shifts/${id}`);
}

/** Put the report back on the shift it was on before the robot moved it or
 *  took it off, as a hand link. */
export async function putBackFirstCheckReport(reportId: string, shiftId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!Id.safeParse(reportId).success || !Id.safeParse(shiftId).success) {
    return fail("That report doesn't look right. Reload the page and try again.");
  }
  const res = await putBackFirstCheck(reportId, shiftId, { userId: me.id, name: me.name || "the office" });
  if (!res.ok) return fail(res.error);
  refresh(reportId, res.fromShiftId ? [shiftId, res.fromShiftId] : [shiftId]);
  return okVoid();
}

/** Leave the report as it is; it stops being listed. */
export async function leaveFirstCheckReport(reportId: string): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!Id.safeParse(reportId).success) return fail("That report doesn't look right. Reload the page and try again.");
  const res = await leaveFirstCheck(reportId, me.id);
  if (!res.ok) return fail(res.error);
  refresh(reportId, []);
  return okVoid();
}
