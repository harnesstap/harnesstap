import type { Command } from "commander";
import {
  handleConfigInitCommand,
  handleConfigShowCommand,
  handleConfigValidateCommand,
} from "../../services/config-command.js";
import { configureCommandGroup } from "../help.js";
import { collectRepeatedOption } from "../shared.js";

export function registerConfigCommands(root: Command): void {
  const configCmd = configureCommandGroup(
    root
      .command("config")
      .description("Manage project profile config (.harnesstap/config.toml)"),
  );

  configCmd
    .command("show")
    .option("--project <path>", "Project directory", ".")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Show resolved project profile config")
    .action((opts: { project?: string; format?: string }) => {
      handleConfigShowCommand(opts);
    });

  configCmd
    .command("validate")
    .option("--project <path>", "Project directory", ".")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Validate project profile config references")
    .action((opts: { project?: string; format?: string }) => {
      handleConfigValidateCommand(opts);
    });

  configCmd
    .command("init")
    .option("--project <path>", "Project directory", ".")
    .option("--force", "Overwrite an existing .harnesstap/config.toml")
    .option(
      "--profile <name>",
      "Profile plugin to include (repeatable; defaults to all local profile plugins)",
      collectRepeatedOption,
      [],
    )
    .option("--default <name>", "Default profile key in project config")
    .option("--no-interactive", "Disable interactive prompts")
    .option("--interactive", "Enable interactive prompts")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Create a starter .harnesstap/config.toml from local profile plugins")
    .action(async (opts: {
      project?: string;
      force?: boolean;
      profile?: string[];
      default?: string;
      noInteractive?: boolean;
      interactive?: boolean;
      format?: string;
    }) => {
      await handleConfigInitCommand({
        project: opts.project,
        force: opts.force,
        profile: opts.profile,
        defaultProfile: opts.default,
        interactive: opts.interactive,
        noInteractive: opts.noInteractive,
        format: opts.format,
      });
    });
}
