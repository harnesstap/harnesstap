import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getLayer } from "../models/layer.js";
import { importFromFile, inspectBundleFile } from "./exporter.js";

function normalizeLayerVersion(version: string | undefined): string {
  return typeof version === "string" && version.length > 0 ? version : "";
}

function layerKey(name: string, version: string | undefined): string {
  return `${name}\u0000${normalizeLayerVersion(version)}`;
}

function hasLayerInstalled(name: string, version: string | undefined): boolean {
  const normalizedVersion = normalizeLayerVersion(version);
  return normalizedVersion.length > 0
    ? getLayer(`${name}@${normalizedVersion}`) !== undefined
    : getLayer(name) !== undefined;
}

function getBuiltInLayersDir(): string {
  const overrideDir = process.env.HARNESSDECK_BUILTIN_LAYERS_DIR;
  if (overrideDir && existsSync(overrideDir)) {
    return overrideDir;
  }

  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, "..", "builtin-layers"),
    join(currentDir, "..", "..", "builtin-layers"),
    join(process.cwd(), "builtin-layers"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const [firstCandidate] = candidates;
  if (!firstCandidate) {
    throw new Error("No built-in layers directories configured");
  }

  return firstCandidate;
}

export function seedBuiltInLayers(): number {
  const layersDir = getBuiltInLayersDir();
  if (!existsSync(layersDir)) return 0;

  let seeded = 0;

  for (const file of readdirSync(layersDir)) {
    if (!file.endsWith(".json") && !file.endsWith(".jsonc")) continue;

    const filePath = join(layersDir, file);
    const summary = inspectBundleFile(filePath);
    const missingLayerKeys = new Set(
      summary.layers
        .filter((layer) => !hasLayerInstalled(layer.name, layer.version))
        .map((layer) => layerKey(layer.name, layer.version)),
    );
    if (missingLayerKeys.size === 0) continue;

    importFromFile(filePath, {
      resourceSource: `builtin:${file}`,
      includeLayers: (layer) =>
        missingLayerKeys.has(layerKey(layer.name, layer.version)),
    });
    seeded++;
  }

  return seeded;
}
