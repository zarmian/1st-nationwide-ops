import { beforeEach, describe, expect, it } from "vitest";
import { labelForUrl, previousPage, recordVisit, setPageTitle } from "./navHistory";

// A minimal browser: per-tab sessionStorage.
function freshTab() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
}

describe("navHistory", () => {
  beforeEach(freshTab);

  it("goes back to the page you came from, with its filters and title", () => {
    setPageTitle("/activities?from=2026-09-01&kind=VPI", "Activities");
    recordVisit("/dispatch/j1");
    const p = previousPage("/dispatch/j1");
    expect(p?.entry).toEqual({ url: "/activities?from=2026-09-01&kind=VPI", title: "Activities" });
    expect(p?.viaHistory).toBe(true);
  });

  it("names the site when the job was opened from a site", () => {
    setPageTitle("/sites/s1", "Swail House");
    expect(previousPage("/dispatch/j1")?.entry.title).toBe("Swail House");
  });

  it("cuts the trail back when you return to an earlier page", () => {
    setPageTitle("/activities", "Activities");
    setPageTitle("/dispatch/j1", "Alarm response");
    recordVisit("/sites/s1");
    recordVisit("/dispatch/j1"); // back to the job
    const p = previousPage("/dispatch/j1");
    expect(p?.entry.url).toBe("/activities");
    expect(p?.viaHistory).toBe(false); // a jump back, not the browser's previous page
  });

  it("never offers a form, or the same page with other filters", () => {
    setPageTitle("/activities", "Activities");
    recordVisit("/dispatch/j1/edit");
    recordVisit("/dispatch/j1"); // saved the edit
    expect(previousPage("/dispatch/j1")?.entry.url).toBe("/activities");

    freshTab();
    setPageTitle("/dispatch", "Dispatch");
    recordVisit("/activities?page=1");
    recordVisit("/activities?page=2");
    expect(previousPage("/activities?page=2")?.entry.url).toBe("/dispatch");
  });

  it("has nothing to offer on the first page of a tab", () => {
    expect(previousPage("/dispatch/j1")).toBeNull();
  });

  it("works without storage (private window)", () => {
    (globalThis as { window?: unknown }).window = {
      sessionStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      },
    };
    expect(() => recordVisit("/activities")).not.toThrow();
    expect(previousPage("/dispatch/j1")).toBeNull();
  });

  it("names pages that didn't record a title", () => {
    expect(labelForUrl("/activities?x=1")).toBe("Activities");
    expect(labelForUrl("/sites/abc")).toBe("Site");
    expect(labelForUrl("/patrols/visits/v1")).toBe("Patrol visit");
    expect(labelForUrl("/dispatch")).toBe("Home");
    expect(labelForUrl("/somewhere-new")).toBe("Back");
  });
});
