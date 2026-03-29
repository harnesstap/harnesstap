import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPreset, createPreset, addResourceToPreset } from "../models/preset.js";
import { createResource } from "../models/resource.js";
import type { ExportBundle } from "../types.js";

function getTemplatesDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, "..", "templates"),
    join(currentDir, "..", "..", "templates"),
    join(process.cwd(), "templates"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return candidates[0]!;
}

export function seedBuiltInTemplates(): number {
  const templatesDir = getTemplatesDir();
  if (!existsSync(templatesDir)) return 0;

  let seeded = 0;

  for (const file of readdirSync(templatesDir)) {
    if (!file.endsWith(".json")) continue;

    const raw = readFileSync(join(templatesDir, file), "utf-8");
    const bundle = JSON.parse(raw) as ExportBundle;

    if (getPreset(bundle.preset.name)) continue;

    const preset = createPreset({
      name: bundle.preset.name,
      description: bundle.preset.description,
      tags: bundle.preset.tags,
      is_template: bundle.preset.is_template,
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
