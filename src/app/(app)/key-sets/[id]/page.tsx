import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { handoverKeySet, updateKeySet } from "../../keys/_actions";
import { KeySetForm } from "./_components/KeySetForm";
import { KeySetHandoverForm } from "./_components/KeySetHandoverForm";
import { PageHeader } from "@/components/PageHeader";

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

export default async function KeySetPage({
  params,
}: {
  params: { id: string };
}) {
  const [set, recipients] = await Promise.all([
    prisma.keySet.findUnique({
      where: { id: params.id },
      include: {
        site: { select: { id: true, name: true, code: true } },
        keys: {
          orderBy: { internalNo: "asc" },
          select: {
            id: true,
            internalNo: true,
            label: true,
            type: true,
            status: true,
            currentHolder: { select: { id: true, name: true } },
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
  if (!set) notFound();

  const updateAction = updateKeySet.bind(null, set.id);
  const handoverAction = handoverKeySet.bind(null, set.id);

  // Holder summary across the set — single holder vs mixed.
  const holderIds = new Set(
    set.keys.map((k) => k.currentHolder?.id ?? "__none__"),
  );
  const currentHolderId =
    holderIds.size === 1 ? set.keys[0]?.currentHolder?.id ?? null : null;
  const holderMixed = holderIds.size > 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title={set.label}
        backHref="/keys"
        backLabel="All keys"
        subtitle={
          <>
            Set · {set.keys.length} key{set.keys.length === 1 ? "" : "s"}
            {set.site && (
              <>
                {" · "}
                <Link
                  href={`/sites/${set.site.id}`}
                  className="hover:text-brand-blue-dark"
                >
                  {set.site.name}
                </Link>
              </>
            )}
            {set.internalNo && ` · ${set.internalNo}`}
          </>
        }
      />

      <div className="grid lg:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-4">
          <KeySetForm
            action={updateAction}
            initial={{
              label: set.label,
              internalNo: set.internalNo,
              notes: set.notes,
              photoUrl: set.photoUrl,
            }}
            siteId={set.siteId}
          />

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-baseline justify-between">
              <div>
                <h2 className="font-semibold text-brand-navy">Keys in set</h2>
                <p className="text-xs text-slate-500">
                  Click a key to edit it individually.
                </p>
              </div>
            </div>
            {set.keys.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500 text-center">
                No keys in this set yet. Add keys from the site page.
              </p>
            ) : (
              <div className="table-scroll">
              <table className="table-default">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Label</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Holder</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {set.keys.map((k) => (
                    <tr
                      key={k.id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {k.internalNo ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/keys/${k.id}`}
                          className="text-brand-navy hover:text-brand-blue-dark"
                        >
                          {k.label}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {titleCase(k.type)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {k.currentHolder?.name ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={STATUS_TONE[k.status] ?? "chip-slate"}
                        >
                          {STATUS_LABEL[k.status] ?? k.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/keys/${k.id}`}
                          className="text-xs text-brand-blue-dark hover:text-brand-navy underline mr-3"
                        >
                          Hand over
                        </Link>
                        <Link
                          href={`/keys/${k.id}/edit`}
                          className="text-xs text-brand-blue-dark hover:text-brand-navy underline"
                        >
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-3">
              Hand over the whole set
            </h3>
            {holderMixed && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">
                Keys are currently with different people. The handover applies
                to every key in the set.
              </p>
            )}
            <KeySetHandoverForm
              action={handoverAction}
              currentHolderId={currentHolderId}
              recipients={recipients}
              keyCount={set.keys.length}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");
}
