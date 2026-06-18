import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PartnerTopNav } from "@/components/PartnerTopNav";
import { RouteProgress } from "@/components/RouteProgress";

/**
 * Partner-portal shell.
 *
 * Three-layer auth as elsewhere:
 *   1. Sign-in required (middleware redirects unauthenticated → /login).
 *   2. Role gate at the middleware level redirects non-PARTNER users
 *      away from /partner/* and PARTNER users into it.
 *   3. This layout re-checks both as a backstop — defence-in-depth.
 *
 * Loads the partner record once so the nav can render the partner's
 * name. Server actions and pages still call requirePartner() and
 * trust only the session's partnerId, never the URL.
 */
export default async function PartnerShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = session.user.role;
  if (role !== "PARTNER") {
    // Our own staff don't have a partner scope. Send them home.
    redirect(role === "OFFICER" ? "/m/today" : "/dispatch");
  }
  const partnerId = session.user.partnerId;
  if (!partnerId) {
    // Misconfigured PARTNER row — bounce to login so they can be
    // re-issued credentials. Logging out clears the stale JWT.
    redirect("/login");
  }

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, name: true, active: true },
  });
  if (!partner || !partner.active) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <RouteProgress />
      <PartnerTopNav
        partnerName={partner.name}
        userEmail={session.user.email ?? null}
      />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
