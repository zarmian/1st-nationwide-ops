/**
 * Client dashboard sign-in by one-time emailed link — no passwords.
 *
 *   1. Someone types their work email at /login/client.
 *   2. If its domain is on a customer's `portalEmailDomains` (exact match),
 *      we email a link that works once and expires after 15 minutes. Only the
 *      SHA-256 of the token is stored.
 *   3. The link opens /login/client/verify, which shows a "Sign in" button —
 *      a button, not an automatic sign-in, so mail scanners that open links
 *      don't use them up. The button signs in through the "client-link"
 *      NextAuth provider (auth.ts), which calls consumeClientLink().
 *   4. The first time, a CUSTOMER user is made for that email. Blocked users
 *      (active = false) and staff emails never get a link.
 *
 * The request page always answers the same way, so it never reveals which
 * addresses can sign in.
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { newPublicToken } from "@/lib/tokens";
import { isEmailConfigured, sendEmail } from "@/lib/email";

export const LINK_TTL_MIN = 15;
/** At most this many links per email address per window… */
const LINKS_PER_WINDOW = 3;
/** …and per customer, so made-up addresses can't flood their inboxes even
 *  where the per-IP limiter (Upstash) isn't set up. */
const CUSTOMER_LINKS_PER_WINDOW = 30;
const WINDOW_MIN = 15;

// ── Pure helpers (unit-tested) ────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** Trimmed, lower-cased email, or null when it isn't one. */
export function normaliseEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  return e;
}

/** The part after the @, lower case. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** Whether the email's domain is exactly one of the allowed domains — a
 *  look-alike such as shurgard.co.uk.example.com doesn't count. */
export function isAllowedDomain(email: string, domains: string[]): boolean {
  const d = emailDomain(email);
  return domains.some((x) => x.toLowerCase() === d);
}

/** "shurgard.co.uk, @shurgard.com" → ["shurgard.co.uk", "shurgard.com"],
 *  plus anything that isn't a domain. */
export function parseDomains(input: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) invalid.push(raw.trim());
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, invalid };
}

/** "john.smith-jones@x" → "John Smith-Jones": a starting name for a new
 *  client user. */
export function nameFromEmail(email: string): string {
  const local = email.slice(0, email.indexOf("@")).replace(/\+.*$/, "");
  const words = local
    .split(/[._]+/)
    .filter(Boolean)
    .map((w) =>
      w
        .split("-")
        .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
        .join("-"),
    );
  return words.join(" ") || email;
}

export function hashLinkToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Absolute URL on this app, from NEXTAUTH_URL (the live origin in Vercel). */
export function appUrl(path: string): string {
  const fromEnv =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  return `${fromEnv.replace(/\/$/, "")}${path}`;
}

/** Where to send clients: the page that asks for their email. */
export function clientLoginUrl(): string {
  return appUrl("/login/client");
}

