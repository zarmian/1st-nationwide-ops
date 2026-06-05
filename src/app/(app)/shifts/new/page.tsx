import Link from "next/link";
import { prisma } from "@/lib/db";
import { createShift } from "../_actions";
import { NewShiftForm } from "../_components/NewShiftForm";

export const dynamic = "force-dynamic";

export default async function NewShiftPage() {
  const [sites, officers] = await Promise.all([
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, postcodeFormatted: true },
    }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["OFFICER", "DISPATCHER"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/shifts"
          className="text-sm text-slate-500 hover:text-brand-blue-dark"
        >
          ← Shifts
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          New shift
        </h1>
        <p className="text-sm text-slate-500">
          Static guarding or dog-handler shift with periodic hourly check-ins.
        </p>
      </div>

      <NewShiftForm action={createShift} sites={sites} officers={officers} />
    </div>
  );
}
