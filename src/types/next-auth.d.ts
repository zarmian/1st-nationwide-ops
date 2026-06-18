import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      /// Set when role = PARTNER (or future PARTNER_OFFICER).
      /// null/undefined for ADMIN / DISPATCHER / OFFICER.
      partnerId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: UserRole;
    partnerId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    partnerId?: string | null;
  }
}
