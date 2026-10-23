import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { ClientLinkForm } from "./ClientLinkForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Client sign-in · 1st Nationwide" };

/** Public: where clients sign in to their dashboard — no password, just a
 *  one-time link emailed to their work address (lib/clientLogin.ts). */
export default function ClientSignInPage({
  searchParams,
}: {
  searchParams: { off?: string };
}) {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-semibold text-brand-navy mb-1">
            Client dashboard
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            Enter your work email and we&rsquo;ll send you a link to sign in. No password needed.
          </p>
          {searchParams.off === "1" && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              Your access to the dashboard has been turned off. Please contact 1st Nationwide.
            </div>
          )}
          <ClientLinkForm />
        </div>
        <p className="mt-6 text-center text-xs text-slate-400">
          1st Nationwide Security Services ·{" "}
          <Link href="/login" className="underline underline-offset-2 hover:text-slate-600">
            Staff sign-in
          </Link>
        </p>
      </div>
    </main>
  );
}
