import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

const Body = z.object({
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }
  const userId = (session.user as any).id as string | undefined;
  const role = (session.user as any).role as string | undefined;

  const visit = await prisma.patrolVisit.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      officerId: true,
      arrivedAt: true,
    },
  });
  if (!visit) {
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  }

  // Officer can only mark their own visits; admin/dispatcher can mark any.
  const isOwner = visit.officerId === userId;
  const isPrivileged = role === "ADMIN" || role === "DISPATCHER";
  if (!isOwner && !isPrivileged) {
    return NextResponse.json({ error: "Not your visit" }, { status: 403 });
  }
  if (visit.status === "COMPLETED") {
    return NextResponse.json(
      { error: "Visit is already completed" },
      { status: 400 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const { lat, lng } = parsed.success ? parsed.data : {};

  // Self-assign if the visit was unassigned.
  const data: {
    status: "IN_PROGRESS";
    arrivedAt: Date;
    gpsLat?: number;
    gpsLng?: number;
    officerId?: string;
  } = {
    status: "IN_PROGRESS",
    arrivedAt: visit.arrivedAt ?? new Date(),
  };
  if (typeof lat === "number") data.gpsLat = lat;
  if (typeof lng === "number") data.gpsLng = lng;
  if (!visit.officerId && userId) data.officerId = userId;

  const updated = await prisma.patrolVisit.update({
    where: { id: params.id },
    data,
    select: {
      id: true,
      status: true,
      arrivedAt: true,
      gpsLat: true,
      gpsLng: true,
      siteId: true,
    },
  });

  return NextResponse.json({ ok: true, visit: updated });
}
