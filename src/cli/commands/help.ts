import type { Command } from "commander";
import { buildHelpCommandPayload, printHelpCommand } from "../../services/concepts-guide.js";
import { runCompleteCommand } from "../../services/completion/run-complete.js";
import {
  loadScenarioGuide,
  parseScenarioId,
} from "../../services/scenario-guide.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { formatCommand, GUIDE_SCENARIOS_URL } from "../shared.js";

function handleHelpCommand(opts: { format?: string }): void {
  const format = parseOutputFormat(opts.format);
  if (format === "json") {
    printJson(buildHelpCommandPayload());
    return;
  }
  printHelpCommand();
}

function handleScenarioGuideCommand(scenarioInput: string, opts: { format?: string }): void {
  const format = parseOutputFormat(opts.format);
  try {
    const scenario = loadScenarioGuide(parseScenarioId(scenarioInput));
    if (format === "json") {
      printJson(scenario);
      return;
    }

    console.log("");
    ui.subheader(`SCENARIO ${scenario.id}: ${scenario.title.toUpperCase()}`);
    if (scenario.frequency || scenario.status) {
      console.log("");
      ui.dim(
        [scenario.frequency, scenario.status].filter(Boolean).join(" · "),
      );
    }
    if (scenario.summaryLines.length > 0) {
      console.log("");
      for (const line of scenario.summaryLines) {
        console.log(`  ${line}`);
      }
    }
    if (scenario.commands.length > 0) {
      console.log("");
      ui.subheader("TYPICAL COMMANDS");
      console.log("");
      for (const command of scenario.commands) {
        console.log(`  ${formatCommand(command)}`);
      }
    }
    console.log("");
    ui.dim(`Full doc: docs/scenarios/details/${scenario.filename}`);
    ui.dim(`All scenarios: ${GUIDE_SCENARIOS_URL}`);
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err), {
      hints: [`ht help scenario 11`, `See ${GUIDE_SCENARIOS_URL}`],
    });
  }
}

export function registerHelpCommands(root: Command): void {
  const helpCommand = root
    .command("help")
    .description("Core concepts and scenario playbooks")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((opts: { format?: string }) => {
      handleHelpCommand(opts);
    });

  helpCommand
    .command("scenario")
    .argument("<id>", "Scenario number from docs/scenarios/scenarios.md")
    .description("Show a numbered scenario playbook from the docs")
    .option("--format <mode>", "Output format: human or json", "human")
    .action((id: string, opts: { format?: string }) => {
      handleScenarioGuideCommand(id, opts);
    });

  root
    .command("__complete")
    .argument("<shell>", "bash | zsh | fish")
    .argument("[line...]", "Partial command line")
    .description(false as unknown as string)
    .action(async (shell: string, line: string[]) => {
      await runCompleteCommand(shell, line, root);
    });
}
