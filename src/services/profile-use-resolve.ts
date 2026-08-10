import { resolve } from "node:path";
import { listProfilePlugins } from "../constants/profile.js";
import { getActiveProfileName } from "./active-profile.js";
import {
  findProjectConfig,
  getProfileEntry,
  type ProjectProfileEntry,
  type ResolvedProjectConfig,
} from "./project-config.js";
import { resolveExpectedPluginName } from "./project-config-use.js";
import { buildProjectProfileChoices } from "./wizards/project-use.js";
import {
  promptForChoice,
  promptForSearchableChoice,
  type PromptChoice,
  shouldUseWizard,
} from "./wizards/shared.js";

const PROJECT_PREFIX = "project:";
const GLOBAL_PREFIX = "global:";

export type ProfileUseSelection =
  | { kind: "project"; profileKey: string }
  | { kind: "global"; pluginName: string };

function encodeProjectChoice(profileKey: string): string {
  return `${PROJECT_PREFIX}${profileKey}`;
}

function encodeGlobalChoice(pluginName: string): string {
  return `${GLOBAL_PREFIX}${pluginName}`;
}

function decodeProfileUseChoice(value: string): ProfileUseSelection {
  if (value.startsWith(PROJECT_PREFIX)) {
    return { kind: "project", profileKey: value.slice(PROJECT_PREFIX.length) };
  }
  if (value.startsWith(GLOBAL_PREFIX)) {
    return { kind: "global", pluginName: value.slice(GLOBAL_PREFIX.length) };
  }
  throw new Error(`Invalid profile selection: ${value}`);
}

function collectProjectPluginNames(config: ResolvedProjectConfig): Set<string> {
  const names = new Set<string>();
  for (const entry of config.profiles) {
    try {
      names.add(resolveExpectedPluginName(config, entry));
    } catch {
      // Skip entries that cannot be resolved yet (e.g. missing inline plugin).
    }
  }
  return names;
}

function buildGlobalProfileChoices(
  config: ResolvedProjectConfig | null,
): PromptChoice<string>[] {
  const coveredPluginNames = config ? collectProjectPluginNames(config) : new Set<string>();
  return listProfilePlugins()
    .filter((plugin) => !coveredPluginNames.has(plugin.name))
    .map((plugin) => ({
      name: `${plugin.name}${getActiveProfileName() === plugin.name ? " (active)" : ""}`,
      value: encodeGlobalChoice(plugin.name),
    }));
}

function buildCombinedProfileUseChoices(
  config: ResolvedProjectConfig | null,
): PromptChoice<string>[] {
  const choices: PromptChoice<string>[] = [];

  if (config && config.profiles.length > 0) {
    for (const entry of config.profiles) {
      choices.push({
        name: `[project] ${formatProjectProfileLabel(config, entry)}`,
        value: encodeProjectChoice(entry.name),
      });
    }
  }

  choices.push(...buildGlobalProfileChoices(config));
  return choices;
}

function formatProjectProfileLabel(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
): string {
  const choice = buildProjectProfileChoices(config).find(
    (candidate) => candidate.value === entry.name,
  );
  return choice?.name ?? entry.name;
}

function resolveDefaultProfileUseChoice(
  config: ResolvedProjectConfig | null,
  choices: PromptChoice<string>[],
): string | undefined {
  if (config?.default_profile) {
    const projectChoice = encodeProjectChoice(config.default_profile);
    if (choices.some((choice) => choice.value === projectChoice)) {
      return projectChoice;
    }
  }

  const active = getActiveProfileName();
  if (active) {
    const globalChoice = encodeGlobalChoice(active);
    if (choices.some((choice) => choice.value === globalChoice)) {
      return globalChoice;
    }
  }

  return choices[0]?.value;
}

async function promptForProfileUseSelection(
  config: ResolvedProjectConfig | null,
): Promise<ProfileUseSelection> {
  const choices = buildCombinedProfileUseChoices(config);
  if (choices.length === 0) {
    throw new Error("No profiles available. Create one with `ht profile create <name>`.");
  }

  const message = config
    ? "Which profile should be applied globally?"
    : "Which profile plugin should be applied globally?";
  const defaultChoice = resolveDefaultProfileUseChoice(config, choices);

  const value =
    choices.length >= 8
      ? await promptForSearchableChoice({ message, choices, default: defaultChoice })
      : await promptForChoice({ message, choices, default: defaultChoice });

  return decodeProfileUseChoice(value);
}

export async function resolveProfileUseSelection(input: {
  name?: string;
  profile?: string;
  project?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
}): Promise<ProfileUseSelection | null> {
  if (input.name) {
    return { kind: "global", pluginName: input.name };
  }

  const projectPath = resolve(input.project ?? process.cwd());
  const config = findProjectConfig(projectPath);

  if (input.profile) {
    if (!config) {
      throw new Error(
        "No project config found. Omit --profile to switch a local profile plugin by name.",
      );
    }
    getProfileEntry(config, input.profile);
    return { kind: "project", profileKey: input.profile };
  }

  const interactive = shouldUseWizard({
    interactive: input.interactive,
    noInteractive: input.noInteractive,
    format: input.format,
    missingRequiredArgs: true,
  });

  if (interactive) {
    return promptForProfileUseSelection(config);
  }

  if (config) {
    if (config.profiles.length === 0) {
      return null;
    }
    if (config.profiles.length === 1) {
      const [onlyProfile] = config.profiles;
      if (!onlyProfile) {
        return null;
      }
      return { kind: "project", profileKey: onlyProfile.name };
    }
    if (config.default_profile) {
      const hasDefault = config.profiles.some(
        (profile) => profile.name === config.default_profile,
      );
      if (hasDefault) {
        return { kind: "project", profileKey: config.default_profile };
      }
    }
    return null;
  }

  return null;
}
