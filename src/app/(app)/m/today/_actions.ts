"use server";

import { requireUser } from "@/lib/authz";
import {
  loadSiteBriefing,
  officerHasCalloutAtSite,
  type SiteBriefing,
} from "@/lib/siteBriefing";

export type BriefingResult =
  | { ok: true; briefing: SiteBriefing }
  | { ok: false; error: string };

/**
 * Fetch the site + key + access briefing for a site the caller is attending.
 * Officers may only pull a briefing for a site they have an active callout at
 * (least privilege — codes stay scoped to real work); staff can pull any.
 * Called lazily when the officer opens the briefing sheet, so decrypted codes
 * never sit in the page's initial HTML.
 */
export async function getMyCalloutBriefing(
  siteId: string,
): Promise<BriefingResult> {
  const u = await requireUser();
  const isStaff = u.role === "ADMIN" || u.role === "DISPATCHER";
  if (!isStaff) {
    if (u.role !== "OFFICER") {
      return { ok: false, error: "Not authorised." };
    }
    const assigned = await officerHasCalloutAtSite(u.id, siteId);
    if (!assigned) {
      return { ok: false, error: "You have no active callout at this site." };
    }
  }
  const briefing = await loadSiteBriefing(siteId);
  if (!briefing) return { ok: false, error: "Site not found." };
  return { ok: true, briefing };
}
