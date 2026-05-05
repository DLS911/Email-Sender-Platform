import { describe, expect, it } from "vitest";
import { z } from "zod";
import { stripFencesAndProse, tryValidate } from "./auto-heal.js";

const PersonSchema = z.object({
  name: z.string(),
  age: z.number().int(),
});

describe("stripFencesAndProse", () => {
  it("strips ```json fences", () => {
    const raw = '```json\n{"name":"mark","age":47}\n```';
    expect(stripFencesAndProse(raw)).toBe('{"name":"mark","age":47}');
  });

  it("strips ``` fences without a language tag", () => {
    const raw = '```\n{"a":1}\n```';
    expect(stripFencesAndProse(raw)).toBe('{"a":1}');
  });

  it("trims leading prose around an object", () => {
    const raw = 'Here is the JSON you requested:\n{"a":1}';
    expect(stripFencesAndProse(raw)).toBe('{"a":1}');
  });

  it("trims trailing prose after an object", () => {
    const raw = '{"a":1}\nLet me know if you need adjustments.';
    expect(stripFencesAndProse(raw)).toBe('{"a":1}');
  });

  it("preserves valid JSON unchanged", () => {
    const raw = '{"name":"mark","age":47}';
    expect(stripFencesAndProse(raw)).toBe(raw);
  });
});

describe("tryValidate", () => {
  it("validates clean JSON", () => {
    const result = tryValidate(PersonSchema, '{"name":"mark","age":47}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.healed).toBe(false);
      expect(result.value).toEqual({ name: "mark", age: 47 });
    }
  });

  it("auto-heals fenced JSON", () => {
    const result = tryValidate(PersonSchema, '```json\n{"name":"mark","age":47}\n```');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.healed).toBe(true);
      expect(result.value.name).toBe("mark");
    }
  });

  it("auto-heals JSON with leading prose", () => {
    const result = tryValidate(PersonSchema, 'Here you go:\n{"name":"mark","age":47}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.healed).toBe(true);
  });

  it("returns ok:false on schema mismatch", () => {
    const result = tryValidate(PersonSchema, '{"name":"mark"}'); // missing age
    expect(result.ok).toBe(false);
  });

  it("returns ok:false on malformed JSON beyond healing", () => {
    const result = tryValidate(PersonSchema, "not json at all, just prose");
    expect(result.ok).toBe(false);
  });

  it("handles arrays at top level", () => {
    const ListSchema = z.array(z.number());
    const result = tryValidate(ListSchema, "Here it is:\n[1, 2, 3]");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([1, 2, 3]);
  });
});
