import { BlueprintForm } from "../_components/BlueprintForm";
import { createBlueprint } from "../_actions";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default function NewBlueprintPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="New blueprint"
        backHref="/admin/blueprints"
        backLabel="Form blueprints"
      />
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
