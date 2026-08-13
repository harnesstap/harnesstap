import { Option, type Command } from "commander";
import { isPromptCancellationError } from "../../services/wizards/shared.js";
import { CliUsageError } from "../../services/cli-errors.js";
import { COMMAND_HELP_REGISTRY } from "../../services/cli-help-registry.js";
import { ui } from "../../ui/index.js";
import { renderCliError } from "../runtime.js";
import {
  handleProfileAddAllResourcesCommand,
  handleProfileAddResourceCommand,
  handleProfileCommitResourceCommand,
  handleProfileFileDiffCommand,
  handleProfileRemoveResourceCommand,
  handleProfileRestoreFileCommand,
} from "../handlers/profile-live-files.js";

function addFormatInteractiveOptions(cmd: Command): Command {
  return cmd
    .option("--format <mode>", "Output format: human or json", "human")
    .option("--no-interactive", "Disable interactive prompts")
    .option("--interactive", "Enable interactive prompts");
}

function addLiveScopeOptions(cmd: Command): Command {
  return addFormatInteractiveOptions(cmd)
    .addOption(
      new Option("--scope <home|project>", "home or project")
        .choices(["home", "project"])
        .makeOptionMandatory(),
    )
    .option("--project <path>", "Project path (required when --scope project)")
    .option("--harness <slug>", "Harness slug");
}

async function runLiveAction(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    if (isPromptCancellationError(err)) {
      ui.info("Operation cancelled.");
      process.exitCode = 0;
      return;
    }
    process.exitCode = 1;
    if (err instanceof CliUsageError) {
      renderCliError(err);
      return;
    }
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

function assignLiveFileHelp(): void {
  COMMAND_HELP_REGISTRY["profile.add-resource"] = {
    description: "Adopt one untracked on-disk resource into the profile library",
    examples: [
      "profile add-resource work --selector skill:foo --scope home",
      "profile add-resource work --selector skill:foo --scope project --project . --format json",
    ],
  };
  COMMAND_HELP_REGISTRY["profile.add-all-resources"] = {
    description: "Adopt every untracked material resource in the scope",
    examples: [
      "profile add-all-resources work --scope home",
      "profile add-all-resources work --scope project --project . --format json",
    ],
  };
  COMMAND_HELP_REGISTRY["profile.commit-resource"] = {
    description: "Snapshot live disk into the profile library",
    examples: [
      "profile commit-resource work --path .claude/skills/foo/SKILL.md --scope home",
      "profile commit-resource work --selector skill:foo --scope home --format json",
    ],
  };
  COMMAND_HELP_REGISTRY["profile.remove-resource"] = {
    description: "Detach a material resource from the profile stack",
    examples: [
      "profile remove-resource work --selector skill:foo -y",
      "profile remove-resource work --selector skill:foo --format json -y",
    ],
  };
  COMMAND_HELP_REGISTRY["profile.restore-file"] = {
    description: "Overwrite the live managed file with the profile snapshot",
    examples: [
      "profile restore-file work --path .claude/skills/foo/SKILL.md --scope home -y",
      "profile restore-file work --path .claude/skills/foo/SKILL.md --scope home --format json -y",
    ],
  };
  COMMAND_HELP_REGISTRY["profile.file-diff"] = {
    description: "Show expected snapshot vs live content as a unified diff",
    examples: [
      "profile file-diff work --path .claude/skills/foo/SKILL.md --scope home",
      "profile file-diff work --path .claude/skills/foo/SKILL.md --scope home --format json",
    ],
  };
}

export function registerProfileLiveFileCommands(profileCmd: Command): void {
  assignLiveFileHelp();

  addLiveScopeOptions(
    profileCmd
      .command("add-resource")
      .argument("<name>", "Profile plugin name or selector")
      .requiredOption("--selector <type:name>", "Resource selector")
      .description("Adopt one untracked on-disk resource into the profile library"),
  ).action(async (name: string, opts) => {
    await runLiveAction(() => handleProfileAddResourceCommand(name, opts));
  });

  addLiveScopeOptions(
    profileCmd
      .command("add-all-resources")
      .argument("<name>", "Profile plugin name or selector")
      .description("Adopt every untracked material resource in the scope"),
  ).action(async (name: string, opts) => {
    await runLiveAction(() => handleProfileAddAllResourcesCommand(name, opts));
  });

  addLiveScopeOptions(
    profileCmd
      .command("commit-resource")
      .argument("<name>", "Profile plugin name or selector")
      .option("--path <path>", "Managed relative path")
      .option("--selector <type:name>", "Resource selector")
      .description("Snapshot live disk into the profile library"),
  ).action(async (name: string, opts) => {
    await runLiveAction(() => handleProfileCommitResourceCommand(name, opts));
  });

  addFormatInteractiveOptions(
    profileCmd
      .command("remove-resource")
      .argument("<name>", "Profile plugin name or selector")
      .requiredOption("--selector <type:name>", "Resource selector")
      .option("--plugin-id <id>", "Plugin id in the profile stack")
      .option("-y, --yes", "Skip the confirmation prompt")
      .description("Detach a material resource from the profile stack"),
  ).action(async (name: string, opts) => {
    await runLiveAction(() => handleProfileRemoveResourceCommand(name, opts));
  });

  addLiveScopeOptions(
    profileCmd
      .command("restore-file")
      .argument("<name>", "Profile plugin name or selector")
      .requiredOption("--path <path>", "Managed relative path")
      .option("-y, --yes", "Skip the confirmation prompt")
      .description("Overwrite the live managed file with the profile snapshot"),
  ).action(async (name: string, opts) => {
    await runLiveAction(() => handleProfileRestoreFileCommand(name, opts));
  });

  addLiveScopeOptions(
    profileCmd
      .command("file-diff")
      .argument("<name>", "Profile plugin name or selector")
      .requiredOption("--path <path>", "Managed relative path")
      .description("Show expected snapshot vs live content as a unified diff"),
  ).action(async (name: string, opts) => {
    await runLiveAction(() => handleProfileFileDiffCommand(name, opts));
  });
}
