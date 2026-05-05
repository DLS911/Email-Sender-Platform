/**
 * Read persona modules from packages/voice-modules at build time.
 * Each persona becomes a static page at /voice/personas/[slug].
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import matter from "gray-matter";

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const PERSONAS_ROOT = resolve(
  REPO_ROOT,
  "packages",
  "voice-modules",
  "src",
  "brands",
  "castor-abbott",
  "personas",
);

export type PersonaProfile = {
  slug: string;
  moduleId: string;
  title: string;
  description: string;
  status: "active" | "experimental" | "deprecated";
  version: number;
  body: string;
};

function fileToSlug(file: string): string {
  // persona-3-wirehouse-refugee.md → wirehouse-refugee
  return file.replace(/\.md$/, "").replace(/^persona-\d+-/, "");
}

function titleFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function loadAllPersonas(): PersonaProfile[] {
  const files = readdirSync(PERSONAS_ROOT).filter((f) => f.endsWith(".md"));
  const profiles: PersonaProfile[] = [];
  for (const file of files) {
    const raw = readFileSync(resolve(PERSONAS_ROOT, file), "utf8");
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    const slug = fileToSlug(file);
    profiles.push({
      slug,
      moduleId: typeof fm.module_id === "string" ? fm.module_id : `personas/${slug}`,
      title: titleFromSlug(slug),
      description: typeof fm.description === "string" ? fm.description : "",
      status: fm.status === "experimental" || fm.status === "deprecated" ? fm.status : "active",
      version: typeof fm.version === "number" ? fm.version : 1,
      body: parsed.content.trim(),
    });
  }
  return profiles.sort((a, b) => a.slug.localeCompare(b.slug));
}

export function loadPersona(slug: string): PersonaProfile | null {
  return loadAllPersonas().find((p) => p.slug === slug) ?? null;
}

export function listPersonaSlugs(): string[] {
  return loadAllPersonas().map((p) => p.slug);
}
