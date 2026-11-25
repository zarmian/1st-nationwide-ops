import { describe, expect, it } from "vitest";
import {
  blobStoreHost,
  errorCode,
  imageTypeOf,
  isOurPhotoUrl,
  keepOurMedia,
  safeLinkUrl,
} from "./fastfieldIntake";

const HOST = "abc123store.public.blob.vercel-storage.com";
const ours = (name: string) => `https://${HOST}/uploads/fastfield/sub-1/${name}-Xy12.jpg`;

describe("blobStoreHost", () => {
  it("reads our store's public host out of the read-write token, like @vercel/blob", () => {
    expect(blobStoreHost("vercel_blob_rw_AbC123Store_s3cretPart")).toBe(HOST);
  });
  it("gives null without a usable token", () => {
    expect(blobStoreHost(undefined)).toBeNull();
    expect(blobStoreHost(null)).toBeNull();
    expect(blobStoreHost("")).toBeNull();
    expect(blobStoreHost("test-token")).toBeNull();
    expect(blobStoreHost("vercel_blob_rw__secret")).toBeNull();
    expect(blobStoreHost("vercel_blob_rw_ab.cd_secret")).toBeNull();
  });
});

describe("isOurPhotoUrl", () => {
  it("accepts the photo route's addresses on our store", () => {
    expect(isOurPhotoUrl(ours("photo-1"), HOST)).toBe(true);
    expect(isOurPhotoUrl(ours("photo-1").replace(HOST, HOST.toUpperCase()), HOST)).toBe(true);
  });
  it("refuses other schemes, hosts, paths and odd forms", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:image/png;base64,iVBORw0KGgo=",
      ours("photo-1").replace("https:", "http:"),
      `https://otherstore.public.blob.vercel-storage.com/uploads/fastfield/sub-1/p.jpg`,
      `https://${HOST}.evil.example/uploads/fastfield/sub-1/p.jpg`,
      `https://${HOST}/uploads/other/p.jpg`,
      `https://${HOST}/uploads/fastfield/../other/p.jpg`,
      `https://${HOST}:8443/uploads/fastfield/sub-1/p.jpg`,
      `https://user:pass@${HOST}/uploads/fastfield/sub-1/p.jpg`,
      `/uploads/fastfield/sub-1/p.jpg`,
      `//${HOST}/uploads/fastfield/sub-1/p.jpg`,
      `${ours("p")}?x=${"a".repeat(1000)}`,
      "",
    ]) {
      expect(isOurPhotoUrl(bad, HOST), bad.slice(0, 80)).toBe(false);
    }
    expect(isOurPhotoUrl(null, HOST)).toBe(false);
    expect(isOurPhotoUrl(42, HOST)).toBe(false);
    expect(isOurPhotoUrl({ url: ours("p") }, HOST)).toBe(false);
  });
  it("without our store known, takes any Vercel Blob public host — nothing else", () => {
    expect(isOurPhotoUrl(`https://anystore.public.blob.vercel-storage.com/uploads/fastfield/s/p.jpg`, null)).toBe(true);
    expect(isOurPhotoUrl(`https://anystore.blob.vercel-storage.com/uploads/fastfield/s/p.jpg`, null)).toBe(false);
    expect(isOurPhotoUrl(`https://evil.example/uploads/fastfield/s/p.jpg`, null)).toBe(false);
    expect(isOurPhotoUrl(`https://a.b.public.blob.vercel-storage.com/uploads/fastfield/s/p.jpg`, null)).toBe(false);
  });
});

