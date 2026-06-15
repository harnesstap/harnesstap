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
import { listPlugins } from "../models/plugin-component.js";
import { exportToFile, importFromFile } from "./exporter.js";
import { loadSettings } from "../config/settings.js";
import type { HarnessdeckSettings } from "../config/settings.js";
import type { HarnessPreference, LayerExport } from "../types.js";
import { formatLayerExportToml, parseLayerExportToml } from "./transport/layer.js";

export const MIGRATE_MANIFEST_VERSION = 1 as const;

export interface MigrateManifest {
  version: typeof MIGRATE_MANIFEST_VERSION;
  exported_at: string;
  layer_count: number;
  include_plugins: boolean;
}

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
    const state = {
      manifest: JSON.parse(manifest) as MigrateManifest,
      harness: existsSync(join(sourceDir, "harness.json"))
        ? JSON.parse(readFileSync(join(sourceDir, "harness.json"), "utf-8"))
        : null,
      config: existsSync(join(sourceDir, "config.json"))
        ? JSON.parse(readFileSync(join(sourceDir, "config.json"), "utf-8"))
        : null,
      layers: readdirSync(join(sourceDir, "layers"))
        .filter((f) => f.endsWith(".toml"))
        .map((f) =>
          parseLayerExportToml(
            readFileSync(join(sourceDir, "layers", f), "utf-8"),
          ),
        ),
    };
    writeFileSync(resolved, JSON.stringify(state, null, 2), "utf-8");
    return;
  }
  execSync(`tar -czf "${resolved}" -C "${sourceDir}" .`, { stdio: "pipe" });
}

function dirnameSafe(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : ".";
}

/**
 * Export all layers, harness preferences, and config into an archive.
 */
export function exportMigrationState(opts: MigrateExportOptions): MigrateManifest {
  const workDir = mkdtempSync(join(tmpdir(), "harnessdeck-migrate-"));
  const layersDir = join(workDir, "layers");
  mkdirSync(layersDir, { recursive: true });

  const layers = listPlugins();
  for (const layer of layers) {
    exportToFile(layer.name, join(layersDir, `${layer.name}.harnessdeck.toml`), {
      embedPlugins: opts.includePlugins ?? false,
    });
  }

  const harness = getHarnessPreference();
  if (harness) {
    writeJson(join(workDir, "harness.json"), harness);
  }

  const config = loadSettings(getHarnessdeckDir());
  writeJson(join(workDir, "config.json"), config);

  const manifest: MigrateManifest = {
    version: MIGRATE_MANIFEST_VERSION,
    exported_at: new Date().toISOString(),
    layer_count: layers.length,
    include_plugins: opts.includePlugins ?? false,
  };
  writeJson(join(workDir, "manifest.json"), manifest);

  mkdirSync(dirnameSafe(resolve(opts.outputPath)), { recursive: true });
  createArchive(workDir, opts.outputPath);
  rmSync(workDir, { recursive: true, force: true });

  return manifest;
}

/**
 * Import a migration archive produced by exportMigrationState.
 */
export function importMigrationState(opts: MigrateImportOptions): {
  manifest: MigrateManifest;
  layers_imported: number;
} {
  const workDir = mkdtempSync(join(tmpdir(), "harnessdeck-migrate-import-"));

  try {
    extractArchive(opts.archivePath, workDir);

    let manifest: MigrateManifest;
    let layersDir: string;
    let harnessPath: string;
    let configPath: string;

    if (existsSync(join(workDir, "state", "migrate.json"))) {
      const state = JSON.parse(
        readFileSync(join(workDir, "state", "migrate.json"), "utf-8"),
      ) as {
        manifest: MigrateManifest;
        harness: HarnessPreference | null;
        config: HarnessdeckSettings;
        layers: unknown[];
      };
      manifest = state.manifest;
      layersDir = join(workDir, "import-layers");
      mkdirSync(layersDir, { recursive: true });
      for (let i = 0; i < state.layers.length; i++) {
        writeFileSync(
          join(layersDir, `layer-${i}.harnessdeck.toml`),
          formatLayerExportToml(state.layers[i] as LayerExport),
          "utf-8",
        );
      }
      if (state.harness) {
        writeJson(join(workDir, "harness.json"), state.harness);
      }
      writeJson(join(workDir, "config.json"), state.config);
      harnessPath = join(workDir, "harness.json");
      configPath = join(workDir, "config.json");
    } else {
      manifest = JSON.parse(
        readFileSync(join(workDir, "manifest.json"), "utf-8"),
      ) as MigrateManifest;
      layersDir = join(workDir, "layers");
      harnessPath = join(workDir, "harness.json");
      configPath = join(workDir, "config.json");
    }

    if (manifest.version !== MIGRATE_MANIFEST_VERSION) {
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

    return { manifest, layers_imported: layersImported };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
