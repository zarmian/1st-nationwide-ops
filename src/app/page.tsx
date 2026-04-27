import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session) redirect("/login");

  const role = (session.user as any).role as string;
  if (role === "OFFICER") redirect("/m/today");
  if (role === "DISPATCHER") redirect("/dispatch");
  redirect("/sites");
}
