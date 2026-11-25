/**
 * The FastField import routes (/api/imports/fastfield and …/photo), called
 * with real Request objects; the import engine, the refused-report store and
 * Blob storage are stand-ins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({
  importFastField: vi.fn(),
  planFastField: vi.fn(),
  retryUnmatched: vi.fn(),
  recordRefusedReports: vi.fn(),
  put: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/fastfieldImport", () => ({
  importFastField: engine.importFastField,
  planFastField: engine.planFastField,
  retryUnmatched: engine.retryUnmatched,
}));
vi.mock("@/lib/fastfieldRefused", async (actual) => ({
  ...(await actual<typeof import("./fastfieldRefused")>()),
  recordRefusedReports: engine.recordRefusedReports,
}));
vi.mock("@vercel/blob", () => ({ put: engine.put }));

import { GET, POST } from "@/app/api/imports/fastfield/route";
import { POST as UPLOAD } from "@/app/api/imports/fastfield/photo/route";

const SECRET = "test-import-secret";
const STORE = "abc123store.public.blob.vercel-storage.com";
const ours = (name: string) => `https://${STORE}/uploads/fastfield/sub-1/${name}-Xy12.jpg`;
const CLIENT_TEXT = "Riverside Storage, 1 High Street";

let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXUS_IMPORT_SECRET", SECRET);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_AbC123Store_s3cret");
  engine.importFastField.mockResolvedValue({ received: 1, linked: 1, failed: 0 });
  engine.planFastField.mockResolvedValue({ fetch: [], counts: {} });
  engine.retryUnmatched.mockResolvedValue({ linked: 0 });
  engine.recordRefusedReports.mockResolvedValue({ received: 1, recorded: 1, alreadyImported: 0, formOff: 0 });
  engine.put.mockResolvedValue({ url: ours("photo-1") });
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errors.mockRestore();
  warnings.mockRestore();
});

function post(body: unknown, opts: { auth?: string | null; query?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = opts.auth === undefined ? `Bearer ${SECRET}` : opts.auth;
  if (auth) headers.authorization = auth;
  return POST(
    new Request(`http://localhost/api/imports/fastfield${opts.query ?? ""}`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const report = (over: Record<string, unknown> = {}) => ({
  submissionId: "sub-1",
  formId: 101,
  formName: "Test Patrol Form",
  submittedAt: "2026-11-24T22:15:00Z",
  startedAt: null,
  finishedAt: null,
  submittedBy: "Officer Ana Test",
  answers: [{ key: "text_1", label: "Notes", type: "TextEntry", value: "All quiet" }],
  photoUrls: [],
  signatureUrl: null,
  ...over,
});

const logged = (spy: ReturnType<typeof vi.spyOn>) => JSON.stringify(spy.mock.calls);

describe("POST /api/imports/fastfield", () => {
  it("fails closed: no secret configured, or the wrong one", async () => {
    vi.stubEnv("NEXUS_IMPORT_SECRET", "");
    let res = await post({ action: "retry" });
    expect(res.status).toBe(401);
    vi.stubEnv("NEXUS_IMPORT_SECRET", SECRET);
    res = await post({ action: "retry" }, { auth: "Bearer nope" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorised", code: "unauthorised" });
    expect(engine.retryUnmatched).not.toHaveBeenCalled();
  });

  it("answers GET with its health check", async () => {
    expect(await (await GET()).json()).toEqual({ ok: true, service: "fastfield", method: "POST" });
  });

  it("refuses a bad request with invalid_body and where, never the values", async () => {
    let res = await post("not json");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");

    res = await post({ action: "import", reports: Array.from({ length: 26 }, () => report()) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "invalid_body", fields: ["reports"] });
    expect(engine.importFastField).not.toHaveBeenCalled();
  });

  it("pins a problem inside one report on that report (invalid_report), naming the field only", async () => {
    const res = await post({
      action: "import",
      reports: [report({ submittedAt: 1732486500000, formName: CLIENT_TEXT })],
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "Invalid body", code: "invalid_report", fields: ["reports.0.submittedAt"] });
    expect(JSON.stringify(json)).not.toContain("1732486500000");
    expect(engine.importFastField).not.toHaveBeenCalled();
  });

  it("refuses a report that's too big with report_too_big (413)", async () => {
    const res = await post({
      action: "import",
      reports: [report({ answers: [{ key: "t", label: "Notes", type: "TextEntry", value: "x".repeat(500_001) }] })],
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "A report is too large", code: "report_too_big" });
  });

  it("keeps only photo and signature addresses on our own storage", async () => {
    const res = await post({
      action: "import",
      reports: [
        report({
          answers: [
            { key: "p", label: "Photos", type: "MultiPhotoPicker", value: [{ url: ours("photo-1") }, { url: "javascript:alert(1)" }] },
            { key: "s", label: "Signature", type: "SignaturePad", value: "https://evil.example/sig.png" },
          ],
          photoUrls: [ours("photo-1"), "javascript:alert(1)", "https://otherstore.public.blob.vercel-storage.com/uploads/fastfield/x.jpg"],
          signatureUrl: "https://evil.example/sig.png",
        }),
      ],
    });
    expect(res.status).toBe(200);
    expect((await res.json()).photosDropped).toBe(3);
    const [sent, preview] = engine.importFastField.mock.calls[0];
    expect(preview).toBe(false);
    expect(sent[0].photoUrls).toEqual([ours("photo-1")]);
    expect(sent[0].signatureUrl).toBeNull();
    expect(sent[0].answers[0].value).toEqual([{ url: ours("photo-1") }]);
    expect(sent[0].answers[1].value).toBeNull();
    expect(sent[0].submissionId).toBe("sub-1");
    expect(logged(warnings)).not.toContain("evil.example");
  });

  it("answers a failure with a generic message and a code, and logs the code only", async () => {
    engine.importFastField.mockRejectedValue(Object.assign(new Error(`Can't link ${CLIENT_TEXT}`), { code: "P2024" }));
    const res = await post({ action: "import", reports: [report()] });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "Import failed", code: "P2024" });
    expect(text).not.toContain("Riverside");
    expect(errors).toHaveBeenCalledWith("FastField import route failed:", "import", "P2024");
    expect(logged(errors)).not.toContain("Riverside");
  });

  it("keeps refused reports (not in a preview)", async () => {
    const refused = {
      action: "refused",
      reports: [{ submissionId: "sub-9", formId: 101, submittedAt: "2026-11-24T22:15:00Z", submittedBy: null, reason: "too_big" }],
    };
    let res = await post(refused);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: 1 });
    expect(engine.recordRefusedReports).toHaveBeenCalledWith(refused.reports);

    engine.recordRefusedReports.mockClear();
    res = await post(refused, { query: "?preview=1" });
    expect(await res.json()).toMatchObject({ ok: true, preview: true, recorded: 0 });
    expect(engine.recordRefusedReports).not.toHaveBeenCalled();

    res = await post({ action: "refused", reports: [{ ...refused.reports[0], reason: "bored" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body"); // a bad refusal is never itself "refused"
    res = await post({ action: "refused", reports: [] });
    expect(res.status).toBe(400);
  });

  it("answers a failure while keeping refused reports the same way", async () => {
    engine.recordRefusedReports.mockRejectedValue(Object.assign(new Error(CLIENT_TEXT), { code: "P1001" }));
    const res = await post({ action: "refused", reports: [{ submissionId: "sub-9", formId: 101, reason: "invalid" }] });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "Import failed", code: "P1001" });
    expect(errors).toHaveBeenCalledWith("FastField import route failed:", "refused", "P1001");
    expect(logged(errors)).not.toContain("Riverside");
  });

  it("still plans and retries as before", async () => {
    let res = await post({ action: "plan", forms: [{ formId: 101, name: "Test Patrol Form" }], submissions: [] });
    expect(res.status).toBe(200);
    expect(engine.planFastField).toHaveBeenCalledTimes(1);
    res = await post({ action: "retry" }, { query: "?preview=1" });
    expect(await res.json()).toMatchObject({ skipped: "retry is not previewed" });
    expect(engine.retryUnmatched).not.toHaveBeenCalled();
    res = await post({ action: "retry" });
    expect(res.status).toBe(200);
    expect(engine.retryUnmatched).toHaveBeenCalledWith({ budgetMs: 45_000 });
  });
});

describe("POST /api/imports/fastfield/photo", () => {
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
  const HTML = new TextEncoder().encode("<html><script>alert(1)</script></html>");

  function upload(bytes: Uint8Array<ArrayBuffer>, type: string, opts: { auth?: string; query?: string } = {}) {
    return UPLOAD(
      new Request(`http://localhost/api/imports/fastfield/photo${opts.query ?? "?submission=sub-1&name=photo-1"}`, {
        method: "POST",
        headers: { authorization: opts.auth ?? `Bearer ${SECRET}`, "content-type": type },
        body: bytes,
      }),
    );
  }

  it("fails closed and checks the request", async () => {
    expect((await upload(JPEG, "image/jpeg", { auth: "Bearer nope" })).status).toBe(401);
    let res = await upload(JPEG, "image/jpeg", { query: "?name=photo-1" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_submission");
    res = await upload(JPEG, "image/gif");
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe("unsupported_type");
    res = await upload(new Uint8Array(0), "image/jpeg");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("empty");
    const huge = new Uint8Array(4 * 1024 * 1024 + 1);
    huge.set(JPEG);
    res = await upload(huge, "image/jpeg");
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("too_large");
    expect(engine.put).not.toHaveBeenCalled();
  });

  it("judges the file by its first bytes, not its Content-Type", async () => {
    const res = await upload(HTML, "image/jpeg");
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "Not a JPEG, PNG or WebP image", code: "not_an_image" });
    expect(engine.put).not.toHaveBeenCalled();
  });

  it("stores a real image as what it is", async () => {
    let res = await upload(JPEG, "image/jpeg");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, url: ours("photo-1") });
    expect(engine.put).toHaveBeenLastCalledWith(
      "uploads/fastfield/sub-1/photo-1.jpg",
      expect.any(Buffer),
      { access: "public", contentType: "image/jpeg", addRandomSuffix: true },
    );
    // A PNG labelled as a JPEG is kept as a PNG.
    res = await upload(PNG, "image/jpeg", { query: "?submission=sub-1&name=signature-1" });
    expect(res.status).toBe(200);
    expect(engine.put).toHaveBeenLastCalledWith(
      "uploads/fastfield/sub-1/signature-1.png",
      expect.any(Buffer),
      { access: "public", contentType: "image/png", addRandomSuffix: true },
    );
    expect(warnings).not.toHaveBeenCalled();
  });

  it("says (without the address) when storage hands back an address the import wouldn't keep", async () => {
    engine.put.mockResolvedValue({ url: "https://otherstore.public.blob.vercel-storage.com/uploads/fastfield/sub-1/p.jpg" });
    const res = await upload(JPEG, "image/jpeg");
    expect(res.status).toBe(200);
    expect(warnings).toHaveBeenCalledTimes(1);
    expect(logged(warnings)).not.toContain("otherstore");
  });

  it("answers a storage failure with a generic message and a code, and logs the code only", async () => {
    engine.put.mockRejectedValue(Object.assign(new Error(`Vercel Blob: denied for ${CLIENT_TEXT}`), { name: "BlobAccessError" }));
    const res = await upload(JPEG, "image/jpeg");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "Upload failed", code: "BlobAccessError" });
    expect(text).not.toContain("Riverside");
    expect(errors).toHaveBeenCalledWith("FastField photo upload failed:", "BlobAccessError");
    expect(logged(errors)).not.toContain("Riverside");
  });
});
