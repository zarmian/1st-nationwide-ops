import Link from "next/link";
import { prisma } from "@/lib/db";
import { createJob } from "../_actions";
import { NewJobForm } from "../_components/NewJobForm";

export const dynamic = "force-dynamic";

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: { siteId?: string };
}) {
  const [sites, officers] = await Promise.all([
    prisma.site.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        postcodeFormatted: true,
      },
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
          href="/dispatch"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Dispatch
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          New job
        </h1>
        <p className="text-sm text-slate-500 max-w-2xl">
          Create a one-off job — alarm response, ad-hoc, lock/unlock, key
          movement, VPI, or one-off patrol. Static guarding / dog handler
          shifts use a different flow (coming soon).
        </p>
      </div>

      <NewJobForm
        action={createJob}
        sites={sites}
        officers={officers}
        defaultSiteId={searchParams.siteId}
      />
    </div>
  );
}
