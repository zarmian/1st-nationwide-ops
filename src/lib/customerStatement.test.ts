import { describe, it, expect } from "vitest";
import { runningBalance, type StatementTxn } from "./customerStatement";

const txn = (
  type: StatementTxn["type"],
  amount: number,
  ref = "X",
): StatementTxn => ({
  date: new Date(2026, 7, 1),
  type,
  ref,
  description: ref,
  amount,
});

describe("runningBalance", () => {
  it("folds a signed running balance from the opening", () => {
    const lines = runningBalance(100, [
      txn("INVOICE", 200),
      txn("PAYMENT", -150),
      txn("CREDIT_NOTE", -50),
    ]);
    expect(lines.map((l) => l.balance)).toEqual([300, 150, 100]);
  });

  it("returns [] for no transactions", () => {
    expect(runningBalance(0, [])).toEqual([]);
  });

  it("rounds each step to 2dp (no float drift)", () => {
    const lines = runningBalance(0, [
      txn("INVOICE", 0.1),
      txn("INVOICE", 0.2),
    ]);
    expect(lines[1].balance).toBe(0.3);
  });

  it("can go negative when payments/credits exceed invoices (customer in credit)", () => {
    const lines = runningBalance(0, [txn("INVOICE", 100), txn("PAYMENT", -150)]);
    expect(lines[1].balance).toBe(-50);
  });
});
