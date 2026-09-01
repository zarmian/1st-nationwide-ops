"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { parseIsoDate } from "@/lib/dates";
import {
  createInvoice,
  setInvoiceStatus,
  recordPayment,
  deletePayment,
  sendInvoiceEmail,
  type InvoiceStatusValue,
} from "@/lib/invoicing";
import { sendManualReminder } from "@/lib/reminders";

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
  revalidatePath("/finance/receivables");
  return res;
}

/** Record a payment (or part payment) against an invoice. */
export async function recordPaymentAction(
  invoiceId: string,
  input: {
    amount: number;
    paidOn: string;
    method?: string | null;
    reference?: string | null;
    notes?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const u = await requireAdmin();
  const paidOn = parseIsoDate(input.paidOn);
  if (!paidOn) return { ok: false, error: "Pick the date the payment was received." };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Enter a payment amount greater than zero." };
  }
  const res = await recordPayment(
    invoiceId,
    {
      amount: input.amount,
      paidOn,
      method: input.method?.trim() || null,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
    },
    u.id,
  );
  revalidatePath(`/finance/invoices/${invoiceId}`);
  revalidatePath("/finance/invoices");
  revalidatePath("/finance/receivables");
  return res;
}

/** Delete a payment (correcting a mistake). */
export async function deletePaymentAction(
  paymentId: string,
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const res = await deletePayment(paymentId);
  revalidatePath(`/finance/invoices/${invoiceId}`);
  revalidatePath("/finance/invoices");
  revalidatePath("/finance/receivables");
  return res;
}

/** Email the invoice PDF to the customer's contact email. */
export async function sendInvoiceEmailAction(
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const res = await sendInvoiceEmail(invoiceId);
  revalidatePath(`/finance/invoices/${invoiceId}`);
  revalidatePath("/finance/invoices");
  revalidatePath("/finance/receivables");
  return res;
}

/** Manually email an overdue reminder for this invoice now. */
export async function sendReminderAction(
  invoiceId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const res = await sendManualReminder(invoiceId);
  revalidatePath(`/finance/invoices/${invoiceId}`);
  revalidatePath("/finance/receivables");
  return res;
}
