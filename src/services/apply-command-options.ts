import type { Command } from "commander";

export interface ApplyCommandOpts {
  project: string;
  harness?: string;
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
}

export function addApplyCommandOptions(command: Command): Command {
  return command
    .option("--project <path>", "Project directory", ".")
    .option(
      "--harness <slugs>",
      "Comma-separated harness slugs (defaults to project or global harness preference)",
    )
    .option("--dry-run", "Show what would be written")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--interactive", "Prompt instead of relying on explicit flags")
    .option(
      "--ignore-plugin-versions",
      "Skip validating layer Claude plugin pins against installed versions",
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
      "When generated files already exist: replace, skip, or prompt (default: prompt on TTY, else replace)",
    )
    .option(
      "--strict",
      "Fail apply when ${VAR} environment placeholders cannot be resolved",
    );
}
