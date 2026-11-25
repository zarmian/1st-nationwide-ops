/**
 * The Claude connector's MCP server: read-only tools over the ops data, built
 * per request for the signed-in principal. Admin-only tools (finance,
 * compliance, customer/partner directory) aren't even listed for office
 * staff. The one exception to read-only: an admin who ticked "Also let
 * Claude change FastField shift links" when connecting (scope
 * `fastfield:link`) also gets the two FastField shift-link tools — nothing
 * else writes. Every call is written to McpToolCall (who, which tool, which
 * filters, ok/error, time) for the admin audit view.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { loadHiddenScope } from "@/lib/hiddenAccounts";
import { CONNECTOR_NAME, MCP_FASTFIELD_LINK_SCOPE } from "./config";
import type { McpPrincipal } from "./oauth";
import {
  ACTIVITY_KINDS,
  getActivity,
  loadActivities,
} from "./tools/activities";
import { listAlarms } from "./tools/alarms";
import { reviewFastFieldReports } from "./tools/fastfield";
import { linkReportToShiftTool, reviewShiftRoundsTool, unlinkReportFromShiftTool } from "./tools/fastfieldShifts";
import { listAccounts } from "./tools/accounts";
import { getFinanceSummary, listInvoices } from "./tools/finance";
import { KEY_STATUSES, findKeys } from "./tools/keys";
import { getOperationsOverview } from "./tools/overview";
import { getCompliance, listOfficers } from "./tools/people";
import { SERVICE_TAGS, getSite, searchSites } from "./tools/sites";
import {
  STATUS_GROUP_KEYS,
  ToolInputError,
  clampLimit,
  matchCustomers,
  matchPartners,
  matchPeople,
  matchRegions,
  matchSites,
  resolveDayRange,
  ukToday,
  type ToolContext,
} from "./tools/common";

const VERSION = "1.0.0";

function instructions(isAdmin: boolean, canLink: boolean): string {
  return [
    "Read-only access to the operations system of 1st Nationwide Security Services (UK): sites, scheduled patrols and VPIs, lock/unlocks, alarm responses, callouts, static guarding shifts, keys and officers" +
      (isAdmin ? ", plus officer compliance, customers/partners and finance." : "."),
    "Dates are UK calendar dates (YYYY-MM-DD, Europe/London); times are UK local with their UTC offset.",
    "Activity date filters always mean the date the work was SCHEDULED for, not when it was done.",
    "Records: 'job' = callout, alarm response, lock/unlock or other one-off work; 'patrol_visit' = a visit generated from a site's patrol/VPI schedule; 'shift' = a static guarding or dog handling shift.",
    "Name filters match part of a name; results say which names were matched. Alarm, padlock and lockbox codes, entry steps, passwords and duty links are never available here.",
    ...(canLink
      ? [
          "This connection may also change which shift a FastField report is on (link_fastfield_report_to_shift, unlink_fastfield_report_from_shift) — nothing else. Only do it when the user asks; check with review_shift_rounds first and say what you'll change. Each change is a hand link the robot leaves alone, recorded in the shift's history with the user's name and your reason.",
        ]
      : []),
  ].join("\n");
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** The FastField shift-link tools: they change data (reversibly — a link can
 *  be moved or taken off again), only in this app. */
const CHANGES_SHIFT_LINKS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 1) }] };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("UK date, YYYY-MM-DD");

