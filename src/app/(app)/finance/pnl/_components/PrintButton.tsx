"use client";

import { Printer } from "lucide-react";

/** Opens the browser print dialog for the current page (P&L statement). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-secondary text-sm inline-flex items-center gap-1.5"
    >
      <Printer size={14} aria-hidden="true" />
      Print
    </button>
  );
}
