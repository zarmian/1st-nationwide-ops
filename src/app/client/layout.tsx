import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClientScope } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { CustomerTopNav } from "@/components/CustomerTopNav";
import { RouteProgress } from "@/components/RouteProgress";

/**
 * Client-portal shell — the read-only surface a direct customer signs into
 * (by emailed link, /login/client), or an admin previews.
 *
 * Middleware does the URL-vs-role match; this backstops sign-in + role +
 * active checks defence-in-depth, and resolves the customer name for the nav.
 * Every page under here scopes its queries to the customer from
 * requireCustomer() — never a URL value.
 */
export default async function ClientShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login/client");

  const scope = await getClientScope();
  if (!scope) {
    const role = session.user.role;
    if (role === "CUSTOMER") redirect("/login/client?off=1"); // blocked since signing in
    redirect(role === "OFFICER" ? "/m/today" : "/dispatch");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: scope.customerId },
    select: { id: true, name: true, active: true },
  });
  if (!customer || (!customer.active && !scope.preview)) redirect("/login/client?off=1");

  return (
    <div className="min-h-screen bg-ambient">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <RouteProgress />
      {scope.preview && (
        <div
          role="status"
          className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950"
        >
          Preview: this is what {customer.name} sees on their dashboard.
        </div>
      )}
      <CustomerTopNav
        customerName={customer.name}
        userEmail={scope.preview ? null : session.user.email ?? null}
        preview={scope.preview}
      />
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
