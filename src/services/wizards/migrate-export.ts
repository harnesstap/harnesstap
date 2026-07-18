import inquirer from "inquirer";
import { listEnvironments } from "../../models/environment.js";
import { listResources } from "../../models/resource.js";
import { toLayerChoices } from "../completion/choices.js";
import type { MigrateScope } from "../migrate-scope.js";
import { isCompositionResourceType } from "../layer-composition.js";
import {
  formatResourceSelectionLabel,
  sortResourcesByUpdatedAt,
  toResourceListRows,
} from "../../ui/resource-list-render.js";
import { promptForSearchableChoice, promptForValue } from "./shared.js";

export type MigrateExportWizardResult = {
  scope: MigrateScope;
  outputPath: string;
  layer?: string;
  resource?: string;
  environment?: string;
  embedPlugins?: boolean;
};

export async function runMigrateExportWizard(): Promise<MigrateExportWizardResult> {
  const { scope } = await inquirer.prompt<{ scope: MigrateScope }>([
    {
      type: "list",
      name: "scope",
      message: "What should be exported?",
      choices: [
        { name: "Workspace (full local library)", value: "workspace" },
        { name: "Layer", value: "layer" },
        { name: "Resource", value: "resource" },
        { name: "Environment", value: "environment" },
      ],
    },
  ]);

  if (scope === "layer") {
    const choices = toLayerChoices();
    const layer = choices.length > 0
      ? await promptForSearchableChoice({ message: "Which layer?", choices })
      : await promptForValue({ message: "Layer name or ID" });
    const firstLayer = layer.split(",")[0]?.trim() ?? "layer";
    const outputPath = await promptForValue({
      message: "Output file",
      default: `${firstLayer}.harnesstap.toml`,
    });
    const { embed } = await inquirer.prompt<{ embed: boolean }>([
      {
        type: "confirm",
        name: "embed",
        message: "Embed plugin trees?",
        default: false,
      },
    ]);
    return { scope, layer, outputPath, embedPlugins: embed };
  }

  if (scope === "resource") {
    const resources = sortResourcesByUpdatedAt(
      toResourceListRows(listResources()).filter(
        (resource) => !isCompositionResourceType(resource.type),
      ),
    );
    if (resources.length === 0) {
      throw new Error(
        "No exportable resources in workspace. Scan or create resources first.",
      );
    }
    const choices = resources.map((resource) => ({
      name: formatResourceSelectionLabel(resource),
      value: `${resource.type}:${resource.name}${resource.namespace ? `@${resource.namespace}` : ""}`,
    }));
    const resource = await promptForSearchableChoice({
      message: "Which resource?",
      choices,
    });
    const [type, rest] = resource.split(":");
    const name = rest?.split("@")[0] ?? "resource";
    const outputPath = await promptForValue({
      message: "Output file",
      default: `${type}-${name}.harnesstap.toml`,
    });
    return { scope, resource, outputPath };
  }

  if (scope === "environment") {
    const environments = listEnvironments();
    if (environments.length === 0) {
      throw new Error(
        "No environments in workspace. Create one with environment create first.",
      );
    }
    const choices = environments.map((environment) => ({
      name: environment.name,
      value: environment.name,
    }));
    const environment = await promptForSearchableChoice({
      message: "Which environment?",
      choices,
    });
    const outputPath = await promptForValue({
      message: "Output file",
      default: `${environment}.environment.toml`,
    });
    return { scope, environment, outputPath };
  }

  const outputPath = await promptForValue({
    message: "Output archive path",
    default: "./harnesstap-backup.tar.gz",
  });
  const { embed } = await inquirer.prompt<{ embed: boolean }>([
    {
      type: "confirm",
      name: "embed",
      message: "Embed plugin trees in layer exports?",
      default: false,
    },
  ]);
  return { scope, outputPath, embedPlugins: embed };
}
