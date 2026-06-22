import {
  resolveProfileEnvironment,
  type ProjectProfileEntry,
  type ResolvedProjectConfig,
} from "../project-config.js";
import {
  promptForChoice,
  promptForSearchableChoice,
  type PromptChoice,
} from "./shared.js";

function formatProfileLayerHint(entry: ProjectProfileEntry): string {
  switch (entry.source) {
    case "catalog":
    case "local":
      return entry.selector ?? entry.name;
    case "inline":
      return entry.layer ?? entry.name;
    default: {
      const unhandledSource: never = entry.source;
      throw new Error(`Unhandled profile source: ${unhandledSource}`);
    }
  }
}

function formatProjectProfileChoiceName(
  config: ResolvedProjectConfig,
  entry: ProjectProfileEntry,
): string {
  const parts = [entry.name, entry.source, formatProfileLayerHint(entry)];
  const environment = resolveProfileEnvironment(config, entry);
  if (environment) {
    parts.push(`env ${environment}`);
  }
  return parts.join(" · ");
}

export function buildProjectProfileChoices(
  config: ResolvedProjectConfig,
): PromptChoice<string>[] {
  return config.profiles.map((entry) => ({
    name: formatProjectProfileChoiceName(config, entry),
    value: entry.name,
  }));
}

function resolveDefaultProfileKey(config: ResolvedProjectConfig): string | undefined {
  const defaultProfile = config.default_profile;
  if (!defaultProfile) {
    return undefined;
  }
  return config.profiles.some((profile) => profile.name === defaultProfile)
    ? defaultProfile
    : undefined;
}

export async function promptForProjectProfile(
  config: ResolvedProjectConfig,
): Promise<string> {
  const choices = buildProjectProfileChoices(config);
  const defaultProfile = resolveDefaultProfileKey(config);
  const message = "Which project profile should be used?";

  if (choices.length >= 5) {
    return promptForSearchableChoice({
      message,
      choices,
      default: defaultProfile,
    });
  }

  return promptForChoice({
    message,
    choices,
    default: defaultProfile,
  });
}
