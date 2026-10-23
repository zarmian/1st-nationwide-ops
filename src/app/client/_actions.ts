"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/authz";
import { CLIENT_PREVIEW_COOKIE, isUuid } from "@/lib/clientPreview";

/** End an admin's preview of a client dashboard and go back to that
 *  customer's admin page. */
export async function exitClientPreview(): Promise<void> {
  await requireAdmin();
  const id = cookies().get(CLIENT_PREVIEW_COOKIE)?.value ?? "";
  cookies().delete(CLIENT_PREVIEW_COOKIE);
  redirect(isUuid(id) ? `/admin/customers/${id}/edit` : "/admin");
}
