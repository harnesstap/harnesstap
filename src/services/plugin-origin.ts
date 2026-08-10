import { getDb } from "../db/connection.js";
import { getPluginById } from "../models/plugin-model.js";
import type { PluginOrigin } from "../types.js";

export type AuthoredCapability = "edit" | "cut" | "publish" | "needs";

const CAPABILITY_VERB: Record<AuthoredCapability, string> = {
  edit: "edited directly",
  cut: "cut",
  publish: "published directly",
  needs: "given needs",
};

export class PluginProvenanceError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[]) {
    super(message);
    this.name = "PluginProvenanceError";
    this.hints = hints;
  }
}

export function getPluginOrigin(pluginId: string): PluginOrigin {
  const db = getDb();
  const row = db
    .prepare("SELECT origin FROM plugins WHERE id = ?")
    .get(pluginId) as { origin: string } | undefined;
  return (row?.origin as PluginOrigin) ?? "authored";
}

export function setPluginOrigin(pluginId: string, origin: PluginOrigin): void {
  const db = getDb();
  db.prepare("UPDATE plugins SET origin = ?, updated_at = ? WHERE id = ?").run(
    origin,
    new Date().toISOString(),
    pluginId,
  );
}

/**
 * Capabilities that mutate or republish a plugin require local authorship.
 * The error names the fix rather than only refusing, because with one flat
 * list of plugins the capability difference is otherwise invisible.
 */
export function assertAuthored(
  pluginId: string,
  capability: AuthoredCapability,
): void {
  const origin = getPluginOrigin(pluginId);
  if (origin === "authored") {
    return;
  }
  const plugin = getPluginById(pluginId);
  const name = plugin?.name ?? pluginId;
  throw new PluginProvenanceError(
    `${name} is ${origin === "upstream" ? "an upstream" : "a catalog"} plugin and cannot be ${CAPABILITY_VERB[capability]}`,
    [`ht plugin fork ${name}`],
  );
}

export function assertSyncable(pluginId: string): void {
  const origin = getPluginOrigin(pluginId);
  if (origin !== "authored") {
    return;
  }
  const plugin = getPluginById(pluginId);
  const name = plugin?.name ?? pluginId;
  throw new PluginProvenanceError(
    `${name} is an authored plugin; there is no upstream to sync from`,
    [`ht plugin edit ${name}`],
  );
}
