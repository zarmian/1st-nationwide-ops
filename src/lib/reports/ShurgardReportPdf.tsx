import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { ShurgardReportData } from "./shurgardReport";

/**
 * Shurgard daily PDF. Customer-facing: site names only (no ids, no officer
 * names). Callouts/lock-ups grouped per site; static guarding shows site +
 * start/end only.
 */

const NAVY = "#0F1929";
const BLUE = "#2563EB";
const SLATE = "#475569";
const LINE = "#E2E8F0";

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 11,
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
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: NAVY },
  brandSub: { fontSize: 8, color: SLATE, marginTop: 2 },
  docTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: BLUE, textAlign: "right" },
  docMeta: { fontSize: 9, color: SLATE, marginTop: 2, textAlign: "right" },
  section: { marginBottom: 18 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: SLATE,
    textTransform: "uppercase",
    letterSpacing: 1,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingBottom: 4,
    marginBottom: 8,
  },
  listRow: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  bullet: { width: 16, color: SLATE },
  site: { flex: 1, color: NAVY },
  hours: { width: 120, color: SLATE, textAlign: "right" },
  empty: { fontSize: 10, color: SLATE, fontStyle: "italic" },
  shiftBlock: { marginBottom: 2 },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingLeft: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  photo: {
    width: 96,
    height: 72,
    objectFit: "cover",
    borderRadius: 3,
    borderWidth: 1,
    borderColor: LINE,
    marginRight: 4,
    marginBottom: 4,
  },
  photoCaption: { fontSize: 7, color: SLATE, paddingLeft: 16, marginBottom: 4 },
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

function ShurgardReportDocument({ data }: { data: ShurgardReportData }) {
  return (
    <Document
      title={`Shurgard daily report — ${data.dateLabel}`}
      author="1st Nationwide Security Services Ltd"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <View>
            <Text style={s.brand}>1st Nationwide</Text>
            <Text style={s.brandSub}>Security Services Ltd</Text>
          </View>
          <View>
            <Text style={s.docTitle}>Shurgard — Daily Report</Text>
            <Text style={s.docMeta}>{data.dateLabel}</Text>
          </View>
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Callouts, lock-ups & unlocks</Text>
          {data.jobSites.length > 0 ? (
            data.jobSites.map((label, i) => (
              <View style={s.listRow} key={i} wrap={false}>
                <Text style={s.bullet}>{i + 1}.</Text>
                <Text style={s.site}>{label}</Text>
              </View>
            ))
          ) : (
            <Text style={s.empty}>None recorded for this date.</Text>
          )}
        </View>

        <View style={s.section}>
          <Text style={s.sectionTitle}>Static guarding</Text>
          {data.shifts.length > 0 ? (
            data.shifts.map((r, i) => (
              <View style={s.shiftBlock} key={i} wrap={false}>
                <View style={s.listRow}>
                  <Text style={s.bullet}>{i + 1}.</Text>
                  <Text style={s.site}>{r.label}</Text>
                  <Text style={s.hours}>{r.hours}</Text>
                </View>
                {r.photos.length > 0 && (
                  <>
                    <View style={s.photoRow}>
                      {r.photos.map((src, j) => (
                        <Image key={j} src={src} style={s.photo} />
                      ))}
                    </View>
                    <Text style={s.photoCaption}>
                      On-site photos captured during the shift.
                    </Text>
                  </>
                )}
              </View>
            ))
          ) : (
            <Text style={s.empty}>None recorded for this date.</Text>
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

export async function renderShurgardReportPdf(
  data: ShurgardReportData,
): Promise<Buffer> {
  return renderToBuffer(<ShurgardReportDocument data={data} />);
}
