import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { Payslip } from "@/lib/payslip";
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
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 4,
  },
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

function PayslipDocument({ data }: { data: Payslip }) {
  const supplierLines = [
    ...COMPANY.addressLines,
    COMPANY.companyNumber ? `Company no. ${COMPANY.companyNumber}` : "",
    [COMPANY.email, COMPANY.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);

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
            <Text style={s.docTitle}>PAYSLIP</Text>
            <Text style={s.docMeta}>
              {d(data.from)} – {d(data.to)}
            </Text>
          </View>
        </View>

        <View style={s.cols}>
          <View style={{ flex: 1 }}>
            <Text style={s.colTitle}>Employee</Text>
            <Text style={s.strong}>{data.officer.name}</Text>
            <Text style={{ marginTop: 2 }}>{data.officer.role}</Text>
            {data.officer.siaNumber ? (
              <Text style={s.small}>SIA {data.officer.siaNumber}</Text>
            ) : null}
            {data.officer.email ? (
              <Text style={s.small}>{data.officer.email}</Text>
            ) : null}
          </View>
          <View style={{ width: 210 }}>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Period</Text>
              <Text>
                {d(data.from)} – {d(data.to)}
              </Text>
            </View>
            {data.retainer ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Retainer</Text>
                <Text>
                  {money(data.retainer.monthly, c)} × {data.retainer.months}{" "}
                  {data.retainer.months === 1 ? "month" : "months"}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <Text style={s.sectionTitle}>Earnings</Text>
        <View style={s.tHead}>
          <Text style={[s.cDesc, s.th]}>Description</Text>
          <Text style={[s.cQty, s.th]}>Qty</Text>
          <Text style={[s.cAmt, s.th]}>Amount</Text>
        </View>
        {data.retainer ? (
          <View style={s.tRow}>
            <Text style={s.cDesc}>Monthly retainer</Text>
            <Text style={s.cQty}>{data.retainer.months}</Text>
            <Text style={s.cAmt}>{money(data.retainer.amount, c)}</Text>
          </View>
        ) : null}
        {data.earnings.map((e, i) => (
          <View key={i} style={s.tRow}>
            <Text style={s.cDesc}>{e.service}</Text>
            <Text style={s.cQty}>{e.count}</Text>
            <Text style={s.cAmt}>{money(e.amount, c)}</Text>
          </View>
        ))}
        {!data.retainer && data.earnings.length === 0 ? (
          <View style={s.tRow}>
            <Text style={s.cDesc}>No activity pay in this period</Text>
            <Text style={s.cQty}>0</Text>
            <Text style={s.cAmt}>{money(0, c)}</Text>
          </View>
        ) : null}

        {data.adjustments.length > 0 ? (
          <>
            <Text style={s.sectionTitle}>Adjustments</Text>
            <View style={s.tHead}>
              <Text style={[s.cDesc, s.th]}>Description</Text>
              <Text style={[s.cQty, s.th]}>Date</Text>
              <Text style={[s.cAmt, s.th]}>Amount</Text>
            </View>
            {data.adjustments.map((a) => (
              <View key={a.id} style={s.tRow}>
                <Text style={s.cDesc}>
                  {a.label}
                  {a.kind ? ` (${a.kind})` : ""}
                </Text>
                <Text style={[s.cQty, { width: 70 }]}>{d(a.date)}</Text>
                <Text style={[s.cAmt, a.amount < 0 ? { color: RED } : {}]}>
                  {money(a.amount, c)}
                </Text>
              </View>
            ))}
          </>
        ) : null}

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Gross pay</Text>
            <Text>{money(data.gross, c)}</Text>
          </View>
          {data.adjustments.length > 0 ? (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Adjustments</Text>
              <Text style={data.adjustmentsTotal < 0 ? { color: RED } : {}}>
                {money(data.adjustmentsTotal, c)}
              </Text>
            </View>
          ) : null}
          <View style={s.grand}>
            <Text style={s.strong}>Net pay</Text>
            <Text style={s.grandNum}>{money(data.net, c)}</Text>
          </View>
        </View>

        <Text style={s.footer} fixed>
          {COMPANY.name}
          {"  "}·{"  "}This payslip is generated for internal record. Pay is
          before any statutory PAYE/NI deductions unless shown as an adjustment.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPayslipPdf(data: Payslip): Promise<Buffer> {
  return renderToBuffer(<PayslipDocument data={data} />);
}
