import { listProfileLayers } from "../constants/profile.js";
import type { Layer } from "../types.js";
import {
  getActiveProfileName,
  setActiveProfileName,
} from "./active-profile.js";
import { createProfileCommand } from "./profile-commands.js";

export interface EnsureDefaultProfileResult {
  layer: Layer;
  created: boolean;
}

/**
 * When no profile layers exist, seed a `default` profile (same name as `ht init`)
 * and point the active-profile pointer at it if unset.
 */
export function ensureDefaultProfileLayer(): EnsureDefaultProfileResult {
  const existing = listProfileLayers();
  const [first] = existing;
  if (first) {
    return { layer: first, created: false };
  }

  const { layer, created } = createProfileCommand({
    name: "default",
    description: "Default profile",
  });

  if (!getActiveProfileName()) {
    setActiveProfileName(layer.name);
  }

  return { layer, created };
}
