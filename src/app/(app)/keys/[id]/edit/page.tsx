import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { updateKey } from "../../_actions";
import { KeyEditForm } from "./_components/KeyEditForm";

export const dynamic = "force-dynamic";

export default async function KeyEditPage({
  params,
}: {
  params: { id: string };
}) {
  const key = await prisma.key.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      label: true,
      internalNo: true,
      type: true,
      status: true,
      notes: true,
      duplicable: true,
      site: { select: { id: true, name: true } },
      keySet: { select: { id: true, label: true } },
    },
  });
  if (!key) notFound();

  const action = updateKey.bind(null, key.id);

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Link
          href={`/keys/${key.id}`}
          className="text-sm text-slate-500 hover:text-brand-blue-dark"
        >
          ← Back to key
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          Edit key
        </h1>
        <p className="text-sm text-slate-500">
          {key.site && (
            <>
              {key.site.name}
              {key.keySet && ` · Set: ${key.keySet.label}`}
            </>
          )}
        </p>
      </div>

      <KeyEditForm
        action={action}
        initial={{
          label: key.label,
          internalNo: key.internalNo,
          type: key.type,
          status: key.status,
          notes: key.notes,
          duplicable: key.duplicable,
        }}
        cancelHref={`/keys/${key.id}`}
      />
    </div>
  );
}
