import type { Command } from "commander";
import { getDb } from "../../db/connection.js";
import { initializeSchema } from "../../db/schema.js";
import { getPlugin } from "../../models/plugin-model.js";
import { type DuplicateMode, type DuplicateResult, detachPlugin, duplicatePlugin } from "../../services/plugin-duplicate.js";
import { duplicateInCloud } from "../../services/plugin-duplicate-cloud.js";
import { ExtendsError, listPluginExcludes, setPluginExcludes } from "../../services/plugin-extends.js";
import { PluginForkError } from "../../services/plugin-fork.js";
import { PluginVersionError } from "../../services/plugin-versioning.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCommand } from "../shared.js";

function reportError(error: unknown, hints: string[] = []): void {
  process.exitCode = 1;
  if (error instanceof ExtendsError && error.hint) {
    ui.danger(error.message, { hints: [error.hint, ...hints] });
    return;
  }
  if (error instanceof PluginForkError && error.code === "plugin_exists") {
    ui.danger(error.message, { hints: [`${formatCommand(["profile", "duplicate", error.sourceName ?? "<source>"])} <name>`] });
    return;
  }
  if (error instanceof ExtendsError || error instanceof PluginForkError || error instanceof PluginVersionError) {
    ui.danger(error.message, hints.length > 0 ? { hints } : undefined);
    return;
  }
  ui.danger(error instanceof Error ? error.message : String(error));
}

function renderLocalDuplicate(result: DuplicateResult, format: string): void {
  const { plugin, upstream, linked_to, mode } = result;
  if (format === "json") {
    printJson({ name: plugin.name, version: plugin.version, mode, linked_to, upstream });
    return;
  }
  if (mode === "inherit") {
    ui.success(`Created ${ui.theme.accent(plugin.name)}, kept in sync with ${linked_to}`);
    ui.hint(`Parent updates show up here. Hide an item: ${formatCommand(["plugin", "edit", plugin.name])} --hide skill:<name>`);
    return;
  }
  ui.success(`Created ${ui.theme.accent(plugin.name)}, a separate copy of ${linked_to}`);
  ui.hint(formatCommand(["plugin", "edit", plugin.name]));
}

export async function handleProfileDuplicateCommand(
  source: string,
  name: string | undefined,
  opts: { copy?: boolean; inherit?: boolean; format?: string; to?: string; account?: string } = {},
): Promise<void> {
  initializeSchema(getDb());
  const format = parseOutputFormat(opts.format);
  if (opts.copy && opts.inherit) {
    process.exitCode = 1;
    ui.danger("Choose one of --inherit (keep in sync) or --copy (separate copy).");
    return;
  }
  const mode: DuplicateMode = opts.copy ? "copy" : "inherit";
  if (opts.to) {
    try {
      const outcome = await duplicateInCloud(source, {
        ...(name ? { name } : {}),
        mode,
        to: opts.to,
        ...(opts.account ? { account: opts.account } : {}),
      });
      if (outcome.kind === "local") {
        if (format !== "json") ui.info("Cloud cannot duplicate profiles yet, so the copy was made in your Library.");
        renderLocalDuplicate(outcome.result, format);
        if (format !== "json") {
          const [org, catalog] = opts.to.split("/");
          ui.hint(`Publish it: ${formatCommand(["plugin", "publish", outcome.result.plugin.name, "--org", org ?? "", "--catalog", catalog || "default"])}`);
        }
        return;
      }
      const { response } = outcome;
      const upstream = response.publishedVersion?.upstream;
      if (format === "json") {
        printJson({ selector: response.selector, version: response.version, mode: response.mode, upstream: upstream ?? null, cloud: true });
        return;
      }
      const link = upstream?.ref ?? source;
      ui.success(
        response.mode === "copy"
          ? `Published ${ui.theme.accent(response.selector)} ${response.version}, a separate copy of ${link}`
          : `Published ${ui.theme.accent(response.selector)} ${response.version}, kept in sync with ${link}`,
      );
      ui.hint(`Get it locally: ${formatCommand(["profile", "pull", response.selector])}`);
    } catch (error) {
      reportError(error);
    }
    return;
  }
  let result: DuplicateResult;
  try {
    result = duplicatePlugin(source, { ...(name ? { name } : {}), mode });
  } catch (error) {
    reportError(error);
    return;
  }
  renderLocalDuplicate(result, format);
}

