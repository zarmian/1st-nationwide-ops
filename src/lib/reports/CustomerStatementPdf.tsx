import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { CustomerStatement } from "@/lib/customerStatement";
import { COMPANY } from "@/lib/company";

const NAVY = "#0F1929";
const BLUE = "#2563EB";
const SLATE = "#475569";
const LINE = "#E2E8F0";
const RED = "#DC2626";

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
  cols: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  colTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  strong: { fontFamily: "Helvetica-Bold", color: NAVY },
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
    paddingVertical: 5,
  },
  cDate: { width: 66 },
  cDesc: { flex: 1 },
  cNum: { width: 78, textAlign: "right" },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: SLATE, textTransform: "uppercase", letterSpacing: 1 },
  openRow: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: LINE },
  totals: { marginTop: 14, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 260, justifyContent: "space-between", paddingVertical: 3 },
  totalLabel: { color: SLATE },
  grand: {
    flexDirection: "row",
    width: 260,
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
function d(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(date);
}

function StatementDocument({ data }: { data: CustomerStatement }) {
  const supplierLines = [
    ...COMPANY.addressLines,
    COMPANY.vatNumber ? `VAT no. ${COMPANY.vatNumber}` : "",
    [COMPANY.email, COMPANY.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);

  const to = [data.customer.contactName, data.customer.billingAddress].filter(Boolean);
  const c = data.currency;

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
            <Text style={s.docTitle}>STATEMENT</Text>
            <Text style={s.docMeta}>
              {d(data.from)} – {d(data.to)}
            </Text>
          </View>
        </View>

        <View style={s.cols}>
          <View style={{ flex: 1 }}>
            <Text style={s.colTitle}>Account</Text>
            <Text style={s.strong}>{data.customer.name}</Text>
            {to.map((l, i) => (
              <Text key={i} style={{ marginTop: 2 }}>
                {l}
              </Text>
            ))}
          </View>
          <View style={{ width: 200 }}>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Opening balance</Text>
              <Text>{money(data.openingBalance, c)}</Text>
            </View>
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Closing balance</Text>
              <Text style={s.strong}>{money(data.closingBalance, c)}</Text>
            </View>
          </View>
        </View>

        <View style={s.tHead}>
          <Text style={[s.cDate, s.th]}>Date</Text>
          <Text style={[s.cDesc, s.th]}>Detail</Text>
          <Text style={[s.cNum, s.th]}>Amount</Text>
          <Text style={[s.cNum, s.th]}>Balance</Text>
        </View>

        <View style={s.openRow}>
          <Text style={s.cDate}></Text>
          <Text style={[s.cDesc, { color: SLATE }]}>Opening balance</Text>
          <Text style={s.cNum}></Text>
          <Text style={s.cNum}>{money(data.openingBalance, c)}</Text>
        </View>

        {data.lines.map((l, i) => (
          <View key={i} style={s.tRow}>
            <Text style={s.cDate}>{d(l.date)}</Text>
            <Text style={s.cDesc}>{l.description}</Text>
            <Text style={[s.cNum, l.amount < 0 ? { color: RED } : {}]}>
              {money(l.amount, c)}
            </Text>
            <Text style={s.cNum}>{money(l.balance, c)}</Text>
          </View>
        ))}
        {data.lines.length === 0 ? (
          <View style={s.tRow}>
            <Text style={[s.cDesc, { color: SLATE }]}>
              No activity in this period.
            </Text>
          </View>
        ) : null}

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Invoiced</Text>
            <Text>{money(data.totalInvoiced, c)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Payments received</Text>
            <Text>{money(data.totalPaid, c)}</Text>
          </View>
          {data.totalCredited > 0 ? (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Credited</Text>
              <Text>{money(data.totalCredited, c)}</Text>
            </View>
          ) : null}
          <View style={s.grand}>
            <Text style={s.strong}>Balance due</Text>
            <Text style={s.grandNum}>{money(data.closingBalance, c)}</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {COMPANY.name}
          {COMPANY.vatNumber ? ` · VAT ${COMPANY.vatNumber}` : ""} · Statement as
          at {d(data.to)}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderCustomerStatementPdf(
  data: CustomerStatement,
): Promise<Buffer> {
  return renderToBuffer(<StatementDocument data={data} />);
}
