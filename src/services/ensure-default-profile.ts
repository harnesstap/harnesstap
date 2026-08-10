import { listProfilePlugins } from "../constants/profile.js";
import type { Plugin } from "../types.js";
import {
  getActiveProfileName,
  setActiveProfileName,
} from "./active-profile.js";
import { createProfileCommand } from "./profile-commands.js";

export interface EnsureDefaultProfileResult {
  plugin: Plugin;
  created: boolean;
}

/**
 * When no profile plugins exist, seed a `default` profile (same name as `ht init`)
 * and point the active-profile pointer at it if unset.
 */
export function ensureDefaultProfilePlugin(): EnsureDefaultProfileResult {
  const existing = listProfilePlugins();
  const [first] = existing;
  if (first) {
    return { plugin: first, created: false };
  }

  const { plugin, created } = createProfileCommand({
    name: "default",
    description: "Default profile",
  });

  if (!getActiveProfileName()) {
    setActiveProfileName(plugin.name);
  }

  return { plugin, created };
}
