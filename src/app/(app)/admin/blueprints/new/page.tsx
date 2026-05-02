import Link from "next/link";
import { BlueprintForm } from "../_components/BlueprintForm";
import { createBlueprint } from "../_actions";

export const dynamic = "force-dynamic";

export default function NewBlueprintPage() {
  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/admin/blueprints"
          className="text-sm text-slate-500 hover:text-brand-mint-dark"
        >
          ← Form blueprints
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          New blueprint
        </h1>
      </div>
      <BlueprintForm
        action={createBlueprint}
        submitLabel="Create blueprint"
        initial={{
          name: "",
          slug: "",
          description: null,
          jobType: null,
          source: null,
          fields: [],
          active: true,
          builtin: false,
        }}
      />
    </div>
  );
}
