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

  // Defence-in-depth role gate. Middleware already redirects, but we
  // re-check here in case a request somehow bypasses it (stale matcher
  // cache, edge runtime quirk, link click from a stale tab, etc.).
  // Middleware forwards the request pathname as x-pathname so this
  // layout can see what page is actually being rendered.
  const pathname = headers().get("x-pathname") ?? "";
  const role = session.user.role;

  if (role === "OFFICER") {
    const officerOk =
      pathname === "/m" ||
      pathname.startsWith("/m/") ||
      pathname === "/submit" ||
      pathname.startsWith("/submit/");
    if (!officerOk) redirect("/m/today");
  }
  if (role === "DISPATCHER") {
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
