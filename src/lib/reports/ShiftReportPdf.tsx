import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ShiftReportData } from "./shiftReport";

/**
 * Customer-facing static-guarding / dog-handler shift report. Uses the
 * built-in Helvetica (no font embedding) so it renders anywhere serverless.
 *
 * The on-arrival / on-departure "full report" section is intentionally not
 * rendered yet — it slots in here once those form fields are defined.
 */

const NAVY = "#0F1929";
const BLUE = "#2563EB";
const SLATE = "#475569";
const LINE = "#E2E8F0";
const RED = "#DC2626";
const GREEN = "#16A34A";

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
    marginBottom: 16,
  },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
  brandSub: { fontSize: 8, color: SLATE, marginTop: 2 },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: BLUE },
  docMeta: { fontSize: 8, color: SLATE, marginTop: 2, textAlign: "right" },
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 6,
  },
  siteName: { fontSize: 13, fontFamily: "Helvetica-Bold", color: NAVY },
  siteAddr: { fontSize: 10, color: SLATE, marginTop: 2 },
  row: { flexDirection: "row", marginBottom: 4 },
  label: { width: 130, color: SLATE },
  value: { flex: 1, color: NAVY },
  statTiles: { flexDirection: "row", gap: 10, marginBottom: 4 },
  tile: {
    flex: 1,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 6,
    padding: 10,
  },
  tileNum: { fontSize: 20, fontFamily: "Helvetica-Bold", color: NAVY },
  tileLabel: { fontSize: 8, color: SLATE, marginTop: 2 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: NAVY,
    paddingBottom: 4,
    marginBottom: 2,
  },
  th: { fontSize: 8, fontFamily: "Helvetica-Bold", color: SLATE, textTransform: "uppercase" },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingVertical: 4,
  },
  cNum: { width: 40 },
  cTime: { flex: 1 },
  cOnsite: { width: 110 },
  note: { fontSize: 9, color: SLATE, marginTop: 6 },
  lateBox: {
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 6,
    padding: 8,
    marginTop: 8,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: SLATE,
  },
});

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

function ShiftReportDocument({ data }: { data: ShiftReportData }) {
  return (
    <Document
      title={`Shift report ${data.reportRef} — ${data.siteName}`}
      author="1st Nationwide Security Services Ltd"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <View>
            <Text style={s.brand}>1st Nationwide</Text>
            <Text style={s.brandSub}>Security Services Ltd</Text>
          </View>
          <View>
            <Text style={s.docTitle}>Shift Report</Text>
            <Text style={s.docMeta}>Ref {data.reportRef}</Text>
            <Text style={s.docMeta}>{data.shiftType}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Site</Text>
          <Text style={s.siteName}>
            {data.siteCode ? `${data.siteCode}  ` : ""}
            {data.siteName}
          </Text>
          <Text style={s.siteAddr}>{data.siteAddress}</Text>
          {data.forName ? (
            <Text style={[s.siteAddr, { marginTop: 4 }]}>
              Prepared for: {data.forName}
            </Text>
          ) : null}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Shift</Text>
          <Field label="Type" value={data.shiftType} />
          <Field
            label="Officer"
            value={
              data.subcontracted
                ? `${data.officerLabel} (subcontracted)`
                : data.officerLabel
            }
          />
          <Field label="Scheduled" value={`${data.scheduledStart}  to  ${data.scheduledEnd}`} />
          <Field
            label="On site"
            value={
              data.actualStart
                ? `${data.actualStart}  to  ${data.actualEnd ?? "—"}`
                : "Did not start"
            }
          />
          {data.totalOnSite ? (
            <Field label="Total on site" value={data.totalOnSite} />
          ) : null}
          <Field label="Status" value={data.statusLabel} />
          {data.endedLate ? (
            <View style={s.lateBox}>
              <Text style={{ color: RED, fontFamily: "Helvetica-Bold", fontSize: 9 }}>
                Finished after scheduled end
              </Text>
              {data.lateReason ? (
                <Text style={{ color: SLATE, marginTop: 2 }}>{data.lateReason}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Check-ins</Text>
          <View style={s.statTiles}>
            <View style={s.tile}>
              <Text style={s.tileNum}>{data.checkDone}</Text>
              <Text style={s.tileLabel}>Completed</Text>
            </View>
            <View style={s.tile}>
              <Text style={s.tileNum}>{data.checkExpected}</Text>
              <Text style={s.tileLabel}>Expected</Text>
            </View>
            <View style={s.tile}>
              <Text style={[s.tileNum, data.checkMissed > 0 ? { color: RED } : {}]}>
                {data.checkMissed}
              </Text>
              <Text style={s.tileLabel}>Missed</Text>
            </View>
          </View>

          {data.checkIns.length > 0 ? (
            <View style={{ marginTop: 6 }}>
              <View style={s.tableHead}>
                <Text style={[s.th, s.cNum]}>#</Text>
                <Text style={[s.th, s.cTime]}>Time (UK)</Text>
                <Text style={[s.th, s.cOnsite]}>On site</Text>
              </View>
              {data.checkIns.map((c, i) => (
                <View style={s.tr} key={i} wrap={false}>
                  <Text style={s.cNum}>{c.n}</Text>
                  <Text style={s.cTime}>{c.time}</Text>
                  <Text
                    style={[
                      s.cOnsite,
                      { color: c.onSite === false ? RED : c.onSite ? GREEN : SLATE },
                    ]}
                  >
                    {c.onSite === true
                      ? "Confirmed on site"
                      : c.onSite === false
                        ? "Outside site"
                        : "Recorded"}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.note}>No check-ins were recorded for this shift.</Text>
          )}
        </View>

        <View style={s.footer} fixed>
          <Text>1st Nationwide Security Services Ltd</Text>
          <Text>Generated {data.generatedAt}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderShiftReportPdf(
  data: ShiftReportData,
): Promise<Buffer> {
  return renderToBuffer(<ShiftReportDocument data={data} />);
}
