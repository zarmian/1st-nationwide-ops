import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PartnerTopNav } from "@/components/PartnerTopNav";
import { PartnerOfficerTopNav } from "@/components/PartnerOfficerTopNav";
import { RouteProgress } from "@/components/RouteProgress";

/**
 * Partner-portal shell. Hosts two sub-surfaces with two different
 * nav shapes:
 *
 *   role=PARTNER          /partner/*       admin nav (Activities,
 *                                          Officers, Rates, Finance)
 *   role=PARTNER_OFFICER  /partner/m/*     mobile nav (Today)
 *
 * Middleware does the URL-vs-role match — by the time we render here
 * we just need to pick the right top-nav based on role. PARTNER won't
 * reach /partner/m/* and PARTNER_OFFICER won't reach any other
 * /partner/* path, so role alone determines which nav to show.
 *
 * Backstops sign-in + role check defence-in-depth.
 */
export default async function PartnerShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = session.user.role;
  if (role !== "PARTNER" && role !== "PARTNER_OFFICER") {
    redirect(role === "OFFICER" ? "/m/today" : "/dispatch");
  }
  const partnerId = session.user.partnerId;
  if (!partnerId) {
    redirect("/login");
  }

  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, name: true, active: true },
  });
  if (!partner || !partner.active) {
    redirect("/login");
  }

  // Partner-officer surface shows the officer's own name in the nav
  // (not the org's), so we resolve the seat's display name here.
  let officerSeatName: string | null = null;
  if (role === "PARTNER_OFFICER") {
    const seat = await prisma.partnerOfficer.findUnique({
      where: { userId: session.user.id },
      select: { name: true, active: true },
    });
    if (!seat || !seat.active) redirect("/login");
    officerSeatName = seat.name;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <RouteProgress />
      {role === "PARTNER" ? (
        <PartnerTopNav
          partnerName={partner.name}
          userEmail={session.user.email ?? null}
        />
      ) : (
        <PartnerOfficerTopNav
          partnerName={partner.name}
          officerName={officerSeatName ?? "Officer"}
        />
      )}
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
