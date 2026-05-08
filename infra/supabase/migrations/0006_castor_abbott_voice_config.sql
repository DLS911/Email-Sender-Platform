-- Castor Abbott v1 brand voice config. Per spec 03 § Brand Voice Config.
--
-- One active config per brand. Inserts the v1 module list that maps
-- (block, edition, content_type) to the modules composeVoice() loads.
--
-- Voice changes after this point are new versions: insert a new row with
-- version = current+1 and is_active=true; flip the previous active row.
-- Past pipeline_runs reference the version that was active at the time.
--
-- Uses jsonb_build_object/jsonb_build_array to construct the value
-- server-side (immune to copy-paste line-wrapping issues that plain
-- JSON string literals can hit).

INSERT INTO brand_voice_configs (brand_id, version, is_active, config, notes)
SELECT 'castor_abbott', 1, true, jsonb_build_object(
  'weekday', jsonb_build_object(
    'shared_modules', jsonb_build_array(
      'core/voice-rules',
      'core/llm-output-discipline',
      'core/editorial-quality',
      'brands/castor-abbott/shared/mark-persona',
      'brands/castor-abbott/shared/author-credibility',
      'brands/castor-abbott/shared/audience'
    ),
    'voice_modules', jsonb_build_array(
      'brands/castor-abbott/weekday/voice-tone',
      'brands/castor-abbott/weekday/trust-stacking',
      'brands/castor-abbott/weekday/physician-model',
      'brands/castor-abbott/weekday/gap-framework',
      'brands/castor-abbott/weekday/three-torments',
      'brands/castor-abbott/weekday/offers-vs-proposals',
      'brands/castor-abbott/weekday/contrarian-positions',
      'brands/castor-abbott/weekday/language-guide',
      'brands/castor-abbott/weekday/synthesis'
    ),
    'content_type_modules', jsonb_build_object(
      'tactic', 'brands/castor-abbott/weekday/content-type-tactic',
      'take', 'brands/castor-abbott/weekday/content-type-take',
      'story', 'brands/castor-abbott/weekday/content-type-story',
      'rant', 'brands/castor-abbott/weekday/content-type-rant',
      'special', 'brands/castor-abbott/weekday/content-type-special',
      'ancient_truth', 'brands/castor-abbott/weekday/content-type-ancient-truth'
    ),
    'persona_modules', jsonb_build_array(
      'brands/castor-abbott/personas/persona-1-solo-operator',
      'brands/castor-abbott/personas/persona-2-rising-star',
      'brands/castor-abbott/personas/persona-3-wirehouse-refugee',
      'brands/castor-abbott/personas/persona-4-fee-only-purist',
      'brands/castor-abbott/personas/persona-5-women-advisor',
      'brands/castor-abbott/personas/persona-6-next-gen-inheritor',
      'brands/castor-abbott/personas/persona-7-niche-specialist',
      'brands/castor-abbott/personas/persona-8-team-builder',
      'brands/castor-abbott/personas/persona-9-veteran',
      'brands/castor-abbott/personas/persona-10-compliance-conscious'
    )
  ),
  'weekend', jsonb_build_object(
    'shared_modules', jsonb_build_array(
      'core/voice-rules',
      'core/llm-output-discipline',
      'core/editorial-quality',
      'brands/castor-abbott/shared/mark-persona',
      'brands/castor-abbott/shared/audience'
    ),
    'voice_modules', jsonb_build_array(
      'brands/castor-abbott/weekend/voice-tone',
      'brands/castor-abbott/weekend/personal-context',
      'brands/castor-abbott/weekend/real-life-anchors',
      'brands/castor-abbott/weekend/unexpected-variable',
      'brands/castor-abbott/weekend/insight-layer',
      'brands/castor-abbott/weekend/guardrails',
      'brands/castor-abbott/weekend/what-this-voice-isnt'
    ),
    'section_modules', jsonb_build_object(
      'the_drive', 'brands/castor-abbott/weekend/car-spectrum'
    ),
    'content_type_modules', jsonb_build_object(
      'type_1', 'brands/castor-abbott/weekend/content-type-1-overlooked-destination',
      'type_2', 'brands/castor-abbott/weekend/content-type-2-luxury-insider',
      'type_3', 'brands/castor-abbott/weekend/content-type-3-peak-season-smart',
      'type_4', 'brands/castor-abbott/weekend/content-type-4-food-first-travel',
      'type_5', 'brands/castor-abbott/weekend/content-type-5-international-insider',
      'type_6', 'brands/castor-abbott/weekend/content-type-6-activity-mastery',
      'type_7', 'brands/castor-abbott/weekend/content-type-7-family-reality',
      'type_8', 'brands/castor-abbott/weekend/content-type-8-tactical-weekend',
      'type_9', 'brands/castor-abbott/weekend/content-type-9-logistics-hack',
      'type_10', 'brands/castor-abbott/weekend/content-type-10-hyper-local'
    ),
    'persona_modules', jsonb_build_array(
      'brands/castor-abbott/personas/persona-1-solo-operator',
      'brands/castor-abbott/personas/persona-2-rising-star',
      'brands/castor-abbott/personas/persona-3-wirehouse-refugee',
      'brands/castor-abbott/personas/persona-4-fee-only-purist',
      'brands/castor-abbott/personas/persona-5-women-advisor',
      'brands/castor-abbott/personas/persona-6-next-gen-inheritor',
      'brands/castor-abbott/personas/persona-7-niche-specialist',
      'brands/castor-abbott/personas/persona-8-team-builder',
      'brands/castor-abbott/personas/persona-9-veteran',
      'brands/castor-abbott/personas/persona-10-compliance-conscious'
    )
  )
), 'v1 — initial port from MindStudio system. See spec 03_voice_system § Castor Abbott Voice.'
ON CONFLICT (brand_id, version) DO NOTHING;
