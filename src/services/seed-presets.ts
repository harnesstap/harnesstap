import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPreset,
  createPreset,
  addResourceToPreset,
} from "../models/preset.js";
import { createResource } from "../models/resource.js";
import type { ExportBundle } from "../types.js";

function getBuiltInPresetsDir(): string {
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
    if (!file.endsWith(".json")) continue;

    const raw = readFileSync(join(presetsDir, file), "utf-8");
    const bundle = JSON.parse(raw) as ExportBundle;

    if (getPreset(bundle.preset.name)) continue;

    const claude = bundle.claude ?? bundle.preset.claude;

    const preset = createPreset({
      name: bundle.preset.name,
      description: bundle.preset.description,
      tags: bundle.preset.tags,
      ...(claude ? { claude } : {}),
    });

    for (const resource of bundle.resources) {
      const saved = createResource({
        type: resource.type,
        name: resource.name,
        description: resource.description,
        content: resource.content,
        metadata: resource.metadata,
        source: `builtin:${file}`,
      });
      addResourceToPreset(preset.id, saved.id);
    }

    seeded++;
  }

  return seeded;
}
