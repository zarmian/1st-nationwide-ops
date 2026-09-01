import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { CreditNotePdfData } from "@/lib/creditNotes";
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
  docTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", color: BLUE, textAlign: "right" },
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
  reason: { marginTop: 6, marginBottom: 14 },
  tRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingVertical: 6,
  },
  cDesc: { flex: 1 },
  cAmt: { width: 100, textAlign: "right" },
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

function CreditNoteDocument({ data }: { data: CreditNotePdfData }) {
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
            <Text style={s.docTitle}>CREDIT NOTE</Text>
            <Text style={s.docMeta}>{data.number}</Text>
            {data.status === "VOID" && <Text style={s.docMeta}>(VOID)</Text>}
          </View>
        </View>

        <View style={s.cols}>
          <View style={{ flex: 1 }}>
            <Text style={s.colTitle}>Credit to</Text>
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
            {data.invoiceNumber ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Against</Text>
                <Text>{data.invoiceNumber}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <Text style={s.colTitle}>Reason</Text>
        <Text style={s.reason}>{data.reason}</Text>

        <View style={s.tRow}>
          <Text style={s.cDesc}>
            {data.invoiceNumber
              ? `Credit against invoice ${data.invoiceNumber}`
              : "Credit"}
          </Text>
          <Text style={s.cAmt}>{money(data.subtotal, data.currency)}</Text>
        </View>

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
            <Text style={s.strong}>Total credited</Text>
            <Text style={s.grandNum}>{money(data.total, data.currency)}</Text>
          </View>
        </View>

        {data.notes ? (
          <View style={{ marginTop: 20 }}>
            <Text style={s.colTitle}>Notes</Text>
            <Text style={{ marginTop: 4 }}>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={s.footer} fixed>
          {COMPANY.vatNumber
            ? `${COMPANY.name} · VAT ${COMPANY.vatNumber}`
            : `${COMPANY.name} — add VAT number & registered address in lib/company.ts for a valid VAT credit note`}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderCreditNotePdf(data: CreditNotePdfData): Promise<Buffer> {
  return renderToBuffer(<CreditNoteDocument data={data} />);
}
