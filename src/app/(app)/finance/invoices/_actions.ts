"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { parseIsoDate } from "@/lib/dates";
import {
  createInvoice,
  setInvoiceStatus,
  type InvoiceStatusValue,
} from "@/lib/invoicing";

/** Generate a draft invoice from the preview page, then open it. */
export async function createInvoiceAction(formData: FormData): Promise<void> {
  const u = await requireAdmin();
  const customerId = String(formData.get("customerId") ?? "");
  const from = parseIsoDate(String(formData.get("from") ?? ""));
  const to = parseIsoDate(String(formData.get("to") ?? ""), true);
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const backTo = `/finance/invoices/new?customerId=${encodeURIComponent(
    customerId,
  )}&from=${formData.get("from") ?? ""}&to=${formData.get("to") ?? ""}`;

  if (!customerId || !from || !to) {
    redirect(`${backTo}&error=Pick+a+customer+and+period.`);
  }

  const res = await createInvoice({ customerId, from, to, notes }, u.id);
  if (!res.ok) {
    redirect(`${backTo}&error=${encodeURIComponent(res.error)}`);
  }
  revalidatePath("/finance/invoices");
  redirect(`/finance/invoices/${res.invoiceId}`);
}

/** Move an invoice through DRAFT → SENT → PAID, or VOID it. */
export async function updateInvoiceStatus(
  id: string,
  status: InvoiceStatusValue,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const res = await setInvoiceStatus(id, status);
  revalidatePath(`/finance/invoices/${id}`);
  revalidatePath("/finance/invoices");
  return res;
}
