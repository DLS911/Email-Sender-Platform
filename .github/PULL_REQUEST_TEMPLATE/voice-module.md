## Voice module change

<!-- Use this template for any change under packages/voice-modules/. -->

## What changed

<!-- One sentence. Why the voice needed sharpening or correcting. -->

## Modules touched

<!-- List module IDs and version bumps. -->

- `brands/castor-abbott/weekday/<module>` — vN → vN+1
- `core/<module>` — typo fix (no version bump)

## Checklist

- [ ] `version` bumped in frontmatter for every substantive change (typo fixes don't bump)
- [ ] `last_updated` field updated
- [ ] `description` still accurate
- [ ] `status` correct (`active`, `experimental`, or `deprecated`)
- [ ] Voice registry sync passes (`pnpm --filter @platform/voice-modules registry:sync`)
- [ ] If a brand voice config references this module, it was reviewed for compatibility
- [ ] If this is a deprecation, downstream `brand_voice_configs` were updated to drop the reference
