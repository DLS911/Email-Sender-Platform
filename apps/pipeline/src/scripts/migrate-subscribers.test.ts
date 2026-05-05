import { describe, expect, it } from "vitest";
import { parseCsv, rowToSubscriber } from "./migrate-subscribers";

describe("parseCsv", () => {
  it("parses simple comma-separated rows", () => {
    const rows = parseCsv("email,name\nfoo@x.com,Foo\nbar@y.com,Bar");
    expect(rows).toEqual([
      { email: "foo@x.com", name: "Foo" },
      { email: "bar@y.com", name: "Bar" },
    ]);
  });

  it("handles quoted fields with embedded commas", () => {
    const rows = parseCsv('email,name\nfoo@x.com,"Last, First"');
    expect(rows[0]?.name).toBe("Last, First");
  });

  it("handles escaped quotes within quoted fields", () => {
    const rows = parseCsv('email,name\nfoo@x.com,"O""Brien, Pat"');
    expect(rows[0]?.name).toBe('O"Brien, Pat');
  });

  it("handles \\r\\n line endings", () => {
    const rows = parseCsv("email,name\r\nfoo@x.com,Foo\r\nbar@y.com,Bar");
    expect(rows).toHaveLength(2);
  });

  it("returns empty array on empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("trims whitespace around cells", () => {
    const rows = parseCsv("email, name\nfoo@x.com , Foo ");
    expect(rows[0]?.name).toBe("Foo");
  });
});

describe("rowToSubscriber", () => {
  it("maps a clean active subscriber", () => {
    const row = {
      email: "Mark@Example.Com",
      name: "Mark",
      status: "active",
      source: "website_signup",
      subscribed_at: "2026-01-15T00:00:00Z",
    };
    const sub = rowToSubscriber(row, "castor_abbott");
    expect(sub).not.toBeNull();
    expect(sub?.email).toBe("mark@example.com");
    expect(sub?.brand_id).toBe("castor_abbott");
    expect(sub?.status).toBe("active");
    expect(sub?.source).toBe("website_signup");
  });

  it("normalizes unknown status to suppressed", () => {
    const row = { email: "x@y.com", status: "weird_status_value" };
    const sub = rowToSubscriber(row, "castor_abbott");
    expect(sub?.status).toBe("suppressed");
  });

  it("returns null for rows without a valid email", () => {
    expect(rowToSubscriber({ email: "" }, "castor_abbott")).toBeNull();
    expect(rowToSubscriber({ email: "not-an-email" }, "castor_abbott")).toBeNull();
  });

  it("folds unknown columns into custom_fields", () => {
    const row = {
      email: "x@y.com",
      status: "active",
      tier: "premium",
      practice_size: "20",
    };
    const sub = rowToSubscriber(row, "castor_abbott");
    expect(sub?.custom_fields).toEqual({ tier: "premium", practice_size: "20" });
  });

  it("defaults source to import when not provided", () => {
    const sub = rowToSubscriber({ email: "x@y.com", status: "active" }, "castor_abbott");
    expect(sub?.source).toBe("import");
  });

  it("preserves all 5 known statuses", () => {
    for (const s of ["active", "unsubscribed", "bounced", "complained", "suppressed"] as const) {
      const sub = rowToSubscriber({ email: "x@y.com", status: s }, "castor_abbott");
      expect(sub?.status).toBe(s);
    }
  });
});
