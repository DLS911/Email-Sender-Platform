import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyGrindContent } from "./daily-grind-html-template";

const BRAND_ID = "castor_abbott";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMS = 1536;

const HAIKU_INPUT_PER_M = 1.0;
const HAIKU_OUTPUT_PER_M = 5.0;
const EMBEDDING_PER_M = 0.02;

export type ExtractedConcept = {
  sectionName: string;
  conceptSummary: string;
  surfaceForm: string | null;
};

export type SimilarConcept = {
  id: string;
  sectionName: string;
  conceptSummary: string;
  surfaceForm: string | null;
  usedAt: string;
  similarity: number;
};

export type RecentConcept = {
  id: string;
  sectionName: string;
  conceptSummary: string;
  surfaceForm: string | null;
  usedAt: string;
};

export type BrainPersistResult = {
  conceptsExtracted: number;
  conceptsEmbedded: number;
  conceptsPersisted: number;
  haikuInputTokens: number;
  haikuOutputTokens: number;
  embeddingTokens: number;
  costUsd: number;
  latencyMs: number;
};

// ─── Concept extraction (Haiku) ────────────────────────────────────────────

const EXTRACT_SYSTEM_PROMPT = `You extract the conceptual fingerprint of a Daily Grind newsletter issue for a long-term content memory. Your job is to surface the distinct CONCEPTS the issue taught or framed so the writer doesn't repeat them in a future issue.

A concept is the underlying idea, NOT the headline. Examples:
- Headline: "The 15-Minute Pre-Meeting Ritual"
  Concept: "Spending dedicated prep time researching prospects on LinkedIn before discovery calls"
- Headline: "The Retainer Surge Nobody Saw Coming"
  Concept: "Unbundling planning fees from AUM as a response to fee compression"
- Headline: "Your CRM Isn't Broken — Your Stack Is"
  Concept: "Disconnected advisor tech stacks causing prospect drop-off"

Extract concepts from each major section:
- opening_trifecta (The Number / The Unspoken / The Flip) — the reframe at the top
- main_content (the Tactic / Take / Story / Rant / Special) — the central move or argument
- worth_knowing (each of the 3 items) — the news angle

For each concept, also note the surface_form — the literal phrase or framing the issue used (e.g. "the 15-minute ritual", "the retainer surge", "your stack is broken").

Return ONLY this JSON, no preamble:
{
  "concepts": [
    {
      "sectionName": "opening_trifecta" | "main_content" | "worth_knowing_1" | "worth_knowing_2" | "worth_knowing_3" | "first_pull",
      "conceptSummary": "2-3 sentence semantic summary of the underlying idea",
      "surfaceForm": "the literal phrase or framing the issue used, or null if not memorable"
    }
  ]
}

Target 5-10 concepts total. Quality over quantity — only surface what's actually distinctive.`;

function buildExtractUserPrompt(content: DailyGrindContent): string {
  const parts: string[] = [];
  parts.push(`Headline: ${content.headline}`);
  parts.push(`Content type: ${content.contentType}`);
  parts.push(`\nOpening Trifecta:`);
  parts.push(`  The Number: ${content.openingTrifecta.theNumber.stat} — ${content.openingTrifecta.theNumber.description}`);
  parts.push(`  The Unspoken: ${content.openingTrifecta.theUnspoken}`);
  parts.push(`  The Flip: ${content.openingTrifecta.theFlip.conventional} → ${content.openingTrifecta.theFlip.reality}`);
  parts.push(`\nFirst Pull:`);
  for (const p of content.firstPull.paragraphs) parts.push(`  ${p}`);
  parts.push(`\nWorth Knowing items:`);
  content.worthKnowing.forEach((item, i) => {
    parts.push(`  Item ${i + 1} [${item.category}]: ${item.headline}`);
    parts.push(`    ${item.body}`);
    parts.push(`    Take: ${item.myTake}`);
  });
  parts.push(`\nMain content (${content.contentType}):`);
  parts.push(`  Subhead: ${content.mainContent.subhead}`);
  parts.push(`  Intro: ${content.mainContent.intro}`);
  parts.push(`  How-to title: ${content.mainContent.howTo.title}`);
  content.mainContent.howTo.steps.forEach((s) => {
    parts.push(`    ${s.label}: ${s.body}`);
  });
  parts.push(`  Closing: ${content.mainContent.closing}`);
  parts.push(`\nGrounds for Thought: ${content.groundsForThought}`);
  return parts.join("\n");
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    if (lines.length >= 3 && lines[lines.length - 1]!.startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return trimmed;
}

function extractJsonObject(text: string): string {
  const cleaned = stripCodeFences(text);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`brain: no JSON found in extract output: ${cleaned.slice(0, 200)}`);
  }
  return cleaned.slice(firstBrace, lastBrace + 1);
}

