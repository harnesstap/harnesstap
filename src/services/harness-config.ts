import { getAllPlatforms, getPlatformIds } from "../platforms/registry.js";
import type { HarnessPreference, HarnessSelection } from "../types.js";
import {
  normalizeRegisteredHarnesses,
  registeredFromLegacyParts,
  registeredHarnessesOf,
} from "./harness-targets.js";
import { promptForSearchableMultiSelect } from "./wizards/searchable-multi-select.js";

export interface ResolveHarnessSelectionOptions {
  current?: HarnessPreference | HarnessSelection;
  detected?: string[];
  harnesses?: string[];
  main?: string;
  aliases?: string[];
  nonInteractive?: boolean;
  message?: string;
  /** @deprecated Use `message`. */
  mainMessage?: string;
  /** @deprecated Ignored; aliases are part of the registered set. */
  aliasMessage?: string;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function validateHarnesses(harnesses: string[]): void {
  const supported = new Set(getPlatformIds());
  const invalid = harnesses.filter((harness) => !supported.has(harness));
  if (invalid.length > 0) {
    throw new Error(`Unsupported harness: ${invalid.join(", ")}`);
  }
}

function defaultRegistered(
  options: ResolveHarnessSelectionOptions,
): string[] {
  if (options.harnesses && options.harnesses.length > 0) {
    return normalizeRegisteredHarnesses(options.harnesses);
  }
  const fromFlags = registeredFromLegacyParts(options.main, options.aliases);
  if (fromFlags.length > 0) {
    return fromFlags;
  }
  const current = registeredHarnessesOf(options.current);
  if (current.length > 0) {
    return current;
  }
  const detected = unique(options.detected ?? []);
  if (detected.length > 0) {
    return detected;
  }
  const first = getPlatformIds()[0];
  return first ? [first] : [];
}

function formatCurrentHarnessSummary(
  current: HarnessPreference | HarnessSelection | undefined,
): string | undefined {
  if (!current) {
    return undefined;
  }
  const registered = registeredHarnessesOf(current);
  return `Current harnesses: ${registered.join(", ") || "(none)"}`;
}

export async function resolveHarnessSelection(
  options: ResolveHarnessSelectionOptions = {},
): Promise<HarnessSelection> {
  const registered = defaultRegistered(options);
  validateHarnesses(registered);

  if (options.nonInteractive || !process.stdin.isTTY) {
    return { registered_harnesses: registered };
  }

  const detected = unique(options.detected ?? []);
  if (detected.length === 1 && detected[0] && registered.length <= 1) {
    return { registered_harnesses: [detected[0]] };
  }

  const harnesses = getAllPlatforms().map((platform) => ({
    name: `${platform.name} (${platform.id})`,
    value: platform.id,
  }));

  const currentSummary = formatCurrentHarnessSummary(options.current);
  const selected = await promptForSearchableMultiSelect({
    message: [
      options.message
      ?? options.mainMessage
      ?? "Select harnesses to keep in sync",
      currentSummary,
    ].filter(Boolean).join("\n"),
    default: registered,
    choices: harnesses,
    pageSize: 10,
    loop: false,
  });

  const next = normalizeRegisteredHarnesses(selected);
  if (next.length === 0) {
    throw new Error("Select at least one harness.");
  }
  validateHarnesses(next);
  return { registered_harnesses: next };
}
