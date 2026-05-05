import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { ConfigError } from "@platform/schemas";
import type { ModuleFrontmatter, VoiceModule } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Root of the voice module file tree. Modules live as .md files under here.
 * Module IDs are paths relative to this root with .md stripped.
 *
 * Example: src/brands/castor-abbott/weekday/trust-stacking.md
 *   → module id: "brands/castor-abbott/weekday/trust-stacking"
 */
export const MODULES_ROOT = resolve(__dirname, "..");

const cache = new Map<string, VoiceModule>();

function moduleIdFromPath(absPath: string): string {
  const rel = relative(MODULES_ROOT, absPath);
  return rel.replace(/^src\//, "").replace(/\.md$/, "");
}

function moduleIdToPath(moduleId: string): string {
  return resolve(MODULES_ROOT, "src", `${moduleId}.md`);
}

function validateFrontmatter(fm: unknown, moduleId: string): ModuleFrontmatter {
  if (!fm || typeof fm !== "object") {
    throw new ConfigError(`voice module ${moduleId}: missing frontmatter`);
  }
  const obj = fm as Record<string, unknown>;
  const required = ["module_id", "version", "category", "description", "status"] as const;
  for (const k of required) {
    if (obj[k] === undefined || obj[k] === null) {
      throw new ConfigError(`voice module ${moduleId}: missing required frontmatter field: ${k}`);
    }
  }
  if (typeof obj.version !== "number") {
    throw new ConfigError(`voice module ${moduleId}: version must be a number`);
  }
  const status = obj.status as string;
  if (!["active", "experimental", "deprecated"].includes(status)) {
    throw new ConfigError(`voice module ${moduleId}: invalid status: ${status}`);
  }
  return obj as ModuleFrontmatter;
}

export async function loadModule(moduleId: string): Promise<VoiceModule> {
  const cached = cache.get(moduleId);
  if (cached) return cached;

  const filePath = moduleIdToPath(moduleId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new ConfigError(`voice module not found: ${moduleId}`, {
      context: { moduleId, filePath },
      cause: err instanceof Error ? err : undefined,
    });
  }

  const parsed = matter(raw);
  const frontmatter = validateFrontmatter(parsed.data, moduleId);

  const mod: VoiceModule = {
    id: moduleId,
    frontmatter,
    body: parsed.content.trim(),
    filePath,
  };
  cache.set(moduleId, mod);
  return mod;
}

export async function listModules(): Promise<string[]> {
  const root = resolve(MODULES_ROOT, "src");
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir);
    for (const e of entries) {
      const p = join(dir, e);
      const s = await stat(p);
      if (s.isDirectory()) await walk(p);
      else if (s.isFile() && e.endsWith(".md")) {
        out.push(moduleIdFromPath(p));
      }
    }
  }

  await walk(root);
  return out.sort();
}
