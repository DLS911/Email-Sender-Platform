import { logger } from "@platform/observability";
import { loadModule } from "./loader.js";
import type { ComposeOptions } from "./types.js";

const DIVIDER = "\n\n---\n\n";

/**
 * Compose a system prompt from a list of voice module IDs. Modules are
 * concatenated in the order given, separated by markdown dividers.
 *
 * The composer:
 *   - loads each module (cached after first load)
 *   - emits a `voice.composed` log row capturing which module versions were used
 *   - returns the assembled system prompt as a string
 *
 * Composition is deterministic: same module IDs at same versions always
 * produce identical output. This is what makes prompt regression tests work.
 */
export async function composeVoice(opts: ComposeOptions): Promise<string> {
  const modules = await Promise.all(opts.modules.map((id) => loadModule(id)));

  for (const mod of modules) {
    if (mod.frontmatter.status === "deprecated") {
      logger.warn("voice.deprecated_module_loaded", {
        block_name: opts.context.blockName,
        run_id: opts.context.runId,
        brand_id: opts.context.brandId,
        module_id: mod.id,
        version: mod.frontmatter.version,
      });
    }
  }

  logger.info("voice.composed", {
    block_name: opts.context.blockName,
    run_id: opts.context.runId,
    brand_id: opts.context.brandId,
    voice_modules: modules.map((m) => ({ id: m.id, version: m.frontmatter.version })),
  });

  return modules.map((m) => m.body).join(DIVIDER);
}
