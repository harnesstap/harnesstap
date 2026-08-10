import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { getHarnesstapDir } from "../db/connection.js";
import { getHarnessPreference, setHarnessPreference } from "../models/harness.js";
import { listPlugins } from "../models/plugin-model.js";
import { loadSettings } from "../config/settings.js";
import type { HarnesstapSettings } from "../config/settings.js";
import type { HarnessPreference } from "../types.js";
import {
  formatEnvironmentToml,
  importEnvironmentToml,
  listEnvironmentDocuments,
} from "./environment-import-export.js";
import { listContainedFiles, assertArchiveMembersContained } from "../utils/path-containment.js";
import {
  buildApPackageFiles,
  writeApPackageFiles,
  readApPackageFiles,
} from "./agent-plugins/files.js";
import { importApPackageFiles } from "./agent-plugins/import.js";
import { slugifyApName } from "./agent-plugins/name.js";
import {
  envelopeFromFiles,
  parseApEnvelope,
} from "./agent-plugins/envelope.js";
import { isLegacyPluginTomlPath } from "./legacy-toml-transport.js";

export const MIGRATE_MANIFEST_VERSION_V1 = 1 as const;
export const MIGRATE_MANIFEST_VERSION = 2 as const;

export interface MigrateManifestV1 {
  version: typeof MIGRATE_MANIFEST_VERSION_V1;
  exported_at: string;
  plugin_count: number;
  include_plugins: boolean;
  includes_active_profile: boolean;
}

export interface MigrateManifest {
  version: typeof MIGRATE_MANIFEST_VERSION;
  exported_at: string;
  plugin_count: number;
  environment_count: number;
  /** Slugified plugin directory names packed under `plugins/`. */
  plugins: string[];
  include_plugins: boolean;
  includes_active_profile: boolean;
}

export type AnyMigrateManifest = MigrateManifestV1 | MigrateManifest;

export interface MigrateExportOptions {
  outputPath: string;
  includePlugins?: boolean;
}

