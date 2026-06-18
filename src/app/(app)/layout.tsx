import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { TopNav } from "@/components/TopNav";
import { PWARegister } from "@/components/PWARegister";
import { RouteProgress } from "@/components/RouteProgress";
import { CommandPalette } from "@/components/CommandPalette";

export default async function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Defence-in-depth role gate. Middleware is the primary enforcement;
  // this layout re-checks server-side so a request that somehow slips
  // past the matcher still can't render. We only redirect when we can
  // positively identify the pathname AND see it's outside the role's
  // allowed set — if x-pathname is missing (e.g. middleware was
  // bypassed entirely, or hasn't rolled out yet) we trust middleware
  // and skip the gate. Failing open here avoids an infinite loop on
  // /m/today if x-pathname ever fails to forward.
  const pathname = headers().get("x-pathname");
  const role = session.user.role;

  if (pathname && role === "OFFICER") {
    const officerOk =
      pathname === "/m" ||
      pathname.startsWith("/m/") ||
      pathname === "/submit" ||
      pathname.startsWith("/submit/");
    if (!officerOk) redirect("/m/today");
  }
  // Partner-portal seats never see the (app) shell.
  if (role === "PARTNER") redirect("/partner");
  if (role === "PARTNER_OFFICER") redirect("/partner/m/today");
  if (pathname && role === "DISPATCHER") {
    const onFinance =
      pathname === "/finance" || pathname.startsWith("/finance/");
    const onAdmin =
      pathname.startsWith("/admin") &&
      pathname !== "/admin/reports" &&
      !pathname.startsWith("/admin/reports/");
    if (onFinance || onAdmin) redirect("/dispatch");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PWARegister />
      <RouteProgress />
      <CommandPalette role={session.user.role} />
      <TopNav
        userName={session.user?.name ?? session.user?.email ?? "User"}
        role={session.user.role}
      />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
