import { redirect } from "next/navigation";
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
