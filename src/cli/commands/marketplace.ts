import type { Command } from "commander";
import type { PluginMarketplacePlatform } from "../../config/settings.js";
import { getHarnesstapDir } from "../../db/connection.js";
import {
  listCatalogPlugins,
  refreshMarketplaceCatalog,
  type RefreshMarketplaceCatalogResult,
} from "../../services/marketplace-catalog.js";
import {
  addMarketplace,
  listMarketplaces,
  normalizeMarketplaceUrl,
  removeMarketplace,
} from "../../services/marketplace-registry.js";
import {
  MarketplaceSourceError,
  assertMarketplaceSourceReachable,
} from "../../services/marketplace-validate.js";
import {
  promptForSearchableChoice,
  shouldUseBrowsePicker,
} from "../../services/wizards/shared.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { marketplaceUnreachable } from "../../copy/cli.js";
import { formatCount } from "../formatting.js";
import { configureCommandGroup } from "../help.js";
import { collectRepeatedOption, fail } from "../shared.js";

const VALID_PLATFORMS = new Set<PluginMarketplacePlatform>([
  "claude-code",
  "cursor",
  "goose",
  "copilot-cli",
]);

function parsePlatforms(platforms: string[] | undefined): PluginMarketplacePlatform[] {
  const ids = platforms && platforms.length > 0 ? platforms : ["claude-code"];
  const parsed: PluginMarketplacePlatform[] = [];
  for (const id of ids) {
    if (!VALID_PLATFORMS.has(id as PluginMarketplacePlatform)) {
      throw new Error(
        `Invalid --platform value: ${id}. Use claude-code, cursor, goose, or copilot-cli.`,
      );
    }
    parsed.push(id as PluginMarketplacePlatform);
  }
  return parsed;
}

function deriveMarketplaceNameFromUrl(url: string): string {
  const normalized = normalizeMarketplaceUrl(url);
  try {
    const parsed = new URL(normalized);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments.at(-1);
    if (last) {
      return last.replace(/\.git$/i, "");
    }
  } catch {
    // fall through to path split fallback
  }

  const last = normalized.split("/").filter(Boolean).at(-1);
  if (!last) {
    throw new Error("Could not derive marketplace name from URL; pass --name.");
  }
  return last.replace(/\.git$/i, "");
}

function requireMarketplaceEntry(name: string) {
  const entry = listMarketplaces(getHarnesstapDir()).find((marketplace) => marketplace.name === name);
  if (!entry) {
    throw new Error(`Marketplace not found: ${name}`);
  }
  return entry;
}

