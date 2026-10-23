import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { peekClientLink } from "@/lib/clientLogin";
import { VerifyButton } from "./VerifyButton";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in · 1st Nationwide", referrer: "no-referrer" };

/**
 * Public: the page an emailed sign-in link opens. It only shows a button —
 * the link is used up when the person presses it, so mail scanners that open
 * links don't spend it first.
 */
export default async function VerifyClientLinkPage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = typeof searchParams.token === "string" ? searchParams.token : "";
  const link = await peekClientLink(token);

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        <div className="card p-6">
          {link ? (
            <>
              <h1 className="text-xl font-semibold text-brand-navy mb-1">Sign in</h1>
              <p className="text-sm text-slate-500 mb-6">
                Signing in as <span className="font-medium text-slate-700 break-all">{link.email}</span>.
              </p>
              <VerifyButton token={token} />
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-brand-navy mb-1">
                This link has expired
              </h1>
              <p className="text-sm text-slate-500 mb-6">
                Sign-in links work once and only for 15 minutes. Ask for a new one.
              </p>
              <Link href="/login/client" className="btn-primary w-full text-center">
                Get a new link
              </Link>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
