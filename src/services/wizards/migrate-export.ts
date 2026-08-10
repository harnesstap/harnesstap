import inquirer from "inquirer";
import { listResources } from "../../models/resource.js";
import { toPluginChoices } from "../completion/choices.js";
import type { MigrateScope } from "../migrate-scope.js";
import { isCompositionResourceType } from "../plugin-composition.js";
import { slugifyApName } from "../agent-plugins/name.js";
import {
  formatResourceSelectionLabel,
  sortResourcesByUpdatedAt,
  toResourceListRows,
} from "../../ui/resource-list-render.js";
import { promptForSearchableChoice, promptForValue } from "./shared.js";

export type MigrateExportWizardResult = {
  scope: MigrateScope;
  outputPath: string;
  plugin?: string;
  resource?: string;
  embedPlugins?: boolean;
  singleFile?: boolean;
};

export async function runMigrateExportWizard(): Promise<MigrateExportWizardResult> {
  const { scope } = await inquirer.prompt<{ scope: MigrateScope }>([
    {
      type: "list",
      name: "scope",
      message: "What should be exported?",
      choices: [
        { name: "Workspace (full local library)", value: "workspace" },
        { name: "Plugin", value: "plugin" },
        { name: "Resource", value: "resource" },
      ],
    },
  ]);

  if (scope === "plugin") {
    const choices = toPluginChoices();
    const plugin = choices.length > 0
      ? await promptForSearchableChoice({ message: "Which plugin?", choices })
      : await promptForValue({ message: "Plugin name or ID" });
    const firstPlugin = plugin.split(",")[0]?.trim() ?? "plugin";
    const apName = slugifyApName(firstPlugin);
    const { singleFile } = await inquirer.prompt<{ singleFile: boolean }>([
      {
        type: "confirm",
        name: "singleFile",
        message: "Write a single .ap.json envelope?",
        default: false,
      },
    ]);
    const outputPath = await promptForValue({
      message: "Output path",
      default: singleFile ? `./${apName}.ap.json` : `./${apName}`,
    });
    return { scope, plugin, outputPath, singleFile };
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
    const rest = resource.split(":")[1] ?? "resource";
    const name = slugifyApName(rest.split("@")[0] ?? "resource");
    const { singleFile } = await inquirer.prompt<{ singleFile: boolean }>([
      {
        type: "confirm",
        name: "singleFile",
        message: "Write a single .ap.json envelope?",
        default: false,
      },
    ]);
    const outputPath = await promptForValue({
      message: "Output path",
      default: singleFile ? `./${name}.ap.json` : `./${name}`,
    });
    return { scope, resource, outputPath, singleFile };
  }

  const outputPath = await promptForValue({
    message: "Output archive path",
    default: "./harnesstap-backup.tar.gz",
  });
  const { embed } = await inquirer.prompt<{ embed: boolean }>([
    {
      type: "confirm",
      name: "embed",
      message: "Embed plugin trees in plugin exports?",
      default: false,
    },
  ]);
  return { scope, outputPath, embedPlugins: embed };
}
