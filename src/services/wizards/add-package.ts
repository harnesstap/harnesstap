import { listPlugins } from "../../models/plugin-model.js";
import { getHarnessPreference } from "../../models/harness.js";
import { getAllPlatforms } from "../../platforms/registry.js";
import type { DiscoveredSkill } from "../skill-discovery.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import {
  promptForChoice,
  promptForConfirmation,
  promptForValue,
  resolveOrPrompt,
} from "./shared.js";

export interface AddPackageWizardResult {
  skillNames?: string[];
  all?: boolean;
  scope: "global" | "project";
  projectRoot?: string;
  method: "symlink" | "copy";
  harnesses?: string[];
  createPlugin?: string;
  plugin?: string;
  confirmed: boolean;
}

function defaultHarnessSelection(): string[] {
  const preference = getHarnessPreference();
  if (preference) {
    return [preference.main_harness, ...preference.alias_harnesses].filter(Boolean);
  }
  return [];
}

function buildSkillChoices(discovered: DiscoveredSkill[]) {
  const byCategory = new Map<string, DiscoveredSkill[]>();
  for (const skill of discovered) {
    const category = skill.category || "general";
    const group = byCategory.get(category) ?? [];
    group.push(skill);
    byCategory.set(category, group);
  }

  const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
  const choices: Array<{ name: string; value: string; description?: string }> = [];
  for (const category of categories) {
    const skills = byCategory.get(category) ?? [];
    for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
      const description = skill.description.trim() || undefined;
      choices.push({
        name: `[${category}] ${skill.name}`,
        value: skill.name,
        description,
      });
    }
  }
  return choices;
}

function resolvePluginStepChoice(input: {
  createPlugin?: string;
  plugin?: string;
}): "skip" | "create" | "existing" | undefined {
  if (input.createPlugin) return "create";
  if (input.plugin) return "existing";
  return undefined;
}

export async function runAddPackageWizard(input: {
  discovered: DiscoveredSkill[];
  skillNames?: string[];
  all?: boolean;
  scope?: "global" | "project";
  projectRoot?: string;
  method?: "symlink" | "copy";
  harnesses?: string[];
  createPlugin?: string;
  plugin?: string;
  sourceLabel?: string;
  shouldPrompt: boolean;
}): Promise<AddPackageWizardResult> {
  const method = input.method ?? "symlink";

  if (!input.shouldPrompt) {
    if (!input.scope) {
      throw new Error("Scope required. Pass --global or --project.");
    }
    return {
      skillNames: input.skillNames,
      all: input.all,
      scope: input.scope,
      projectRoot: input.projectRoot,
      method,
      harnesses: input.harnesses,
      createPlugin: input.createPlugin,
      plugin: input.plugin,
      confirmed: true,
    };
  }

  let skillNames = input.skillNames;
  let all = input.all;

  if (!all && (!skillNames || skillNames.length === 0)) {
    const selected = await promptForSearchableMultiSelect({
      message: "Which skills do you want to install?",
      choices: buildSkillChoices(input.discovered),
      default: input.discovered.map((skill) => skill.name),
      pageSize: 12,
      loop: false,
    });
    if (selected.length === 0) {
      throw new Error("No skills selected.");
    }
    if (selected.length === input.discovered.length) {
      all = true;
      skillNames = undefined;
    } else {
      skillNames = selected;
    }
  }

  const harnessChoices = getAllPlatforms().map((platform) => ({
    name: `${platform.name} (${platform.id})`,
    value: platform.id,
  }));
  const defaultHarnesses = input.harnesses ?? defaultHarnessSelection();
  const harnesses = await resolveOrPrompt({
    value: input.harnesses,
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      promptForSearchableMultiSelect({
        message: "Which harnesses should receive the installed skills?",
        choices: harnessChoices,
        default: defaultHarnesses,
        pageSize: 10,
        loop: false,
      }),
  });

  const scope = await resolveOrPrompt({
    value: input.scope,
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      promptForChoice({
        message: "Where should skills be installed?",
        choices: [
          { name: "Global (user home)", value: "global" },
          { name: "Project directory", value: "project" },
        ],
        default: "global",
      }),
  });

  if (!scope) {
    throw new Error("Scope required. Pass --global or --project.");
  }

  let projectRoot = input.projectRoot;
  if (scope === "project" && !projectRoot) {
    projectRoot = await promptForValue({
      message: "Project directory",
      default: ".",
    });
  }

  const installMethod = await resolveOrPrompt({
    value: input.method,
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      promptForChoice({
        message: "Installation method",
        choices: [
          { name: "Symlink (recommended)", value: "symlink" },
          { name: "Copy files", value: "copy" },
        ],
        default: "symlink",
      }),
  });

  let createPlugin = input.createPlugin;
  let plugin = input.plugin;
  const pluginStep = resolvePluginStepChoice(input);
  if (!pluginStep) {
    const pluginChoice = await promptForChoice({
      message: "Attach skills to a plugin?",
      choices: [
        { name: "Skip", value: "skip" },
        {
          name: "Create a new plugin",
          value: "create",
        },
        { name: "Add to an existing plugin", value: "existing" },
      ],
      default: "skip",
    });

    if (pluginChoice === "create") {
      createPlugin = await promptForValue({
        message: "New plugin name",
        default: input.sourceLabel?.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || undefined,
      });
    } else if (pluginChoice === "existing") {
      const plugins = listPlugins();
      if (plugins.length > 0) {
        plugin = await promptForChoice({
          message: "Which plugin?",
          choices: plugins.map((entry) => ({
            name: `${entry.name}@${entry.version}`,
            value: entry.name,
          })),
        });
      } else {
        plugin = await promptForValue({
          message: "Existing plugin name",
        });
      }
    }
  }

  const confirmed = await promptForConfirmation({
    message: "Proceed with installation?",
    default: true,
  });

  return {
    skillNames,
    all,
    scope,
    projectRoot,
    method: installMethod ?? method,
    harnesses,
    createPlugin,
    plugin,
    confirmed,
  };
}
