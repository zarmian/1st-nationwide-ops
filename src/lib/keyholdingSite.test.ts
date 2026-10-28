import { describe, it, expect } from "vitest";
import { prepare } from "./keyholdingJobs";
import { khPropertyFromNotes } from "./keyholdingSite";

// A Keyholding row as the robot reads it (only the columns the notes use).
const row = (over: Record<string, string> = {}) => ({
  "#": "J21634508",
  Service: "Lock Up",
  "Execution Status": "Scheduled",
  Status: "Open",
  "Source Type": "Scheduled",
  Date: "28/10/2026 18:00",
  Property: "Riverside Business Park Unit 4",
  "Property Number": "48213",
  Contract: "Acme Facilities",
  Addresses: "Unit 4, Riverside Business Park, Mill Lane, Reading, RG1 8LS",
  ...over,
});

const notesOf = (r: Record<string, string>) => {
  const p = prepare(r);
  if (!p.ok) throw new Error("row skipped");
  return p.row.notes;
};

describe("khPropertyFromNotes", () => {
  it("reads the property from the notes the import writes", () => {
    expect(khPropertyFromNotes(notesOf(row()))).toEqual({
      name: "Riverside Business Park Unit 4",
      number: "48213",
      contract: "Acme Facilities",
      addressLine: "Unit 4, Riverside Business Park, Mill Lane",
      city: "Reading",
      postcode: "RG18LS",
      postcodeFormatted: "RG1 8LS",
    });
  });

  it("copes with no contract and full stops inside the name", () => {
    const p = khPropertyFromNotes(
      notesOf(row({ Contract: "", Property: "St. Mary's Hall", Addresses: "1 Church Rd, Leeds LS1 4AB" })),
    );
    expect(p).toMatchObject({ name: "St. Mary's Hall", contract: null, postcode: "LS14AB" });
  });

  it("gives nothing without an address with a postcode, or for other notes", () => {
    expect(khPropertyFromNotes(notesOf(row({ Addresses: "Mill Lane, Reading" })))).toBeNull();
    expect(khPropertyFromNotes(notesOf(row({ Addresses: "" })))).toBeNull();
    expect(khPropertyFromNotes("Called the keyholder, all fine.")).toBeNull();
    expect(khPropertyFromNotes(null)).toBeNull();
  });
});