export function handleProfileDetachCommand(name: string, opts: { format?: string } = {}): void {
  initializeSchema(getDb());
  const format = parseOutputFormat(opts.format);
  let result: ReturnType<typeof detachPlugin>;
  try {
    result = detachPlugin(name);
  } catch (error) {
    reportError(error);
    return;
  }
  const { plugin, materialized, hidden } = result;
  if (format === "json") {
    printJson({ name: plugin.name, upstream: plugin.upstream ?? null, materialized, hidden_cleared: hidden });
    return;
  }
  ui.success(
    `Detached ${ui.theme.accent(plugin.name)}: ${materialized} inherited ${materialized === 1 ? "item is" : "items are"} now its own. Nothing was deleted.`,
  );
  if (hidden.length > 0) {
    ui.info(`Hidden items no longer apply and stay out of the copy: ${hidden.join(", ")}`);
  }
  ui.hint(`Not applied yet. Run ${formatCommand(["profile", "use", plugin.name])} to apply it.`);
}

/** `--hide` / `--unhide` on `plugin edit`. Returns false when neither was passed. */
export function handlePluginHideOptions(
  name: string | undefined,
  opts: { hide?: string[]; unhide?: string[]; format?: string },
): boolean {
  const hide = opts.hide ?? [];
  const unhide = opts.unhide ?? [];
  if (hide.length === 0 && unhide.length === 0) return false;
  initializeSchema(getDb());
  const plugin = name ? getPlugin(name) : undefined;
  if (!plugin) {
    process.exitCode = 1;
    ui.danger(name ? `Plugin not found: ${name}` : "Name the profile to edit.");
    return true;
  }
  try {
    const next = new Set(listPluginExcludes(plugin.id));
    for (const entry of hide) next.add(entry.trim());
    for (const entry of unhide) next.delete(entry.trim());
    const entries = setPluginExcludes(plugin.id, [...next]);
    if (parseOutputFormat(opts.format) === "json") {
      printJson({ name: plugin.name, hidden: entries });
      return true;
    }
    ui.success(
      entries.length > 0
        ? `${plugin.name} hides ${entries.join(", ")}`
        : `${plugin.name} shows every item from its parent`,
    );
  } catch (error) {
    reportError(error);
  }
  return true;
}

export function registerProfileDuplicateCommands(profileCmd: Command): void {
  profileCmd
    .command("duplicate")
    .argument("<source>", "Profile or plugin to duplicate")
    .argument("[name]", "Name for the new profile (default: <source>-copy)")
    .option("--inherit", "Keep in sync: show the parent's items live and store only your changes (default)")
    .option("--copy", "Separate copy: copy the items now; later parent changes do not apply")
    .option("--to <org/catalog>", "Duplicate in Cloud and publish to this catalog (source must be in a catalog)")
    .option("--account <name>", "Cloud account to use with --to")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Duplicate a profile, kept in sync with it or as a separate copy")
    .action(
      async (
        source: string,
        name: string | undefined,
        opts: { inherit?: boolean; copy?: boolean; format?: string; to?: string; account?: string },
      ) => {
        await handleProfileDuplicateCommand(source, name, opts);
      },
    );

  profileCmd
    .command("detach")
    .argument("<name>", "Profile that keeps in sync with a parent")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Stop keeping a profile in sync: its current items become its own (Library only)")
    .action((name: string, opts: { format?: string }) => {
      handleProfileDetachCommand(name, opts);
    });
}
