import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PROJECT_SCHEMA, PROJECT_SCHEMA_VERSION } from "../types.js";
import type { ProjectConfig, ProjectProfileEntry } from "./project-config.js";
import { PROJECT_CONFIG_EXISTS_MESSAGE } from "./project-config-messages.js";
import { formatTransportToml } from "./toml/write.js";

export function buildStarterProjectConfigDocument(input: {
  defaultProfile: string;
  profileNames: string[];
}): Record<string, unknown> {
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_SCHEMA_VERSION,
    default_profile: input.defaultProfile,
    profiles: input.profileNames.map((name) => ({
      name,
      source: "local",
      selector: name,
    })),
  };
}

export function writeStarterProjectConfig(input: {
  projectPath: string;
  defaultProfile: string;
  profileNames: string[];
  force?: boolean;
}): { configPath: string } {
  const root = resolve(input.projectPath);
  const configDir = join(root, ".harnesstap");
  const configPath = join(configDir, "config.toml");

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
    schema: PROJECT_SCHEMA,
    version: PROJECT_SCHEMA_VERSION,
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
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, formatTransportToml(projectConfigToDocument(config)), "utf-8");
}
