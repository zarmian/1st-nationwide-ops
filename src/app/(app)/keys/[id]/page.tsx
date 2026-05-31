import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { handoverKey } from "../_actions";
import { HandoverForm } from "./_components/HandoverForm";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  WITH_US: "With us",
  WITH_OFFICER: "With officer",
  WITH_CUSTOMER: "With customer",
  LOST: "Lost",
  RETIRED: "Retired",
};

const STATUS_TONE: Record<string, string> = {
  WITH_US: "chip-mint",
  WITH_OFFICER: "chip-amber",
  WITH_CUSTOMER: "chip-slate",
  LOST: "chip-red",
  RETIRED: "chip-slate",
};

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default async function KeyDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const [key, recipients] = await Promise.all([
    prisma.key.findUnique({
      where: { id: params.id },
      include: {
        site: { select: { id: true, name: true, code: true } },
        keySet: { select: { id: true, label: true } },
        currentHolder: { select: { id: true, name: true } },
        copyOf: { select: { id: true, internalNo: true, label: true } },
        copies: { select: { id: true, internalNo: true, label: true } },
        movements: {
          orderBy: { occurredAt: "desc" },
          take: 50,
          include: {
            fromUser: { select: { name: true } },
            toUser: { select: { name: true } },
            signedOffBy: { select: { name: true } },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        role: { in: ["OFFICER", "DISPATCHER", "ADMIN"] },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!key) notFound();
  const action = handoverKey.bind(null, key.id);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/keys"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← All keys
        </Link>
        <div className="flex items-baseline gap-3 mt-1">
          <h1 className="text-2xl font-semibold text-brand-navy">
            {key.label}
          </h1>
          <span className={STATUS_TONE[key.status] ?? "chip-slate"}>
            {STATUS_LABEL[key.status] ?? key.status}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {key.internalNo ? `${key.internalNo} · ` : ""}
          {key.type.charAt(0) + key.type.slice(1).toLowerCase()}
          {key.site && (
            <>
              {" · "}
              <Link
                href={`/sites/${key.site.id}`}
                className="hover:text-brand-mint-dark"
              >
                {key.site.name}
              </Link>
            </>
          )}
          {key.keySet && ` · Set: ${key.keySet.label}`}
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-5">
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-brand-navy">Movement history</h2>
            <p className="text-xs text-slate-500">
              Chain of custody — most recent first.
            </p>
          </div>
          {key.movements.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 text-center">
              No movements recorded yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    When
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    From
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    To
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    Reason
                  </th>
                  <th className="text-left px-4 py-2 font-medium uppercase tracking-wider text-xs">
                    By
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {key.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2 text-slate-600 whitespace-nowrap">
                      {fmt(m.occurredAt)}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {m.fromUser?.name ?? "1NW"}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {m.toUser?.name ?? "1NW"}
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {m.reason ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-xs">
                      {m.signedOffBy?.name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
              Current holder
            </h3>
            {key.currentHolder ? (
              <Link
                href={`/officers/${key.currentHolder.id}/edit`}
                className="font-medium text-brand-navy hover:text-brand-mint-dark"
              >
                {key.currentHolder.name}
              </Link>
            ) : (
              <p className="text-sm text-slate-500">With us (no current holder).</p>
            )}
          </div>

          <div className="card p-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3">
              Hand over
            </h3>
            <HandoverForm
              action={action}
              currentHolderId={key.currentHolderUserId}
              recipients={recipients}
            />
          </div>

          {(key.copyOf || key.copies.length > 0) && (
            <div className="card p-4">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                Related
              </h3>
              {key.copyOf && (
                <p className="text-sm text-slate-700">
                  Copy of{" "}
                  <Link
                    href={`/keys/${key.copyOf.id}`}
                    className="text-brand-navy hover:text-brand-mint-dark"
                  >
                    {key.copyOf.internalNo ?? key.copyOf.label}
                  </Link>
                </p>
              )}
              {key.copies.length > 0 && (
                <div className="text-sm">
                  <div className="text-slate-500 mb-1">
                    {key.copies.length} cop{key.copies.length === 1 ? "y" : "ies"}
                  </div>
                  <ul className="space-y-0.5">
                    {key.copies.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/keys/${c.id}`}
                          className="text-brand-navy hover:text-brand-mint-dark"
                        >
                          {c.internalNo ?? c.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {key.notes && (
            <div className="card p-4">
              <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                Notes
              </h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {key.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
