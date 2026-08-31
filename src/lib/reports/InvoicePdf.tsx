import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { InvoicePdfData } from "./invoiceReport";
import { COMPANY } from "@/lib/company";

const NAVY = "#0F1929";
const BLUE = "#2563EB";
const SLATE = "#475569";
const LINE = "#E2E8F0";

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 10,
    color: NAVY,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
    paddingBottom: 10,
    marginBottom: 18,
  },
  brand: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY },
  small: { fontSize: 8, color: SLATE, marginTop: 2 },
  docTitle: { fontSize: 20, fontFamily: "Helvetica-Bold", color: BLUE, textAlign: "right" },
  docMeta: { fontSize: 9, color: SLATE, marginTop: 3, textAlign: "right" },
  cols: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  colTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  strong: { fontFamily: "Helvetica-Bold", color: NAVY },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaLabel: { color: SLATE, width: 70 },
  tHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 5,
    marginBottom: 2,
  },
  tRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingVertical: 6,
  },
  cDesc: { flex: 1 },
  cQty: { width: 44, textAlign: "right" },
  cUnit: { width: 80, textAlign: "right" },
  cAmt: { width: 90, textAlign: "right" },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: SLATE, textTransform: "uppercase", letterSpacing: 1 },
  totals: { marginTop: 12, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 240, justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: SLATE },
  grand: {
    flexDirection: "row",
    width: 240,
    justifyContent: "space-between",
    paddingVertical: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: NAVY,
  },
  grandNum: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY },
  pay: { marginTop: 26, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10 },
  footer: { position: "absolute", bottom: 24, left: 44, right: 44, fontSize: 7, color: SLATE, textAlign: "center" },
});

function money(n: number, currency = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}
function d(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const supplierLines = [
    ...COMPANY.addressLines,
    COMPANY.companyNumber ? `Company no. ${COMPANY.companyNumber}` : "",
    COMPANY.vatNumber ? `VAT no. ${COMPANY.vatNumber}` : "",
    [COMPANY.email, COMPANY.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);

  const billTo = [
    data.customer.contactName,
    data.customer.billingAddress,
    data.customer.contactEmail,
  ].filter(Boolean);

  const bank = COMPANY.bank;
  const hasBank = Boolean(bank.accountNumber || bank.sortCode);

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.brand}>{COMPANY.name}</Text>
            {supplierLines.map((l, i) => (
              <Text key={i} style={s.small}>
                {l}
              </Text>
            ))}
          </View>
          <View>
            <Text style={s.docTitle}>INVOICE</Text>
            <Text style={s.docMeta}>{data.number}</Text>
            {data.status !== "SENT" && data.status !== "PAID" && (
              <Text style={s.docMeta}>({data.status})</Text>
            )}
          </View>
        </View>

        <View style={s.cols}>
          <View style={{ flex: 1 }}>
            <Text style={s.colTitle}>Bill to</Text>
            <Text style={s.strong}>{data.customer.name}</Text>
            {billTo.map((l, i) => (
              <Text key={i} style={{ marginTop: 2 }}>
                {l}
              </Text>
            ))}
          </View>
          <View style={{ width: 210 }}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Issued</Text>
              <Text>{d(data.issuedAt)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Due</Text>
              <Text>{d(data.dueAt)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Period</Text>
              <Text>
                {d(data.periodFrom)} – {d(data.periodTo)}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.tHead}>
          <Text style={[s.cDesc, s.th]}>Description</Text>
          <Text style={[s.cQty, s.th]}>Qty</Text>
          <Text style={[s.cUnit, s.th]}>Unit</Text>
          <Text style={[s.cAmt, s.th]}>Amount</Text>
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={s.tRow}>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={s.cQty}>{l.quantity}</Text>
            <Text style={s.cUnit}>{money(l.unitAmount, data.currency)}</Text>
            <Text style={s.cAmt}>{money(l.amount, data.currency)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text>{money(data.subtotal, data.currency)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>
              VAT ({Math.round(data.vatRate * 100)}%)
            </Text>
            <Text>{money(data.vatAmount, data.currency)}</Text>
          </View>
          <View style={s.grand}>
            <Text style={s.strong}>Total due</Text>
            <Text style={s.grandNum}>{money(data.total, data.currency)}</Text>
          </View>
        </View>

        {(hasBank || Boolean(data.notes)) && (
          <View style={s.pay}>
            {hasBank && (
              <>
                <Text style={s.colTitle}>Payment</Text>
                <Text>
                  {[bank.name, bank.accountName].filter(Boolean).join(" · ")}
                </Text>
                <Text style={s.small}>
                  {[
                    bank.sortCode ? `Sort code ${bank.sortCode}` : "",
                    bank.accountNumber ? `Account ${bank.accountNumber}` : "",
                  ]
                    .filter(Boolean)
                    .join("  ")}
                </Text>
              </>
            )}
            {data.notes && (
              <Text style={{ marginTop: hasBank ? 8 : 0 }}>{data.notes}</Text>
            )}
          </View>
        )}

        <Text style={s.footer} fixed>
          {COMPANY.vatNumber
            ? `${COMPANY.name} · VAT ${COMPANY.vatNumber}`
            : `${COMPANY.name} — add VAT number & registered address in lib/company.ts for a valid VAT invoice`}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
