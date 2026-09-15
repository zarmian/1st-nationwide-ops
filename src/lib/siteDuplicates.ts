/**
 * Suspected-duplicate site detection. Two sites are flagged as possible
 * duplicates when they share a normalised name or the same postcode — the
 * usual sign of a site added by hand and then again via the Nexus import.
 * It's advisory only (a highlight), since two distinct sites can legitimately
 * share a postcode.
 */
export type DupSite = { id: string; name: string; postcode: string | null };
export type DupInfo = { byName: boolean; byPostcode: boolean };

/** Loose name key: lower-cased, punctuation/whitespace collapsed. */
export function normaliseNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function postcodeKey(pc: string | null | undefined): string {
  return (pc ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Returns a map of siteId → why it's a suspected duplicate, for every site that
 * shares a name or postcode with at least one other site in the input set.
 */
export function findDuplicateSites(sites: DupSite[]): Map<string, DupInfo> {
  const nameCount = new Map<string, number>();
  const pcCount = new Map<string, number>();

  for (const s of sites) {
    const nk = normaliseNameKey(s.name);
    if (nk) nameCount.set(nk, (nameCount.get(nk) ?? 0) + 1);
    const pk = postcodeKey(s.postcode);
    if (pk) pcCount.set(pk, (pcCount.get(pk) ?? 0) + 1);
  }

  const result = new Map<string, DupInfo>();
  for (const s of sites) {
    const nk = normaliseNameKey(s.name);
    const pk = postcodeKey(s.postcode);
    const byName = Boolean(nk) && (nameCount.get(nk) ?? 0) > 1;
    const byPostcode = Boolean(pk) && (pcCount.get(pk) ?? 0) > 1;
    if (byName || byPostcode) result.set(s.id, { byName, byPostcode });
  }
  return result;
}

/** Human explanation for a duplicate flag. */
export function dupReason(d: DupInfo): string {
  if (d.byName && d.byPostcode)
    return "Another site has the same name and postcode";
  if (d.byName) return "Another site has the same name";
  return "Another site has the same postcode";
}
