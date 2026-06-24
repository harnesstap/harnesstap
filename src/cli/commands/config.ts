import type { Command } from "commander";
import {
  handleConfigInitCommand,
  handleConfigShowCommand,
  handleConfigValidateCommand,
} from "../../services/config-command.js";
import { configureCommandGroup } from "../help.js";

export function registerConfigCommands(root: Command): void {
  const configCmd = configureCommandGroup(
    root
      .command("config")
      .description("Inspect and validate project profile config (.harnessdeck/config.toml)"),
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
    .description("Create a starter .harnessdeck/config.toml (not yet implemented)")
    .action(() => {
      handleConfigInitCommand();
    });
}
