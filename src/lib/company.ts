/**
 * Supplier (our own) details for customer-facing documents — currently the
 * invoice PDF. Fill these in for a legally valid UK VAT invoice: the VAT
 * number and registered address are required by HMRC. Empty values are
 * omitted from the document rather than rendered blank.
 *
 * Kept as a constant (not a DB row) for now — promote to a settings table if
 * multiple trading entities are ever needed.
 */
export const COMPANY = {
  name: "1st Nationwide Security Services Ltd",
  /** e.g. ["12 Example Street", "London", "SW1A 1AA"] */
  addressLines: [] as string[],
  companyNumber: "",
  /** GB VAT registration number — required on a VAT invoice. */
  vatNumber: "",
  email: "",
  phone: "",
  bank: {
    name: "",
    accountName: "",
    sortCode: "",
    accountNumber: "",
  },
  /** Default payment terms, days from issue. */
  paymentTermsDays: 30,
  /** UK standard VAT rate. */
  vatRate: 0.2,
};
