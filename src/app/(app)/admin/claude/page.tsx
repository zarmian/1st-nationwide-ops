import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { formatDateTime, formatTimeAgo } from "@/lib/dates";
import { roleLabel } from "@/lib/roleLabel";
import { mcpResourceUrl } from "@/lib/mcp/config";
import { getConnectorSettings } from "@/lib/mcp/oauth";
import { DisconnectButton } from "./_components/DisconnectButton";
import { OfficeStaffToggle } from "./_components/OfficeStaffToggle";

export const dynamic = "force-dynamic";

const TOOL_LABEL: Record<string, string> = {
  get_operations_overview: "Operations overview",
  list_activities: "Activities",
  get_activity: "Activity details",
  list_alarms: "Alarms",
  search_sites: "Site search",
  get_site: "Site profile",
  find_keys: "Keys",
  list_officers: "Officers",
  get_compliance: "Compliance",
  list_accounts: "Customers & partners",
  get_finance_summary: "Finance summary",
  list_invoices: "Invoices",
};

/** Compact "filter: value" summary of what Claude looked up. */
function describeArgs(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  return Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
    .join(" · ");
}

export default async function ClaudeConnectorPage() {
  await requireAdmin();

  const [settings, connections, calls] = await Promise.all([
    getConnectorSettings(prisma),
    prisma.mcpGrant.findMany({
      where: { revokedAt: null, tokens: { some: {} } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        clientName: true,
        redirectHost: true,
        createdAt: true,
        lastUsedAt: true,
        user: { select: { name: true, role: true } },
      },
    }),
    prisma.mcpToolCall.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        userId: true,
        tool: true,
        args: true,
        ok: true,
        error: true,
        durationMs: true,
        createdAt: true,
      },
    }),
  ]);

  const callerIds = [...new Set(calls.map((c) => c.userId))];
  const callers = callerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: callerIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameOf = new Map(callers.map((u) => [u.id, u.name]));
  const url = mcpResourceUrl();

  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader
        title="Claude"
        backHref="/admin"
        backLabel="Admin"
        subtitle="Connect Claude (claude.ai, the Claude apps or Claude Code) to this system so you can ask it about sites, jobs, patrols, alarms, keys, officers and finance. Claude can only look things up — it can't change anything — and it never sees alarm, padlock or lockbox codes or passwords."
      />

      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-brand-navy">Connect Claude</h2>
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-slate-700">
          <li>
            In Claude, open <span className="font-medium">Customize → Connectors</span> and choose{" "}
            <span className="font-medium">Add custom connector</span>.
          </li>
          <li>
            Name it <span className="font-medium">1st Nationwide Ops</span> and paste this address:
            <code className="mt-1.5 block select-all rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs text-slate-900 break-all">
              {url}
            </code>
          </li>
          <li>
            If asked how Claude should identify itself, choose{" "}
            <span className="font-medium">Use Claude&rsquo;s published identity</span>, and leave the
            OAuth client ID and secret empty.
          </li>
          <li>
            Click <span className="font-medium">Connect</span>, sign in here with your 1NW login, and
            choose <span className="font-medium">Allow</span>.
          </li>
        </ol>
        <p className="text-xs text-slate-500">
          What Claude reads is sent to Anthropic to answer your questions, so only connect a Claude
          account the company controls. Only accounts you allow below can connect.
        </p>
      </div>

      <div className="card p-5">
        <OfficeStaffToggle allowed={settings.allowDispatchers} />
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">
            Connected ({connections.length})
          </h2>
        </div>
        {connections.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            Nobody has connected Claude yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {connections.map((c) => (
              <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {c.user.name}{" "}
                    <span className="text-xs font-normal text-slate-500">
                      ({roleLabel(c.user.role)})
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {c.clientName}
                    {c.redirectHost === "localhost" || c.redirectHost === "127.0.0.1"
                      ? " on their computer"
                      : ` (${c.redirectHost})`}{" "}
                    · connected {formatDateTime(c.createdAt)} · last used{" "}
                    {c.lastUsedAt ? formatTimeAgo(c.lastUsedAt) : "never"}
                  </div>
                </div>
                <DisconnectButton grantId={c.id} who={c.user.name} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="font-semibold text-brand-navy">What Claude looked up</h2>
          <p className="text-xs text-slate-500">The latest 50 lookups, newest first.</p>
        </div>
        {calls.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Nothing yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {calls.map((c) => {
              const filters = describeArgs(c.args);
              return (
                <li key={c.id} className="px-4 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-slate-900">
                      {TOOL_LABEL[c.tool] ?? c.tool}
                    </span>
                    <span className="text-xs text-slate-500">
                      {nameOf.get(c.userId) ?? "Unknown user"} · {formatDateTime(c.createdAt)} ·{" "}
                      {c.durationMs} ms
                    </span>
                    {!c.ok && (
                      <span className="text-xs font-medium text-red-700">failed</span>
                    )}
                  </div>
                  {filters && <div className="text-xs text-slate-500 break-words">{filters}</div>}
                  {!c.ok && c.error && (
                    <div className="text-xs text-red-700 break-words">{c.error}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
