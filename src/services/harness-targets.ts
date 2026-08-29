import { getHarnessPreference, getProjectHarnessConfig } from "../models/harness.js";
import { getProjectByLocalPath } from "../models/project.js";
import { getAllPlatforms } from "../platforms/registry.js";
import { detectHomePlatforms, detectPlatforms } from "./scanner.js";
import { resolveHomeRoot } from "../utils/home-root.js";

export function parsePlatformFilter(platform?: string): string[] | undefined {
  return platform?.split(",").map((p) => p.trim()).filter(Boolean);
}

export function uniqueHarnessTargets(harnesses: string[]): string[] {
  return [...new Set(harnesses.filter(Boolean))];
}

export function assertSupportedHarnessTargets(harnesses: string[]): void {
  const supported = new Set(getAllPlatforms().map((platform) => platform.id));
  const invalid = harnesses.filter((harness) => !supported.has(harness));
  if (invalid.length > 0) {
    throw new Error(`Unsupported harness: ${invalid.join(", ")}`);
  }
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
    const preferredTargets = uniqueHarnessTargets([
      preference.main_harness,
      ...preference.alias_harnesses,
    ]);
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
    "No global harness targets configured. Run harnesstap harness set or pass --harness <slugs>.",
  );
}

/**
 * Machine-local fallback used only by `ht apply <plugin>` after CLI flags and
 * declared `targets:` have been considered. Install/compile do not use this.
 */
export function collectApplyPreferenceHarnesses(projectRoot: string): string[] {
  const projectByPath = getProjectByLocalPath(projectRoot);
  const projectConfig = projectByPath
    ? getProjectHarnessConfig(projectByPath.id)
    : undefined;
  if (projectConfig) {
    const preferredTargets = uniqueHarnessTargets([
      projectConfig.main_harness,
      ...projectConfig.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  const preference = getHarnessPreference();
  if (preference) {
    const preferredTargets = uniqueHarnessTargets([
      preference.main_harness,
      ...preference.alias_harnesses,
    ]);
    assertSupportedHarnessTargets(preferredTargets);
    return preferredTargets;
  }

  return uniqueHarnessTargets(detectPlatforms(projectRoot));
}
