import { CLI_ERRORS, CLI_HINTS } from "../copy/cli.js";
import { getHarnessPreference, getProjectHarnessConfig } from "../models/harness.js";
import { getProjectByLocalPath } from "../models/project.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { CliUsageError } from "./cli-errors.js";
import { detectHomePlatforms } from "./scanner.js";
import { resolveHomeRoot } from "../utils/home-root.js";

export function parsePlatformFilter(platform?: string): string[] | undefined {
  return platform?.split(",").map((p) => p.trim()).filter(Boolean);
}

export function uniqueHarnessTargets(harnesses: readonly string[]): string[] {
  return [...new Set(harnesses.filter(Boolean))];
}

/** Ordered registered set. Drops empties and duplicates, first occurrence wins. */
export function normalizeRegisteredHarnesses(
  harnesses: readonly string[],
): string[] {
  return uniqueHarnessTargets(harnesses);
}

export function registeredHarnessesOf(
  selection:
    | { registered_harnesses?: readonly string[] }
    | null
    | undefined,
): string[] {
  if (!selection?.registered_harnesses) return [];
  return normalizeRegisteredHarnesses(selection.registered_harnesses);
}

/** `--main`/`--aliases` and pre-v32 archive JSON. */
export function registeredFromLegacyParts(
  main?: string | null,
  aliases?: readonly string[] | null,
): string[] {
  return normalizeRegisteredHarnesses([
    ...(main ? [main] : []),
    ...(aliases ?? []),
  ]);
}

export function assertSupportedHarnessTargets(harnesses: string[]): void {
  const supported = new Set(getAllPlatforms().map((platform) => platform.id));
  const invalid = harnesses.filter((harness) => !supported.has(harness));
  if (invalid.length > 0) {
    throw new Error(`Unsupported harness: ${invalid.join(", ")}`);
  }
}

/**
 * Global apply / profile use targets: explicit `--harness`, else the
 * registered set. Never falls back to filesystem detection of default
 * harnesses (claude-code, warp, jules, …) when none are registered.
 */
export function resolveRegisteredGlobalApplyHarnesses(harnessOption?: string): string[] {
  const explicitTargets = uniqueHarnessTargets(parsePlatformFilter(harnessOption) ?? []);
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
  }

  const preferredTargets = registeredHarnessesOf(getHarnessPreference());
  if (preferredTargets.length > 0) {
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  throw new CliUsageError(CLI_ERRORS.noHarnesses, [CLI_HINTS.harnessSetOrFlag]);
}

export function resolveScanGlobalHarnessTargets(
  harnessOption?: string,
  homeRoot = resolveHomeRoot(),
): string[] {
  const explicitTargets = uniqueHarnessTargets(parsePlatformFilter(harnessOption) ?? []);
  if (explicitTargets.length > 0) {
    assertSupportedHarnessTargets(explicitTargets);
    return explicitTargets;
  }

  const preference = getHarnessPreference();
  if (preference) {
    const preferredTargets = registeredHarnessesOf(preference);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  const detectedTargets = uniqueHarnessTargets(
    detectHomePlatforms(homeRoot).map((result) => result.platformId),
  );
  if (detectedTargets.length > 0) {
    return detectedTargets;
  }

  throw new Error(
    "No global harness targets configured. Run ht harness set or pass --harness <slugs>.",
  );
}

/**
 * Project then global harness preference slugs. Filesystem detection is a
 * later step in `resolveCompileTargets` so declared `targets:` stay portable.
 */
export function collectApplyPreferenceHarnesses(projectRoot: string): string[] {
  const projectByPath = getProjectByLocalPath(projectRoot);
  const projectConfig = projectByPath
    ? getProjectHarnessConfig(projectByPath.id)
    : undefined;
  if (projectConfig) {
    const preferredTargets = registeredHarnessesOf(projectConfig);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  const preference = getHarnessPreference();
  if (preference) {
    const preferredTargets = registeredHarnessesOf(preference);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  return [];
}
