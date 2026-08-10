import { getDb } from "../db/connection.js";
import type { PluginOverrides } from "../types.js";

const EMPTY: PluginOverrides = { versions: {}, resources: {} };

export function getPluginOverrides(pluginId: string): PluginOverrides {
  const db = getDb();
  const row = db
    .prepare("SELECT overrides FROM plugins WHERE id = ?")
    .get(pluginId) as { overrides: string } | undefined;
  if (!row || !row.overrides || row.overrides === "{}") {
    return { ...EMPTY, versions: {}, resources: {} };
  }
  const parsed = JSON.parse(row.overrides) as Partial<PluginOverrides>;
  return { versions: parsed.versions ?? {}, resources: parsed.resources ?? {} };
}

function writePluginOverrides(pluginId: string, overrides: PluginOverrides): void {
  const db = getDb();
  db.prepare("UPDATE plugins SET overrides = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(overrides),
    new Date().toISOString(),
    pluginId,
  );
}

export function setPluginVersionOverride(
  pluginId: string,
  name: string,
  version: string,
): void {
  const current = getPluginOverrides(pluginId);
  writePluginOverrides(pluginId, {
    ...current,
    versions: { ...current.versions, [name]: version },
  });
}

export function setPluginResourceOverride(
  pluginId: string,
  resourceKey: string,
  winningPluginName: string,
): void {
  const current = getPluginOverrides(pluginId);
  writePluginOverrides(pluginId, {
    ...current,
    resources: { ...current.resources, [resourceKey]: winningPluginName },
  });
}

export function clearPluginOverrides(pluginId: string): void {
  writePluginOverrides(pluginId, { versions: {}, resources: {} });
}
