import type { Command } from "commander";
import { getHarnesstapDir } from "../../db/connection.js";
import { listPlugins } from "../../models/plugin-model.js";
import { CliUsageError } from "../../services/cli-errors.js";
import {
  type CatalogPlugin,
  searchCatalogPlugins,
} from "../../services/marketplace-catalog.js";
import {
  addPluginFromMarketplace,
  type AddPluginFromMarketplaceResult,
} from "../../services/plugin-marketplace-add.js";
import {
  promptForChoice,
  promptForSearchableChoice,
  promptForValue,
  shouldUseBrowsePicker,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { resolveHomeRoot } from "../../utils/home-root.js";
import {
  type OutputFormat,
  parseOutputFormat,
  printJson,
} from "../../utils/output-format.js";
import { configureCommandGroup } from "../help.js";
import { renderCliError } from "../runtime.js";

async function resolvePluginName(
  pluginOpt: string | undefined,
  shouldPrompt: boolean,
): Promise<string | undefined> {
  const trimmed = pluginOpt?.trim();
  if (trimmed) {
    return trimmed;
  }

  if (!shouldPrompt) {
    return undefined;
  }

  const plugins = listPlugins();
  if (plugins.length > 0) {
    return promptForChoice({
      message: "Select a plugin for the plugin pin",
      choices: plugins.map((plugin) => ({
        name: plugin.name,
        value: plugin.name,
      })),
    });
  }

  return promptForValue({
    message: "Enter a plugin name for the plugin pin",
  });
}

function printPluginSearchResults(
  plugins: CatalogPlugin[],
  format: OutputFormat,
): void {
  if (format === "json") {
    printJson({ plugins });
    return;
  }

  if (plugins.length === 0) {
    ui.dim("No plugins matched your search.");
    return;
  }

  ui.table.print({
    columns: [
      { key: "name", header: "NAME", width: 24 },
      { key: "ref", header: "REF", width: 32 },
      { key: "version", header: "VERSION", width: 12 },
      { key: "description", header: "DESCRIPTION", width: 40 },
    ],
    rows: plugins.map((plugin) => ({
      name: plugin.name,
      ref: plugin.ref,
      version: plugin.version ?? "",
      description: plugin.description ?? "",
    })),
    summary: `${plugins.length} plugin${plugins.length === 1 ? "" : "s"}`,
    empty: "No plugins matched your search.",
  });
}

function printPluginAddResult(
  result: AddPluginFromMarketplaceResult,
  format: OutputFormat,
): void {
  if (format === "json") {
    printJson(result);
    return;
  }

  if (result.status === "already_attached") {
    ui.info(`Plugin pin already attached: ${result.ref} on ${result.pluginName}`);
    return;
  }

  ui.success(`Attached plugin pin ${result.ref} to plugin ${result.pluginName}`);
}

async function addPluginPin(
  ref: string,
  pluginName: string,
  format: OutputFormat,
): Promise<void> {
  const result = await addPluginFromMarketplace({
    harnesstapDir: getHarnesstapDir(),
    homeRoot: resolveHomeRoot(),
    projectRoot: process.cwd(),
    ref,
    pluginName,
  });
  printPluginAddResult(result, format);
}

async function handlePluginSearchCommand(
  query: string | undefined,
  opts: {
    refresh?: boolean;
    format?: string;
    plugin?: string;
    noInteractive?: boolean;
  } = {},
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const harnesstapDir = getHarnesstapDir();
  const useBrowsePicker = shouldUseBrowsePicker({
    noInteractive: opts.noInteractive,
    format: opts.format,
  });

  if (useBrowsePicker) {
    const plugins = searchCatalogPlugins(harnesstapDir, query ?? "", {
      refresh: opts.refresh,
    });
    if (plugins.length === 0) {
      throw new Error(
        "No plugins found. Try plugin search <query> --refresh.",
      );
    }

    const selectedRef = await promptForSearchableChoice({
      message: "Select a plugin to add",
      choices: plugins.map((plugin) => ({
        name: plugin.description
          ? `${plugin.name} — ${plugin.description}`
          : plugin.name,
        value: plugin.ref,
        description: plugin.version ? `v${plugin.version}` : undefined,
      })),
    });

    const pluginName = await resolvePluginName(opts.plugin, true);
    if (!pluginName) {
      process.exitCode = 2;
      renderCliError(
        new CliUsageError(
          "Plugin is required. Pass --plugin <name> to choose which plugin receives the plugin pin.",
          ["Run `ht plugin search --help` for usage."],
          2,
        ),
      );
      return;
    }

    await addPluginPin(selectedRef, pluginName, format);
    return;
  }

  const plugins = searchCatalogPlugins(harnesstapDir, query ?? "", {
    refresh: opts.refresh,
  });
  printPluginSearchResults(plugins, format);
}

async function handlePluginAddCommand(
  ref: string,
  opts: {
    plugin?: string;
    format?: string;
    noInteractive?: boolean;
  } = {},
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const useBrowsePicker = shouldUseBrowsePicker({
    noInteractive: opts.noInteractive,
    format: opts.format,
  });

  const pluginName = await resolvePluginName(
    opts.plugin,
    useBrowsePicker,
  );
  if (!pluginName) {
    process.exitCode = 2;
    renderCliError(
      new CliUsageError(
        "Plugin is required. Pass --plugin <name> to choose which plugin receives the plugin pin.",
        ["Run `ht plugin add --help` for usage."],
        2,
      ),
    );
    return;
  }

  await addPluginPin(ref, pluginName, format);
}

export function registerPluginCommands(root: Command): void {
  const pluginCmd = configureCommandGroup(
    root
      .command("plugin")
      .description("Search and add plugins from marketplaces"),
  );

  pluginCmd
    .command("search")
    .argument("[query]", "Search query for marketplace plugins")
    .option("--refresh", "Refresh marketplace catalogs before searching")
    .option("--plugin <name>", "Plugin to attach the selected plugin pin to")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--no-interactive", "Disable interactive browse picker")
    .description("Search marketplace catalogs for plugins")
    .action(handlePluginSearchCommand);

  pluginCmd
    .command("add")
    .argument("<ref>", "Plugin ref as name@marketplace")
    .option("--plugin <name>", "Plugin to attach the plugin pin to")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--no-interactive", "Disable interactive prompts")
    .description("Attach a marketplace plugin pin to a plugin")
    .action(handlePluginAddCommand);
}