export function clientLinkEmail(link: string, customerName: string) {
  const subject = `Your sign-in link for the ${customerName} security dashboard`;
  const text = [
    `Sign in to the ${customerName} security dashboard from 1st Nationwide:`,
    "",
    link,
    "",
    `The link works once and expires in ${LINK_TTL_MIN} minutes.`,
    "If you didn't ask for it, you can ignore this email.",
  ].join("\n");
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0F1929">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:13px;color:#64748b">1st Nationwide Security Services</p>
    <h1 style="margin:0 0 16px;font-size:20px">Sign in to the ${escapeHtml(customerName)} security dashboard</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Use the button below to sign in. It works once and expires in ${LINK_TTL_MIN} minutes.</p>
    <p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2FCB80;color:#0F1929;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Sign in</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#64748b">Or paste this link into your browser:</p>
    <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${escapeHtml(link)}" style="color:#0F1929">${escapeHtml(link)}</a></p>
    <p style="margin:0;font-size:13px;color:#64748b">If you didn't ask for this, you can ignore this email.</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Database ──────────────────────────────────────────────────────────────

/** The active customer whose sign-in domains include this email's domain. */
async function customerForEmail(email: string) {
  return prisma.customer.findFirst({
    where: { active: true, portalEmailDomains: { has: emailDomain(email) } },
    select: { id: true, name: true, portalEmailDomains: true },
  });
}

/**
 * Email a sign-in link if this address may use a client dashboard. Returns
 * nothing either way — the caller shows the same message regardless.
 */
export async function requestClientLink(rawEmail: string): Promise<void> {
  const email = normaliseEmail(rawEmail);
  if (!email) return;
  const customer = await customerForEmail(email);
  if (!customer || !isAllowedDomain(email, customer.portalEmailDomains)) return;

  // A staff login, another client's login, or a blocked one: no link.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { role: true, customerId: true, active: true },
  });
  if (
    existing &&
    (existing.role !== "CUSTOMER" || existing.customerId !== customer.id || !existing.active)
  ) {
    return;
  }

  const since = new Date(Date.now() - WINDOW_MIN * 60_000);
  const [forEmail, forCustomer] = await Promise.all([
    prisma.clientLoginLink.count({ where: { email, createdAt: { gte: since } } }),
    prisma.clientLoginLink.count({ where: { customerId: customer.id, createdAt: { gte: since } } }),
  ]);
  if (forEmail >= LINKS_PER_WINDOW) return;
  if (forCustomer >= CUSTOMER_LINKS_PER_WINDOW) {
    console.warn("Client sign-in links paused for a customer: too many in 15 minutes.");
    return;
  }

  const token = newPublicToken();
  await prisma.clientLoginLink.create({
    data: {
      tokenHash: hashLinkToken(token),
      email,
      customerId: customer.id,
      expiresAt: new Date(Date.now() + LINK_TTL_MIN * 60_000),
    },
  });

  const link = appUrl(`/login/client/verify?token=${encodeURIComponent(token)}`);
  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      // Local development only — there's no email service to send it.
      console.log(`[client sign-in] email not configured; link: ${link}`);
    } else {
      console.error("Client sign-in link not sent: email isn't configured (RESEND_API_KEY).");
    }
    return;
  }
  const mail = clientLinkEmail(link, customer.name);
  const sent = await sendEmail({ to: email, ...mail });
  if (!sent.ok) console.error("Client sign-in link email failed:", sent.error);
}

/** The email a link was sent to, while the link is still usable. Doesn't
 *  use it up. */
export async function peekClientLink(token: string): Promise<{ email: string } | null> {
  if (!token) return null;
  const link = await prisma.clientLoginLink.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    select: { email: true, usedAt: true, expiresAt: true },
  });
  if (!link || link.usedAt || link.expiresAt <= new Date()) return null;
  return { email: link.email };
}

export type ClientLinkUser = {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER";
  partnerId: null;
  customerId: string;
};

/**
 * Use a sign-in link (once) and return the client user to sign in as —
 * making the user the first time. Null when the link is unknown, used,
 * expired, or the address may no longer sign in.
 */
export async function consumeClientLink(token: string): Promise<ClientLinkUser | null> {
  if (!token) return null;
  const tokenHash = hashLinkToken(token);
  const now = new Date();
  const used = await prisma.clientLoginLink.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (used.count !== 1) return null;

  const link = await prisma.clientLoginLink.findUnique({
    where: { tokenHash },
    select: {
      email: true,
      customer: { select: { id: true, active: true, portalEmailDomains: true } },
    },
  });
  if (!link) return null;
  const { customer } = link;
  const email = link.email.toLowerCase();
  if (!customer.active || !isAllowedDomain(email, customer.portalEmailDomains)) return null;

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, role: true, customerId: true, active: true },
  });
  if (existing) {
    if (existing.role !== "CUSTOMER" || existing.customerId !== customer.id || !existing.active) {
      return null;
    }
    await prisma.user.update({ where: { id: existing.id }, data: { lastLoginAt: now } });
    return {
      id: existing.id,
      email,
      name: existing.name,
      role: "CUSTOMER",
      partnerId: null,
      customerId: customer.id,
    };
  }

  const created = await prisma.user.create({
    data: {
      email,
      name: nameFromEmail(email),
      role: "CUSTOMER",
      customerId: customer.id,
      lastLoginAt: now,
    },
    select: { id: true, name: true },
  });
  return {
    id: created.id,
    email,
    name: created.name,
    role: "CUSTOMER",
    partnerId: null,
    customerId: customer.id,
  };
}
