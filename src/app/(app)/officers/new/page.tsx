import Link from "next/link";
import { prisma } from "@/lib/db";
import { OfficerForm } from "../_components/OfficerForm";
import { createOfficer } from "../_actions";

export const dynamic = "force-dynamic";

export default async function NewOfficerPage() {
  const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/officers"
          className="text-sm text-slate-500 hover:text-brand-blue-dark"
        >
          ← Officers
        </Link>
        <h1 className="text-2xl font-semibold text-brand-navy mt-1">
          New officer
        </h1>
      </div>
      <OfficerForm
        action={createOfficer}
        submitLabel="Create officer"
        isCreate
        regions={regions}
        initial={{
          name: "",
          email: "",
          phone: null,
          whatsappNumber: null,
          siaNumber: null,
          regionId: null,
          role: "OFFICER",
          active: true,
        }}
      />
    </div>
  );
}
