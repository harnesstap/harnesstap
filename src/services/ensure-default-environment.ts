import {
  createEnvironment,
  listEnvironments,
} from "../models/environment.js";
import type { Environment } from "../types.js";
import {
  getGlobalActiveEnvironmentName,
  setGlobalActiveEnvironment,
} from "./environment-session.js";

export interface EnsureDefaultEnvironmentResult {
  environment: Environment;
  created: boolean;
}

/**
 * When no environments exist, seed a `default` environment and point the home
 * active environment at it if unset.
 */
export function ensureDefaultEnvironment(): EnsureDefaultEnvironmentResult {
  const existing = listEnvironments();
  const [first] = existing;
  if (first) {
    return { environment: first, created: false };
  }

  const environment = createEnvironment({
    name: "default",
    description: "Default environment",
  });

  if (!getGlobalActiveEnvironmentName()) {
    setGlobalActiveEnvironment(environment.name);
  }

  return { environment, created: true };
}
