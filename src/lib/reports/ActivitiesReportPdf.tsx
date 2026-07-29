import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

/**
 * Completed-activities report. Built-in Helvetica (no font embedding) so it
 * renders serverless. Landscape A4 to fit the table comfortably.
 */

const NAVY = "#0F1929";
const BLUE = "#2563EB";
const SLATE = "#475569";
const LINE = "#E2E8F0";
const ZEBRA = "#F8FAFC";

export type ActivitiesReportRowPdf = {
  date: string;
  service: string;
  site: string;
  account: string;
  officer: string;
  status: string;
  location: string | null;
};

export type ActivitiesReportData = {
  title: string;
  rangeLabel: string;
  scopeLabel: string | null;
  generatedAt: string;
  total: number;
  rows: ActivitiesReportRowPdf[];
};

const s = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 40,
    paddingHorizontal: 32,
    fontSize: 9,
    color: NAVY,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: NAVY,
    paddingBottom: 8,
    marginBottom: 6,
  },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
  brandSub: { fontSize: 8, color: SLATE, marginTop: 2 },
  docTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", color: BLUE, textAlign: "right" },
  docMeta: { fontSize: 8, color: SLATE, marginTop: 2, textAlign: "right" },
  summary: { fontSize: 9, color: SLATE, marginBottom: 8 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 4,
    paddingTop: 2,
  },
  th: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingVertical: 4,
  },
  cell: { color: NAVY, paddingRight: 6 },
  empty: { textAlign: "center", color: SLATE, marginTop: 20, fontSize: 10 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 32,
    right: 32,
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: SLATE,
  },
});

function ActivitiesReportDocument({ data }: { data: ActivitiesReportData }) {
  const showLocation = data.rows.some((r) => r.location);
  // Column widths (flex). Location only takes space when there's data.
  const w = {
    date: 12,
    service: 14,
    site: showLocation ? 22 : 26,
    account: 15,
    officer: 15,
    status: 10,
    location: showLocation ? 12 : 0,
  };

  return (
    <Document
      title={data.title}
      author="1st Nationwide Security Services Ltd"
    >
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header} fixed>
          <View>
            <Text style={s.brand}>1st Nationwide</Text>
            <Text style={s.brandSub}>Security Services Ltd</Text>
          </View>
          <View>
            <Text style={s.docTitle}>{data.title}</Text>
            <Text style={s.docMeta}>{data.rangeLabel}</Text>
            {data.scopeLabel ? (
              <Text style={s.docMeta}>{data.scopeLabel}</Text>
            ) : null}
          </View>
        </View>

        <Text style={s.summary} fixed>
          {data.total} {data.total === 1 ? "activity" : "activities"}
        </Text>

        <View style={s.tableHead} fixed>
          <Text style={[s.th, { width: `${w.date}%` }]}>Date (UK)</Text>
          <Text style={[s.th, { width: `${w.service}%` }]}>Service</Text>
          <Text style={[s.th, { width: `${w.site}%` }]}>Site</Text>
          <Text style={[s.th, { width: `${w.account}%` }]}>Account</Text>
          <Text style={[s.th, { width: `${w.officer}%` }]}>Officer</Text>
          <Text style={[s.th, { width: `${w.status}%` }]}>Status</Text>
          {showLocation ? (
            <Text style={[s.th, { width: `${w.location}%` }]}>Location</Text>
          ) : null}
        </View>

        {data.rows.map((r, i) => (
          <View
            key={i}
            style={[s.tr, i % 2 === 1 ? { backgroundColor: ZEBRA } : {}]}
            wrap={false}
          >
            <Text style={[s.cell, { width: `${w.date}%` }]}>{r.date}</Text>
            <Text style={[s.cell, { width: `${w.service}%` }]}>{r.service}</Text>
            <Text style={[s.cell, { width: `${w.site}%` }]}>{r.site}</Text>
            <Text style={[s.cell, { width: `${w.account}%` }]}>{r.account}</Text>
            <Text style={[s.cell, { width: `${w.officer}%` }]}>{r.officer}</Text>
            <Text style={[s.cell, { width: `${w.status}%` }]}>{r.status}</Text>
            {showLocation ? (
              <Text style={[s.cell, { width: `${w.location}%` }]}>
                {r.location ?? "—"}
              </Text>
            ) : null}
          </View>
        ))}

        {data.rows.length === 0 ? (
          <Text style={s.empty}>No activities match these filters.</Text>
        ) : null}

        <View style={s.footer} fixed>
          <Text>1st Nationwide Security Services Ltd</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}  ·  Generated ${data.generatedAt}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export async function renderActivitiesReportPdf(
  data: ActivitiesReportData,
): Promise<Buffer> {
  return renderToBuffer(<ActivitiesReportDocument data={data} />);
}
