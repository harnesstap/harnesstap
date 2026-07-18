import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getHarnesstapDir } from "../db/connection.js";
import type { Layer } from "../types.js";
import { exportToFile } from "./layer-export.js";

export function resolveLayerDefinitionPath(layer: Pick<Layer, "name" | "version">): string {
  return join(
    getHarnesstapDir(),
    "layers",
    `${layer.name}@${layer.version}.harnessdeck.toml`,
  );
}

export function exportLayerDefinition(
  layer: Pick<Layer, "id" | "name" | "version">,
  filePath?: string,
): string {
  const definitionPath = filePath ?? resolveLayerDefinitionPath(layer);
  mkdirSync(dirname(definitionPath), { recursive: true });
  exportToFile(layer.id, definitionPath);
  return definitionPath;
}
