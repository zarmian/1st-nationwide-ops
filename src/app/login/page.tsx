import { Suspense } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <BrandLogo />
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

        <p className="mt-6 text-center text-xs text-slate-400">
          1st Nationwide Security Services
        </p>
      </div>
    </main>
  );
}
