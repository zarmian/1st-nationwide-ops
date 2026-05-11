import { describe, expect, it } from "vitest";
import {
  formatPostcode,
  normalisePostcode,
  parseAddress,
  readCsvRows,
} from "./nexusImport";

describe("nexusImport — pure parsers", () => {
  describe("normalisePostcode / formatPostcode", () => {
    it("normalises spacing and casing", () => {
      expect(normalisePostcode("br3 4pr")).toBe("BR34PR");
      expect(normalisePostcode("BR3  4PR")).toBe("BR34PR");
    });

    it("re-spaces the inward part", () => {
      expect(formatPostcode("BR34PR")).toBe("BR3 4PR");
      expect(formatPostcode("se16 2sd")).toBe("SE16 2SD");
    });

    it("returns input upper-cased for too-short strings", () => {
      expect(formatPostcode("abc")).toBe("ABC");
    });
  });

  describe("parseAddress", () => {
    it("extracts city + postcode from the trailing chunks", () => {
      const r = parseAddress("25-27 Beckenham Road, Beckenham, BR3 4PR");
      expect(r.addressLine).toBe("25-27 Beckenham Road");
      expect(r.city).toBe("Beckenham");
      expect(r.postcodeRaw).toBe("BR3 4PR");
    });

    it("collapses trailing duplicates (London, London)", () => {
      const r = parseAddress(
        "The Queen Of The South, 367 Norwood Road, London, London, SE27 9BQ",
      );
      expect(r.addressLine).toBe(
        "The Queen Of The South, 367 Norwood Road",
      );
      expect(r.city).toBe("London");
      expect(r.postcodeRaw).toBe("SE27 9BQ");
    });

    it("returns null postcode when none matches", () => {
      const r = parseAddress("No postcode here");
      expect(r.postcodeRaw).toBeNull();
      expect(r.addressLine).toBe("No postcode here");
    });
  });

  describe("readCsvRows", () => {
    it("parses headers + rows, handles quoted commas", () => {
      const csv = [
        "Reference,Site Name,Site Address",
        'SITE-1,Foo,"123 High St, London, SW1A 1AA"',
        "SITE-2,Bar,",
      ].join("\n");
      const rows = readCsvRows(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0].Reference).toBe("SITE-1");
      expect(rows[0]["Site Address"]).toBe("123 High St, London, SW1A 1AA");
      expect(rows[1]["Site Address"]).toBe("");
    });

    it("strips a UTF-8 BOM (common from Windows exports)", () => {
      const csv = "﻿Reference,Foo\nSITE-3,bar";
      const rows = readCsvRows(csv);
      expect(rows[0].Reference).toBe("SITE-3");
      expect(rows[0].Foo).toBe("bar");
    });

    it("returns empty array for empty input", () => {
      expect(readCsvRows("")).toEqual([]);
    });
  });
});
