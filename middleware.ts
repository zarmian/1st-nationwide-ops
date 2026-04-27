import { withAuth } from "next-auth/middleware";

// Pages requiring authentication. The `/submit` form is intentionally PUBLIC
// so any officer (internal or third-party) can fill it from a phone link.
export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/sites/:path*",
    "/m/:path*",
    "/dispatch/:path*",
    "/admin/:path*",
    "/api/jobs/:path*",
    "/api/sites/:path*",
    "/api/partners/:path*",
  ],
};
