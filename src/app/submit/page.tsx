import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SubmitForm } from "./SubmitForm";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: { jobId?: string; siteId?: string };
}) {
  const session = await getServerSession(authOptions);

  // Pre-fill if officer is logged in or if jobId/siteId was passed
  const sites = await prisma.site.findMany({
    where: { active: true },
    select: { id: true, name: true, postcode: true },
    orderBy: { name: "asc" },
  });

  let prefilledJob = null;
  if (searchParams.jobId) {
    prefilledJob = await prisma.job.findUnique({
      where: { id: searchParams.jobId },
      select: { id: true, siteId: true, type: true },
    });
  }

  const officerName =
    session?.user?.name ?? (session?.user as any)?.email ?? "";

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-2xl px-4 h-14 flex items-center justify-between">
          <BrandLogo />
          <div className="text-xs text-slate-500">Officer report</div>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-2xl font-semibold text-brand-navy">
          Submit a report
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Pick the site and the type of job, then fill in what you saw on site.
          Photos are optional.
        </p>
        <SubmitForm
          sites={sites}
          officerName={officerName}
          isInternal={!!session}
          prefilledSiteId={prefilledJob?.siteId ?? searchParams.siteId ?? null}
          prefilledJobId={prefilledJob?.id ?? null}
          prefilledJobType={prefilledJob?.type ?? null}
        />
      </div>
    </main>
  );
}
