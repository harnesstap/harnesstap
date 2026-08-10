import { getDb } from "../db/connection.js";
import { getLayerById } from "../models/plugin-model.js";
import type { LayerOrigin } from "../types.js";

export type AuthoredCapability = "edit" | "cut" | "publish" | "needs";

const CAPABILITY_VERB: Record<AuthoredCapability, string> = {
  edit: "edited directly",
  cut: "cut",
  publish: "published directly",
  needs: "given needs",
};

export class LayerProvenanceError extends Error {
  readonly hints: string[];

  constructor(message: string, hints: string[]) {
    super(message);
    this.name = "LayerProvenanceError";
    this.hints = hints;
  }
}

export function getLayerOrigin(layerId: string): LayerOrigin {
  const db = getDb();
  const row = db
    .prepare("SELECT origin FROM layers WHERE id = ?")
    .get(layerId) as { origin: string } | undefined;
  return (row?.origin as LayerOrigin) ?? "authored";
}

export function setLayerOrigin(layerId: string, origin: LayerOrigin): void {
  const db = getDb();
  db.prepare("UPDATE layers SET origin = ?, updated_at = ? WHERE id = ?").run(
    origin,
    new Date().toISOString(),
    layerId,
  );
}

/**
 * Capabilities that mutate or republish a plugin require local authorship.
 * The error names the fix rather than only refusing, because with one flat
 * list of plugins the capability difference is otherwise invisible.
 */
export function assertAuthored(
  layerId: string,
  capability: AuthoredCapability,
): void {
  const origin = getLayerOrigin(layerId);
  if (origin === "authored") {
    return;
  }
  const layer = getLayerById(layerId);
  const name = layer?.name ?? layerId;
  throw new LayerProvenanceError(
    `${name} is ${origin === "upstream" ? "an upstream" : "a catalog"} plugin and cannot be ${CAPABILITY_VERB[capability]}`,
    [`ht layer fork ${name}`],
  );
}

export function assertSyncable(layerId: string): void {
  const origin = getLayerOrigin(layerId);
  if (origin !== "authored") {
    return;
  }
  const layer = getLayerById(layerId);
  const name = layer?.name ?? layerId;
  throw new LayerProvenanceError(
    `${name} is an authored plugin; there is no upstream to sync from`,
    [`ht layer edit ${name}`],
  );
}
