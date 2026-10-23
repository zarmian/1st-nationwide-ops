"use server";

import { headers } from "next/headers";
import { checkLimit, clientLinkLimiter } from "@/lib/ratelimit";
import { normaliseEmail, requestClientLink } from "@/lib/clientLogin";

export type ClientLinkState = { sentTo?: string; error?: string };

/** Ask for a sign-in link. Answers the same whether or not the address may
 *  sign in, so the page never reveals who can. */
export async function requestLink(
  _prev: ClientLinkState,
  formData: FormData,
): Promise<ClientLinkState> {
  const email = normaliseEmail(String(formData.get("email") ?? ""));
  if (!email) return { error: "Enter your work email address." };

  const h = headers();
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "anon").split(",")[0].trim();
  const limit = await checkLimit(clientLinkLimiter, ip);
  if (!limit.allowed) {
    return { error: "Too many requests from here. Please wait a few minutes and try again." };
  }

  try {
    await requestClientLink(email);
  } catch (e) {
    console.error("Client sign-in link request failed:", (e as Error)?.name ?? "error");
  }
  return { sentTo: email };
}
