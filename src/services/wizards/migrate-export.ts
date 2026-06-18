import inquirer from "inquirer";
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
      default: `${firstLayer}.harnessdeck.toml`,
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
      default: `${type}-${name}.harnessdeck.toml`,
    });
    return { scope, resource, outputPath };
  }

  const outputPath = await promptForValue({
    message: "Output archive path",
    default: "./harnessdeck-backup.tar.gz",
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
