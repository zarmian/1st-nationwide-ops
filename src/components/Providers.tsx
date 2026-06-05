"use client";

import { SessionProvider } from "next-auth/react";
import { ToastProvider } from "./Toast";
import { ConfirmProvider } from "./Confirm";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </SessionProvider>
  );
}
