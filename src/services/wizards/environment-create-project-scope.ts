import { resolve } from "node:path";
import { getPluginById } from "../../models/plugin-model.js";
import {
  getProjectByLocalPath,
  getProjectConfiguredPlugins,
} from "../../models/project.js";
import { toPluginChoices } from "../completion/choices.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import {
  isPromptBackError,
  promptForChoice,
  promptForValue,
  withPromptBack,
  type PromptChoice,
} from "./shared.js";

export type ProjectPluginScopeInspection =
  | {
      kind: "applied";
      projectRoot: string;
      selectors: string[];
      labels: string[];
    }
  | { kind: "untracked"; projectRoot: string }
  | { kind: "no_applied_plugins"; projectRoot: string };

type PromptPluginSelection = string[] | "back";

function formatPluginSelector(pluginId: string): string | undefined {
  const plugin = getPluginById(pluginId);
  if (!plugin) {
    return undefined;
  }
  return `${plugin.name}@${plugin.version}`;
}

export function inspectProjectPluginScope(
  projectRoot: string,
): ProjectPluginScopeInspection {
  const resolvedRoot = resolve(projectRoot);
  const project = getProjectByLocalPath(resolvedRoot);
  if (!project) {
    return { kind: "untracked", projectRoot: resolvedRoot };
  }

  const applied = getProjectConfiguredPlugins(project.id);
  const selectors: string[] = [];
  const labels: string[] = [];

  for (const row of applied) {
    const selector = formatPluginSelector(row.plugin_id);
    if (!selector) {
      continue;
    }
    selectors.push(selector);
    labels.push(selector);
  }

  if (selectors.length === 0) {
    return { kind: "no_applied_plugins", projectRoot: resolvedRoot };
  }

  return {
    kind: "applied",
    projectRoot: resolvedRoot,
    selectors,
    labels,
  };
}

function explainMissingProjectPlugins(inspection: ProjectPluginScopeInspection): void {
  console.log("");
  if (inspection.kind === "untracked") {
    console.log(
      `No HarnessTap project is tracked at ${inspection.projectRoot}.`,
    );
    console.log(
      "Run `ht plugin apply` in that directory first, or pick plugins from your library to define which env vars are required.",
    );
    return;
  }

  console.log(
    `Project ${inspection.projectRoot} is tracked, but no plugins have been applied yet.`,
  );
  console.log(
    "Run `ht plugin apply` there, or pick plugins from your library to define which env vars are required.",
  );
}

type MissingScopeAction = "pick_plugins" | "change_directory" | "cancel";

async function promptMissingScopeAction(): Promise<MissingScopeAction> {
  return withPromptBack(() =>
    promptForChoice<MissingScopeAction>({
      message: "How do you want to continue?",
      choices: [
        {
          name: "Pick plugins from library",
          value: "pick_plugins",
          description: "Choose which plugins define required env vars",
        },
        {
          name: "Try another project directory",
          value: "change_directory",
          description: "Look for a tracked project with applied plugins",
        },
        {
          name: "Cancel",
          value: "cancel",
          description: "Abort environment create",
        },
      ],
      default: "pick_plugins",
    }),
  );
}

async function promptPluginSelectorsFromLibrary(): Promise<PromptPluginSelection> {
  const pluginChoices = toPluginChoices();
  if (pluginChoices.length === 0) {
    console.log("");
    console.log("No plugins found in your HarnessTap library.");
    console.log("Create a plugin first with `ht plugin create`, then retry.");
    return [];
  }

  try {
    const selected = await promptForSearchableMultiSelect({
      message: "Plugins that define required environment variables",
      choices: pluginChoices.map((choice) => ({
        name: choice.name,
        value: choice.value,
        description: choice.description,
      })),
    });

    if (selected.length === 0) {
      console.log("");
      console.log("Select at least one plugin to continue.");
      return [];
    }

    return selected;
  } catch (error) {
    if (isPromptBackError(error)) {
      return "back";
    }
    throw error;
  }
}

async function promptAppliedPluginSelectors(input: {
  labels: string[];
  selectors: string[];
}): Promise<PromptPluginSelection> {
  if (input.selectors.length === 1) {
    console.log("");
    console.log(`Using applied plugin: ${input.labels[0]}`);
    return input.selectors;
  }

  console.log("");
  console.log("Applied plugins at this project:");
  for (const label of input.labels) {
    console.log(`  - ${label}`);
  }

  try {
    const selected = await promptForSearchableMultiSelect({
      message: "Plugins to derive required environment variables from",
      choices: input.selectors.map((selector, index) => ({
        name: input.labels[index] ?? selector,
        value: selector,
      })),
      default: input.selectors,
    });

    if (selected.length === 0) {
      console.log("");
      console.log("Select at least one plugin to continue.");
      return [];
    }

    return selected;
  } catch (error) {
    if (isPromptBackError(error)) {
      return "back";
    }
    throw error;
  }
}

async function promptProjectDirectory(defaultPath = "."): Promise<string> {
  return resolve(
    await withPromptBack(() =>
      promptForValue({
        message: "Project directory to scan for harness configuration",
        default: defaultPath,
      }),
    ),
  );
}

export async function promptForProjectPluginScope(input?: {
  initialProjectRoot?: string;
}): Promise<{ projectRoot: string; pluginSelectors: string[] } | undefined> {
  let projectRoot = input?.initialProjectRoot
    ? resolve(input.initialProjectRoot)
    : undefined;

  while (true) {
    if (!projectRoot) {
      try {
        projectRoot = await promptProjectDirectory();
      } catch (error) {
        if (isPromptBackError(error)) {
          throw error;
        }
        throw error;
      }
    }

    while (true) {
      const inspection = inspectProjectPluginScope(projectRoot);

      if (inspection.kind === "applied") {
        const pluginSelection = await promptAppliedPluginSelectors({
          labels: inspection.labels,
          selectors: inspection.selectors,
        });
        if (pluginSelection === "back") {
          projectRoot = undefined;
          break;
        }
        if (pluginSelection.length === 0) {
          continue;
        }
        return {
          projectRoot: inspection.projectRoot,
          pluginSelectors: pluginSelection,
        };
      }

      explainMissingProjectPlugins(inspection);

      let action: MissingScopeAction;
      try {
        action = await promptMissingScopeAction();
      } catch (error) {
        if (isPromptBackError(error)) {
          projectRoot = undefined;
          break;
        }
        throw error;
      }

      if (action === "cancel") {
        return undefined;
      }

      if (action === "change_directory") {
        projectRoot = undefined;
        break;
      }

      const pluginSelection = await promptPluginSelectorsFromLibrary();
      if (pluginSelection === "back") {
        continue;
      }
      if (pluginSelection.length === 0) {
        continue;
      }

      return {
        projectRoot: inspection.projectRoot,
        pluginSelectors: pluginSelection,
      };
    }
  }
}

export const ENVIRONMENT_CREATE_SOURCE_CHOICES: PromptChoice<
  "from-project" | "from-plugin" | "blank"
>[] = [
  {
    name: "From project",
    value: "from-project",
    description: "Scan harness files and import required env vars for applied plugins",
  },
  {
    name: "From plugin requirements",
    value: "from-plugin",
    description: "Fill keys a plugin needs without scanning a project directory",
  },
  {
    name: "Blank environment",
    value: "blank",
    description: "Create an empty record and add values in environment edit",
  },
];
