import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";

const KEY_B64 = randomBytes(32).toString("base64");

let originalKey: string | undefined;

beforeAll(() => {
  originalKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = KEY_B64;
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
});

// Dynamic import so the module reads our env var at load time.
async function load() {
  return await import("./crypto");
}

describe("crypto", () => {
  it("round-trips a plaintext through encryptString/decryptString", async () => {
    const { encryptString, decryptString } = await load();
    const enc = encryptString("1234#alarm");
    expect(enc).not.toBeNull();
    expect(Buffer.isBuffer(enc)).toBe(true);
    expect(decryptString(enc)).toBe("1234#alarm");
  });

  it("returns null for null / empty inputs", async () => {
    const { encryptString, decryptString } = await load();
    expect(encryptString(null)).toBeNull();
    expect(encryptString("")).toBeNull();
    expect(decryptString(null)).toBeNull();
  });

  it("produces distinct ciphertext for repeated encryption (random IV)", async () => {
    const { encryptString } = await load();
    const a = encryptString("hunter2");
    const b = encryptString("hunter2");
    expect(a).not.toEqual(b);
  });

  it("returns null when ciphertext fails auth (tampered byte)", async () => {
    const { encryptString, decryptString } = await load();
    const enc = encryptString("dont-tamper")!;
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1] ^= 0xff;
    expect(decryptString(tampered)).toBeNull();
  });

  it("tolerates legacy plaintext bytes (no envelope)", async () => {
    const { decryptString } = await load();
    expect(decryptString(Buffer.from("legacy", "utf8"))).toBe("legacy");
  });
});
