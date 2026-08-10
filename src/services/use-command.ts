import { resolve } from "node:path";
import { getDb } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";
import { ui } from "../ui/index.js";
import { parseOutputFormat, printJson } from "../utils/output-format.js";
import { MISSING_PROJECT_CONFIG_MESSAGE } from "./project-config-messages.js";
import {
  executeProjectUse,
  type ProjectUseOptions,
  type ProjectUseResult,
} from "./project-config-use.js";
import {
  findProjectConfig,
  resolveProfileEnvironment,
  type ProjectProfileEntry,
  type ResolvedProjectConfig,
} from "./project-config.js";
export interface UseCommandOptions {
  profile?: string;
  project?: string;
  list?: boolean;
  dryRun?: boolean;
  force?: boolean;
  pull?: boolean;
  harness?: string;
  account?: string;
  baseUrl?: string;
  onConflict?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
}

interface ProjectProfileListRow {
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
      return entry.plugin ?? "";
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

function buildProjectProfileListRows(config: ResolvedProjectConfig): ProjectProfileListRow[] {
  return config.profiles.map((entry) => ({
    profile: entry.name,
    source: entry.source,
    target: profileTarget(entry),
    environment: resolveProfileEnvironment(config, entry) ?? "",
    default: entry.name === config.default_profile ? "*" : "",
  }));
}

function listProjectProfiles(config: ResolvedProjectConfig, format: "human" | "json"): void {
  const rows = buildProjectProfileListRows(config);

  if (format === "json") {
    printJson(
      rows.map((row) => ({
        profile: row.profile,
        source: row.source,
        selector_or_plugin: row.target,
        environment: row.environment || undefined,
        default: row.default === "*",
      })),
    );
    return;
  }

  if (rows.length === 0) {
    ui.dim("No profiles configured in project config.");
    return;
  }

  ui.table.print({
    columns: [
      { key: "profile", header: "PROFILE", width: 16 },
      { key: "source", header: "SOURCE", width: 10 },
      { key: "target", header: "SELECTOR/PLUGIN", width: 24 },
      { key: "environment", header: "ENVIRONMENT", width: 16 },
      { key: "default", header: "", width: 2 },
    ],
    rows,
    summary: `${rows.length} profile${rows.length === 1 ? "" : "s"}`,
  });
}

export function renderProjectUseHuman(result: ProjectUseResult): void {
  if (result.skipped) {
    const environmentSuffix = result.environment_name
      ? ` with environment ${ui.theme.accent(result.environment_name)}`
      : "";
    ui.info(
      `Profile ${ui.theme.accent(result.profile_key)} (${result.plugin_name}) is already active and in sync${environmentSuffix}.`,
    );
    return;
  }

  if (result.cancelled) {
    process.exitCode = 1;
    ui.warn("Profile apply cancelled.");
    return;
  }

  const dryPrefix = result.dry_run ? `${ui.theme.muted("[dry run] ")}` : "";
  ui.success(
    `${dryPrefix}Applied profile ${ui.theme.accent(result.profile_key)} (${result.profile_name}) to ${result.harnesses.join(", ") || "(none)"}`,
  );
  if (result.environment_name) {
    ui.info(`Environment: ${ui.theme.accent(result.environment_name)}`);
  }
  if ((result.pulled_plugins?.length ?? 0) > 0) {
    ui.info(`Pulled ${result.pulled_plugins?.length ?? 0} missing plugin dependencies:`);
    for (const pulled of result.pulled_plugins ?? []) {
      console.log(`  - ${pulled.plugin_name} (${pulled.source})`);
    }
  }
  ui.kvBlock([
    { key: "Files", value: `${result.files.length}` },
    { key: "Written", value: `${result.written_files.length}` },
    { key: "Skipped", value: `${result.skipped_files.length}` },
    ...(result.snapshot_id ? [{ key: "Snapshot", value: result.snapshot_id }] : []),
  ]);
}

function toProjectUseOptions(opts: UseCommandOptions): ProjectUseOptions {
  return {
    profile: opts.profile,
    project: opts.project,
    dryRun: opts.dryRun,
    force: opts.force,
    pull: opts.pull,
    harness: opts.harness,
    account: opts.account,
    baseUrl: opts.baseUrl,
    onConflict: opts.onConflict,
    format: opts.format,
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
  };
}

export async function handleUseCommand(opts: UseCommandOptions): Promise<void> {
  const db = getDb();
  initializeSchema(db);
  const format = parseOutputFormat(opts.format);
  const projectPath = resolve(opts.project ?? process.cwd());

  if (opts.list) {
    const config = findProjectConfig(projectPath);
    if (!config) {
      process.exitCode = 1;
      ui.danger(MISSING_PROJECT_CONFIG_MESSAGE);
      return;
    }
    listProjectProfiles(config, format);
    return;
  }

  try {
    const result = await executeProjectUse({
      ...toProjectUseOptions({ ...opts, project: projectPath }),
    });
    if (format === "json") {
      printJson(result);
      return;
    }
    renderProjectUseHuman(result);
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

export function mapProfileUseDelegationOptions(opts: {
  profile?: string;
  project?: string;
  dryRun?: boolean;
  harness?: string;
  onConflict?: string;
  account?: string;
  baseUrl?: string;
  pull?: boolean;
  force?: boolean;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
}): ProjectUseOptions {
  return {
    profile: opts.profile,
    project: opts.project,
    dryRun: opts.dryRun,
    force: opts.force,
    pull: opts.pull,
    harness: opts.harness,
    account: opts.account,
    baseUrl: opts.baseUrl,
    onConflict: opts.onConflict,
    format: opts.format,
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
  };
}

export async function handleProfileUseProjectDelegation(
  opts: Parameters<typeof mapProfileUseDelegationOptions>[0],
): Promise<boolean> {
  const config = findProjectConfig(resolve(opts.project ?? process.cwd()));
  if (!config) {
    return false;
  }

  const format = parseOutputFormat(opts.format);
  try {
    const result = await executeProjectUse(mapProfileUseDelegationOptions(opts));
    if (format === "json") {
      printJson(result);
      return true;
    }
    renderProjectUseHuman(result);
    return true;
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
    return true;
  }
}
