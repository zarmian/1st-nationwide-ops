import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { PartnerStatement, StatementSide } from "@/lib/partnerStatement";
import { COMPANY } from "@/lib/company";

const NAVY = "#0F1929";
const BLUE = "#2563EB";
const SLATE = "#475569";
const LINE = "#E2E8F0";
const GREEN = "#16A34A";
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
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingVertical: 5,
  },
  cDesc: { flex: 1 },
  cQty: { width: 40, textAlign: "right" },
  cAmt: { width: 90, textAlign: "right" },
  th: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  totalRow: {
    flexDirection: "row",
    paddingTop: 6,
    marginTop: 2,
  },
  strong: { fontFamily: "Helvetica-Bold", color: NAVY },
  net: {
    marginTop: 8,
    borderTopWidth: 2,
    borderTopColor: NAVY,
    paddingTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  netNum: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    fontSize: 7,
    color: SLATE,
    textAlign: "center",
  },
});

function money(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(n);
}
function d(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function Side({ title, side }: { title: string; side: StatementSide }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.row}>
        <Text style={[s.cDesc, s.th]}>Service</Text>
        <Text style={[s.cQty, s.th]}>Qty</Text>
        <Text style={[s.cAmt, s.th]}>Amount</Text>
      </View>
      {side.lines.length === 0 ? (
        <View style={s.row}>
          <Text style={[s.cDesc, { color: SLATE }]}>Nothing in this period.</Text>
        </View>
      ) : (
        side.lines.map((l, i) => (
          <View key={i} style={s.row}>
            <Text style={s.cDesc}>{l.service}</Text>
            <Text style={s.cQty}>{l.quantity}</Text>
            <Text style={s.cAmt}>{money(l.amount)}</Text>
          </View>
        ))
      )}
      <View style={s.totalRow}>
        <Text style={[s.cDesc, s.strong]}>Total</Text>
        <Text style={s.cQty}>{side.count}</Text>
        <Text style={[s.cAmt, s.strong]}>{money(side.total)}</Text>
      </View>
    </View>
  );
}

function StatementDocument({ data }: { data: PartnerStatement }) {
  const supplierLines = [
    ...COMPANY.addressLines,
    COMPANY.vatNumber ? `VAT no. ${COMPANY.vatNumber}` : "",
    [COMPANY.email, COMPANY.phone].filter(Boolean).join(" · "),
  ].filter(Boolean);

  const netLabel =
    data.net > 0
      ? `${data.partnerName} owes us`
      : data.net < 0
        ? `We owe ${data.partnerName}`
        : "Settled";
  const netColor = data.net > 0 ? GREEN : data.net < 0 ? RED : NAVY;

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
            <Text style={s.docMeta}>{data.partnerName}</Text>
            <Text style={s.docMeta}>
              {d(data.from)} – {d(data.to)}
            </Text>
          </View>
        </View>

        <Side title="They owe us — we worked for them" side={data.theyOweUs} />
        <Side title="We owe them — they worked for us" side={data.weOweThem} />

        <View style={s.net}>
          <Text style={s.strong}>{netLabel}</Text>
          <Text style={[s.netNum, { color: netColor }]}>
            {money(Math.abs(data.net))}
          </Text>
        </View>

        <Text style={s.footer} fixed>
          {COMPANY.name} · Reconciliation statement — amounts exclude VAT unless
          noted.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPartnerStatementPdf(
  data: PartnerStatement,
): Promise<Buffer> {
  return renderToBuffer(<StatementDocument data={data} />);
}
