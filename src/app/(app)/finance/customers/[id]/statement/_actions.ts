"use server";

import { requireAdmin } from "@/lib/authz";
import { parseIsoDate } from "@/lib/dates";
import { sendCustomerStatementEmail } from "@/lib/customerStatement";

/** Email the account statement PDF to the customer. */
export async function emailStatementAction(
  customerId: string,
  from: string,
  to: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const fromDate = parseIsoDate(from);
  const toDate = parseIsoDate(to, true);
  if (!fromDate || !toDate) return { ok: false, error: "Invalid statement period." };
  return sendCustomerStatementEmail(customerId, fromDate, toDate);
}