describe("keepOurMedia", () => {
  const answer = (type: string, value: unknown) => ({ key: type, label: type, type, value });

  it("keeps our addresses and drops the rest, in every place photos and signatures go", () => {
    const evil = "javascript:alert(1)";
    const other = "https://tracker.example/pixel.gif";
    const kept = keepOurMedia(
      {
        answers: [
          answer("MultiPhotoPicker", [{ url: ours("photo-1"), comment: "Front gate" }, { url: evil }, { url: other }]),
          answer("SignaturePad", evil),
          answer("PhotoPicker", [{ url: other }]),
          answer("TextEntry", other),
          answer("PhotoPicker", null),
          answer("Signature", ""),
        ],
        photoUrls: [ours("photo-1"), evil, other, 7],
        signatureUrl: other,
      },
      HOST,
    );
    expect(kept.photoUrls).toEqual([ours("photo-1")]);
    expect(kept.signatureUrl).toBeNull();
    expect(kept.answers.map((a) => a.value)).toEqual([
      [{ url: ours("photo-1"), comment: "Front gate" }],
      null,
      null,
      other, // a text answer is shown as text, never as a link: untouched
      null,
      "",
    ]);
    // javascript:, the tracker and the number 7, each counted once.
    expect(kept.dropped).toBe(3);
  });

  it("leaves a report with only our addresses exactly as it was", () => {
    const answers = [
      answer("MultiPhotoPicker", [{ url: ours("photo-1") }, { url: ours("photo-2") }]),
      answer("SignaturePad", ours("signature-1")),
    ];
    const kept = keepOurMedia(
      { answers, photoUrls: [ours("photo-1"), ours("photo-2")], signatureUrl: ours("signature-1") },
      HOST,
    );
    expect(kept.answers[0]).toBe(answers[0]);
    expect(kept.answers[1]).toBe(answers[1]);
    expect(kept.photoUrls).toEqual([ours("photo-1"), ours("photo-2")]);
    expect(kept.signatureUrl).toBe(ours("signature-1"));
    expect(kept.dropped).toBe(0);
  });

  it("copes with a preview's report (no photos copied) and odd shapes", () => {
    const kept = keepOurMedia(
      { answers: [answer("PhotoPicker", { url: "data:x" }), answer("PhotoPicker", [])] },
      HOST,
    );
    expect(kept.photoUrls).toEqual([]);
    expect(kept.signatureUrl).toBeNull();
    expect(kept.answers.map((a) => a.value)).toEqual([null, []]);
    expect(kept.dropped).toBe(1);
  });
});

describe("safeLinkUrl", () => {
  it("passes absolute http(s) addresses", () => {
    expect(safeLinkUrl(ours("p"))).toBe(ours("p"));
    expect(safeLinkUrl("http://example.org/a.jpg")).toBe("http://example.org/a.jpg");
  });
  it("never passes script, data or relative addresses", () => {
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "/uploads/x.jpg",
      "//evil.example/x.jpg",
      "",
    ]) {
      expect(safeLinkUrl(bad), bad).toBeNull();
    }
    expect(safeLinkUrl(undefined)).toBeNull();
    expect(safeLinkUrl({ url: ours("p") })).toBeNull();
  });
});

describe("imageTypeOf", () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

  it("knows JPEG, PNG and WebP by their first bytes", () => {
    expect(imageTypeOf(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe("image/jpeg");
    expect(imageTypeOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe("image/png");
    expect(imageTypeOf(bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBPVP8 ")))).toBe("image/webp");
    expect(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
  });
  it("refuses anything else, whatever it claims to be", () => {
    expect(imageTypeOf(bytes())).toBeNull();
    expect(imageTypeOf(bytes(0xff, 0xd8))).toBeNull();
    expect(imageTypeOf(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull(); // cut-off PNG signature
    expect(imageTypeOf(bytes(...ascii("GIF89a")))).toBeNull();
    expect(imageTypeOf(bytes(...ascii("<html><script>")))).toBeNull();
    expect(imageTypeOf(bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
    expect(imageTypeOf(bytes(...ascii("<svg xmlns=")))).toBeNull();
  });
});

describe("errorCode", () => {
  it("gives the code or the name, never the message", () => {
    expect(errorCode(Object.assign(new Error("Riverside Storage, 1 High St"), { code: "P2002" }))).toBe("P2002");
    expect(errorCode(new TypeError("Officer Ana Test"))).toBe("TypeError");
    expect(errorCode(Object.assign(new Error("x"), { code: 503 }))).toBe("503");
    expect(errorCode(Object.assign(new Error("x"), { code: "Riverside Storage, 1 High St" }))).toBe("Error");
    expect(errorCode({ code: "a b c" })).toBe("error");
    expect(errorCode("Riverside Storage")).toBe("error");
    expect(errorCode(null)).toBe("error");
    expect(errorCode(undefined)).toBe("error");
  });
});
