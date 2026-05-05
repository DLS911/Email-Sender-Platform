import { describe, expect, it } from "vitest";
import {
  parseDateLoose,
  parseHardBlocked,
  parseLookbackOverrides,
  rowToConcept,
} from "./migrate-concepts-from-sheet";

describe("parseDateLoose", () => {
  it("parses ISO timestamps", () => {
    expect(parseDateLoose("2026-01-15T00:00:00Z")).toBe("2026-01-15T00:00:00.000Z");
  });

  it("parses M/D/YYYY", () => {
    const out = parseDateLoose("3/5/2026");
    expect(out.startsWith("2026-03-05")).toBe(true);
  });

  it("parses M/D/YY", () => {
    const out = parseDateLoose("3/5/26");
    expect(out.startsWith("2026-03-05")).toBe(true);
  });

  it("falls back to now() on garbage input", () => {
    const before = Date.now();
    const out = parseDateLoose("not-a-date");
    const parsed = Date.parse(out);
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
  });

  it("returns now() on empty input", () => {
    const before = Date.now();
    const parsed = Date.parse(parseDateLoose(""));
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe("parseHardBlocked", () => {
  it("treats true/yes/1/y (case-insensitive) as true", () => {
    for (const v of ["true", "TRUE", "yes", "Yes", "1", "y", "Y"]) {
      expect(parseHardBlocked(v)).toBe(true);
    }
  });

  it("treats anything else as false", () => {
    for (const v of ["false", "no", "0", "", undefined, "maybe"]) {
      expect(parseHardBlocked(v)).toBe(false);
    }
  });
});

describe("parseLookbackOverrides", () => {
  it("parses comma-separated key=value pairs", () => {
    expect(parseLookbackOverrides("cover_story=300,tactic=14")).toEqual({
      cover_story: 300,
      tactic: 14,
    });
  });

  it("ignores malformed pairs", () => {
    expect(parseLookbackOverrides("cover_story=300,broken,tactic=14")).toEqual({
      cover_story: 300,
      tactic: 14,
    });
  });

  it("returns empty object for undefined or empty", () => {
    expect(parseLookbackOverrides(undefined)).toEqual({});
    expect(parseLookbackOverrides("")).toEqual({});
  });

  it("ignores non-numeric values", () => {
    expect(parseLookbackOverrides("cover_story=abc")).toEqual({});
  });
});

describe("rowToConcept", () => {
  it("maps a typical row with default lookback", () => {
    const row = {
      date: "2026-04-01",
      section: "cover_story",
      item_name: "Boise whitewater trip",
      concept: "overlooked western destination near a major airport",
    };
    const c = rowToConcept(row, "castor_abbott", {});
    expect(c).not.toBeNull();
    expect(c?.brand_id).toBe("castor_abbott");
    expect(c?.section_name).toBe("cover_story");
    expect(c?.surface_form).toBe("Boise whitewater trip");
    expect(c?.concept_summary).toContain("overlooked");
    // cover_story default is 270 days
    const used = new Date(c?.used_at ?? "").getTime();
    const lookback = new Date(c?.lookback_until ?? "").getTime();
    const diffDays = Math.round((lookback - used) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(270);
  });

  it("respects override lookback window", () => {
    const c = rowToConcept(
      { date: "2026-04-01", section: "cover_story", concept: "x" },
      "castor_abbott",
      { cover_story: 100 },
    );
    const diffDays = Math.round(
      (new Date(c?.lookback_until ?? "").getTime() - new Date(c?.used_at ?? "").getTime()) /
        (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(100);
  });

  it("hard-blocked concepts get null lookback", () => {
    const c = rowToConcept(
      {
        date: "2026-04-01",
        section: "tasting_menu_item",
        concept: "Lodge cast iron",
        hard_blocked: "true",
      },
      "castor_abbott",
      {},
    );
    expect(c?.hard_blocked).toBe(true);
    expect(c?.lookback_until).toBeNull();
  });

  it("returns null when concept is missing", () => {
    expect(
      rowToConcept({ date: "x", section: "cover_story", concept: "" }, "castor_abbott", {}),
    ).toBeNull();
  });

  it("is case-insensitive on column names", () => {
    const c = rowToConcept(
      { Date: "2026-04-01", SECTION: "tactic", Concept: "test concept" },
      "castor_abbott",
      {},
    );
    expect(c).not.toBeNull();
    expect(c?.section_name).toBe("tactic");
  });
});
