import { resolve } from "node:path";
import { getLayerById } from "../../models/layer-model.js";
import {
  getProjectByLocalPath,
  getProjectConfiguredLayers,
} from "../../models/project.js";
import { toLayerChoices } from "../completion/choices.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import {
  promptForChoice,
  promptForValue,
  type PromptChoice,
} from "./shared.js";

export type ProjectLayerScopeInspection =
  | {
      kind: "applied";
      projectRoot: string;
      selectors: string[];
      labels: string[];
    }
  | { kind: "untracked"; projectRoot: string }
  | { kind: "no_applied_layers"; projectRoot: string };

function formatLayerSelector(layerId: string): string | undefined {
  const layer = getLayerById(layerId);
  if (!layer) {
    return undefined;
  }
  return `${layer.name}@${layer.version}`;
}

export function inspectProjectLayerScope(
  projectRoot: string,
): ProjectLayerScopeInspection {
  const resolvedRoot = resolve(projectRoot);
  const project = getProjectByLocalPath(resolvedRoot);
  if (!project) {
    return { kind: "untracked", projectRoot: resolvedRoot };
  }

  const applied = getProjectConfiguredLayers(project.id);
  const selectors: string[] = [];
  const labels: string[] = [];

  for (const row of applied) {
    const selector = formatLayerSelector(row.layer_id);
    if (!selector) {
      continue;
    }
    selectors.push(selector);
    labels.push(selector);
  }

  if (selectors.length === 0) {
    return { kind: "no_applied_layers", projectRoot: resolvedRoot };
  }

  return {
    kind: "applied",
    projectRoot: resolvedRoot,
    selectors,
    labels,
  };
}

function explainMissingProjectLayers(inspection: ProjectLayerScopeInspection): void {
  console.log("");
  if (inspection.kind === "untracked") {
    console.log(
      `No HarnessDeck project is tracked at ${inspection.projectRoot}.`,
    );
    console.log(
      "Run `hd layer apply` in that directory first, or pick layers from your library to define which env vars are required.",
    );
    return;
  }

  console.log(
    `Project ${inspection.projectRoot} is tracked, but no layers have been applied yet.`,
  );
  console.log(
    "Run `hd layer apply` there, or pick layers from your library to define which env vars are required.",
  );
}

type MissingScopeAction = "pick_layers" | "change_directory" | "cancel";

async function promptMissingScopeAction(): Promise<MissingScopeAction> {
  return promptForChoice<MissingScopeAction>({
    message: "How do you want to continue?",
    choices: [
      {
        name: "Pick layers from library",
        value: "pick_layers",
        description: "Choose which layers define required env vars",
      },
      {
        name: "Try another project directory",
        value: "change_directory",
        description: "Look for a tracked project with applied layers",
      },
      {
        name: "Cancel",
        value: "cancel",
        description: "Abort environment create",
      },
    ],
    default: "pick_layers",
  });
}

async function promptLayerSelectorsFromLibrary(): Promise<string[] | undefined> {
  const layerChoices = toLayerChoices();
  if (layerChoices.length === 0) {
    console.log("");
    console.log("No layers found in your HarnessDeck library.");
    console.log("Create a layer first with `hd layer create`, then retry.");
    return undefined;
  }

  const selected = await promptForSearchableMultiSelect({
    message: "Layers that define required environment variables",
    choices: layerChoices.map((choice) => ({
      name: choice.name,
      value: choice.value,
      description: choice.description,
    })),
  });

  if (selected.length === 0) {
    console.log("");
    console.log("Select at least one layer to continue.");
    return undefined;
  }

  return selected;
}

async function promptAppliedLayerSelectors(input: {
  labels: string[];
  selectors: string[];
}): Promise<string[]> {
  if (input.selectors.length === 1) {
    console.log("");
    console.log(`Using applied layer: ${input.labels[0]}`);
    return input.selectors;
  }

  console.log("");
  console.log("Applied layers at this project:");
  for (const label of input.labels) {
    console.log(`  - ${label}`);
  }

  return promptForSearchableMultiSelect({
    message: "Layers to derive required environment variables from",
    choices: input.selectors.map((selector, index) => ({
      name: input.labels[index] ?? selector,
      value: selector,
    })),
    default: input.selectors,
  });
}

export async function promptForProjectLayerScope(input?: {
  initialProjectRoot?: string;
}): Promise<{ projectRoot: string; layerSelectors: string[] } | undefined> {
  let projectRoot = resolve(
    input?.initialProjectRoot
      ?? (await promptForValue({
        message: "Project directory to scan for harness configuration",
        default: ".",
      })),
  );

  while (true) {
    const inspection = inspectProjectLayerScope(projectRoot);

    if (inspection.kind === "applied") {
      const layerSelectors = await promptAppliedLayerSelectors({
        labels: inspection.labels,
        selectors: inspection.selectors,
      });
      if (layerSelectors.length === 0) {
        console.log("");
        console.log("Select at least one layer to continue.");
        continue;
      }
      return { projectRoot: inspection.projectRoot, layerSelectors };
    }

    explainMissingProjectLayers(inspection);
    const action = await promptMissingScopeAction();

    if (action === "cancel") {
      return undefined;
    }

    if (action === "change_directory") {
      projectRoot = resolve(
        await promptForValue({
          message: "Project directory to scan for harness configuration",
          default: projectRoot,
        }),
      );
      continue;
    }

    const layerSelectors = await promptLayerSelectorsFromLibrary();
    if (!layerSelectors) {
      continue;
    }

    return { projectRoot: inspection.projectRoot, layerSelectors };
  }
}

export const ENVIRONMENT_CREATE_SOURCE_CHOICES: PromptChoice<
  "from-project" | "from-layer" | "blank"
>[] = [
  {
    name: "From project",
    value: "from-project",
    description: "Scan harness files and import required env vars for applied layers",
  },
  {
    name: "From layer requirements",
    value: "from-layer",
    description: "Fill keys a layer needs without scanning a project directory",
  },
  {
    name: "Blank environment",
    value: "blank",
    description: "Create an empty record and add values in environment edit",
  },
];
