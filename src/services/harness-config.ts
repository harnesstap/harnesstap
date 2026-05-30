import inquirer from "inquirer";
import { getAllPlatforms, getPlatformIds } from "../platforms/registry.js";
import type { HarnessPreference, HarnessSelection } from "../types.js";
import {
  promptForOptionalValue,
  promptForSearchableChoice,
} from "./wizards/shared.js";

export interface ResolveHarnessSelectionOptions {
  current?: HarnessPreference | HarnessSelection;
  detected?: string[];
  main?: string;
  aliases?: string[];
  nonInteractive?: boolean;
  mainMessage?: string;
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

function pickDefaultMain(
  current: HarnessPreference | HarnessSelection | undefined,
  detected: string[],
): string {
  if (current?.main_harness) return current.main_harness;
  if (detected.length > 0) {
    const firstDetected = detected[0];
    if (firstDetected) return firstDetected;
  }

  const first = getPlatformIds()[0];
  if (!first) {
    throw new Error("No harnesses are registered");
  }
  return first;
}

function normalizeSelection(selection: HarnessSelection): HarnessSelection {
  return {
    main_harness: selection.main_harness,
    alias_harnesses: unique(selection.alias_harnesses).filter(
      (harness) => harness !== selection.main_harness,
    ),
  };
}

function formatCurrentHarnessSummary(
  current: HarnessPreference | HarnessSelection | undefined,
): string | undefined {
  if (!current) {
    return undefined;
  }

  return `Current main: ${current.main_harness} | aliases: ${current.alias_harnesses.join(", ") || "(none)"}`;
}

export async function resolveHarnessSelection(
  options: ResolveHarnessSelectionOptions = {},
): Promise<HarnessSelection> {
  const detected = unique(options.detected ?? []);
  const current = options.current;
  const defaultMain = options.main ?? pickDefaultMain(current, detected);
  const defaultAliases = unique(
    options.aliases ??
      current?.alias_harnesses ??
      detected.filter((harness) => harness !== defaultMain),
  ).filter((harness) => harness !== defaultMain);

  validateHarnesses([defaultMain, ...defaultAliases]);

  if (options.nonInteractive || !process.stdin.isTTY) {
    return normalizeSelection({
      main_harness: defaultMain,
      alias_harnesses: defaultAliases,
    });
  }

  if (
    detected.length === 1
    && detected[0] === defaultMain
    && defaultAliases.length === 0
  ) {
    return normalizeSelection({
      main_harness: defaultMain,
      alias_harnesses: [],
    });
  }

  const harnesses = getAllPlatforms().map((platform) => ({
    name: `${platform.name} (${platform.id})`,
    value: platform.id,
  }));

  const currentSummary = formatCurrentHarnessSummary(current);
  const main_harness = await promptForSearchableChoice({
    message: [
      options.mainMessage ?? "Select the main harness",
      currentSummary,
    ].filter(Boolean).join("\n"),
    default: defaultMain,
    choices: harnesses,
  });
  const aliasChoices = harnesses.filter((choice) => choice.value !== main_harness);
  const aliasFilter = await promptForOptionalValue({
    message: [
      "Search alias harnesses (optional)",
      currentSummary,
    ].filter(Boolean).join("\n"),
  });
  const normalizedAliasFilter = aliasFilter.toLowerCase();
  const filteredAliasChoices =
    normalizedAliasFilter.length > 0
      ? aliasChoices.filter((choice) =>
          `${choice.name} ${choice.value}`.toLowerCase().includes(normalizedAliasFilter),
        )
      : aliasChoices;
  const visibleAliasValues = new Set(
    filteredAliasChoices.map((choice) => choice.value),
  );
  const hiddenDefaultAliases = defaultAliases.filter(
    (harness) =>
      harness !== main_harness
      && !visibleAliasValues.has(harness),
  );

  const { alias_harnesses } = await inquirer.prompt<{
    alias_harnesses: string[];
  }>([
    {
      type: "checkbox",
      name: "alias_harnesses",
      message: [
        options.aliasMessage ??
        "Select additional harnesses to keep in sync as aliases",
        currentSummary,
      ].filter(Boolean).join("\n"),
      default: defaultAliases.filter((harness) => visibleAliasValues.has(harness)),
      choices: filteredAliasChoices,
      pageSize: 10,
      loop: false,
    },
  ]);

  return normalizeSelection({
    main_harness,
    alias_harnesses: [...hiddenDefaultAliases, ...alias_harnesses],
  });
}
