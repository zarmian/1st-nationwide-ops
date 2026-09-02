import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CustomerTopNav } from "@/components/CustomerTopNav";
import { RouteProgress } from "@/components/RouteProgress";

/**
 * Client-portal shell — the read-only surface a direct customer signs into.
 *
 * Middleware does the URL-vs-role match; this backstops sign-in + role +
 * active checks defence-in-depth, and resolves the customer name for the nav.
 * Every page under here scopes its queries to `session.user.customerId` via
 * requireCustomer() — never a URL value.
 */
export default async function ClientShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = session.user.role;
  if (role !== "CUSTOMER") {
    redirect(role === "OFFICER" ? "/m/today" : "/dispatch");
  }
  const customerId = session.user.customerId;
  if (!customerId) redirect("/login");

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, active: true },
  });
  if (!customer || !customer.active) redirect("/login");

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <RouteProgress />
      <CustomerTopNav
        customerName={customer.name}
        userEmail={session.user.email ?? null}
      />
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
