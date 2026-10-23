import { Suspense } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        <div className="card p-6">
          <h1 className="text-xl font-semibold text-brand-navy mb-1">
            Sign in
          </h1>
          <p className="text-sm text-slate-500 mb-6">
            Use your work email and password.
          </p>

          <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-4 text-center text-sm text-slate-500">
          A client?{" "}
          <Link
            href="/login/client"
            className="font-medium text-brand-navy underline underline-offset-2 hover:text-brand-blue-dark"
          >
            Sign in with your work email
          </Link>
        </p>

        <p className="mt-6 text-center text-xs text-slate-400">
          1st Nationwide Security Services
        </p>
      </div>
    </main>
  );
}
