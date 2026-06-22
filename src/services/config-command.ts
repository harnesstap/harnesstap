import { resolve } from "node:path";
import { ui } from "../ui/index.js";
import { parseOutputFormat, printJson } from "../utils/output-format.js";
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

function requireProjectConfig(projectPath: string): ResolvedProjectConfig | null {
  const config = findProjectConfig(projectPath);
  if (!config) {
    process.exitCode = 1;
    ui.danger(
      "No project config found. Create `.harnessdeck/config.toml` or run `hd config init` when available.",
    );
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
  const config = requireProjectConfig(projectPath);
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
        errors: ["No project config found at .harnessdeck/config.toml"],
      });
      return;
    }
    ui.danger(
      "No project config found. Create `.harnessdeck/config.toml` or run `hd config init` when available.",
    );
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

export function handleConfigInitCommand(): void {
  process.exitCode = 1;
  ui.warn(
    "config init is not available yet. Create `.harnessdeck/config.toml` manually — see `hd help scenario 40` or docs/cli/concepts/projects.md.",
  );
}
