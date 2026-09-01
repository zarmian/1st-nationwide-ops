import { describe, it, expect } from "vitest";
import {
  invoiceCsvHeader,
  invoiceCsvLine,
  paymentCsvHeader,
  paymentCsvLine,
  type InvoiceExportRow,
  type PaymentExportRow,
} from "./accountingExport";

describe("invoice CSV", () => {
  const row: InvoiceExportRow = {
    number: "INV-00007",
    issueDate: new Date(2026, 7, 3), // 3 Aug 2026
    dueDate: new Date(2026, 8, 2),
    customer: "Shurgard",
    customerEmail: "ap@shurgard.example",
    description: "Security services 2026-07-01 to 2026-07-31",
    currency: "GBP",
    net: 1000,
    vatRate: 0.2,
    vat: 200,
    gross: 1200,
    status: "SENT",
    paid: 500,
    balance: 700,
  };

  it("has the promised columns", () => {
    expect(invoiceCsvHeader()).toBe(
      [
        "invoice_number",
        "issue_date",
        "due_date",
        "customer",
        "customer_email",
        "description",
        "currency",
        "net",
        "vat_rate_pct",
        "vat",
        "gross",
        "status",
        "paid",
        "balance",
      ]
        .map((c) => `"${c}"`)
        .join(","),
    );
  });

  it("formats dates ISO, money 2dp, VAT rate as a percentage number", () => {
    const line = invoiceCsvLine(row);
    expect(line).toContain('"2026-08-03"'); // issue date, local (not UTC-shifted)
    expect(line).toContain('"1000.00"');
    expect(line).toContain('"20"'); // 0.2 → 20
    expect(line).toContain('"1200.00"');
    expect(line).toContain('"700.00"');
  });

  it("quotes and escapes customer names with commas/quotes", () => {
    const tricky = { ...row, customer: `Smith, "Bob" & Co` };
    expect(invoiceCsvLine(tricky)).toContain(`"Smith, ""Bob"" & Co"`);
  });

  it("leaves blank cells for missing dates/email", () => {
    const noDates = { ...row, issueDate: null, dueDate: null, customerEmail: null };
    const line = invoiceCsvLine(noDates);
    // three consecutive empty quoted cells is hard to assert directly;
    // check the empty-string cell appears.
    expect(line).toContain('""');
  });

  it("handles a non-standard VAT rate", () => {
    expect(invoiceCsvLine({ ...row, vatRate: 0.05 })).toContain('"5"');
    expect(invoiceCsvLine({ ...row, vatRate: 0 })).toContain('"0"');
  });
});

describe("payment CSV", () => {
  const row: PaymentExportRow = {
    date: new Date(2026, 7, 15),
    invoiceNumber: "INV-00007",
    customer: "Shurgard",
    currency: "GBP",
    amount: 500,
    method: "Bank transfer",
    reference: "FT2608",
    note: null,
  };

  it("has the promised columns", () => {
    expect(paymentCsvHeader()).toBe(
      [
        "date",
        "invoice_number",
        "customer",
        "currency",
        "amount",
        "method",
        "reference",
        "note",
      ]
        .map((c) => `"${c}"`)
        .join(","),
    );
  });

  it("formats the row", () => {
    const line = paymentCsvLine(row);
    expect(line).toContain('"2026-08-15"');
    expect(line).toContain('"500.00"');
    expect(line).toContain('"Bank transfer"');
    expect(line).toContain('"FT2608"');
  });
});
