import "./live.css";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AutoRefresh } from "../(app)/m/today/_components/AutoRefresh";
import { TopBar, initialsOf } from "./_ui";

// Always render against live data — never statically cached.
export const dynamic = "force-dynamic";

export default async function CommandCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Staff-only surface. Officers have their own mobile home.
  const role = session.user.role;
  if (role === "OFFICER") redirect("/m/today");

  const pathname = headers().get("x-pathname") ?? "/command-center";
  const name = session.user.name ?? session.user.email ?? "User";

  return (
    <div className="ccx">
      {/* Fira loaded at runtime via <link> (not next/font) so the production
          build never depends on a Google Fonts fetch. Degrades to Inter/
          system fonts via the CSS fallback stack if the request is blocked. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@300;400;500;600;700&display=swap"
      />
      {/* Real-time: refresh server data every 30s while the tab is visible. */}
      <AutoRefresh intervalMs={30_000} />
      <TopBar active={pathname} initials={initialsOf(name)} role={role} now={new Date()} />
      {children}
    </div>
  );
}
