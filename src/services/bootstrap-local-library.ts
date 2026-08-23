import { existsSync } from "node:fs";
import { getDb, getDbPath } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";
import { ensureDefaultEnvironment } from "./ensure-default-environment.js";
import { seedDefaultProfileFromLibrary } from "./ensure-default-profile.js";
import { scanAndPersistHomeDefaults } from "./scanner.js";

export interface BootstrapLocalLibraryOptions {
  seedDefaultProfile?: boolean;
}

export interface BootstrapLocalLibraryResult {
  firstRun: boolean;
  homeDefaults: Awaited<ReturnType<typeof scanAndPersistHomeDefaults>>;
}

/**
 * Shared first-run / re-init bootstrap: schema, home scan, default
 * environment, and a default profile seeded from library resources.
 */
export async function bootstrapLocalLibrary(
  options: BootstrapLocalLibraryOptions = {},
): Promise<BootstrapLocalLibraryResult> {
  const firstRun = !existsSync(getDbPath());
  initializeSchema(getDb());
  ensureDefaultEnvironment();
  const homeDefaults = await scanAndPersistHomeDefaults();
  if (options.seedDefaultProfile !== false) {
    seedDefaultProfileFromLibrary();
  }
  return { firstRun, homeDefaults };
}
