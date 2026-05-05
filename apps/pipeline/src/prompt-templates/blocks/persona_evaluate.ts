/**
 * Persona Evaluate Block
 *
 * Simulates a single persona's response to a finalized issue. Called 10
 * times in parallel — once per persona in the panel — to produce the full
 * persona panel evaluation.
 *
 * The system prompt for THIS block is special: it loads the specific
 * persona's module (e.g. persona-1-solo-operator.md) along with the brand
 * voice modules. That gives the LLM the persona's full profile, content
 * type preferences, flag triggers, and calibration metadata.
 *
 * The user prompt provides the issue to evaluate and asks for the persona's
 * structured response.
 */

import { formatSection, wrapInTag } from "../_shared/formatters";

export type PersonaEvaluateInput = {
  brandId: string;
  edition: "weekday" | "weekend";
  issueDate: string;
  contentType: string;
  personaSlug: string; // e.g. "solo-operator", "rising-star"
  factCheckedDraftJson: string; // the post-fact-check final draft
};

/**
 * Build the user prompt for a single persona's evaluation.
 *
 * The persona module is loaded into the system prompt. The user prompt
 * just provides the issue and asks for the response.
 */
export function buildPersonaEvaluatePrompt(input: PersonaEvaluateInput): string {
  const sections: string[] = [];

  sections.push(
    `You are evaluating an issue of the ${input.edition === "weekday" ? "Daily Grind" : "Saturday Morning Latte"} as the ${input.personaSlug} persona. The persona module loaded in the system prompt describes who you are, what you care about, what you flag, and how you typically engage with content. Inhabit that persona for this evaluation. Do not break character.`,
  );

  sections.push(
    formatSection("Issue to Evaluate", wrapInTag("issue_json", input.factCheckedDraftJson)),
  );

  sections.push(
    formatSection(
      "Your Evaluation Task",
      `As the ${input.personaSlug} persona, evaluate this issue. Provide:

1. **Probability you would open this issue** based on subject line / first paragraph (0.0 to 1.0)
2. **Probability you would read the main section to completion** if you opened (0.0 to 1.0)
3. **Probability you would click into any links** (0.0 to 1.0)
4. **Probability you would reply** with your own experience or thoughts (0.0 to 1.0)
5. **Probability you would forward** this issue to a peer (0.0 to 1.0)
6. **Probability you would unsubscribe** based on this issue alone (0.0 to 1.0)
7. **Love rating:** Would you love this issue? (boolean — true if "yes, this is the kind of content I subscribe for")
8. **Specific flags:** What about this issue would you flag, based on your persona's flag_triggers from the system prompt module
9. **Voice fit:** Does this issue sound like the brand voice you've come to recognize? (excellent | good | acceptable | drift | failure)
10. **Specific reactions:** 2-3 sentences in your persona voice describing your reaction to this specific issue

**Calibration discipline:**
The probabilities should reflect your persona's baseline metrics from the system prompt module. If your baseline open rate is 0.42, your probability-of-opening for an average issue should be ~0.42. Issues that are unusually well-fit to your persona should produce higher probabilities; issues that are poorly fit should produce lower. Don't anchor every probability at 0.5; use the baseline as your starting point and adjust based on how this specific issue lands.

**Flag discipline:**
Only flag issues that match your persona's flag_triggers. Don't manufacture flags for content that's just neutral for your persona. The flag list is calibrated to specific content patterns; respect that calibration.

**Voice integrity:**
Your "specific reactions" should sound like the persona, not like generic feedback. A Solo Operator's reaction reads differently from a Rising Star's, which reads differently from a Veteran's. The system prompt module describes the persona's voice; match it.`,
    ),
  );

  sections.push(
    formatSection(
      "Output Format",
      `Return your evaluation as JSON with this exact shape:

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
    {
      "trigger": "<flag trigger from your persona module>",
      "specificInstance": "<what specifically triggered the flag>",
      "severity": "high | medium | low"
    }
  ],
  "specificReaction": "<2-3 sentences in your persona voice — what you actually thought reading this issue>"
}

Return ONLY the JSON object. No preamble, no commentary, no markdown fences.`,
    ),
  );

  return sections.join("\n\n");
}
