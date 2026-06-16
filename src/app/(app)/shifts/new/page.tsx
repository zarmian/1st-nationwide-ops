import { prisma } from "@/lib/db";
import { createShift } from "../_actions";
import { NewShiftForm } from "../_components/NewShiftForm";
import { PageHeader } from "@/components/PageHeader";

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
      <PageHeader
        title="New shift"
        backHref="/shifts"
        backLabel="Shifts"
        subtitle="Static guarding or dog-handler shift with periodic hourly check-ins."
      />

      <NewShiftForm action={createShift} sites={sites} officers={officers} />
    </div>
  );
}
