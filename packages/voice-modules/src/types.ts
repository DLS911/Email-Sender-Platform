import type { RunContext } from "@platform/schemas";

export type ModuleStatus = "active" | "experimental" | "deprecated";

export type ModuleFrontmatter = {
  module_id: string;
  version: number;
  category: string;
  brand?: string | null;
  edition?: "weekday" | "weekend" | "both" | null;
  description: string;
  status: ModuleStatus;
  created_at?: string;
  last_updated?: string;
};

export type VoiceModule = {
  id: string;
  frontmatter: ModuleFrontmatter;
  body: string;
  filePath: string;
};

export type ComposeOptions = {
  modules: string[];
  context: RunContext;
};
