import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { approveReview, rejectReview } from "../_actions";
import { ApproveForm, RejectForm } from "./_components/ReviewActions";

export const dynamic = "force-dynamic";

function toDateTimeLocal(d: Date | null): string {
  if (!d) return "";
  // YYYY-MM-DDTHH:MM in local-naive form for <input type="datetime-local">
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export default async function ReviewDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const review = await prisma.reportReview.findUnique({
    where: { id: params.id },
    include: {
      reviewer: { select: { name: true, email: true } },
      submission: {
        include: {
          submittedBy: { select: { name: true, email: true } },
          site: true,
          job: {
            include: {
              customer: { select: { id: true, name: true, contactEmail: true } },
              partner: { select: { id: true, name: true } },
            },
          },
        },
      },
      clientReports: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!review) notFound();

  const sub = review.submission;
  const job = sub.job;
  const reportable = Boolean(
    job &&
      !job.reportedViaPartnerApp &&
      job.customer &&
      job.customer.contactEmail,
  );

  const approve = approveReview.bind(null, review.id);
  const reject = rejectReview.bind(null, review.id);

  const isClosed =
    review.status === "APPROVED" ||
    review.status === "EDITED_AND_APPROVED" ||
    review.status === "REJECTED";

  const payload =
    sub.payload && typeof sub.payload === "object" && !Array.isArray(sub.payload)
      ? (sub.payload as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link
          href="/admin/reports"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Back to review queue
        </Link>
        <div className="flex items-start justify-between mt-1">
          <div>
            <h1 className="text-2xl font-semibold text-brand-navy">
              {sub.form.replace(/_/g, " ")} —{" "}
              {sub.site?.name ?? "Unknown site"}
            </h1>
            <p className="text-sm text-slate-500">
              Submitted {fmt(sub.submittedAt)} by{" "}
              {sub.submittedBy?.name ?? sub.officerNameRaw}
            </p>
          </div>
          <StatusChip status={review.status} />
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Site
          </div>
          <div className="font-medium text-brand-navy">
            {sub.site?.name ?? "—"}
          </div>
          <div className="text-xs text-slate-500">
            {sub.site?.postcodeFormatted}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            {job?.partner ? "Operated for partner" : "Customer"}
          </div>
          <div className="font-medium text-brand-navy">
            {job?.customer?.name ?? job?.partner?.name ?? "—"}
          </div>
          {job?.customer?.contactEmail && (
            <div className="text-xs text-slate-500">
              {job.customer.contactEmail}
            </div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">
            Times
          </div>
          <div className="text-sm text-slate-700">
            <div>Arrived: {fmt(sub.arrivedAt)}</div>
            <div>Departed: {fmt(sub.departedAt)}</div>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-brand-navy mb-3">Officer payload</h2>
        {payload && Object.keys(payload).length > 0 ? (
          <dl className="grid sm:grid-cols-[160px_1fr] gap-y-2 gap-x-4 text-sm">
            {Object.entries(payload).map(([k, v]) => (
              <FragmentRow key={k} label={k} value={v} />
            ))}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No payload data submitted.</p>
        )}
      </div>

      {isClosed ? (
        <ClosedState review={review} />
      ) : (
        <>
          <div className="card p-5">
            <h2 className="font-semibold text-brand-navy mb-1">
              Approve & queue client report
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Edit anything that's wrong before approving. Edits are recorded
              against the review.
            </p>
            <ApproveForm
              action={approve}
              initialOfficer={sub.officerNameRaw}
              initialArrivedAt={toDateTimeLocal(sub.arrivedAt)}
              initialDepartedAt={toDateTimeLocal(sub.departedAt)}
              reportable={reportable}
              toAddress={job?.customer?.contactEmail ?? null}
            />
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-brand-navy mb-1">
              Send back for fixing
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Reject the submission and tell the officer what to fix.
            </p>
            <RejectForm action={reject} />
          </div>
        </>
      )}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: unknown }) {
  const labelEl = (
    <dt className="text-slate-500">{label.replace(/_/g, " ")}</dt>
  );

  if (value === null || value === undefined || value === "") {
    return (
      <>
        {labelEl}
        <dd className="text-slate-400">—</dd>
      </>
    );
  }

  // Tri-state — encoded as 0/1/2 (No/Yes/N/A)
  if (typeof value === "number" && (value === 0 || value === 1 || value === 2)) {
    const triLabels: Record<number, string> = {
      0: "No",
      1: "Yes",
      2: "N/A",
    };
    return (
      <>
        {labelEl}
        <dd className="text-slate-800">{triLabels[value]}</dd>
      </>
    );
  }

  // Signature — single blob URL
  if (typeof value === "string" && /^https:\/\/.+\.(png|jpe?g|webp)/i.test(value)) {
    return (
      <>
        {labelEl}
        <dd>
          <img
            src={value}
            alt="Signature"
            className="max-h-24 border border-slate-200 rounded bg-white p-1"
          />
        </dd>
      </>
    );
  }

  // Multiphoto — array of {url, name?}
  if (Array.isArray(value) && value.every((p) => p && typeof p === "object" && typeof (p as any).url === "string")) {
    const photos = value as { url: string; name?: string | null }[];
    return (
      <>
        {labelEl}
        <dd>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-w-md">
            {photos.map((p, i) => (
              <a
                key={p.url}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block aspect-square"
              >
                <img
                  src={p.url}
                  alt={p.name ?? `Photo ${i + 1}`}
                  className="w-full h-full object-cover rounded border border-slate-200"
                />
              </a>
            ))}
          </div>
        </dd>
      </>
    );
  }

  // Location — {lat, lng, accuracy?, capturedAt?}
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as any).lat === "number" &&
    typeof (value as any).lng === "number"
  ) {
    const loc = value as { lat: number; lng: number; accuracy?: number | null };
    const mapsUrl = `https://www.google.com/maps?q=${loc.lat},${loc.lng}`;
    return (
      <>
        {labelEl}
        <dd className="text-slate-800">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand-mint-dark hover:underline font-mono text-xs"
          >
            {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
          </a>
          {loc.accuracy != null && (
            <span className="text-xs text-slate-500 ml-2">
              ±{Math.round(loc.accuracy)}m
            </span>
          )}
        </dd>
      </>
    );
  }

  let display: string;
  if (typeof value === "object") display = JSON.stringify(value);
  else display = String(value);
  return (
    <>
      {labelEl}
      <dd className="text-slate-800 break-words">{display}</dd>
    </>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "APPROVED" || status === "EDITED_AND_APPROVED") {
    return <span className="chip-mint">Approved</span>;
  }
  if (status === "REJECTED") return <span className="chip-red">Rejected</span>;
  return <span className="chip-amber">Pending</span>;
}

function ClosedState({
  review,
}: {
  review: {
    status: string;
    reviewedAt: Date | null;
    reviewer: { name: string | null; email: string } | null;
    reviewerNotes: string | null;
    edits: unknown;
    clientReports: { id: string; toAddress: string; status: string; sentAt: Date | null }[];
  };
}) {
  const editsObj =
    review.edits && typeof review.edits === "object" && !Array.isArray(review.edits)
      ? (review.edits as Record<string, { from: unknown; to: unknown }>)
      : null;

  return (
    <div className="card p-5 space-y-3">
      <div className="text-sm text-slate-700">
        {review.status === "REJECTED" ? "Rejected" : "Approved"} by{" "}
        {review.reviewer?.name ?? review.reviewer?.email ?? "system"} on{" "}
        {fmt(review.reviewedAt)}.
      </div>
      {review.reviewerNotes && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">
          <div className="text-xs text-slate-500 mb-0.5">Internal note</div>
          {review.reviewerNotes}
        </div>
      )}
      {editsObj && Object.keys(editsObj).length > 0 && (
        <div>
          <div className="text-xs text-slate-500 mb-1">Edits made</div>
          <ul className="text-sm space-y-1">
            {Object.entries(editsObj).map(([k, v]) => (
              <li key={k}>
                <span className="font-medium">{k}:</span>{" "}
                <span className="text-slate-500">{String(v.from ?? "—")}</span>{" "}
                → <span className="text-slate-800">{String(v.to ?? "—")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.clientReports.length > 0 && (
        <div>
          <div className="text-xs text-slate-500 mb-1">Client reports</div>
          <ul className="text-sm space-y-1">
            {review.clientReports.map((cr) => (
              <li key={cr.id}>
                <span className="chip-slate">{cr.status}</span> {cr.toAddress}
                {cr.sentAt ? ` (sent ${fmt(cr.sentAt)})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
