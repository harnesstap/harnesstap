import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatApmManifest } from "./apm-manifest.js";
import {
  projectManifestPath,
  type ProjectConfig,
  type ProjectProfileEntry,
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

function serializeProfileEntry(profile: ProjectProfileEntry): Record<string, unknown> {
  return {
    name: profile.name,
    source: profile.source,
    ...(profile.selector ? { selector: profile.selector } : {}),
    ...(profile.plugin ? { plugin: profile.plugin } : {}),
    ...(profile.environment ? { environment: profile.environment } : {}),
  };
}

export function projectConfigToDocument(config: ProjectConfig): Record<string, unknown> {
  return {
    ...(config.apm_name ? { name: config.apm_name } : {}),
    ...(config.apm_version ? { version: config.apm_version } : {}),
    ...(config.apm_description ? { description: config.apm_description } : {}),
    ...(config.default_profile ? { default_profile: config.default_profile } : {}),
    ...(config.default_environment ? { default_environment: config.default_environment } : {}),
    ...(config.profiles.length > 0
      ? { profiles: config.profiles.map(serializeProfileEntry) }
      : {}),
    ...(config.environments.length > 0 ? { environments: config.environments } : {}),
    ...(config.plugins.length > 0 ? { plugins: config.plugins } : {}),
  };
}

export function writeProjectConfigFile(
  configPath: string,
  config: ProjectConfig,
): void {
  const projectPath = resolve(configPath, "..");
  writeFileSync(configPath, formatApmManifest(config, projectPath), "utf-8");
}
