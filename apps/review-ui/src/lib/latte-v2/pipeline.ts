/**
 * v2 pipeline orchestrator. Runs research → writer → v2 image gen
 * (scene route best-of-N; composite route delegated for MVP).
 * Persists the issue to `saturday_latte_issues` under a v2-tagged
 * `sections.pipelineVersion = "v2"` so the DB knows which pipeline
 * produced the row.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  runPerplexityResearch,
  runWriterPhase,
  type LatteResearch,
} from "../saturday-latte-generator";
import type { SaturdayLatteContent } from "../saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../saturday-latte-html-template";
import {
  loadRecentCoverStories,
  loadRecentLatteContext,
  type RecentLatteContext,
} from "../saturday-latte-cron";
import { sendPreviewEmail } from "../preview-email";
import { formatVisualFactsForWriter, researchCar, researchDish, researchPlace, type VisualFacts } from "./research";
import { generateSceneSlot, type V2SceneResult } from "./scene-route";
import { generateProductOrDrinkSlot, generateCarSlot, type V2CompositeResult } from "./composite-route";
import type { V2ValidatorContext } from "./validator";
import { getStorageClient, uploadToStorage, extForMime } from "../saturday-latte-images";

export type V2Result = {
  targetDate: string;
  generated: boolean;
  reusedExisting: boolean;
  headline: string | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
  perSlot?: Array<{
    slot: string;
    route: string;
    score: number;
    belowThreshold?: boolean;
    deductions?: Array<{ code: string; note: string; weight: number }>;
    referenceUrl?: string;
  }>;
};

function nextSaturday(from: Date): string {
  const d = new Date(from);
  const day = d.getUTCDay();
  const daysUntilSaturday = (6 - day + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + daysUntilSaturday);
  return d.toISOString().slice(0, 10);
}

function getServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("latte-v2: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function runLatteGenerateV2(opts: { targetDate?: string; regenerate?: boolean }): Promise<V2Result> {
  const targetDate = opts.targetDate ?? nextSaturday(new Date());
  const result: V2Result = {
    targetDate,
    generated: false,
    reusedExisting: false,
    headline: null,
    costUsd: null,
    latencyMs: null,
    error: null,
  };
  try {
    const db = getServiceRoleClient();

    // Stale-cache check identical to v1 — 12h TTL, regenerate=1 bypasses.
    const STALE_HOURS = 12;
    if (!opts.regenerate) {
      const { data: existing } = await db
        .from("saturday_latte_issues")
        .select("issue_date, cover_story_headline, generated_at")
        .eq("issue_date", targetDate)
        .maybeSingle();
      if (existing) {
        const generatedAt = existing.generated_at ? new Date(existing.generated_at) : null;
        const ageHours = generatedAt ? (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
        if (ageHours <= STALE_HOURS) {
          result.reusedExisting = true;
          result.headline = existing.cover_story_headline;
          return result;
        }
      }
    }

    const [recentCoverStories, recentContext] = await Promise.all([
      loadRecentCoverStories(db, 200),
      loadRecentLatteContext(db, 200),
    ]);

    const start = Date.now();
    const anthropicKeyOrUndef = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKeyOrUndef) throw new Error("ANTHROPIC_API_KEY missing");
    const anthropicKey: string = anthropicKeyOrUndef;
    const client = new Anthropic({ apiKey: anthropicKey });

    // 1. Perplexity research (unchanged from v1).
    const research = await runPerplexityResearch(
      process.env.PERPLEXITY_API_KEY
        ? { issueDate: targetDate, recentCoverStories, apiKey: process.env.PERPLEXITY_API_KEY, ...(recentContext ? { recentContext } : {}) }
        : { issueDate: targetDate, recentCoverStories, ...(recentContext ? { recentContext } : {}) },
    );

    // 2. First writer pass (no visualFacts yet — needed for its picks).
    let writer = await runWriterPhase(client, targetDate, research.bundle as LatteResearch, recentCoverStories, recentContext);

    // 3. v2 research on the writer's picks. Runs in parallel; each call
    //    returns undefined if Haiku doesn't know the subject well enough.
    const [placeFacts, dishFacts, carFacts] = await Promise.all([
      researchPlace(writer.content.coverStoryHeadline),
      researchDish(writer.content.hostsCorner.moveTitle),
      researchCar(writer.content.theDrive.car),
    ]);
    const visualFacts: VisualFacts = {};
    if (placeFacts) visualFacts.place = placeFacts;
    if (dishFacts) visualFacts.dish = dishFacts;
    if (carFacts) visualFacts.car = carFacts;
    const factsBlock = formatVisualFactsForWriter(visualFacts);

    // 4. Second writer pass with visualFacts injected. Same writer, same
    //    research bundle, but the writer now knows the named landmarks /
    //    exact cookware / correct car generation code. Its imagePrompts
    //    are grounded in real named features.
    if (factsBlock) {
      const writer2 = await runWriterPhase(
        client,
        targetDate,
        research.bundle as LatteResearch,
        recentCoverStories,
        recentContext,
        undefined,
        factsBlock,
      );
      writer = {
        content: writer2.content,
        contentType: writer2.contentType,
        imagePrompts: writer2.imagePrompts,
        inputTokens: writer.inputTokens + writer2.inputTokens,
        outputTokens: writer.outputTokens + writer2.outputTokens,
        latencyMs: writer.latencyMs + writer2.latencyMs,
      };
    }

    if (!writer.imagePrompts) throw new Error("v2: writer produced no imagePrompts");
    const imagePrompts = writer.imagePrompts;

    // 5. Image generation. Scene slots get best-of-N; composite slots
    //    delegate to legacy paths for MVP. All results are scored.
    const perSlot: NonNullable<V2Result["perSlot"]> = [];
    const storage = getStorageClient();
    const genStamp = String(Math.floor(Date.now() / 1000));
    const uploadedUrls: Record<string, string> = {};

    async function shipToStorage(slot: string, res: V2SceneResult | V2CompositeResult): Promise<string> {
      const filename = `${targetDate}/v2-${slot}-${genStamp}.${extForMime(res.mimeType)}`;
      const url = await uploadToStorage(storage, res.bytes, filename, res.mimeType);
      perSlot.push({
        slot,
        route: res.route,
        score: res.score,
        ...("belowThreshold" in res && res.belowThreshold ? { belowThreshold: true } : {}),
        deductions: res.deductions.map((d) => ({ code: d.code, note: d.note, weight: d.weight })),
        ...("referenceUrl" in res && res.referenceUrl ? { referenceUrl: res.referenceUrl } : {}),
      });
      return url;
    }

    async function runScene(slot: "hero" | "coverDetail" | "hostsCorner", subject: string, prompt: string, validatorCtx: V2ValidatorContext): Promise<void> {
      const res = await generateSceneSlot({
        apiKey: anthropicKey,
        slot,
        subject,
        slotPrompt: prompt,
        n: 3,
        validatorCtx,
      });
      if (res) uploadedUrls[slot] = await shipToStorage(slot, res);
      else console.error("latte-v2.scene_slot_null", { slot, subject });
    }

    const heroValidatorCtx: V2ValidatorContext = {
      slot: "hero",
      subject: writer.content.coverStoryHeadline,
      ...(visualFacts.place ? { visualFacts: { landmarks: visualFacts.place.landmarks, ...(visualFacts.place.signatureSubject ? { signatureSubject: visualFacts.place.signatureSubject } : {}) } } : {}),
    };
    const coverDetailValidatorCtx: V2ValidatorContext = {
      slot: "coverDetail",
      subject: writer.content.coverStoryHeadline,
      ...(visualFacts.place ? { visualFacts: { landmarks: visualFacts.place.landmarks, ...(visualFacts.place.signatureSubject ? { signatureSubject: visualFacts.place.signatureSubject } : {}) } } : {}),
    };
    const hcValidatorCtx: V2ValidatorContext = {
      slot: "hostsCorner",
      subject: writer.content.hostsCorner.moveTitle,
      ...(visualFacts.dish ? { visualFacts: { cookware: visualFacts.dish.cookware } } : {}),
    };
    const carValidatorCtx: V2ValidatorContext = {
      slot: "theDrive",
      subject: writer.content.theDrive.car,
      ...(visualFacts.car ? { visualFacts: { ...(visualFacts.car.generationCode ? { generationCode: visualFacts.car.generationCode } : {}), features: visualFacts.car.features } } : {}),
    };

    // Fire all slots in parallel.
    const jobs: Array<Promise<void>> = [];
    jobs.push(runScene("hero", writer.content.coverStoryHeadline, imagePrompts.hero, heroValidatorCtx));
    jobs.push(runScene("coverDetail", writer.content.coverStoryHeadline, imagePrompts.coverDetail, coverDetailValidatorCtx));
    jobs.push(runScene("hostsCorner", writer.content.hostsCorner.moveTitle, imagePrompts.hostsCorner, hcValidatorCtx));

    // The Drive → composite-legacy route.
    jobs.push((async () => {
      const carRes = await generateCarSlot({
        apiKey: anthropicKey,
        carName: writer.content.theDrive.car,
        slotPrompt: imagePrompts.theDrive,
        sectionTag: `[Saturday Morning Latte v2 — The Drive] Subject: "${writer.content.theDrive.car}"`,
        validatorCtx: carValidatorCtx,
      });
      if (carRes) uploadedUrls["theDrive"] = await shipToStorage("theDrive", carRes);
      else console.error("latte-v2.car_slot_null");
    })());

    // Tasting menu → composite-legacy route.
    const tastingUrls: string[] = ["", "", ""];
    for (let i = 0; i < 3; i++) {
      jobs.push((async () => {
        const item = writer.content.tastingMenu[i];
        if (!item) return;
        const label = (item.label ?? "").toLowerCase();
        const kind: "book" | "film" | "product" | "drink" | "unknown" =
          label.includes("reading") ? "book"
          : label.includes("watching") ? "film"
          : label.includes("drinking") ? "drink"
          : label.includes("trying") || label.includes("listening") ? "product"
          : "unknown";
        const slotType: V2ValidatorContext["slot"] =
          kind === "book" ? "tastingMenu-book"
          : kind === "film" ? "tastingMenu-film-poster"
          : kind === "drink" ? "tastingMenu-drink"
          : "tastingMenu-product";
        const validatorCtx: V2ValidatorContext = { slot: slotType, subject: item.title };
        const res = await generateProductOrDrinkSlot({
          apiKey: anthropicKey,
          subject: item.title,
          kind,
          slotPrompt: imagePrompts.tastingMenu[i] ?? "",
          sectionTag: `[Saturday Morning Latte v2 — Tasting Menu #${i + 1}] Subject: "${item.title}"`,
          validatorCtx,
        });
        if (res) {
          const url = await shipToStorage(`tasting-${i + 1}`, res);
          tastingUrls[i] = url;
        } else {
          console.error("latte-v2.tasting_slot_null", { i, subject: item.title });
        }
      })());
    }

    await Promise.all(jobs);

    const contentWithImages: SaturdayLatteContent = {
      ...writer.content,
      images: {
        ...(uploadedUrls["hero"] ? { hero: uploadedUrls["hero"] } : {}),
        ...(uploadedUrls["coverDetail"] ? { coverDetail: uploadedUrls["coverDetail"] } : {}),
        ...(uploadedUrls["hostsCorner"] ? { hostsCorner: uploadedUrls["hostsCorner"] } : {}),
        ...(uploadedUrls["theDrive"] ? { theDrive: uploadedUrls["theDrive"] } : {}),
        ...(tastingUrls.some((u) => u) ? { tastingMenu: tastingUrls } : {}),
      },
    };

    const rendered = renderSaturdayLatteHtml(contentWithImages, {
      issueDate: targetDate,
      unsubscribeUrl: "{{unsubscribe_url}}",
      webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
    });

    // 6. Persist. Tag with pipelineVersion so we can distinguish v2 rows.
    const sections = {
      coverStory: {
        headline: contentWithImages.coverStoryHeadline,
        body: contentWithImages.coverStoryParagraphs.join("\n\n"),
      },
      tastingMenu: contentWithImages.tastingMenu,
      hostsCorner: contentWithImages.hostsCorner,
      theDrive: contentWithImages.theDrive,
      sundayPrep: contentWithImages.sundayPrep,
      sundayReset: contentWithImages.sundayReset,
      sabbath: contentWithImages.sabbath,
      ps: contentWithImages.ps,
      images: contentWithImages.images ?? null,
      pipelineVersion: "v2",
      v2VisualFacts: visualFacts,
      v2PerSlot: perSlot,
    };
    const { error: upsertErr } = await db.from("saturday_latte_issues").upsert(
      {
        issue_date: targetDate,
        cover_story_headline: contentWithImages.coverStoryHeadline,
        subject: rendered.subject,
        preheader: rendered.preheader,
        sections,
        html: rendered.html,
        text_body: rendered.text,
        model: "sonnet-4.5 + gemini-2.5-flash-image + haiku-4.5-v2",
        approval_status: "pending",
        generated_at: new Date().toISOString(),
      },
      { onConflict: "issue_date" },
    );
    if (upsertErr) throw new Error(`v2 upsert: ${upsertErr.message}`);

    result.generated = true;
    result.headline = contentWithImages.coverStoryHeadline;
    result.latencyMs = Date.now() - start;
    result.perSlot = perSlot;

    // 7. Preview email — reuse v1's helper.
    try {
      const baseUrl = process.env.PUBLIC_BASE_URL || "https://email-sndr-platform.vercel.app";
      await sendPreviewEmail({
        brand: "latte",
        issueDate: targetDate,
        subject: `[V2] ${rendered.subject}`,
        issueHtml: rendered.html,
        issueText: rendered.text,
        baseUrl,
      });
    } catch (err) {
      console.warn("latte-v2.preview_email_failed", err instanceof Error ? err.message : String(err));
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error("latte-v2.pipeline_fatal", { error: result.error });
    return result;
  }
}

export type { RecentLatteContext };
