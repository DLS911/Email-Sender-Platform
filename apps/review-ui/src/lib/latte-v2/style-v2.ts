/**
 * v2 image style suffix — replaces the ~1400-word negatives block in v1
 * (LATTE_IMAGE_STYLE_SUFFIX). Positive-only, descriptive. Rules that were
 * negatives now live in the scoring validator (see validator.ts).
 *
 * Only one universal negative kept: no text/logos/signage in the frame.
 * Every other rule (physics, kitchen logic, pair counts, structural
 * coherence, etc.) is a validator deduction.
 */
export const STYLE_V2 = `

Editorial photograph in the register of Garden & Gun and Kinfolk. Natural light only, one clear light direction with true shadows. 50mm or 90mm lens look, shallow but real depth of field, rule-of-thirds framing, subject off-centre. Kodak Ektar for landscape, Portra 400 for interiors and food. Muted, accurate colour. Textured, wind-broken water; structured, patchy mist where mist exists. Clean, uncluttered surfaces. Square 1:1. No text, lettering, captions, logos or signage anywhere in the frame.`;