async function handleMarketplaceAddCommand(
  url: string,
  opts: {
    name?: string;
    platform?: string[];
    branch?: string[];
    format?: string;
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const harnesstapDir = getHarnesstapDir();
  const name = opts.name?.trim() || deriveMarketplaceNameFromUrl(url);
  const platforms = parsePlatforms(opts.platform);

  try {
    await assertMarketplaceSourceReachable(url);
  } catch (error) {
    if (error instanceof MarketplaceSourceError) {
      fail(error.message, error.hint ? { hint: error.hint } : undefined);
      return;
    }
    throw error;
  }

  const result = addMarketplace(harnesstapDir, {
    url,
    name,
    platforms,
    trackedBranches: opts.branch,
  });

  let refresh: RefreshMarketplaceCatalogResult | undefined;
  try {
    refresh = refreshMarketplaceCatalog(harnesstapDir, {
      name: result.entry.name,
      force: true,
    });
    if (!refresh.ok && result.status === "added") {
      removeMarketplace(harnesstapDir, result.entry.name);
      fail(marketplaceUnreachable(result.entry.url), {
        hint: refresh.message,
      });
      return;
    }
    if (!refresh.ok) {
      fail(marketplaceUnreachable(result.entry.url), {
        hint: refresh.message,
      });
      return;
    }
  } catch (error) {
    if (result.status === "added") {
      removeMarketplace(harnesstapDir, result.entry.name);
    }
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  if (format === "json") {
    printJson({
      status: result.status,
      entry: result.entry,
      ...(refresh ? { refresh } : {}),
    });
    return;
  }

  if (result.status === "already_configured") {
    ui.info(`Marketplace already configured: ${result.entry.name}`);
    return;
  }

  ui.success(`Added marketplace: ${result.entry.name}`, {
    hint: result.entry.url,
  });
}

function handleMarketplaceListCommand(opts: { format?: string } = {}): void {
  const format = parseOutputFormat(opts.format);
  const marketplaces = listMarketplaces(getHarnesstapDir());

  if (format === "json") {
    printJson({ marketplaces });
    return;
  }

  if (marketplaces.length === 0) {
    ui.dim("No marketplaces configured.");
    return;
  }

  ui.table.print({
    columns: [
      { key: "name", header: "NAME", width: 24 },
      { key: "url", header: "URL", width: 48 },
      { key: "platforms", header: "PLATFORMS", width: 24 },
    ],
    rows: marketplaces.map((entry) => ({
      name: entry.name,
      url: entry.url,
      platforms: entry.platforms.join(", "),
    })),
    summary: formatCount(marketplaces.length, "marketplace"),
    empty: "No marketplaces configured.",
  });
}

function handleMarketplaceRemoveCommand(name: string, opts: { format?: string } = {}): void {
  const format = parseOutputFormat(opts.format);
  const result = removeMarketplace(getHarnesstapDir(), name);
  if (result.status === "not_found") {
    throw new Error(`Marketplace not found: ${name}`);
  }

  if (format === "json") {
    printJson(result);
    return;
  }

  ui.success(`Removed marketplace: ${result.entry.name}`);
}

async function handleMarketplaceShowCommand(
  name: string,
  opts: {
    refresh?: boolean;
    format?: string;
    noInteractive?: boolean;
  } = {},
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const harnesstapDir = getHarnesstapDir();
  requireMarketplaceEntry(name);

  let refresh: RefreshMarketplaceCatalogResult | undefined;
  if (opts.refresh) {
    refresh = refreshMarketplaceCatalog(harnesstapDir, { name, force: true });
    if (!refresh.ok) {
      throw new Error(refresh.message);
    }
  }

  const plugins = listCatalogPlugins(harnesstapDir, { name });
  const useBrowsePicker = shouldUseBrowsePicker({
    noInteractive: opts.noInteractive,
    format: opts.format,
  });

  if (useBrowsePicker) {
    if (plugins.length === 0) {
      throw new Error(
        `No plugins in catalog for "${name}". Try marketplace show ${name} --refresh.`,
      );
    }

    const selectedRef = await promptForSearchableChoice({
      message: `Select a plugin from ${name}`,
      choices: plugins.map((plugin) => ({
        name: plugin.description
          ? `${plugin.name}: ${plugin.description}`
          : plugin.name,
        value: plugin.ref,
        description: plugin.version ? `v${plugin.version}` : undefined,
      })),
    });

    if (format === "json") {
      printJson({
        name,
        ref: selectedRef,
        ...(refresh ? { refresh } : {}),
      });
      return;
    }

    console.log(selectedRef);
    return;
  }

  if (format === "json") {
    printJson({
      name,
      plugins,
      ...(refresh ? { refresh } : {}),
    });
    return;
  }

  if (plugins.length === 0) {
    ui.dim(`No plugins in catalog for "${name}". Try: marketplace show ${name} --refresh`);
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
    summary: formatCount(plugins.length, "plugin"),
    empty: `No plugins in catalog for "${name}".`,
  });
}

export function registerMarketplaceCommands(root: Command): void {
  const marketplaceCmd = configureCommandGroup(
    root
      .command("marketplace")
      .alias("mkt")
      .description("Manage plugin marketplace sources"),
  );

  marketplaceCmd
    .command("add")
    .argument("<url>", "Marketplace git URL, file:// URL, or local git path")
    .option("--name <id>", "Marketplace registry name")
    .option(
      "--platform <id>",
      "Target platform (repeatable; default: claude-code)",
      collectRepeatedOption,
      [],
    )
    .option(
      "--branch <name>",
      "Extra git branch to catalog (repeatable; default: the repo default branch only)",
      collectRepeatedOption,
      [],
    )
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--no-interactive", "Disable interactive prompts")
    .description("Register a plugin marketplace git URL or local path")
    .action(handleMarketplaceAddCommand);

  marketplaceCmd
    .command("list")
    .alias("ls")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("List configured plugin marketplaces")
    .action(handleMarketplaceListCommand);

  marketplaceCmd
    .command("remove")
    .alias("rm")
    .argument("<name>", "Marketplace registry name to remove")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Remove a configured plugin marketplace")
    .action(handleMarketplaceRemoveCommand);

  marketplaceCmd
    .command("show")
    .argument("<name>", "Marketplace registry name to browse")
    .option("--refresh", "Refresh the marketplace catalog before listing")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--no-interactive", "Disable interactive browse picker")
    .description("List or browse plugins from a marketplace catalog")
    .action(handleMarketplaceShowCommand);
}
