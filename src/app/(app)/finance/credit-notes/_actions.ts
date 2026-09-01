"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/authz";
import { createCreditNote, voidCreditNote } from "@/lib/creditNotes";

/** Create a credit note from the new-credit-note form, then open it. */
export async function createCreditNoteAction(formData: FormData): Promise<void> {
  const u = await requireAdmin();
  const customerId = String(formData.get("customerId") ?? "");
  const invoiceId = String(formData.get("invoiceId") ?? "").trim() || null;
  const net = Number(formData.get("net") ?? NaN);
  const vatRate = Number(formData.get("vatRate") ?? 0.2);
  const reason = String(formData.get("reason") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const back = `/finance/credit-notes/new?customerId=${encodeURIComponent(customerId)}${
    invoiceId ? `&invoiceId=${encodeURIComponent(invoiceId)}` : ""
  }`;

  if (!customerId) {
    redirect(`${back}&error=Pick+a+customer.`);
  }

  const res = await createCreditNote(
    { customerId, invoiceId, net, vatRate, reason, notes },
    u.id,
  );
  if (!res.ok) {
    redirect(`${back}&error=${encodeURIComponent(res.error)}`);
  }
  revalidatePath("/finance/credit-notes");
  revalidatePath("/finance/receivables");
  redirect(`/finance/credit-notes/${res.id}`);
}

/** Void a credit note (reverses its effect everywhere). */
export async function voidCreditNoteAction(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const res = await voidCreditNote(id);
  revalidatePath(`/finance/credit-notes/${id}`);
  revalidatePath("/finance/credit-notes");
  revalidatePath("/finance/receivables");
  return res;
}
