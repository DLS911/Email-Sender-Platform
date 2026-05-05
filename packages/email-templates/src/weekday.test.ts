import { describe, expect, it } from "vitest";
import { escapeHtml, withTracking } from "./shared.js";
import { renderWeekday } from "./weekday.js";
import { renderWeekend } from "./weekend.js";

describe("escapeHtml", () => {
  it("escapes the four core characters", () => {
    expect(escapeHtml(`<a href="x&y">b</a>`)).toBe("&lt;a href=&quot;x&amp;y&quot;&gt;b&lt;/a&gt;");
  });
});

describe("withTracking", () => {
  it("appends tracking params and section", () => {
    const url = withTracking(
      "https://example.com/article",
      { utm_source: "newsletter" },
      "tasting_menu",
    );
    expect(url).toContain("utm_source=newsletter");
    expect(url).toContain("section=tasting_menu");
  });
  it("returns input on invalid url", () => {
    expect(withTracking("not-a-url", { x: "y" }, "section")).toBe("not-a-url");
  });
});

describe("renderWeekday", () => {
  it("produces html, text, subject, preheader", () => {
    const out = renderWeekday({
      brandName: "Castor Abbott",
      brandSlug: "castor-abbott",
      episodeId: "ep-001",
      headline: "The pre-meeting ritual",
      preheader: "Why first meetings start before they start.",
      contentType: "tactic",
      sections: [
        { name: "First Pull", body: "Most advisors prep wrong.\n\nThe fix is upstream." },
        { name: "Tactic", body: "Three minutes of LinkedIn." },
      ],
      unsubscribeUrl: "https://mail.castorabbott.com/u/abc",
    });
    expect(out.subject).toBe("The pre-meeting ritual");
    expect(out.preheader).toBe("Why first meetings start before they start.");
    expect(out.html).toContain("Castor Abbott");
    expect(out.html).toContain("The pre-meeting ritual");
    expect(out.html).toContain("First Pull");
    expect(out.html).toContain("Tactic");
    expect(out.text).toContain("## First Pull");
    expect(out.text).toContain("unsubscribe: https://mail.castorabbott.com/u/abc");
  });

  it("escapes user content in headline", () => {
    const out = renderWeekday({
      brandName: "X",
      brandSlug: "x",
      episodeId: "e",
      headline: "<script>alert(1)</script>",
      preheader: "p",
      contentType: "tactic",
      sections: [{ name: "S", body: "b" }],
      unsubscribeUrl: "https://example.com",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});

describe("renderWeekend", () => {
  it("renders cover story + tasting menu + drive", () => {
    const out = renderWeekend({
      brandName: "Castor Abbott",
      brandSlug: "castor-abbott",
      episodeId: "ep-003",
      headline: "Skip the famous estate",
      preheader: "Where operators actually go.",
      contentType: "type_2_luxury_insider",
      sections: [
        {
          kind: "cover_story",
          openingHook: "Everybody books Castello Banfi.",
          body: "Thirty minutes south, a working olive operation rents a farmhouse.",
        },
        {
          kind: "tasting_menu",
          items: [
            { title: "Pienza Friday market", summary: "half the price of Saturday Montepulciano" },
            {
              title: "Olive press week",
              summary: "book in November to eat with the family",
              url: "https://example.com/press",
            },
          ],
        },
        {
          kind: "the_drive",
          pick: "Used Alfa Stelvio",
          rationale: "These roads punish 18-inch wheels.",
        },
      ],
      unsubscribeUrl: "https://mail.castorabbott.com/u/abc",
      trackingParams: { utm_source: "newsletter" },
    });
    expect(out.html).toContain("Cover Story");
    expect(out.html).toContain("Tasting Menu");
    expect(out.html).toContain("The Drive");
    expect(out.html).toContain("section=tasting_menu");
    expect(out.html).toContain("utm_source=newsletter");
    expect(out.text).toContain("Pienza Friday market");
    expect(out.text).toContain("Used Alfa Stelvio");
  });
});
