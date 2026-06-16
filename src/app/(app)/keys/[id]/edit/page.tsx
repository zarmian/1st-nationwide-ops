import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
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
      <PageHeader
        title="Edit key"
        backHref={`/keys/${key.id}`}
        backLabel="Back to key"
        subtitle={
          key.site ? (
            <>
              {key.site.name}
              {key.keySet && ` · Set: ${key.keySet.label}`}
            </>
          ) : undefined
        }
      />

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
