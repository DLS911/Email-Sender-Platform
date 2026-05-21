/**
 * Persona Evaluate Block — adapted from
 * /apps/pipeline/src/prompt-templates/blocks/persona_evaluate.ts
 *
 * Each call inhabits ONE persona (loaded as the system prompt from
 * personas.ts) and evaluates the issue. The panel runs 10 of these in
 * parallel to produce the full persona evaluation.
 *
 * Returns probabilities, love rating, voice fit, flags, and a persona-voice
 * reaction. The score_aggregator block reduces these to a pass/fail verdict.
 */

import type { PersonaSlug } from "./personas";

export type PersonaEvaluateInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  personaSlug: PersonaSlug;
  factCheckedDraftJson: string;
};

function formatSection(label: string, body: string): string {
  return `## ${label}\n\n${body.trim()}`;
}

function wrapInTag(tag: string, content: string): string {
  return `<${tag}>\n${content.trim()}\n</${tag}>`;
}

export function buildPersonaEvaluatePrompt(input: PersonaEvaluateInput): string {
  const sections: string[] = [];

  sections.push(
    `You are evaluating an issue of The ${input.edition === "weekday" ? "Daily Grind" : "Saturday Morning Latte"} as the ${input.personaSlug} persona. The persona profile loaded in the system prompt describes who you are, what you care about, what you flag, and how you typically engage with content. Inhabit that persona for this evaluation. Do not break character.`,
  );

  sections.push(
    formatSection("Issue to Evaluate", wrapInTag("issue_json", input.factCheckedDraftJson)),
  );

  sections.push(
    formatSection(
      "Your Evaluation Task",
      `As the ${input.personaSlug} persona, evaluate this issue. Provide:

1. **Probability you would open** based on subject line / first paragraph (0.0 to 1.0)
2. **Probability you would read to completion** if opened (0.0 to 1.0)
3. **Probability you would click** any links (0.0 to 1.0)
4. **Probability you would reply** with your own experience or thoughts (0.0 to 1.0)
5. **Probability you would forward** to a peer (0.0 to 1.0)
6. **Probability you would unsubscribe** based on this issue alone (0.0 to 1.0)
7. **Love rating:** Would you love this issue? (boolean — true if "yes, this is the kind of content I subscribe for")
8. **Specific flags:** What about this issue would you flag, based on your flag_triggers from the system prompt
9. **Voice fit:** Does this issue sound like the brand voice? (excellent | good | acceptable | drift | failure)
10. **Specific reaction:** 2-3 sentences in your persona voice describing your reaction

**Calibration discipline:**
The probabilities should reflect your persona's baseline metrics. If your baseline open rate is 0.42, your probability-of-opening for an average issue should be ~0.42. Adjust based on how this specific issue lands.

**Flag discipline:**
Only flag issues matching your flag_triggers. Don't manufacture flags.

**Voice integrity:**
Your "specific reaction" should sound like the persona, not generic feedback.`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return your evaluation as JSON:

{
  "personaSlug": "${input.personaSlug}",
  "probabilities": {
    "open": <0.0 to 1.0>,
    "readToCompletion": <0.0 to 1.0>,
    "click": <0.0 to 1.0>,
    "reply": <0.0 to 1.0>,
    "forward": <0.0 to 1.0>,
    "unsubscribe": <0.0 to 1.0>
  },
  "loveRating": <boolean>,
  "voiceFit": "excellent | good | acceptable | drift | failure",
  "flags": [
    { "trigger": "<flag trigger>", "specificInstance": "<what triggered it>", "severity": "high | medium | low" }
  ],
  "specificReaction": "<2-3 sentences in your persona voice>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}

export type PersonaEvaluation = {
  personaSlug: PersonaSlug;
  probabilities: {
    open: number;
    readToCompletion: number;
    click: number;
    reply: number;
    forward: number;
    unsubscribe: number;
  };
  loveRating: boolean;
  voiceFit: "excellent" | "good" | "acceptable" | "drift" | "failure";
  flags: Array<{ trigger: string; specificInstance: string; severity: "high" | "medium" | "low" }>;
  specificReaction: string;
};
