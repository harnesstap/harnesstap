import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { apmDocumentFromProjectConfig, formatApmManifest } from "./apm-manifest.js";
import {
  projectManifestPath,
  type ProjectConfig,
} from "./project-config.js";
import { PROJECT_CONFIG_EXISTS_MESSAGE } from "./project-config-messages.js";

export function buildStarterProjectConfigDocument(input: {
  defaultProfile: string;
  profileNames: string[];
  packageName?: string;
}): ProjectConfig {
  return {
    ...(input.packageName ? { apm_name: input.packageName } : {}),
    apm_version: "1.0.0",
    default_profile: input.defaultProfile,
    profiles: input.profileNames.map((name) => ({
      name,
      source: "local" as const,
      selector: name,
    })),
    environments: [],
    plugins: [],
  };
}

export function writeStarterProjectConfig(input: {
  projectPath: string;
  defaultProfile: string;
  profileNames: string[];
  force?: boolean;
}): { configPath: string } {
  const root = resolve(input.projectPath);
  const configPath = projectManifestPath(root);

  if (existsSync(configPath) && !input.force) {
    throw new Error(PROJECT_CONFIG_EXISTS_MESSAGE);
  }

  if (input.profileNames.length === 0) {
    throw new Error("At least one profile is required.");
  }

  if (!input.profileNames.includes(input.defaultProfile)) {
    throw new Error(`Default profile "${input.defaultProfile}" must be included in the profile list.`);
  }

  writeProjectConfigFile(configPath, {
    default_profile: input.defaultProfile,
    profiles: input.profileNames.map((name) => ({
      name,
      source: "local",
      selector: name,
    })),
    environments: [],
    plugins: [],
    apm_version: "1.0.0",
  });

  return { configPath };
}

export function projectConfigToDocument(config: ProjectConfig): Record<string, unknown> {
  return apmDocumentFromProjectConfig(config, ".");
}

export function writeProjectConfigFile(
  configPath: string,
  config: ProjectConfig,
): void {
  const projectPath = resolve(configPath, "..");
  writeFileSync(configPath, formatApmManifest(config, projectPath), "utf-8");
}
