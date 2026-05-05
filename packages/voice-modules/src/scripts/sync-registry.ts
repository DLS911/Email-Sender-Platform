/**
 * CI script: walk the voice module file tree, validate every module's
 * frontmatter, and upsert rows in the `voice_module_registry` table.
 *
 * Run by .github/workflows/ci.yml on every deploy. Failures (malformed
 * frontmatter, missing required fields) fail the build.
 *
 * Modules in the registry but missing from the file tree are marked
 * `deprecated` (not deleted) — past brand_voice_configs may still
 * reference them.
 */
import { listModules, loadModule } from "../loader.js";

async function main(): Promise<void> {
  const ids = await listModules();
  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    try {
      const mod = await loadModule(id);
      ok++;
      console.log(
        `OK  ${id} v${mod.frontmatter.version} [${mod.frontmatter.status}] ${mod.frontmatter.category}`,
      );
    } catch (err) {
      fail++;
      console.error(`FAIL ${id}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\n${ok} ok / ${fail} failed (${ids.length} total)`);
  if (fail > 0) process.exit(1);

  // TODO(stage-2): once Supabase is provisioned, upsert rows into
  // voice_module_registry here. For now this script just validates frontmatter.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
