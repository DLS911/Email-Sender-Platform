/**
 * v2 Composite route (MVP). Full spec §4 requires curated library +
 * rembg cutout + programmatic placement + CLIP/DINO identity check.
 * All of that is deferred. For MVP, this route delegates to the
 * existing v1 image paths so we can ship a v2 email today, then
 * substitute real composite as the harness comes online.
 *
 * The route logs its provenance so we can see in Vercel logs which
 * slots ran through legacy delegation.
 */

import type { V2ValidatorContext } from "./validator";
import { scoreCandidate } from "./validator";
import { generateTastingImageWithReference, generateDriveImageWithReference } from "../saturday-latte-images";

export type V2CompositeResult = {
  bytes: Uint8Array;
  mimeType: string;
  score: number;
  route: "composite-legacy";
  referenceUrl?: string;
  usedReference: boolean;
  deductions: Array<{ code: string; weight: number; note: string }>;
};

export async function generateProductOrDrinkSlot(opts: {
  apiKey: string;
  subject: string;
  kind: "book" | "film" | "product" | "drink" | "unknown";
  slotPrompt: string;
  sectionTag: string;
  validatorCtx: V2ValidatorContext;
}): Promise<V2CompositeResult | null> {
  const { apiKey, subject, kind, slotPrompt, sectionTag, validatorCtx } = opts;
  try {
    const legacy = await generateTastingImageWithReference(apiKey, slotPrompt, sectionTag, subject, kind);
    const verdict = await scoreCandidate(legacy.bytes, legacy.mimeType, validatorCtx);
    const result: V2CompositeResult = {
      bytes: legacy.bytes,
      mimeType: legacy.mimeType,
      score: verdict.score,
      route: "composite-legacy",
      usedReference: legacy.usedReference,
      deductions: verdict.deductions,
    };
    if (legacy.referenceUrl) result.referenceUrl = legacy.referenceUrl;
    console.info("latte-v2.composite_legacy_result", {
      subject,
      kind,
      score: verdict.score,
      usedReference: legacy.usedReference,
    });
    return result;
  } catch (err) {
    console.error("latte-v2.composite_legacy_threw", {
      subject,
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function generateCarSlot(opts: {
  apiKey: string;
  carName: string;
  slotPrompt: string;
  sectionTag: string;
  validatorCtx: V2ValidatorContext;
}): Promise<V2CompositeResult | null> {
  const { apiKey, carName, slotPrompt, sectionTag, validatorCtx } = opts;
  try {
    const legacy = await generateDriveImageWithReference(apiKey, slotPrompt, sectionTag, carName);
    const verdict = await scoreCandidate(legacy.bytes, legacy.mimeType, validatorCtx);
    const result: V2CompositeResult = {
      bytes: legacy.bytes,
      mimeType: legacy.mimeType,
      score: verdict.score,
      route: "composite-legacy",
      usedReference: legacy.usedReference,
      deductions: verdict.deductions,
    };
    if (legacy.referenceUrl) result.referenceUrl = legacy.referenceUrl;
    console.info("latte-v2.car_legacy_result", {
      car: carName,
      score: verdict.score,
      usedReference: legacy.usedReference,
    });
    return result;
  } catch (err) {
    console.error("latte-v2.car_legacy_threw", {
      car: carName,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
