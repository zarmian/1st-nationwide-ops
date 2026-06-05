import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { BrandLogo } from "@/components/BrandLogo";
import { ClaimForm } from "./ClaimForm";
import { getJobTypeLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function PublicJobDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const jobTypeLabels = await getJobTypeLabels();
  const job = await prisma.job.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      type: true,
      priority: true,
      status: true,
      scheduledFor: true,
      notes: true,
      assignedToUserId: true,
      externalResponder: true,
      site: {
        select: {
          name: true,
          addressLine: true,
          postcode: true,
          city: true,
          what3words: true,
          notes: true,
        },
      },
    },
  });

  if (!job) notFound();

  const claimable =
    job.status === "OPEN" &&
    !job.assignedToUserId &&
    !job.externalResponder;

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-2xl px-4 h-14 flex items-center justify-between">
          <BrandLogo />
          <Link href="/jobs" className="text-xs text-slate-500 hover:underline">
            ← All open jobs
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">
            {job.site?.name ?? "Site TBC"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-brand-blue-light text-brand-blue-dark px-2 py-0.5 font-medium">
              {jobTypeLabels[job.type] ?? job.type}
            </span>
            {job.priority === "HIGH" && (
              <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 font-medium">
                High priority
              </span>
            )}
            <span className="text-slate-500">
              {job.scheduledFor ? formatUkDateTime(job.scheduledFor) : "ASAP"}
            </span>
          </div>
        </div>

        <div className="card p-4 space-y-3">
          <Section title="Where">
            <div className="text-sm text-slate-700">
              {job.site?.addressLine}
              {job.site?.city ? `, ${job.site.city}` : ""}
            </div>
            <div className="text-sm text-slate-500">
              {job.site?.postcode}
              {job.site?.what3words ? ` · ///${job.site.what3words}` : ""}
            </div>
          </Section>

          {job.notes && (
            <Section title="Job notes">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {job.notes}
              </p>
            </Section>
          )}

          {job.site?.notes && (
            <Section title="Site notes">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {job.site.notes}
              </p>
            </Section>
          )}
        </div>

        {claimable ? (
          <ClaimForm jobId={job.id} />
        ) : (
          <div className="card p-6 text-center text-sm text-slate-500">
            This job is no longer open.{" "}
            <Link href="/jobs" className="text-brand-blue-dark underline">
              See other open jobs
            </Link>
            .
          </div>
        )}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function formatUkDateTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
