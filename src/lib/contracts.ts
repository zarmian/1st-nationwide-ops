/**
 * Customer service agreements (contracts) + renewal tracking.
 *
 * A Contract records the commercial deal — the recurring value, its cadence,
 * the term, and the renewal (end) date. It drives the annual-contract-value
 * total and the "renewing soon" reminders. It's independent of RecurringCharge
 * (which actually bills); a contract is the agreement behind the billing.
 */
import { prisma } from "@/lib/db";
import type { ContractCadence, ContractStatus } from "@prisma/client";
import { type HiddenScope, customerHiddenAnd } from "@/lib/hiddenAccounts";

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const CADENCE_LABEL: Record<ContractCadence, string> = {
  MONTHLY: "per month",
  QUARTERLY: "per quarter",
  ANNUAL: "per year",
};

/** Contract value scaled to a full year, for the ACV total. */
export function annualise(value: number, cadence: ContractCadence): number {
  const multiplier = cadence === "MONTHLY" ? 12 : cadence === "QUARTERLY" ? 4 : 1;
  return round2(value * multiplier);
}

export type ContractRow = {
  id: string;
  customerId: string;
  customerName: string;
  title: string;
  value: number;
  cadence: ContractCadence;
  annualised: number;
  startDate: Date;
  endDate: Date | null;
  status: ContractStatus;
  /** Whole days until the end date; negative = already past. Null = open-ended. */
  daysUntilRenewal: number | null;
  renewingSoon: boolean;
  notes: string | null;
};

export type ContractsSummary = {
  rows: ContractRow[];
  activeCount: number;
  annualisedValue: number;
  renewingSoon: ContractRow[];
  renewingSoonCount: number;
};

function toRow(
  c: {
    id: string;
    customerId: string;
    customer: { name: string };
    title: string;
    value: unknown;
    cadence: ContractCadence;
    startDate: Date;
    endDate: Date | null;
    noticeDays: number | null;
    status: ContractStatus;
    notes: string | null;
  },
  asOf: Date,
): ContractRow {
  const value = Number(c.value);
  const daysUntilRenewal = c.endDate
    ? Math.floor((c.endDate.getTime() - asOf.getTime()) / DAY_MS)
    : null;
  const notice = c.noticeDays ?? 60;
  const renewingSoon =
    c.status === "ACTIVE" &&
    daysUntilRenewal != null &&
    daysUntilRenewal <= notice;
  return {
    id: c.id,
    customerId: c.customerId,
    customerName: c.customer.name,
    title: c.title,
    value,
    cadence: c.cadence,
    annualised: annualise(value, c.cadence),
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    daysUntilRenewal,
    renewingSoon,
    notes: c.notes,
  };
}

export async function loadContracts(
  asOf: Date = new Date(),
  hidden?: HiddenScope,
): Promise<ContractsSummary> {
  const contracts = await prisma.contract.findMany({
    where: { AND: customerHiddenAnd(hidden) },
    include: { customer: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { endDate: "asc" }],
  });
  const rows = contracts.map((c) => toRow(c, asOf));
  const active = rows.filter((r) => r.status === "ACTIVE");
  const renewingSoon = active
    .filter((r) => r.renewingSoon)
    .sort((a, b) => (a.daysUntilRenewal ?? 0) - (b.daysUntilRenewal ?? 0));

  return {
    rows,
    activeCount: active.length,
    annualisedValue: round2(active.reduce((n, r) => n + r.annualised, 0)),
    renewingSoon,
    renewingSoonCount: renewingSoon.length,
  };
}

/** Active contracts whose end date is within `withinDays` (or already past). */
export async function contractsDueForRenewal(
  withinDays: number,
  asOf: Date = new Date(),
): Promise<ContractRow[]> {
  const horizon = new Date(asOf.getTime() + withinDays * DAY_MS);
  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { not: null, lte: horizon } },
    include: { customer: { select: { name: true } } },
    orderBy: { endDate: "asc" },
  });
  return contracts.map((c) => toRow(c, asOf));
}
