/**
 * Voice module index for the review UI.
 *
 * Reads the actual markdown files from packages/voice-modules at build time
 * (server-side, via Node fs). The result is serialized into the static
 * page so the client never reads disk.
 *
 * When packaged as a Next.js static export, this runs during build.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import matter from "gray-matter";

type VoiceModuleSummary = {
  id: string;
  category: string;
  brand: string | null;
  edition: string | null;
  description: string;
  status: "active" | "experimental" | "deprecated";
  version: number;
  bodyExcerpt: string;
};

const REPO_ROOT = resolve(process.cwd(), "..", "..");
const MODULES_ROOT = resolve(REPO_ROOT, "packages", "voice-modules", "src");

function walkSync(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkSync(full, out);
    else if (s.isFile() && entry.endsWith(".md")) out.push(full);
  }
  return out;
}

export function loadAllVoiceModules(): VoiceModuleSummary[] {
  const files = walkSync(MODULES_ROOT);
  const out: VoiceModuleSummary[] = [];
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const parsed = matter(raw);
    const fm = parsed.data as Record<string, unknown>;
    const id = relative(MODULES_ROOT, file).replace(/\.md$/, "");
    out.push({
      id,
      category: typeof fm.category === "string" ? fm.category : "unknown",
      brand: typeof fm.brand === "string" ? fm.brand : null,
      edition: typeof fm.edition === "string" ? fm.edition : null,
      description: typeof fm.description === "string" ? fm.description : "",
      status: fm.status === "experimental" || fm.status === "deprecated" ? fm.status : "active",
      version: typeof fm.version === "number" ? fm.version : 1,
      bodyExcerpt: parsed.content.trim().slice(0, 240),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export type { VoiceModuleSummary };
