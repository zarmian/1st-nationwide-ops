import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";
import { isLoopbackUri } from "@/lib/mcp/clients";
import {
  checkAuthorizeRequest,
  connectorAccessFor,
  denyAuthorization,
  type AuthorizeInput,
} from "@/lib/mcp/oauth";

/**
 * Consent screen for the Claude connector (OAuth authorization endpoint).
 * Claude sends the browser here; the person signs in with their 1NW login
 * and approves. The decision posts to /api/oauth/authorize. Framing is
 * blocked in next.config (clickjacking).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect Claude · 1st Nationwide Ops",
  robots: { index: false, follow: false },
};

const FIELDS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;

function readInput(
  searchParams: Record<string, string | string[] | undefined>,
): AuthorizeInput {
  const input: AuthorizeInput = {};
  for (const f of FIELDS) {
    const v = searchParams[f];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string") input[f] = s;
  }
  return input;
}

function selfUrl(input: AuthorizeInput): string {
  const qs = new URLSearchParams();
  for (const f of FIELDS) if (input[f] !== undefined) qs.set(f, input[f]!);
  return `/oauth/authorize?${qs.toString()}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-slate-400">
          1st Nationwide Security Services
        </p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const input = readInput(searchParams);
  const check = await checkAuthorizeRequest(input);

  if (!check.ok) {
    if (check.fatal) {
      return (
        <Shell>
          <div className="card p-6" role="alert">
            <h1 className="text-xl font-semibold text-brand-navy mb-2">
              Can&rsquo;t connect
            </h1>
            <p className="text-sm text-slate-600">{check.message}</p>
            <p className="text-sm text-slate-500 mt-3">
              To connect Claude, start from Claude&rsquo;s connector settings
              and add <span className="font-medium">1st Nationwide Ops</span>{" "}
              there.
            </p>
          </div>
        </Shell>
      );
    }
    redirect(check.redirectTo);
  }

  const session = await getSessionUser();
  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(selfUrl(input))}`);
  }

  const { request } = check;
  const access = await connectorAccessFor(prisma, session.id);
  const loopback = isLoopbackUri(request.redirectUri);
  const clientHost = new URL(request.client.clientId).hostname;
  const signOutHref = `/api/auth/signout?callbackUrl=${encodeURIComponent(
    `/login?callbackUrl=${encodeURIComponent(selfUrl(input))}`,
  )}`;

  if (!access.allowed) {
    return (
      <Shell>
        <div className="card p-6" role="alert">
          <h1 className="text-xl font-semibold text-brand-navy mb-2">
            This account can&rsquo;t connect Claude
          </h1>
          <p className="text-sm text-slate-600">{access.reason}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a className="btn-secondary" href={denyAuthorization(request)}>
              Back to Claude
            </a>
            <a className="btn-ghost" href={signOutHref}>
              Use a different account
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  const { user } = access;
  const isAdmin = user.role === "ADMIN";

  return (
    <Shell>
      <div className="card p-6">
        <h1 className="text-xl font-semibold text-brand-navy">
          Connect Claude to 1st Nationwide Ops?
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          <span className="font-semibold text-slate-900">
            {request.client.clientName}
          </span>{" "}
          ({clientHost}) is asking to read this system as you.
        </p>

        {loopback ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This connection goes to a program on your own computer (
            {new URL(request.redirectUri).hostname}). Only allow it if you
            started Claude Code yourself just now.
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-500">
            After you allow it, you&rsquo;ll go back to{" "}
            <span className="font-medium text-slate-700">
              {new URL(request.redirectUri).hostname}
            </span>
            . Only continue if you started connecting Claude yourself just
            now.
          </p>
        )}

        <div className="card-subtle mt-4 p-4 text-sm text-slate-700">
          <p className="font-medium text-slate-900 mb-2">Claude will be able to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Look up sites, schedules, keys and who holds them</li>
            <li>See jobs, patrols, shifts, alarms and response times</li>
            <li>See officers{isAdmin ? " and their compliance (SIA, DBS, right to work)" : ""}</li>
            {isAdmin && <li>See finance figures and invoices</li>}
          </ul>
          <p className="font-medium text-slate-900 mt-3 mb-2">It can&rsquo;t:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Create, change or delete anything</li>
            <li>See alarm, padlock or lockbox codes, or anyone&rsquo;s password</li>
            <li>See anything your own account can&rsquo;t</li>
          </ul>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          What Claude reads is sent to Anthropic to answer your questions, so
          only connect a Claude account the company controls. You can
          disconnect any time in Admin → Claude or in Claude&rsquo;s connector
          settings.
        </p>

        <form method="post" action="/api/oauth/authorize" className="mt-6">
          {FIELDS.map((f) =>
            input[f] !== undefined ? (
              <input key={f} type="hidden" name={f} value={input[f]} />
            ) : null,
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" name="decision" value="allow" className="btn-primary">
              Allow
            </button>
            <button type="submit" name="decision" value="deny" className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>

        <p className="mt-6 text-xs text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{user.name}</span>{" "}
          ({user.email}, {isAdmin ? "admin" : "office"}).{" "}
          <a className="underline hover:text-slate-700" href={signOutHref}>
            Not you?
          </a>
        </p>
      </div>
    </Shell>
  );
}