export async function buildMcpServer(principal: McpPrincipal): Promise<McpServer> {
  const isAdmin = principal.role === "ADMIN";
  // The one write scope (FastField shift links), for admins who ticked it.
  const canLink = isAdmin && principal.scopes.includes(MCP_FASTFIELD_LINK_SCOPE);
  const ctx: ToolContext = {
    principal,
    isAdmin,
    hidden: await loadHiddenScope(isAdmin),
    now: new Date(),
  };

  const server = new McpServer(
    { name: CONNECTOR_NAME, version: VERSION },
    { instructions: instructions(isAdmin, canLink) },
  );

  /** Register a read-only tool with audit logging and friendly errors
   *  (`writes`: one of the FastField shift-link tools — only registered for
   *  an admin whose connection has the `fastfield:link` scope). */
  function tool<Shape extends z.ZodRawShape>(
    name: string,
    meta: { title: string; description: string; input: Shape; adminOnly?: boolean; writes?: boolean },
    run: (args: z.objectOutputType<Shape, z.ZodTypeAny>) => Promise<unknown>,
  ) {
    if (meta.adminOnly && !isAdmin) return;
    if (meta.writes && !canLink) return;
    server.registerTool(
      name,
      {
        title: meta.title,
        description: meta.description,
        inputSchema: meta.input,
        annotations: { title: meta.title, ...(meta.writes ? CHANGES_SHIFT_LINKS : READ_ONLY) },
      },
      (async (args: z.objectOutputType<Shape, z.ZodTypeAny>) => {
        const started = Date.now();
        let ok = true;
        let error: string | undefined;
        try {
          return textResult(await run(args));
        } catch (e) {
          ok = false;
          if (e instanceof ToolInputError) {
            error = e.message;
            return errorResult(e.message);
          }
          error = e instanceof Error ? e.message.slice(0, 500) : "unknown error";
          console.error(`mcp tool ${name} failed`, error);
          return errorResult(
            "Something went wrong looking that up. Try again, or narrow the filters.",
          );
        } finally {
          await prisma.mcpToolCall
            .create({
              data: {
                grantId: principal.grantId,
                userId: principal.userId,
                tool: name,
                args: JSON.parse(JSON.stringify(args ?? {})),
                ok,
                error: error ?? null,
                durationMs: Date.now() - started,
              },
            })
            .catch((e) => console.error("mcp audit write failed", e instanceof Error ? e.message : e));
        }
      }) as never,
    );
  }

  // ── Operations ───────────────────────────────────────────────────────────

  tool(
    "get_operations_overview",
    {
      title: "Operations overview",
      description:
        "Snapshot of one UK day's work (default today): jobs, patrol visits and shifts scheduled that day by status. For today it also lists what's in progress now, unassigned jobs, overdue open jobs, reports awaiting review, open alarms from the last 24 hours with their response-time status, and officers on duty.",
      input: { date: dateArg.optional() },
    },
    (a) => getOperationsOverview(ctx, a),
  );

  tool(
    "list_activities",
    {
      title: "List activities",
      description:
        "Jobs, patrol visits and shifts scheduled within a UK date window (default today; up to 93 days), earliest first, with totals by status. Filter by site, customer, partner, officer or region (part of a name works), by kind and by status group. Each row says how many FastField reports are attached to it (fastfieldReports). Same data and rules as the Activities log in the app.",
      input: {
        from: dateArg.optional().describe("First UK day (YYYY-MM-DD). Default today."),
        to: dateArg.optional().describe("Last UK day, inclusive. Default = from."),
        site: z.string().optional().describe("Site code, name, postcode or id"),
        customer: z.string().optional().describe("Customer name (part is fine)"),
        partner: z.string().optional().describe("Partner name (part is fine)"),
        officer: z.string().optional().describe("Officer name (part is fine)"),
        region: z.string().optional().describe("Region name"),
        kinds: z
          .array(z.enum(ACTIVITY_KINDS))
          .optional()
          .describe(
            "Job kinds (ALARM_RESPONSE, PATROL, LOCK, UNLOCK, KEY_COLLECTION, KEY_DROPOFF, SURVEY, VPI, ADHOC), scheduled visits (VISIT_PATROL, VISIT_VPI) or shifts (STATIC_GUARDING_SHIFT, DOG_HANDLER_SHIFT)",
          ),
        status: z
          .array(z.enum(STATUS_GROUP_KEYS))
          .optional()
          .describe("Status groups: scheduled, in_progress, completed, missed, cancelled"),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 100)"),
      },
    },
    async (a) => {
      const today = ukToday(ctx.now);
      const range = resolveDayRange(a, { from: today, to: today }, 93);
      const [sites, customers, partners, officers, regions] = await Promise.all([
        a.site ? matchSites(a.site) : null,
        a.customer ? matchCustomers(a.customer) : null,
        a.partner ? matchPartners(a.partner) : null,
        a.officer ? matchPeople(a.officer) : null,
        a.region ? matchRegions(a.region) : null,
      ]);
      const res = await loadActivities(ctx, {
        from: range.fromDate,
        to: range.toDate,
        siteIds: sites?.ids,
        customerIds: customers?.ids,
        partnerIds: partners?.ids,
        officerIds: officers?.ids,
        regionIds: regions?.ids,
        kinds: a.kinds,
        statusGroups: a.status,
        limit: clampLimit(a.limit, 100, 200),
      });
      return {
        from: range.from,
        to: range.to,
        matched: {
          sites: sites?.names,
          customers: customers?.names,
          partners: partners?.names,
          officers: officers?.names,
          regions: regions?.names,
        },
        totals: res.totals,
        shown: res.rows.length,
        truncated: res.truncated,
        activities: res.rows,
      };
    },
  );

  tool(
    "get_activity",
    {
      title: "Get activity details",
      description:
        "Full details of one job, patrol visit or shift: times, officer, partner, notes, alarm details with response-time status, and GPS proof of presence against the site. Look it up by id (from list_activities / get_operations_overview, or an alarm id) or by a partner reference such as a Nexus LINK-… or Keyholding J… number.",
      input: {
        id: z.string().optional().describe("Activity or alarm id"),
        reference: z.string().optional().describe("Partner reference, e.g. LINK-123456 or J21634508"),
      },
    },
    (a) => getActivity(ctx, a),
  );

  tool(
    "list_alarms",
    {
      title: "List alarms",
      description:
        "Alarm activations received within a UK date window (default the last 7 days), newest first, with response-time performance: how many met the target (High 20, Medium 45, Low 90 minutes from receipt to officer on site), average response and breaches. Filter by site, customer, priority and open/closed.",
      input: {
        from: dateArg.optional(),
        to: dateArg.optional(),
        site: z.string().optional().describe("Site code, name, postcode or id"),
        customer: z.string().optional().describe("Customer name (part is fine)"),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
        state: z.enum(["open", "closed", "all"]).optional().describe("Default all"),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)"),
      },
    },
    (a) => listAlarms(ctx, { ...a, limit: clampLimit(a.limit, 50, 200) }),
  );

  // ── Sites & keys ─────────────────────────────────────────────────────────

  tool(
    "search_sites",
    {
      title: "Search sites",
      description:
        "Find sites by name, code, postcode, address or customer name, and filter by customer, partner, region, service and active status. Returns address, services, risk level and DO NOT ENGAGE / health & safety flags.",
      input: {
        query: z.string().optional().describe("Name, code, postcode, address or customer name"),
        customer: z.string().optional(),
        partner: z.string().optional(),
        region: z.string().optional().describe("Exact region name"),
        service: z.enum(SERVICE_TAGS).optional(),
        status: z.enum(["active", "inactive", "all"]).optional().describe("Default active"),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)"),
      },
    },
    (a) => searchSites(ctx, { ...a, limit: clampLimit(a.limit, 50, 200) }),
  );

  tool(
    "get_site",
    {
      title: "Get site profile",
      description:
        "One site's profile: address, customer and contacts, partner, services, flags, patrol/VPI and lock/unlock schedules, key sets and who holds each key, the last 14 days' activity and the next 7 days' scheduled work. Never includes alarm, padlock or lockbox codes or entry steps.",
      input: {
        site: z.string().min(1).describe("Site code, name, postcode or id"),
      },
    },
    (a) => getSite(ctx, a),
  );

  tool(
    "find_keys",
    {
      title: "Find keys",
      description:
        "Search the key register: keys, fobs and padlocks by site, current holder (an officer's name, or 'office' for keys held by 1NW), status or label, with each key's latest handover. Key notes are never shown, so codes kept with a key stay out.",
      input: {
        site: z.string().optional().describe("Site code, name, postcode or id"),
        holder: z.string().optional().describe("Officer name, or 'office'"),
        status: z.enum(KEY_STATUSES).optional(),
        query: z.string().optional().describe("Key label, key number or site name"),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)"),
      },
    },
    (a) => findKeys(ctx, { ...a, limit: clampLimit(a.limit, 50, 200) }),
  );

  // ── People ───────────────────────────────────────────────────────────────

  tool(
    "list_officers",
    {
      title: "List officers",
      description:
        "Officers (or office staff) with region, phone, on-duty status, last seen time and SIA licence expiry status. Filter by name, region, status and role.",
      input: {
        name: z.string().optional(),
        region: z.string().optional(),
        status: z.enum(["active", "on_duty", "inactive", "all"]).optional().describe("Default active"),
        role: z.enum(["officer", "office", "all"]).optional().describe("Default officer"),
        limit: z.number().int().min(1).max(300).optional().describe("Max rows (default 100)"),
      },
    },
    (a) => listOfficers(ctx, { ...a, limit: clampLimit(a.limit, 100, 300) }),
  );

  tool(
    "get_compliance",
    {
      title: "Officer compliance",
      description:
        "The compliance register: SIA licence, right to work, DBS and training certificates for each officer and office user, marked expired, expiring within 30 days, missing or valid. Defaults to people needing attention.",
      adminOnly: true,
      input: {
        show: z
          .enum(["needs_attention", "expired", "expiring", "missing", "all"])
          .optional()
          .describe("Default needs_attention"),
        name: z.string().optional(),
      },
    },
    (a) => getCompliance(ctx, a),
  );

  tool(
    "list_accounts",
    {
      title: "Customers and partners",
      description:
        "The customer and partner directory: contacts (name, role, phone, email), number of sites, contract dates, and for partners whether they work for us, we work for them, or both.",
      adminOnly: true,
      input: {
        kind: z.enum(["customers", "partners", "both"]).optional().describe("Default both"),
        name: z.string().optional().describe("Part of the account name"),
        includeInactive: z.boolean().optional(),
      },
    },
    (a) => listAccounts(ctx, a),
  );

  // ── FastField (admin) ────────────────────────────────────────────────────

  tool(
    "review_fastfield",
    {
      title: "Review FastField matching",
      description:
        "FastField reports filed in a UK date window (default the last 30 days): how many the robot linked or created, how many were linked or created by hand, set aside, and still waiting. For each waiting report the robot still tries by itself (form set to On, not taken off its activity; newest first): what the robot would do with it now under the current rules (a dry run — nothing changes), the site the officer typed and the site matched, and the work recorded at that site within 24 hours (or, with no site, the nearest site to the phone's GPS). No report answers.",
      adminOnly: true,
      input: {
        from: dateArg.optional(),
        to: dateArg.optional(),
        limit: z.number().int().min(1).max(150).optional().describe("Waiting reports to check (default 60)"),
      },
    },
    (a) => reviewFastFieldReports(ctx, { ...a, limit: clampLimit(a.limit, 60, 150) }),
  );

  tool(
    "review_shift_rounds",
    {
      title: "Review FastField reports on shifts",
      description:
        "Static / dog-handler shifts that started in a UK date window (default the last 7 days; up to 31), each with the FastField reports linked to it, checked against the rules: does the report's TYPED time fit the shift (with the 30-minute allowance either side), is it at the shift's site, does it name the shift's officer, and what would the robot's rules do with it (keep / move to another shift there it fits / take off; the robot itself never touches a hand link). Also lists waiting reports at the site whose typed time fits the shift. By default only shifts with something to look at; onlyProblems=false lists all. Ids are full, for the link tools. No report answers.",
      adminOnly: true,
      input: {
        from: dateArg.optional().describe("First UK day the shifts start on (YYYY-MM-DD). Default 6 days ago."),
        to: dateArg.optional().describe("Last UK day (YYYY-MM-DD). Default today."),
        site: z.string().max(120).optional().describe("Part of a site's name, its code or postcode."),
        onlyProblems: z.boolean().optional().describe("Only shifts with something to look at (default true)."),
        limit: z.number().int().min(1).max(200).optional().describe("Shifts to list (default 60)"),
      },
    },
    (a) => reviewShiftRoundsTool(ctx, { ...a, limit: clampLimit(a.limit, 60, 200) }),
  );

  tool(
    "link_fastfield_report_to_shift",
    {
      title: "Put a FastField report on a shift",
      description:
        "Put a FastField report on a static / dog-handler shift — moving it off the shift it's on, if any. It's a hand link: the robot leaves it there, even outside the shift's time. Recorded in the shift's history with the user's name and the reason. Not for a report on a job or patrol visit (change those in the app). Only when the user asks; check with review_shift_rounds first.",
      adminOnly: true,
      writes: true,
      input: {
        reportId: z.string().describe("The report's full id (review_shift_rounds reportId)."),
        shiftId: z.string().describe("The shift's full id (review_shift_rounds shiftId)."),
        reason: z.string().min(3).max(300).describe("Why, in a few words — kept in the shift's history."),
      },
    },
    (a) => linkReportToShiftTool(ctx, a),
  );

  tool(
    "unlink_fastfield_report_from_shift",
    {
      title: "Take a FastField report off its shift",
      description:
        "Take a FastField report off the shift it's on. Its patrol round on the shift goes, and the report waits in Needs linking (Admin → FastField); the robot won't link it again — a person (or link_fastfield_report_to_shift) does. Recorded in the shift's history with the user's name and the reason. Only when the user asks.",
      adminOnly: true,
      writes: true,
      input: {
        reportId: z.string().describe("The report's full id (review_shift_rounds reportId)."),
        reason: z.string().min(3).max(300).describe("Why, in a few words — kept in the shift's history."),
      },
    },
    (a) => unlinkReportFromShiftTool(ctx, a),
  );

  // ── Finance (admin) ──────────────────────────────────────────────────────

  tool(
    "get_finance_summary",
    {
      title: "Finance summary",
      description:
        "Management P&L for a UK date window (default this month to date) against the previous period of the same length: revenue, officer pay, subcontractor charges, gross profit, overheads and net profit (ex VAT, by scheduled date), revenue by service, and money owed to us with ageing and the biggest balances.",
      adminOnly: true,
      input: {
        from: dateArg.optional(),
        to: dateArg.optional(),
      },
    },
    (a) => getFinanceSummary(ctx, a),
  );

  tool(
    "list_invoices",
    {
      title: "List invoices",
      description:
        "Invoices by status: outstanding (sent, not fully paid, after credit notes), overdue, draft, sent, paid, void or all — with balances and days overdue for outstanding ones. Filter by customer.",
      adminOnly: true,
      input: {
        status: z
          .enum(["outstanding", "overdue", "draft", "sent", "paid", "void", "all"])
          .optional()
          .describe("Default outstanding"),
        customer: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)"),
      },
    },
    (a) => listInvoices(ctx, { ...a, limit: clampLimit(a.limit, 50, 200) }),
  );

  return server;
}
