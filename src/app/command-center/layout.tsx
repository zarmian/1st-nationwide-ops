import "./live.css";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { Fira_Sans, Fira_Code } from "next/font/google";
import { authOptions } from "@/lib/auth";
import { AutoRefresh } from "../(app)/m/today/_components/AutoRefresh";
import { TopBar, initialsOf } from "./_ui";

// Fira for the data-dense "control room" look, self-hosted via next/font
// (same approach as the app's Inter) so it renders on first paint.
const firaSans = Fira_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-fira-sans",
});
const firaCode = Fira_Code({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-fira-code",
});

// Always render against live data — never statically cached.
export const dynamic = "force-dynamic";

export default async function CommandCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  // Staff-only surface. Officers and partner seats have their own homes.
  const role = session.user.role;
  if (role === "OFFICER") redirect("/m/today");
  if (role === "PARTNER") redirect("/partner");
  if (role === "PARTNER_OFFICER") redirect("/partner/m/today");

  const pathname = headers().get("x-pathname") ?? "/command-center";
  const name = session.user.name ?? session.user.email ?? "User";

  return (
    <div className={`ccx ${firaSans.variable} ${firaCode.variable}`}>
      {/* Real-time: refresh server data every 30s while the tab is visible. */}
      <AutoRefresh intervalMs={30_000} />
      <TopBar active={pathname} initials={initialsOf(name)} role={role} now={new Date()} />
      {children}
    </div>
  );
}
