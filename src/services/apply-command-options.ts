import type { Command } from "commander";

export interface ApplyCommandOpts {
  project: string;
  harness?: string;
  target?: string;
  all?: boolean;
  failClosedTargets?: boolean;
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
}

export function addApplyCommandOptions(command: Command): Command {
  return command
    .option("--project <path>", "Project directory", ".")
    .option(
      "--harness <slugs>",
      "Comma-separated HarnessTap harness slugs (same resolution slot as --target)",
    )
    .option(
      "-t, --target <slugs>",
      "Comma-separated APM target slugs (cursor, claude, …). Wins over apm.yml targets: and auto-detect",
    )
    .option(
      "--all",
      "Install/apply every canonical target (not antigravity or agent-skills)",
    )
    .option("--dry-run", "Show what would be written")
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--interactive", "Prompt instead of relying on explicit flags")
    .option(
      "--ignore-plugin-versions",
      "Skip validating plugin Claude plugin pins against installed versions",
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
    );
}
