/**
 * Read-only site + key lookups for the bot (staff only). Kept deliberately
 * non-sensitive: we surface where a key is and the basics of a site, but
 * never access codes over chat — those stay behind the app's own gating.
 */
import { prisma } from "@/lib/db";
import { escapeHtml } from "@/lib/telegram";
import { matchSite } from "@/lib/telegramCallout";
import { loadDayActivities } from "@/lib/dayActivities";
import { resolveDayTarget } from "@/lib/dayActivitiesFormat";

function keyStatusLabel(status: string): string {
  switch (status) {
    case "WITH_US":
      return "with us";
    case "WITH_OFFICER":
      return "with officer";
    case "WITH_CUSTOMER":
      return "with customer";
    case "LOST":
      return "LOST";
    default:
      return status.toLowerCase();
  }
}

/** Site lookup — basics + key holders + how many activities are on today. */
export async function siteLookupMessage(query: string): Promise<string> {
  const q = query.trim();
  if (!q) return "Which site? e.g. /site Neasden";

  const sites = await prisma.site.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      postcodeFormatted: true,
      addressLine: true,
      city: true,
    },
  });
  const m = matchSite(
    q,
    sites.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      postcode: s.postcodeFormatted,
      address: [s.addressLine, s.city].filter(Boolean).join(" "),
    })),
  );
  if (m.kind === "none") return `No site matches “${escapeHtml(q)}”.`;
  if (m.kind === "many") {
    const list = m.sites
      .slice(0, 10)
      .map(
        (s) =>
          `• ${escapeHtml(s.name)}${s.postcode ? ` — ${escapeHtml(s.postcode)}` : ""}`,
      )
      .join("\n");
    const more =
      m.sites.length > 10
        ? `\n…and ${m.sites.length - 10} more — add more detail`
        : "";
    return `🔎 <b>${m.sites.length} sites match “${escapeHtml(q)}”</b>\n${list}${more}\n\nReply with the name or postcode of the one you want.`;
  }

  const site = await prisma.site.findUnique({
    where: { id: m.site.id },
    select: {
      name: true,
      code: true,
      postcodeFormatted: true,
      what3words: true,
      region: { select: { name: true } },
      customer: { select: { name: true } },
      partner: { select: { name: true } },
      accessInstruction: { select: { id: true } },
      keys: {
        where: { status: { not: "RETIRED" } },
        select: {
          label: true,
          internalNo: true,
          status: true,
          currentHolder: { select: { name: true } },
        },
      },
    },
  });
  if (!site) return `No site matches “${escapeHtml(q)}”.`;

  const account = site.customer
    ? escapeHtml(site.customer.name)
    : site.partner
      ? `for ${escapeHtml(site.partner.name)}`
      : "—";

  const withUs = site.keys.filter((k) => k.status === "WITH_US").length;
  const out = site.keys.filter((k) => k.status !== "WITH_US");
  const keyBits: string[] = [];
  if (site.keys.length === 0) keyBits.push("none on file");
  else keyBits.push(`${withUs} with us`);
  for (const k of out.slice(0, 6)) {
    const who = k.currentHolder?.name ?? keyStatusLabel(k.status);
    keyBits.push(`${escapeHtml(k.label)} → ${escapeHtml(who)}`);
  }
  if (out.length > 6) keyBits.push(`+${out.length - 6} more`);

  const today = resolveDayTarget("today");
  const todayCount = today
    ? (await loadDayActivities(today, { siteId: m.site.id })).length
    : 0;

  const lines = [
    `📍 <b>${escapeHtml(site.name)}</b>${site.code ? ` (${escapeHtml(site.code)})` : ""}`,
    `${escapeHtml(site.postcodeFormatted)}${site.what3words ? ` · ///${escapeHtml(site.what3words)}` : ""}`,
    `${escapeHtml(site.region?.name ?? "—")} · ${account}`,
    `🔑 ${keyBits.join(" · ")}`,
    `📋 Today: ${todayCount} scheduled${todayCount ? " (send /today for detail)" : ""}`,
  ];
  if (site.accessInstruction) {
    lines.push("📝 Access notes on file — see the app.");
  }
  return lines.join("\n");
}

/** Key lookup — by number, label, or site name. Shows the current holder. */
export async function keyLookupMessage(query: string): Promise<string> {
  const q = query.trim();
  if (!q) return "Which key? e.g. /key 12 or /key Neasden";

  const keys = await prisma.key.findMany({
    where: {
      status: { not: "RETIRED" },
      OR: [
        { internalNo: { contains: q, mode: "insensitive" } },
        { label: { contains: q, mode: "insensitive" } },
        { site: { is: { name: { contains: q, mode: "insensitive" } } } },
        { site: { is: { code: { contains: q, mode: "insensitive" } } } },
      ],
    },
    orderBy: [{ internalNo: "asc" }],
    take: 12,
    select: {
      internalNo: true,
      label: true,
      status: true,
      site: { select: { name: true } },
      currentHolder: { select: { name: true } },
    },
  });
  if (keys.length === 0) return `No keys match “${escapeHtml(q)}”.`;

  const lines = [`🔑 <b>Keys matching “${escapeHtml(q)}”</b>`, ""];
  for (const k of keys) {
    const who = k.currentHolder?.name ?? keyStatusLabel(k.status);
    const id = k.internalNo ? `#${escapeHtml(k.internalNo)} ` : "";
    lines.push(
      `• ${id}${escapeHtml(k.label)} — ${escapeHtml(k.site?.name ?? "no site")} · ${escapeHtml(who)}`,
    );
  }
  if (keys.length === 12) lines.push("", "(showing first 12 — narrow the search)");
  return lines.join("\n");
}
