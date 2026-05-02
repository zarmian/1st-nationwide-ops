"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function requireStaff() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!role || !["ADMIN", "DISPATCHER"].includes(role)) {
    throw new Error("Not authorised");
  }
}

const ReassignInput = z.object({
  scheduleId: z.string().uuid(),
  officerId: z.string().uuid().or(z.literal("")).nullable(),
});

export async function reassignSchedule(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const parsed = ReassignInput.safeParse({
    scheduleId: formData.get("scheduleId")?.toString() ?? "",
    officerId: formData.get("officerId")?.toString() ?? "",
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const officerId =
    parsed.data.officerId && parsed.data.officerId !== ""
      ? parsed.data.officerId
      : null;
  await prisma.patrolSchedule.update({
    where: { id: parsed.data.scheduleId },
    data: { assignedOfficerId: officerId },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function toggleScheduleActive(
  scheduleId: string,
  active: boolean,
): Promise<{ ok: boolean }> {
  await requireStaff();
  await prisma.patrolSchedule.update({
    where: { id: scheduleId },
    data: { active },
  });
  revalidatePath("/patrols");
  return { ok: true };
}

export async function reassignVisit(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  await requireStaff();
  const visitId = formData.get("visitId")?.toString();
  const officerId = formData.get("officerId")?.toString() || "";
  if (!visitId) return { ok: false, error: "Missing visit id" };
  await prisma.patrolVisit.update({
    where: { id: visitId },
    data: { officerId: officerId === "" ? null : officerId },
  });
  revalidatePath("/patrols");
  return { ok: true };
}
