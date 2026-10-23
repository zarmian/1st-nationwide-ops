"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export function VerifyButton({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");

  async function go() {
    setState("busy");
    const res = await signIn("client-link", { token, redirect: false, callbackUrl: "/client" });
    if (!res || res.error) {
      setState("failed");
      return;
    }
    router.replace("/client");
    router.refresh();
  }

  if (state === "failed") {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          That link didn&rsquo;t work. It may have expired or already been used.
        </div>
        <Link href="/login/client" className="btn-primary w-full text-center">
          Get a new link
        </Link>
      </div>
    );
  }

  return (
    <button type="button" className="btn-primary w-full" onClick={go} disabled={state === "busy"}>
      {state === "busy" ? "Signing in…" : "Sign in to the dashboard"}
    </button>
  );
}
