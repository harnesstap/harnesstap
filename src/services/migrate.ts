import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { getHarnessdeckDir } from "../db/connection.js";
import { getHarnessPreference, setHarnessPreference } from "../models/harness.js";
import { listLayers } from "../models/layer-model.js";
import { exportToFile } from "./layer-export.js";
import { importFromFile } from "./layer-import.js";
import { loadSettings } from "../config/settings.js";
import type { HarnessdeckSettings } from "../config/settings.js";
import type { HarnessPreference, LayerExport } from "../types.js";
import { formatLayerExportToml, parseLayerExportToml } from "./transport/layer.js";
import {
  formatEnvironmentToml,
  importEnvironmentToml,
  listEnvironmentDocuments,
} from "./environment-import-export.js";

export const MIGRATE_MANIFEST_VERSION_V1 = 1 as const;
export const MIGRATE_MANIFEST_VERSION = 2 as const;

export interface MigrateManifestV1 {
  version: typeof MIGRATE_MANIFEST_VERSION_V1;
  exported_at: string;
  layer_count: number;
  include_plugins: boolean;
  includes_active_profile: boolean;
}

export interface MigrateManifest {
  version: typeof MIGRATE_MANIFEST_VERSION;
  exported_at: string;
  layer_count: number;
  environment_count: number;
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

function extractArchive(archivePath: string, destDir: string): void {
  const resolved = resolve(archivePath);
  if (resolved.endsWith(".json")) {
    mkdirSync(join(destDir, "state"), { recursive: true });
    cpSync(resolved, join(destDir, "state", "migrate.json"));
    return;
  }
  execSync(`tar -xzf "${resolved}" -C "${destDir}"`, { stdio: "pipe" });
}

function createArchive(sourceDir: string, outputPath: string): void {
  const resolved = resolve(outputPath);
  if (resolved.endsWith(".json")) {
    const manifest = readFileSync(
      join(sourceDir, "manifest.json"),
      "utf-8",
    );
    const environmentsDir = join(sourceDir, "environments");
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
      layers: readdirSync(join(sourceDir, "layers"))
        .filter((f) => f.endsWith(".toml"))
        .map((f) =>
          parseLayerExportToml(
            readFileSync(join(sourceDir, "layers", f), "utf-8"),
          ),
        ),
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
 * Export all layers, environments, harness preferences, and config into an archive.
 */
export function exportMigrationState(opts: MigrateExportOptions): MigrateManifest {
  const workDir = mkdtempSync(join(tmpdir(), "harnessdeck-migrate-"));
  const layersDir = join(workDir, "layers");
  const environmentsDir = join(workDir, "environments");
  mkdirSync(layersDir, { recursive: true });
  mkdirSync(environmentsDir, { recursive: true });

  const layers = listLayers();
  for (const layer of layers) {
    exportToFile(layer.name, join(layersDir, `${layer.name}.harnessdeck.toml`), {
      embedPlugins: opts.includePlugins ?? false,
    });
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

  const config = loadSettings(getHarnessdeckDir());
  writeJson(join(workDir, "config.json"), config);
  const harnessdeckDir = getHarnessdeckDir();
  const activeProfilePath = join(harnessdeckDir, "active-profile.json");
  const includesActiveProfile = existsSync(activeProfilePath);
  if (includesActiveProfile) {
    cpSync(activeProfilePath, join(workDir, "active-profile.json"));
  }

  const manifest: MigrateManifest = {
    version: MIGRATE_MANIFEST_VERSION,
    exported_at: new Date().toISOString(),
    layer_count: layers.length,
    environment_count: environments.length,
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

/**
 * Import a migration archive produced by exportMigrationState.
 */
export function importMigrationState(opts: MigrateImportOptions): {
  manifest: AnyMigrateManifest;
  layers_imported: number;
  environments_imported: number;
} {
  const workDir = mkdtempSync(join(tmpdir(), "harnessdeck-migrate-import-"));

  try {
    extractArchive(opts.archivePath, workDir);

    let manifest: AnyMigrateManifest;
    let layersDir: string;
    let environmentsDir: string;
    let harnessPath: string;
    let configPath: string;

    if (existsSync(join(workDir, "state", "migrate.json"))) {
      const state = JSON.parse(
        readFileSync(join(workDir, "state", "migrate.json"), "utf-8"),
      ) as {
        manifest: AnyMigrateManifest;
        harness: HarnessPreference | null;
        config: HarnessdeckSettings;
        active_profile: { name?: string } | null;
        layers: unknown[];
        environments?: string[];
      };
      manifest = state.manifest;
      layersDir = join(workDir, "import-layers");
      environmentsDir = join(workDir, "import-environments");
      mkdirSync(layersDir, { recursive: true });
      mkdirSync(environmentsDir, { recursive: true });
      for (let i = 0; i < state.layers.length; i++) {
        writeFileSync(
          join(layersDir, `layer-${i}.harnessdeck.toml`),
          formatLayerExportToml(state.layers[i] as LayerExport),
          "utf-8",
        );
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
      layersDir = join(workDir, "layers");
      environmentsDir = join(workDir, "environments");
      harnessPath = join(workDir, "harness.json");
      configPath = join(workDir, "config.json");
    }
    const activeProfilePath = join(workDir, "active-profile.json");

    if (
      manifest.version !== MIGRATE_MANIFEST_VERSION
      && manifest.version !== MIGRATE_MANIFEST_VERSION_V1
    ) {
      throw new Error(`Unsupported migration manifest version: ${manifest.version}`);
    }

    let layersImported = 0;
    if (existsSync(layersDir)) {
      for (const file of readdirSync(layersDir)) {
        if (!file.endsWith(".toml")) continue;
        importFromFile(join(layersDir, file));
        layersImported++;
      }
    }

    const environmentsImported = isMigrateManifestV1(manifest)
      ? 0
      : importEnvironmentsFromDir(environmentsDir);

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
      ) as HarnessdeckSettings;
      const targetDir = getHarnessdeckDir();
      mkdirSync(targetDir, { recursive: true });
      writeJson(join(targetDir, "config.json"), config);
    }
    if (existsSync(activeProfilePath)) {
      const activeProfile = JSON.parse(
        readFileSync(activeProfilePath, "utf-8"),
      ) as { name?: string };
      const targetDir = getHarnessdeckDir();
      mkdirSync(targetDir, { recursive: true });
      writeJson(join(targetDir, "active-profile.json"), activeProfile);
    }

    return { manifest, layers_imported: layersImported, environments_imported: environmentsImported };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
