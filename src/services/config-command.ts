import { resolve } from "node:path";
import { ui } from "../ui/index.js";
import { parseOutputFormat, printJson } from "../utils/output-format.js";
import { executeConfigInit } from "./config-init.js";
import { MISSING_PROJECT_CONFIG_MESSAGE, PROJECT_CONFIG_EXISTS_MESSAGE } from "./project-config-messages.js";
import {
  findProjectConfig,
  resolveProfileEnvironment,
  validateProjectConfig,
  type ProjectProfileEntry,
  type ResolvedProjectConfig,
} from "./project-config.js";

export interface ConfigCommandOptions {
  project?: string;
  format?: string;
}

interface ProjectProfileShowRow {
  profile: string;
  source: string;
  target: string;
  environment: string;
  default: string;
}

function profileTarget(entry: ProjectProfileEntry): string {
  switch (entry.source) {
    case "catalog":
    case "local":
      return entry.selector ?? "";
    case "inline":
      return entry.layer ?? "";
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

function buildProjectProfileShowRows(config: ResolvedProjectConfig): ProjectProfileShowRow[] {
  return config.profiles.map((entry) => ({
    profile: entry.name,
    source: entry.source,
    target: profileTarget(entry),
    environment: resolveProfileEnvironment(config, entry) ?? "",
    default: entry.name === config.default_profile ? "*" : "",
  }));
}

function requireProjectConfig(
  projectPath: string,
  format: "human" | "json",
): ResolvedProjectConfig | null {
  let config: ResolvedProjectConfig | null;
  try {
    config = findProjectConfig(projectPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.exitCode = 1;
    if (format === "json") {
      printJson({ error: message });
    } else {
      ui.danger(message);
    }
    return null;
  }
  if (!config) {
    process.exitCode = 1;
    if (format === "json") {
      printJson({
        error:
          MISSING_PROJECT_CONFIG_MESSAGE,
      });
    } else {
      ui.danger(MISSING_PROJECT_CONFIG_MESSAGE);
    }
    return null;
  }
  return config;
}

function summarizeConfigForJson(config: ResolvedProjectConfig) {
  return {
    root_path: config.rootPath,
    config_path: config.configPath,
    default_profile: config.default_profile,
    default_environment: config.default_environment,
    profiles: config.profiles,
    environments: config.environments,
    layers: config.layers.map((layer) => ({ name: layer.name })),
    environment_count: config.environments.length,
    layer_count: config.layers.length,
  };
}

export function handleConfigShowCommand(opts: ConfigCommandOptions): void {
  const format = parseOutputFormat(opts.format);
  const projectPath = resolve(opts.project ?? process.cwd());
  const config = requireProjectConfig(projectPath, format);
  if (!config) {
    return;
  }

  if (format === "json") {
    printJson(summarizeConfigForJson(config));
    return;
  }

  ui.kvBlock([
    { key: "Config", value: config.configPath },
    { key: "Root", value: config.rootPath },
    ...(config.default_profile
      ? [{ key: "Default profile", value: config.default_profile }]
      : []),
    ...(config.default_environment
      ? [{ key: "Default environment", value: config.default_environment }]
      : []),
    { key: "Environments", value: `${config.environments.length}` },
    { key: "Inline layers", value: `${config.layers.length}` },
  ]);

  const rows = buildProjectProfileShowRows(config);
  if (rows.length === 0) {
    ui.dim("No profiles configured.");
    return;
  }

  ui.table.print({
    columns: [
      { key: "profile", header: "PROFILE", width: 16 },
      { key: "source", header: "SOURCE", width: 10 },
      { key: "target", header: "SELECTOR/LAYER", width: 24 },
      { key: "environment", header: "ENVIRONMENT", width: 16 },
      { key: "default", header: "", width: 2 },
    ],
    rows,
    summary: `${rows.length} profile${rows.length === 1 ? "" : "s"}`,
  });
}

export function handleConfigValidateCommand(opts: ConfigCommandOptions): void {
  const format = parseOutputFormat(opts.format);
  const projectPath = resolve(opts.project ?? process.cwd());

  let config: ResolvedProjectConfig | null;
  try {
    config = findProjectConfig(projectPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.exitCode = 1;
    if (format === "json") {
      printJson({ valid: false, errors: [message] });
      return;
    }
    ui.danger(message);
    return;
  }

  if (!config) {
    process.exitCode = 1;
    if (format === "json") {
      printJson({
        valid: false,
        errors: [MISSING_PROJECT_CONFIG_MESSAGE],
      });
      return;
    }
    ui.danger(MISSING_PROJECT_CONFIG_MESSAGE);
    return;
  }

  const result = validateProjectConfig(config);
  if (format === "json") {
    printJson(result);
    if (!result.valid) {
      process.exitCode = 1;
    }
    return;
  }

  if (result.valid) {
    ui.success(`Project config is valid (${config.configPath}).`);
    return;
  }

  process.exitCode = 1;
  ui.danger(`Project config validation failed (${config.configPath}):`);
  for (const error of result.errors) {
    console.log(`  - ${error}`);
  }
}

export async function handleConfigInitCommand(opts: {
  project?: string;
  force?: boolean;
  profile?: string[];
  defaultProfile?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  try {
    const result = await executeConfigInit({
      project: opts.project,
      force: opts.force,
      profiles: opts.profile,
      defaultProfile: opts.defaultProfile,
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format: opts.format,
    });
    if (format === "json") {
      printJson(result);
      return;
    }
    ui.success(`Created project config at ${result.config_path}.`);
    ui.kvBlock([
      { key: "Default profile", value: result.default_profile },
      { key: "Profiles", value: result.profiles.join(", ") },
    ]);
    ui.hint("Run `ht config show` to inspect or `ht use` to switch profiles.");
  } catch (err) {
    process.exitCode = 1;
    const message = err instanceof Error ? err.message : String(err);
    if (format === "json") {
      printJson({ error: message });
      return;
    }
    if (message === PROJECT_CONFIG_EXISTS_MESSAGE) {
      ui.warn(message);
      return;
    }
    ui.danger(message);
  }
}
