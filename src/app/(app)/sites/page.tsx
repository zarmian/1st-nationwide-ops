import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function SitesPage({
  searchParams,
}: {
  searchParams: { q?: string; region?: string; service?: string };
}) {
  const { q, region, service } = searchParams;

  const sites = await prisma.site.findMany({
    where: {
      AND: [
        q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { addressLine: { contains: q, mode: "insensitive" } },
                { postcode: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
        region ? { region: { name: { equals: region, mode: "insensitive" } } } : {},
        service ? { services: { has: service as any } } : {},
        { active: true },
      ],
    },
    include: {
      customer: { select: { name: true } },
      partner: { select: { name: true } },
      region: { select: { name: true } },
      _count: { select: { jobs: true } },
    },
    orderBy: { name: "asc" },
    take: 200,
  });

  const total = await prisma.site.count({ where: { active: true } });

  return (
    <div>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy">Sites</h1>
          <p className="text-sm text-slate-500">
            {sites.length} of {total} sites shown
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/sites/new" className="btn-primary">
            + New site
          </Link>
        </div>
      </div>

      <form className="card p-3 mb-4 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="label">Search</label>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Site name, address, postcode, code…"
            className="input"
          />
        </div>
        <div>
          <label className="label">Region</label>
          <select name="region" defaultValue={region ?? ""} className="input">
            <option value="">All</option>
            <option value="London">London</option>
            <option value="Outside London">Outside London</option>
          </select>
        </div>
        <div>
          <label className="label">Service</label>
          <select name="service" defaultValue={service ?? ""} className="input">
            <option value="">All</option>
            <option value="ALARM_RESPONSE">Alarm response</option>
            <option value="KEYHOLDING">Keyholding</option>
            <option value="PATROL">Mobile patrol</option>
            <option value="LOCKUP">Lock-up</option>
            <option value="UNLOCK">Unlock</option>
            <option value="VPI">VPI</option>
            <option value="STATIC_GUARDING">Static guarding</option>
            <option value="DOG_HANDLER">Dog handler</option>
            <option value="ADHOC">Ad-hoc</option>
          </select>
        </div>
        <button className="btn-secondary" type="submit">
          Filter
        </button>
      </form>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Name</th>
              <th className="text-left px-4 py-2.5 font-medium">Customer</th>
              <th className="text-left px-4 py-2.5 font-medium">Region</th>
              <th className="text-left px-4 py-2.5 font-medium">Services</th>
              <th className="text-right px-4 py-2.5 font-medium">Jobs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sites.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/sites/${s.id}`}
                    className="font-medium text-brand-navy hover:text-brand-mint-dark"
                  >
                    {s.name}
                  </Link>
                  {s.postcodeFormatted && (
                    <div className="text-xs text-slate-500">
                      {s.postcodeFormatted}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-600">
                  {s.customer?.name ??
                    (s.partner?.name ? (
                      <span title="Operated for partner">
                        {s.partner.name}{" "}
                        <span className="text-xs text-slate-400">(partner)</span>
                      </span>
                    ) : (
                      "—"
                    ))}
                </td>
                <td className="px-4 py-2.5">
                  <span className="chip-slate">{s.region?.name ?? "—"}</span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {s.services.map((svc) => (
                      <span key={svc} className="chip-mint">
                        {svc.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700">
                  {s._count.jobs}
                </td>
              </tr>
            ))}
            {sites.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-center text-slate-500" colSpan={5}>
                  No sites match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