async function extractConceptsWithHaiku(
  anthropic: Anthropic,
  content: DailyGrindContent,
): Promise<{ concepts: ExtractedConcept[]; inputTokens: number; outputTokens: number }> {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    temperature: 0.2,
    system: EXTRACT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildExtractUserPrompt(content) }],
  });
  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("brain: haiku response missing text");
  }
  const json = extractJsonObject(firstBlock.text);
  const parsed = JSON.parse(json) as { concepts?: unknown[] };
  const raw = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  const concepts: ExtractedConcept[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    const sectionName = typeof obj.sectionName === "string" ? obj.sectionName.trim() : "";
    const conceptSummary = typeof obj.conceptSummary === "string" ? obj.conceptSummary.trim() : "";
    if (!sectionName || !conceptSummary) continue;
    const surfaceForm =
      typeof obj.surfaceForm === "string" && obj.surfaceForm.trim() !== ""
        ? obj.surfaceForm.trim()
        : null;
    concepts.push({ sectionName, conceptSummary, surfaceForm });
  }
  return {
    concepts,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ─── OpenAI embeddings ──────────────────────────────────────────────────────

async function embedTexts(
  openai: OpenAI,
  texts: string[],
): Promise<{ embeddings: number[][]; tokens: number }> {
  if (texts.length === 0) return { embeddings: [], tokens: 0 };
  const response = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  if (response.data.length !== texts.length) {
    throw new Error(`brain: embedding count mismatch — sent ${texts.length}, got ${response.data.length}`);
  }
  const embeddings = response.data.map((d) => {
    if (!d.embedding || d.embedding.length !== EMBEDDING_DIMS) {
      throw new Error(`brain: unexpected embedding shape, len=${d.embedding?.length}`);
    }
    return d.embedding;
  });
  return { embeddings, tokens: response.usage.total_tokens };
}

// ─── Persistence ────────────────────────────────────────────────────────────

async function persistConcepts(
  db: SupabaseClient,
  brandId: string,
  issueDate: string,
  concepts: ExtractedConcept[],
  embeddings: number[][],
): Promise<number> {
  if (concepts.length === 0) return 0;
  const rows = concepts.map((c, i) => ({
    brand_id: brandId,
    episode_id: null,
    section_name: c.sectionName,
    concept_summary: c.conceptSummary,
    concept_embedding: embeddings[i] ?? null,
    surface_form: c.surfaceForm,
    raw_content: { issueDate, source: "daily_grind_test" },
    used_at: new Date().toISOString(),
  }));
  const { data, error } = await db.from("content_concepts").insert(rows).select("id");
  if (error) throw new Error(`brain: persist failed — ${error.message}`);
  return data?.length ?? 0;
}

// ─── Public: extract + persist after each issue ─────────────────────────────

export async function extractAndPersistConcepts(opts: {
  db: SupabaseClient;
  content: DailyGrindContent;
  issueDate: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}): Promise<BrainPersistResult> {
  const start = Date.now();
  const anthropic = new Anthropic({
    apiKey: opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
  });
  const openai = new OpenAI({ apiKey: opts.openaiApiKey ?? process.env.OPENAI_API_KEY });

  const extract = await extractConceptsWithHaiku(anthropic, opts.content);
  const embedded = await embedTexts(
    openai,
    extract.concepts.map((c) => c.conceptSummary),
  );
  const persisted = await persistConcepts(
    opts.db,
    BRAND_ID,
    opts.issueDate,
    extract.concepts,
    embedded.embeddings,
  );

  const cost =
    (extract.inputTokens / 1_000_000) * HAIKU_INPUT_PER_M +
    (extract.outputTokens / 1_000_000) * HAIKU_OUTPUT_PER_M +
    (embedded.tokens / 1_000_000) * EMBEDDING_PER_M;

  return {
    conceptsExtracted: extract.concepts.length,
    conceptsEmbedded: embedded.embeddings.length,
    conceptsPersisted: persisted,
    haikuInputTokens: extract.inputTokens,
    haikuOutputTokens: extract.outputTokens,
    embeddingTokens: embedded.tokens,
    costUsd: cost,
    latencyMs: Date.now() - start,
  };
}

// ─── Public: load + check for next issue ────────────────────────────────────

export async function loadRecentConceptSummaries(
  db: SupabaseClient,
  limit = 60,
): Promise<string[]> {
  // First try the RPC (preferred — supports the since-window filter cleanly).
  // Fall back to a direct SELECT if the RPC isn't installed (migration 0008
  // not applied). The direct query doesn't require any installed function.
  const rpcResult = await db.rpc("recent_content_concepts", {
    p_brand_id: BRAND_ID,
    match_count: limit,
  });
  if (!rpcResult.error && rpcResult.data) {
    return ((rpcResult.data ?? []) as RecentConcept[]).map((r) => {
      const sf = r.surfaceForm ? ` ("${r.surfaceForm}")` : "";
      return `${r.conceptSummary}${sf}`;
    });
  }
  // Fallback: direct table query (no RPC needed).
  const sinceDate = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("content_concepts")
    .select("concept_summary, surface_form, used_at")
    .eq("brand_id", BRAND_ID)
    .gte("used_at", sinceDate)
    .order("used_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return ((data ?? []) as Array<{ concept_summary: string; surface_form: string | null }>).map(
    (r) => {
      const sf = r.surface_form ? ` ("${r.surface_form}")` : "";
      return `${r.concept_summary}${sf}`;
    },
  );
}

export async function findSimilarConceptsForTexts(opts: {
  db: SupabaseClient;
  texts: string[];
  threshold?: number;
  perTextLimit?: number;
  openaiApiKey?: string;
}): Promise<Array<{ queryText: string; matches: SimilarConcept[] }>> {
  if (opts.texts.length === 0) return [];
  const openai = new OpenAI({ apiKey: opts.openaiApiKey ?? process.env.OPENAI_API_KEY });
  const { embeddings } = await embedTexts(openai, opts.texts);
  const threshold = opts.threshold ?? 0.82;
  const perTextLimit = opts.perTextLimit ?? 5;
  const out: Array<{ queryText: string; matches: SimilarConcept[] }> = [];
  for (let i = 0; i < opts.texts.length; i++) {
    const { data, error } = await opts.db.rpc("match_content_concepts", {
      query_embedding: embeddings[i],
      p_brand_id: BRAND_ID,
      match_threshold: threshold,
      match_count: perTextLimit,
    });
    if (error) {
      out.push({ queryText: opts.texts[i]!, matches: [] });
      continue;
    }
    out.push({
      queryText: opts.texts[i]!,
      matches: (data ?? []) as SimilarConcept[],
    });
  }
  return out;
}