export interface MigrateImportOptions {
  archivePath: string;
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

function listArchiveMembers(archivePath: string): string[] {
  const listing = execSync(`tar -tzf "${archivePath}"`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extractArchive(archivePath: string, destDir: string): void {
  const resolved = resolve(archivePath);
  if (resolved.endsWith(".json") && !resolved.endsWith(".ap.json")) {
    mkdirSync(join(destDir, "state"), { recursive: true });
    cpSync(resolved, join(destDir, "state", "migrate.json"));
    return;
  }
  // Reject path-traversal members before write; post-walk only sees files under destDir.
  assertArchiveMembersContained(destDir, listArchiveMembers(resolved));
  execSync(`tar -xzf "${resolved}" -C "${destDir}"`, { stdio: "pipe" });
  // Catch in-tree symlink escapes that resolve outside the destination.
  listContainedFiles(destDir);
}

function createArchive(sourceDir: string, outputPath: string): void {
  const resolved = resolve(outputPath);
  if (resolved.endsWith(".json") && !resolved.endsWith(".ap.json")) {
    const manifest = readFileSync(join(sourceDir, "manifest.json"), "utf-8");
    const environmentsDir = join(sourceDir, "environments");
    const pluginsDir = join(sourceDir, "plugins");
    const plugins: unknown[] = [];
    if (existsSync(pluginsDir)) {
      for (const entry of readdirSync(pluginsDir)) {
        const packageDir = join(pluginsDir, entry);
        if (!statSync(packageDir).isDirectory()) continue;
        if (!existsSync(join(packageDir, "plugin.json"))) {
          throw new Error(
            `Archive plugin directory ${entry} is missing plugin.json`,
          );
        }
        plugins.push(envelopeFromFiles(readApPackageFiles(packageDir)));
      }
    }
    const state: Record<string, unknown> = {
      manifest: JSON.parse(manifest) as AnyMigrateManifest,
      harness: existsSync(join(sourceDir, "harness.json"))
        ? JSON.parse(readFileSync(join(sourceDir, "harness.json"), "utf-8"))
        : null,
      config: existsSync(join(sourceDir, "config.json"))
        ? JSON.parse(readFileSync(join(sourceDir, "config.json"), "utf-8"))
        : null,
      active_profile: existsSync(join(sourceDir, "active-profile.json"))
        ? JSON.parse(readFileSync(join(sourceDir, "active-profile.json"), "utf-8"))
        : null,
      plugins,
    };
    if (existsSync(environmentsDir)) {
      state.environments = readdirSync(environmentsDir)
        .filter((f) => f.endsWith(".toml"))
        .map((f) => readFileSync(join(environmentsDir, f), "utf-8"));
    }
    writeFileSync(resolved, JSON.stringify(state, null, 2), "utf-8");
    return;
  }
  execSync(`tar -czf "${resolved}" -C "${sourceDir}" .`, { stdio: "pipe" });
}

function dirnameSafe(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : ".";
}

function isMigrateManifestV1(manifest: AnyMigrateManifest): manifest is MigrateManifestV1 {
  return manifest.version === MIGRATE_MANIFEST_VERSION_V1;
}

/**
 * Export all plugins, environments, harness preferences, and config into an archive.
 */
export function exportMigrationState(opts: MigrateExportOptions): MigrateManifest {
  const workDir = mkdtempSync(join(tmpdir(), "harnesstap-migrate-"));
  const pluginsDir = join(workDir, "plugins");
  const environmentsDir = join(workDir, "environments");
  mkdirSync(pluginsDir, { recursive: true });
  mkdirSync(environmentsDir, { recursive: true });

  const plugins = listPlugins();
  const pluginNames: string[] = [];
  for (const plugin of plugins) {
    const slug = slugifyApName(plugin.name);
    pluginNames.push(slug);
    const packageDir = join(pluginsDir, slug);
    writeApPackageFiles(buildApPackageFiles(plugin.id), packageDir);
  }

  const environments = listEnvironmentDocuments();
  for (const environment of environments) {
    writeFileSync(
      join(environmentsDir, `${environment.name}.toml`),
      formatEnvironmentToml(environment),
      "utf-8",
    );
  }

  const harness = getHarnessPreference();
  if (harness) {
    writeJson(join(workDir, "harness.json"), harness);
  }

  const config = loadSettings(getHarnesstapDir());
  writeJson(join(workDir, "config.json"), config);
  const harnesstapDir = getHarnesstapDir();
  const activeProfilePath = join(harnesstapDir, "active-profile.json");
  const includesActiveProfile = existsSync(activeProfilePath);
  if (includesActiveProfile) {
    cpSync(activeProfilePath, join(workDir, "active-profile.json"));
  }

  const manifest: MigrateManifest = {
    version: MIGRATE_MANIFEST_VERSION,
    exported_at: new Date().toISOString(),
    plugin_count: plugins.length,
    environment_count: environments.length,
    plugins: pluginNames,
    include_plugins: opts.includePlugins ?? false,
    includes_active_profile: includesActiveProfile,
  };
  writeJson(join(workDir, "manifest.json"), manifest);

  mkdirSync(dirnameSafe(resolve(opts.outputPath)), { recursive: true });
  createArchive(workDir, opts.outputPath);
  rmSync(workDir, { recursive: true, force: true });

  return manifest;
}

function importEnvironmentsFromDir(environmentsDir: string): number {
  if (!existsSync(environmentsDir)) {
    return 0;
  }
  let imported = 0;
  for (const file of readdirSync(environmentsDir)) {
    if (!file.endsWith(".toml")) continue;
    importEnvironmentToml(readFileSync(join(environmentsDir, file), "utf-8"));
    imported++;
  }
  return imported;
}

function importPluginsFromDir(pluginsDir: string): number {
  if (!existsSync(pluginsDir)) {
    return 0;
  }
  let imported = 0;
  for (const entry of readdirSync(pluginsDir)) {
    const packageDir = join(pluginsDir, entry);
    if (!statSync(packageDir).isDirectory()) {
      if (isLegacyPluginTomlPath(entry) || entry.endsWith(".toml")) {
        throw new Error(
          "This archive stores plugins as TOML, which is no longer supported. " +
            "Re-export with a current CLI to produce Agent Plugins packages.",
        );
      }
      continue;
    }
    if (!existsSync(join(packageDir, "plugin.json"))) {
      throw new Error(
        `Archive plugin directory ${entry} is missing plugin.json`,
      );
    }
    importApPackageFiles(readApPackageFiles(packageDir));
    imported++;
  }
  return imported;
}

/**
 * Import a migration archive produced by exportMigrationState.
 */
export function importMigrationState(opts: MigrateImportOptions): {
  manifest: AnyMigrateManifest;
  plugins_imported: number;
  environments_imported: number;
} {
  const workDir = mkdtempSync(join(tmpdir(), "harnesstap-migrate-import-"));

  try {
    extractArchive(opts.archivePath, workDir);

    let manifest: AnyMigrateManifest;
    let pluginsDir: string;
    let environmentsDir: string;
    let harnessPath: string;
    let configPath: string;

    if (existsSync(join(workDir, "state", "migrate.json"))) {
      const state = JSON.parse(
        readFileSync(join(workDir, "state", "migrate.json"), "utf-8"),
      ) as {
        manifest: AnyMigrateManifest;
        harness: HarnessPreference | null;
        config: HarnesstapSettings;
        active_profile: { name?: string } | null;
        plugins: unknown[];
        environments?: string[];
      };
      manifest = state.manifest;
      pluginsDir = join(workDir, "import-plugins");
      environmentsDir = join(workDir, "import-environments");
      mkdirSync(pluginsDir, { recursive: true });
      mkdirSync(environmentsDir, { recursive: true });
      for (let i = 0; i < state.plugins.length; i++) {
        const packageDir = join(pluginsDir, `plugin-${i}`);
        const envelopeRaw = JSON.stringify(state.plugins[i]);
        const files = parseApEnvelope(envelopeRaw, `archive plugin ${i}`);
        writeApPackageFiles(files, packageDir);
      }
      if (state.environments) {
        for (let i = 0; i < state.environments.length; i++) {
          writeFileSync(
            join(environmentsDir, `environment-${i}.toml`),
            state.environments[i] ?? "",
            "utf-8",
          );
        }
      }
      if (state.harness) {
        writeJson(join(workDir, "harness.json"), state.harness);
      }
      writeJson(join(workDir, "config.json"), state.config);
      if (state.active_profile) {
        writeJson(join(workDir, "active-profile.json"), state.active_profile);
      }
      harnessPath = join(workDir, "harness.json");
      configPath = join(workDir, "config.json");
    } else {
      manifest = JSON.parse(
        readFileSync(join(workDir, "manifest.json"), "utf-8"),
      ) as AnyMigrateManifest;
      pluginsDir = join(workDir, "plugins");
      environmentsDir = join(workDir, "environments");
      harnessPath = join(workDir, "harness.json");
      configPath = join(workDir, "config.json");
    }
    const activeProfilePath = join(workDir, "active-profile.json");

    if (isMigrateManifestV1(manifest)) {
      throw new Error(
        "This archive uses manifest version 1, which stored plugins as TOML. " +
          "Version 1 archives were never released and are not supported.",
      );
    }

    const manifestVersion = manifest.version;
    if (manifestVersion !== MIGRATE_MANIFEST_VERSION) {
      throw new Error(`Unsupported migration manifest version: ${manifestVersion}`);
    }

    const pluginsImported = importPluginsFromDir(pluginsDir);
    const environmentsImported = importEnvironmentsFromDir(environmentsDir);

    if (existsSync(harnessPath)) {
      const harness = JSON.parse(
        readFileSync(harnessPath, "utf-8"),
      ) as HarnessPreference;
      setHarnessPreference({
        main_harness: harness.main_harness,
        alias_harnesses: harness.alias_harnesses,
      });
    }

    if (existsSync(configPath)) {
      const config = JSON.parse(
        readFileSync(configPath, "utf-8"),
      ) as HarnesstapSettings;
      const targetDir = getHarnesstapDir();
      mkdirSync(targetDir, { recursive: true });
      writeJson(join(targetDir, "config.json"), config);
    }
    if (existsSync(activeProfilePath)) {
      const activeProfile = JSON.parse(
        readFileSync(activeProfilePath, "utf-8"),
      ) as { name?: string };
      const targetDir = getHarnesstapDir();
      mkdirSync(targetDir, { recursive: true });
      writeJson(join(targetDir, "active-profile.json"), activeProfile);
    }

    return {
      manifest,
      plugins_imported: pluginsImported,
      environments_imported: environmentsImported,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
