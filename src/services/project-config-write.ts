import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROJECT_SCHEMA, PROJECT_SCHEMA_VERSION } from "../types.js";
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

  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    configPath,
    formatTransportToml(
      buildStarterProjectConfigDocument({
        defaultProfile: input.defaultProfile,
        profileNames: input.profileNames,
      }),
    ),
    "utf-8",
  );

  return { configPath };
}
