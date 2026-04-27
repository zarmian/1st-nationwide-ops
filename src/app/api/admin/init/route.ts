import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// One-time bootstrap endpoint:
//   GET /api/admin/init?secret=<INIT_SECRET>
// Creates the first admin user from ADMIN_EMAIL / ADMIN_PASSWORD env vars.
// No-op (returns "already_exists") if an admin already exists.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");

  if (!process.env.INIT_SECRET) {
    return NextResponse.json(
      { error: "INIT_SECRET not configured on the server." },
      { status: 500 },
    );
  }
  if (secret !== process.env.INIT_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";
  if (!adminEmail || !adminPassword) {
    return NextResponse.json(
      { error: "Set ADMIN_EMAIL and ADMIN_PASSWORD in env first." },
      { status: 500 },
    );
  }

  const existing = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true },
  });
  if (existing) {
    return NextResponse.json({
      ok: true,
      status: "already_exists",
      email: existing.email,
    });
  }

  const passwordHash = await bcrypt.hash(adminPassword, 10);
  const user = await prisma.user.create({
    data: {
      email: adminEmail,
      name: "Admin",
      role: "ADMIN",
      passwordHash,
      active: true,
    },
    select: { id: true, email: true, name: true, role: true },
  });

  return NextResponse.json({ ok: true, status: "created", user });
}
