import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const Body = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
  accuracy: z.number().finite().optional().nullable(),
});

/**
 * Officer-driven location update. Called every few minutes from /m/today
 * while the officer is on duty (foreground only — browsers throttle / kill
 * background GPS). Idempotent: just overwrites the user's lastLat/lastLng/
 * lastSeenAt.
 *
 * Auth: must be signed in. Privacy: only writes the *current* position,
 * no breadcrumb history (yet).
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      lastLat: parsed.data.lat,
      lastLng: parsed.data.lng,
      lastSeenAt: new Date(),
    },
  });
  return NextResponse.json({ ok: true });
}
