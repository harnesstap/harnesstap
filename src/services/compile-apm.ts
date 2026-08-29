import { detectPlatforms } from "./scanner.js";
import {
  resolveCompileTargets,
  type ResolveCompileTargetsInput,
  type ResolvedCompileTargets,
} from "./apm-targets.js";
import { collectApplyPreferenceHarnesses, uniqueHarnessTargets } from "./harness-targets.js";
import { findProjectConfig } from "./project-config.js";

export type ResolveProjectCompileTargetsInput = Omit<
  ResolveCompileTargetsInput,
  "manifestHarnessTargets" | "preferenceHarnesses" | "fallbackHarnesses"
>;

/**
 * Resolve apply/compile harness targets for a project: CLI flags, then
 * `apm.yml` `targets:`, then HT preference, then filesystem signals.
 */
export function resolveProjectCompileTargets(
  input: ResolveProjectCompileTargetsInput,
): ResolvedCompileTargets {
  const manifest = findProjectConfig(input.projectRoot);
  return resolveCompileTargets({
    ...input,
    ...(manifest && manifest.harnessTargets.length > 0
      ? { manifestHarnessTargets: manifest.harnessTargets }
      : {}),
    preferenceHarnesses: collectApplyPreferenceHarnesses(input.projectRoot),
    fallbackHarnesses: uniqueHarnessTargets(detectPlatforms(input.projectRoot)),
  });
}
