import { describe, expect, it } from "vitest";
import { composeVoice } from "./composer.js";
import { listModules, loadModule } from "./loader.js";

const RUN_CTX = {
  runId: "00000000-0000-0000-0000-000000000000",
  brandId: "castor_abbott" as const,
  blockName: "test",
};

describe("loadModule", () => {
  it("loads a real Castor Abbott voice module with valid frontmatter", async () => {
    const mod = await loadModule("brands/castor-abbott/weekday/trust-stacking");
    expect(mod.frontmatter.module_id).toContain("trust-stacking");
    expect(mod.frontmatter.version).toBeGreaterThanOrEqual(1);
    expect(mod.frontmatter.status).toBe("active");
    expect(mod.body.length).toBeGreaterThan(0);
  });

  it("loads a core module shared across brands", async () => {
    const mod = await loadModule("core/voice-rules");
    expect(mod.frontmatter.category).toBeDefined();
    expect(mod.body).toMatch(/em.*dash|passive|hedge/i);
  });

  it("throws ConfigError when the module does not exist", async () => {
    await expect(loadModule("does/not/exist")).rejects.toThrow(/voice module not found/);
  });
});

describe("listModules", () => {
  it("walks the file tree and returns all module ids", async () => {
    const ids = await listModules();
    expect(ids.length).toBeGreaterThan(40); // 49 in the package, allow some slack
    expect(ids).toContain("core/voice-rules");
    expect(ids).toContain("brands/castor-abbott/weekday/trust-stacking");
  });
});

describe("composeVoice", () => {
  it("concatenates module bodies with dividers", async () => {
    const out = await composeVoice({
      modules: ["core/voice-rules", "core/llm-output-discipline"],
      context: RUN_CTX,
    });
    expect(out).toContain("---");
    expect(out.split("---").length).toBeGreaterThanOrEqual(2);
  });

  it("preserves module order", async () => {
    const out1 = await composeVoice({
      modules: ["core/voice-rules", "core/editorial-quality"],
      context: RUN_CTX,
    });
    const out2 = await composeVoice({
      modules: ["core/editorial-quality", "core/voice-rules"],
      context: RUN_CTX,
    });
    expect(out1).not.toBe(out2);
  });

  it("is deterministic — same inputs produce identical output", async () => {
    const a = await composeVoice({
      modules: ["core/voice-rules", "brands/castor-abbott/shared/mark-persona"],
      context: RUN_CTX,
    });
    const b = await composeVoice({
      modules: ["core/voice-rules", "brands/castor-abbott/shared/mark-persona"],
      context: RUN_CTX,
    });
    expect(a).toBe(b);
  });

  it("composes a realistic weekday tactic prompt", async () => {
    const out = await composeVoice({
      modules: [
        "core/voice-rules",
        "core/editorial-quality",
        "brands/castor-abbott/shared/mark-persona",
        "brands/castor-abbott/shared/author-credibility",
        "brands/castor-abbott/weekday/voice-tone",
        "brands/castor-abbott/weekday/trust-stacking",
        "brands/castor-abbott/weekday/content-type-tactic",
      ],
      context: RUN_CTX,
    });
    expect(out.length).toBeGreaterThan(2000);
    expect(out.toLowerCase()).toMatch(/trust|stacking|tactic/);
  });
});
