import { getDb } from "../db/connection.js";
import type { LayerOverrides } from "../types.js";

const EMPTY: LayerOverrides = { versions: {}, resources: {} };

export function getLayerOverrides(layerId: string): LayerOverrides {
  const db = getDb();
  const row = db
    .prepare("SELECT overrides FROM layers WHERE id = ?")
    .get(layerId) as { overrides: string } | undefined;
  if (!row || !row.overrides || row.overrides === "{}") {
    return { ...EMPTY, versions: {}, resources: {} };
  }
  const parsed = JSON.parse(row.overrides) as Partial<LayerOverrides>;
  return { versions: parsed.versions ?? {}, resources: parsed.resources ?? {} };
}

function writeLayerOverrides(layerId: string, overrides: LayerOverrides): void {
  const db = getDb();
  db.prepare("UPDATE layers SET overrides = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(overrides),
    new Date().toISOString(),
    layerId,
  );
}

export function setLayerVersionOverride(
  layerId: string,
  name: string,
  version: string,
): void {
  const current = getLayerOverrides(layerId);
  writeLayerOverrides(layerId, {
    ...current,
    versions: { ...current.versions, [name]: version },
  });
}

export function setLayerResourceOverride(
  layerId: string,
  resourceKey: string,
  winningLayerName: string,
): void {
  const current = getLayerOverrides(layerId);
  writeLayerOverrides(layerId, {
    ...current,
    resources: { ...current.resources, [resourceKey]: winningLayerName },
  });
}

export function clearLayerOverrides(layerId: string): void {
  writeLayerOverrides(layerId, { versions: {}, resources: {} });
}
