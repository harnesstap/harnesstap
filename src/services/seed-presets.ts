import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPreset } from "../models/preset.js";
import { importFromFile, inspectBundleFile } from "./exporter.js";

function normalizePresetVersion(version: string | undefined): string {
  return typeof version === "string" && version.length > 0 ? version : "";
}

function presetKey(name: string, version: string | undefined): string {
  return `${name}\u0000${normalizePresetVersion(version)}`;
}

function hasPresetInstalled(name: string, version: string | undefined): boolean {
  const normalizedVersion = normalizePresetVersion(version);
  return normalizedVersion.length > 0
    ? getPreset(`${name}@${normalizedVersion}`) !== undefined
    : getPreset(name) !== undefined;
}

function getBuiltInPresetsDir(): string {
  const overrideDir = process.env.HARNESSDECK_BUILTIN_PRESETS_DIR;
  if (overrideDir && existsSync(overrideDir)) {
    return overrideDir;
  }

  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, "..", "builtin-presets"),
    join(currentDir, "..", "..", "builtin-presets"),
    join(process.cwd(), "builtin-presets"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const [firstCandidate] = candidates;
  if (!firstCandidate) {
    throw new Error("No built-in presets directories configured");
  }

  return firstCandidate;
}

export function seedBuiltInPresets(): number {
  const presetsDir = getBuiltInPresetsDir();
  if (!existsSync(presetsDir)) return 0;

  let seeded = 0;

  for (const file of readdirSync(presetsDir)) {
    if (!file.endsWith(".json") && !file.endsWith(".jsonc")) continue;

    const filePath = join(presetsDir, file);
    const summary = inspectBundleFile(filePath);
    const missingPresetKeys = new Set(
      summary.presets
        .filter((preset) => !hasPresetInstalled(preset.name, preset.version))
        .map((preset) => presetKey(preset.name, preset.version)),
    );
    if (missingPresetKeys.size === 0) continue;

    importFromFile(filePath, {
      resourceSource: `builtin:${file}`,
      includePresets: (preset) =>
        missingPresetKeys.has(presetKey(preset.name, preset.version)),
    });
    seeded++;
  }

  return seeded;
}
