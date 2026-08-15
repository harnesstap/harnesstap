import { listProfilePlugins } from "../constants/profile.js";
import { getActiveProfileName } from "./active-profile.js";
import { ensureDefaultEnvironment } from "./ensure-default-environment.js";
import { ensureDefaultProfilePlugin } from "./ensure-default-profile.js";
import { writeStarterProjectConfig } from "./project-config-write.js";
import { promptForChoice, shouldUseWizard } from "./wizards/shared.js";
import { promptForSearchableMultiSelect } from "./wizards/searchable-multi-select.js";

export interface ConfigInitOptions {
  project?: string;
  force?: boolean;
  profiles?: string[];
  defaultProfile?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
}

export interface ConfigInitResult {
  config_path: string;
  default_profile: string;
  profiles: string[];
}

function resolveProfilePluginNames(
  availableNames: string[],
  overrideNames?: string[],
): string[] {
  if (overrideNames && overrideNames.length > 0) {
    const known = new Set(availableNames);
    for (const name of overrideNames) {
      if (!known.has(name)) {
        throw new Error(
          `Unknown profile plugin: ${name}. Create it with \`ht profile create ${name}\` first.`,
        );
      }
    }
    return [...new Set(overrideNames)];
  }
  return availableNames;
}

function resolveDefaultProfileName(
  profileNames: string[],
  override?: string,
): string {
  if (override) {
    if (!profileNames.includes(override)) {
      throw new Error(`Default profile "${override}" must be one of: ${profileNames.join(", ")}`);
    }
    return override;
  }

  const active = getActiveProfileName();
  if (active && profileNames.includes(active)) {
    return active;
  }

  const [first] = profileNames;
  if (!first) {
    throw new Error("No profile plugins available.");
  }
  return first;
}

async function promptProfileSelection(
  availableNames: string[],
): Promise<string[]> {
  const active = getActiveProfileName();
  const defaultSelection = availableNames.filter(
    (name) => name === active || availableNames.length <= 3,
  );
  const selected =
    defaultSelection.length > 0 ? defaultSelection : [...availableNames];

  if (availableNames.length === 1) {
    return availableNames;
  }

  return promptForSearchableMultiSelect({
    message: "Which profile plugins should be listed in project config?",
    choices: availableNames.map((name) => ({
      name: name === active ? `${name} (active)` : name,
      value: name,
      checked: selected.includes(name),
    })),
    default: selected,
  });
}

async function promptDefaultProfile(profileNames: string[]): Promise<string> {
  if (profileNames.length === 1) {
    const [only] = profileNames;
    if (!only) {
      throw new Error("No profiles selected.");
    }
    return only;
  }

  const active = getActiveProfileName();
  const defaultName =
    active && profileNames.includes(active) ? active : profileNames[0];

  return promptForChoice({
    message: "Which profile should be the default?",
    choices: profileNames.map((name) => ({ name, value: name })),
    default: defaultName,
  });
}

export async function executeConfigInit(
  options: ConfigInitOptions = {},
): Promise<ConfigInitResult> {
  const projectPath = options.project ?? process.cwd();
  ensureDefaultProfilePlugin();
  ensureDefaultEnvironment();
  const availableNames = listProfilePlugins().map((plugin) => plugin.name);
  if (availableNames.length === 0) {
    throw new Error("Failed to ensure a default profile plugin.");
  }

  const needsProfilePrompt = !options.profiles?.length;
  const needsDefaultPrompt = !options.defaultProfile;
  const useWizard = shouldUseWizard({
    interactive: options.interactive,
    noInteractive: options.noInteractive,
    format: options.format,
    missingRequiredArgs: needsProfilePrompt || needsDefaultPrompt,
  });

  let profileNames = resolveProfilePluginNames(availableNames, options.profiles);
  if (useWizard && needsProfilePrompt) {
    profileNames = await promptProfileSelection(availableNames);
  }

  if (profileNames.length === 0) {
    throw new Error("Select at least one profile plugin for project config.");
  }

  let defaultProfile = resolveDefaultProfileName(profileNames, options.defaultProfile);
  if (useWizard && needsDefaultPrompt) {
    defaultProfile = await promptDefaultProfile(profileNames);
  }

  const { configPath } = writeStarterProjectConfig({
    projectPath,
    defaultProfile,
    profileNames,
    force: options.force,
  });

  return {
    config_path: configPath,
    default_profile: defaultProfile,
    profiles: profileNames,
  };
}
