import { Option, type Command } from "commander";
import { ON_CONFLICT_APPLY_HELP } from "../cli/on-conflict.js";

export interface ApplyCommandOpts {
  project: string;
  harness?: string;
  target?: string;
  all?: boolean;
  account?: string;
  baseUrl?: string;
  dryRun?: boolean;
  format?: string;
  ignorePluginVersions?: boolean;
  strictPluginVersions?: boolean;
  strict?: boolean;
  syncPlugins?: boolean;
  interactive?: boolean;
  noInteractive?: boolean;
  onConflict?: string;
  explain?: boolean;
  update?: boolean;
  force?: boolean;
  yes?: boolean;
  forceRemove?: boolean;
}

export function addApplyCommandOptions(command: Command): Command {
  return command
    .option("--project <path>", "Project directory", ".")
    .option(
      "--harness <slugs>",
      "Comma-separated harness slugs",
    )
    .addOption(
      new Option(
        "-t, --target <slugs>",
        "Hidden alias for --harness",
      ).hideHelp(),
    )
    .option(
      "--all",
      "Install/apply every canonical HT-mapped target (not agent-skills)",
    )
    .option("--dry-run", "Show what would be written")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--interactive", "Prompt instead of relying on explicit flags")
    .option(
      "--ignore-plugin-versions",
      "Skip checking Claude plugin pins against installed versions",
    )
    .option(
      "--strict-plugin-versions",
      "Fail apply (exit 2) if any pinned plugin violates its version constraint",
    )
    .option(
      "--sync-plugins",
      "Refresh all pinned plugin resources from install trees before apply (unresolved plugins are synced by default)",
    )
    .option(
      "--on-conflict <policy>",
      ON_CONFLICT_APPLY_HELP,
    )
    .option(
      "--explain",
      "Print the resolution trail: selected versions with their constraints, and every resource decision",
    )
    .option(
      "--update",
      "Ignore apm.lock.yaml, re-resolve the dependency graph, and refresh file hashes",
    )
    .option(
      "--strict",
      "Fail apply when ${VAR} environment placeholders cannot be resolved",
    )
    .option(
      "--force",
      "Override critical hidden-Unicode findings and continue apply",
    )
    .option("-y, --yes", "Install pinned marketplace plugins without a prompt")
    .option(
      "--force-remove",
      "Also remove managed files you changed and unmanaged files in the way",
    );
}
