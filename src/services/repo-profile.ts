import { existsSync } from "node:fs";
import { join } from "node:path";
import { discoverSkillPackage } from "./skill-discovery.js";
import { detectPlatforms, hasPluginSourceLayout } from "./scanner.js";

export type RepoProfile =
  | "skill-package"
  | "plugin-source"
  | "layer-bundle"
  | "deck-repo"
  | "harness-project"
  | "unknown";

export interface RepoClassification {
  primary: RepoProfile;
  profiles: RepoProfile[];
}

export function classifyRepo(rootPath: string): RepoClassification {
  const profiles: RepoProfile[] = [];

  if (discoverSkillPackage(rootPath).length > 0) {
    profiles.push("skill-package");
  }
  if (hasPluginSourceLayout(rootPath)) {
    profiles.push("plugin-source");
  }
  if (existsSync(join(rootPath, ".harnessdeck", "deck.toml"))) {
    profiles.push("deck-repo");
  }
  if (detectPlatforms(rootPath).length > 0) {
    profiles.push("harness-project");
  }

  const primary = profiles.includes("skill-package")
    ? "skill-package"
    : profiles.includes("plugin-source")
      ? "plugin-source"
      : profiles.includes("deck-repo")
        ? "deck-repo"
        : profiles.includes("harness-project")
          ? "harness-project"
          : "unknown";

  return { primary, profiles };
}
