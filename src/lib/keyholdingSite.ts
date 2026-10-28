/**
 * A site for a Keyholding job whose property isn't in the system yet, made
 * from the property details the Keyholding import keeps in the job's notes
 * ("Property: Name (#123). … Address: 1 High St, Town, RG1 2AB. Imported from
 * the Keyholding …") — on the office's say-so, from the job's edit page.
 */
import { prisma } from "@/lib/db";
import { logActivity } from "@/lib/audit";
import { geocodePostcodes } from "@/lib/geocode";
import { jobTypeToRateService } from "@/lib/billing";
import { formatPostcode, normalisePostcode, parseAddress } from "@/lib/nexusImport";

export type KhProperty = {
  name: string;
  /** Keyholding's property number. */
  number: string | null;
  contract: string | null;
  /** The street address, without the town and postcode. */
  addressLine: string;
  city: string | null;
  /** No spaces, upper case — how sites store it. */
  postcode: string;
  postcodeFormatted: string;
};

/** The Keyholding property in an imported job's notes, or null when the
 *  notes don't carry one with a postcode. */
export function khPropertyFromNotes(notes: string | null | undefined): KhProperty | null {
  if (!notes) return null;
  const prop = notes.match(/Property: (.+?) \(#([^)]*)\)\./);
  const addr = notes.match(/Address: (.+?)\. Imported from the Keyholding/);
  if (!prop || !addr) return null;
  const { addressLine, city, postcodeRaw } = parseAddress(addr[1]);
  if (!postcodeRaw) return null;
  return {
    name: prop[1].trim(),
    number: prop[2].trim() || null,
    contract: notes.match(/Contract: (.+?)\. Address:/)?.[1]?.trim() ?? null,
    addressLine: addressLine || addr[1].trim(),
    city,
    postcode: normalisePostcode(postcodeRaw),
    postcodeFormatted: formatPostcode(postcodeRaw),
  };
}

/** How a job's notes name its Keyholding property — the same in every job for it. */
function propertyMarker(p: KhProperty): string {
  return `Property: ${p.name} (#${p.number ?? ""}).`;
}

export type SiteFromJobResult =
  | { ok: true; siteId: string; attached: number }
  | { ok: false; error: string };

/**
 * Add the job's Keyholding property as a site — name, address and postcode
 * from Keyholding, the job's customer, the map position from the postcode —
 * and attach the job, plus any other job still waiting for the same property.
 * Refuses when a site at that postcode is already in the system.
 */
export async function addSiteFromKeyholdingJob(
  jobId: string,
  userId: string,
): Promise<SiteFromJobResult> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, siteId: true, customerId: true, type: true, notes: true },
  });
  if (!job) return { ok: false, error: "Job not found." };
  if (job.siteId) return { ok: false, error: "This job already has a site." };
  const p = khPropertyFromNotes(job.notes);
  if (!p) {
    return {
      ok: false,
      error: "This job doesn't carry the property's address from Keyholding, so add the site under Sites.",
    };
  }
  const clash = await prisma.site.findFirst({
    where: { postcode: p.postcode },
    select: { name: true, code: true },
  });
  if (clash) {
    return {
      ok: false,
      error: `A site at ${p.postcodeFormatted} is already in the system (${clash.code ? `${clash.code} · ` : ""}${clash.name}) — pick it from the list instead.`,
    };
  }

  const coords = (await geocodePostcodes([p.postcode]).catch(() => null))?.get(p.postcode) ?? null;
  const service = jobTypeToRateService(job.type);
  const site = await prisma.site.create({
    data: {
      name: p.name,
      addressLine: p.addressLine,
      city: p.city,
      postcode: p.postcode,
      postcodeFormatted: p.postcodeFormatted,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      customerId: job.customerId,
      services: (service ? [service] : []) as any,
      notes: [
        "Added from a Keyholding job",
        p.number ? ` — Keyholding property #${p.number}` : "",
        p.contract ? `, contract ${p.contract}` : "",
        ".",
      ].join(""),
    },
    select: { id: true },
  });

  // This job, and any other still waiting for the same property.
  const attached = await prisma.job.updateMany({
    where: {
      siteId: null,
      customerId: job.customerId,
      OR: [{ id: job.id }, { notes: { contains: propertyMarker(p) } }],
    },
    data: { siteId: site.id },
  });

  await logActivity({
    entity: "Site",
    entityId: site.id,
    action: "created_from_job",
    userId,
    diff: { jobId: job.id, jobsAttached: attached.count } as any,
  }).catch((e) => console.error("logActivity (site from job) failed", e));

  return { ok: true, siteId: site.id, attached: attached.count };
}
